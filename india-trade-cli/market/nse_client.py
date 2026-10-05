"""
market/nse_client.py
────────────────────
Singleton NSE client wrapper around the `nse` Python package (v3.2.1+).

Provides NSE India data without broker credentials or API keys.
The `nse` package handles cookie-based session authentication automatically.

Key design decisions:
  - Singleton: `nse_client` is module-level; do NOT instantiate _NSEClient directly
  - Global throttle: min 0.35s between any NSE API call (3 req/s NSE rate limit)
  - Retry-once on TimeoutError / ConnectionError (1s sleep between attempts)
  - Graceful degradation: returns None on failure, never raises into caller

NSE constructor signature: NSE(download_folder, server=False, timeout=15)
  - download_folder is required; we use a local ./nse_downloads/ temp dir

Actual method names (verified against nse package):
  equityQuote / equityMetaInfo, financial_results, results_comparison,
  shareholding, actions, boardMeetings, announcements, annual_reports,
  optionChain, fetch_historical_vix_data, quote

Usage:
    from market.nse_client import nse_client
    quote = nse_client.get_quote("RELIANCE")
    results = nse_client.get_results_comparison("RELIANCE")
"""

from __future__ import annotations

import logging
import os
import time
import threading
from typing import Optional, Any

logger = logging.getLogger(__name__)

# ── Global throttle state ─────────────────────────────────────
_THROTTLE_LOCK = threading.Lock()
_LAST_CALL_TS: float = 0.0
_MIN_INTERVAL: float = 0.35  # seconds — 3 req/s NSE rate limit


def _throttle() -> None:
    """Block until the minimum inter-call interval has elapsed."""
    global _LAST_CALL_TS
    with _THROTTLE_LOCK:
        elapsed = time.monotonic() - _LAST_CALL_TS
        if elapsed < _MIN_INTERVAL:
            time.sleep(_MIN_INTERVAL - elapsed)
        _LAST_CALL_TS = time.monotonic()


def _safe_call(fn, *args, **kwargs) -> Optional[Any]:
    """
    Throttled, retry-once wrapper.
    Returns None and logs on any failure — never propagates exceptions.
    """
    for attempt in range(2):
        try:
            _throttle()
            return fn(*args, **kwargs)
        except (TimeoutError, ConnectionError, OSError) as e:
            if attempt == 0:
                logger.warning(f"[NSEClient] Network error (attempt 1), retrying: {e}")
                time.sleep(1.0)
            else:
                logger.error(f"[NSEClient] Network error after retry: {e}")
                return None
        except Exception as e:
            logger.error(f"[NSEClient] {type(e).__name__}: {e}")
            return None
    return None


class _NSEClient:
    """Process-singleton wrapping the nse package's NSE class."""

    def __init__(self):
        self._nse = None
        self._session = None
        self._init_lock = threading.Lock()
        self._fiidii_cache: Optional[tuple] = None
        self._FIIDII_TTL = 15 * 60  # 15 minutes

        # Download folder for the nse package (required constructor arg)
        self._download_folder = os.path.join(
            os.path.dirname(__file__), "nse_downloads"
        )

    def _init(self) -> bool:
        """Lazy-init the NSE instance. Returns True if ready."""
        if self._nse is not None:
            return True
        with self._init_lock:
            if self._nse is not None:
                return True
            try:
                os.makedirs(self._download_folder, exist_ok=True)
                from nse import NSE  # type: ignore
                self._nse = NSE(self._download_folder)
                # Grab the package's internal requests.Session for FII/DII reuse
                for attr in ("session", "_session", "s", "_s", "client"):
                    s = getattr(self._nse, attr, None)
                    if s is not None and hasattr(s, "get"):
                        self._session = s
                        break
                logger.info("[NSEClient] NSE package initialised (download_folder=%s)", self._download_folder)
                return True
            except ImportError:
                logger.error("[NSEClient] `nse` package not installed. Run: pip install nse>=3.2.1")
                return False
            except Exception as e:
                logger.error(f"[NSEClient] Failed to init: {e}")
                return False

    def _m(self, *names: str):
        """Resolve an nse-package method across versions (3.x camelCase vs 4.x/5.x snake_case)."""
        for name in names:
            fn = getattr(self._nse, name, None)
            if callable(fn):
                return fn

        def _missing(*_a, **_k):
            raise AttributeError(f"nse package has none of: {', '.join(names)}")
        return _missing

    # ── Market Quote ──────────────────────────────────────────

    def get_quote(self, symbol: str) -> Optional[dict]:
        """
        Live NSE quote. Tries equityQuote → equityMetaInfo → quote fallback.
        Returns dict with lastPrice / ltp, previousClose, pChange, totalTradedVolume,
        yearHigh, yearLow, or None on failure.
        """
        if not self._init():
            return None
        # Try the primary equity quote endpoint
        result = _safe_call(self._m("equityQuote", "equity_quote"), symbol.upper())
        if result is None:
            result = _safe_call(self._m("equityMetaInfo", "equity_meta_info"), symbol.upper())
        if result is None:
            result = _safe_call(self._nse.quote, symbol.upper())
        return result

    # ── Financial Results ─────────────────────────────────────

    def get_financial_results(self, symbol: str) -> Optional[dict]:
        """
        Filing metadata: audited/consolidated flags, XBRL links, filing dates.
        NSE method: financial_results(symbol)
        """
        if not self._init():
            return None
        return _safe_call(self._nse.financial_results, symbol.upper())

    def get_results_comparison(self, symbol: str) -> Optional[list]:
        """
        ~5 quarters of revenue/net_profit/EPS from NSE.
        NSE method: results_comparison(symbol)

        Units: NSE returns values in ₹ Lakhs — we convert to ₹ Crores
        by dividing by 100 (documented inline in the dict as {field}_unit).
        Returns a list of quarterly dicts or None on failure.
        """
        if not self._init():
            return None
        raw = _safe_call(self._nse.results_comparison, symbol.upper())
        if not raw:
            return None
        # Normalise: convert Lakhs → Crores
        normalised = []
        items = raw if isinstance(raw, list) else [raw]
        for q in items:
            if not isinstance(q, dict):
                continue
            entry = dict(q)
            for field in ("income", "revenue", "totalIncome", "profit", "netProfit",
                          "netProfitAfterTax", "eps", "total_income", "net_profit"):
                if field in entry and entry[field] is not None:
                    try:
                        entry[field] = round(float(entry[field]) / 100, 2)
                        entry[f"{field}_unit"] = "₹ Crores"
                    except (TypeError, ValueError):
                        pass
            normalised.append(entry)
        return normalised or None

    # ── Shareholding ──────────────────────────────────────────

    def get_shareholding(self, symbol: str) -> Optional[dict]:
        """
        Quarterly promoter / public / FII / DII holding history.
        NSE method: shareholding(symbol)
        """
        if not self._init():
            return None
        return _safe_call(self._nse.shareholding, symbol.upper())

    # ── Corporate Actions ─────────────────────────────────────

    def get_actions(self, symbol: str) -> Optional[list]:
        """Dividends, bonuses, splits, rights. NSE method: actions(symbol=symbol)"""
        if not self._init():
            return None
        return _safe_call(self._nse.actions, symbol=symbol.upper())

    def get_board_meetings(self, symbol: str) -> Optional[list]:
        """Upcoming and recent board meetings. NSE method: boardMeetings(symbol=symbol)"""
        if not self._init():
            return None
        return _safe_call(self._m("boardMeetings", "board_meetings"), symbol=symbol.upper())

    def get_announcements(self, symbol: str) -> Optional[list]:
        """Exchange filings and announcements. NSE method: announcements(symbol=symbol)"""
        if not self._init():
            return None
        return _safe_call(self._nse.announcements, symbol=symbol.upper())

    def get_annual_reports(self, symbol: str) -> Optional[list]:
        """Annual report PDF links. NSE method: annual_reports(symbol=symbol)"""
        if not self._init():
            return None
        return _safe_call(self._nse.annual_reports, symbol=symbol.upper())

    # ── VIX / Options ─────────────────────────────────────────

    def get_vix_history(self, from_date: str, to_date: str) -> Optional[Any]:
        """India VIX historical. NSE method: fetch_historical_vix_data(from_date, to_date)
        Date format: 'DD-MM-YYYY'"""
        if not self._init():
            return None
        # nse>=4 wants datetime.date objects; older versions took DD-MM-YYYY strings.
        try:
            from datetime import datetime as _dt
            fd, td = _dt.strptime(from_date, "%d-%m-%Y").date(), _dt.strptime(to_date, "%d-%m-%Y").date()
            res = _safe_call(self._nse.fetch_historical_vix_data, fd, td)
            if res is not None:
                return res
        except ValueError:
            pass
        return _safe_call(self._nse.fetch_historical_vix_data, from_date, to_date)

    def get_option_chain(self, symbol: str) -> Optional[dict]:
        """Full option chain for stock or index. NSE method: optionChain(symbol)"""
        if not self._init():
            return None
        return _safe_call(self._m("optionChain", "option_chain"), symbol.upper())

    # ── FII/DII Flows ─────────────────────────────────────────

    def get_fii_dii(self) -> Optional[list]:
        """
        FII/DII daily activity from NSE API endpoint /api/fiidiiTradeReact.
        Reuses or establishes an authenticated session with NSE cookies.
        Cached for _FIIDII_TTL (15 min).
        Returns [{date, fii_net_cr, dii_net_cr, fii_buy_cr, fii_sell_cr,
                  dii_buy_cr, dii_sell_cr}] or empty list.
        """
        if self._fiidii_cache is not None:
            ts, data = self._fiidii_cache
            if time.time() - ts < self._FIIDII_TTL:
                return data

        self._init()

        session = self._session
        if session is None:
            try:
                import requests
                s = requests.Session()
                s.headers.update({
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
                    "Accept-Language": "en-US,en;q=0.9",
                    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                })
                s.get("https://www.nseindia.com", timeout=8)
                self._session = s
                session = s
            except Exception as e:
                logger.debug(f"[NSEClient] direct NSE session bootstrap failed: {e}")

        if session is None:
            return []

        try:
            _throttle()
            url = "https://www.nseindia.com/api/fiidiiTradeReact"
            headers = {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
                "Accept": "application/json, text/plain, */*",
                "Referer": "https://www.nseindia.com/reports/fii-dii",
                "X-Requested-With": "XMLHttpRequest",
            }
            resp = session.get(url, headers=headers, timeout=10)
            if resp.status_code != 200:
                return []
            raw = resp.json()

            rows = []
            items = raw if isinstance(raw, list) else []
            if items and isinstance(items[0], dict) and "category" in items[0]:
                # Current NSE shape: one row per category ("DII", "FII/FPI") with buyValue/sellValue/netValue.
                by_date: dict = {}
                for item in items:
                    row = by_date.setdefault(item.get("date"), {
                        "date": item.get("date"),
                        "fii_net_cr": None, "dii_net_cr": None,
                        "fii_buy_cr": None, "fii_sell_cr": None,
                        "dii_buy_cr": None, "dii_sell_cr": None,
                    })
                    cat = str(item.get("category") or "").upper()
                    who = "fii" if ("FII" in cat or "FPI" in cat) else ("dii" if "DII" in cat else None)
                    if who is None:
                        continue
                    buy, sell = _num(item.get("buyValue")), _num(item.get("sellValue"))
                    net = _num(item.get("netValue"))
                    row[f"{who}_buy_cr"], row[f"{who}_sell_cr"] = buy, sell
                    row[f"{who}_net_cr"] = net if net is not None else _net(item.get("buyValue"), item.get("sellValue"))
                rows = list(by_date.values())
                items = []  # legacy loop below not needed
            for item in items:
                try:
                    rows.append({
                        "date": item.get("date") or item.get("tradingDate"),
                        "fii_net_cr": _net(item.get("fiiBuyValue"), item.get("fiiSellValue")),
                        "dii_net_cr": _net(item.get("diiBuyValue"), item.get("diiSellValue")),
                        "fii_buy_cr": _num(item.get("fiiBuyValue")),
                        "fii_sell_cr": _num(item.get("fiiSellValue")),
                        "dii_buy_cr": _num(item.get("diiBuyValue")),
                        "dii_sell_cr": _num(item.get("diiSellValue")),
                    })
                except Exception:
                    continue

            self._fiidii_cache = (time.time(), rows)
            return rows

        except Exception as e:
            logger.debug(f"[NSEClient] FII/DII fetch: {e}")
            return []

    def download_document(self, url: str) -> Optional[bytes]:
        """Download a PDF/document via the authenticated session."""
        if not self._init() or self._session is None:
            return None
        try:
            _throttle()
            resp = self._session.get(url, timeout=30)
            resp.raise_for_status()
            return resp.content
        except Exception as e:
            logger.error(f"[NSEClient] Document download failed ({url}): {e}")
            return None

    # ── SAST / Insider Disclosures ────────────────────────────────────────────

    def get_sast_disclosures(self, symbol: str, days: int = 90) -> Optional[list]:
        """
        Fetch SAST (Regulation 7 / Regulation 29) insider transaction disclosures
        for a given symbol from NSE.

        Returns a list of dicts with keys:
          date, acquirerName, noOfSharesAcquired, modeOfAcquisition, percentagePost
        or None on failure.

        NOTE: NSE does not expose a public SAST API endpoint; this uses the
        announcements feed filtered to SAST/insider filings as the best available
        public source. A dedicated SAST scraper should be wired here when available.
        """
        if not self._init():
            return None
        try:
            # Filter announcements for SAST / shareholding / pledge disclosures
            announcements = _safe_call(self._nse.announcements, symbol=symbol.upper())
            if not announcements:
                return None

            sast_keywords = {"sast", "reg 7", "regulation 7", "pledge", "insider", "reg 29"}
            sast_items = []
            for ann in (announcements if isinstance(announcements, list) else []):
                desc = (ann.get("desc") or ann.get("subject") or "").lower()
                if any(kw in desc for kw in sast_keywords):
                    sast_items.append({
                        "date": ann.get("exchdisstime") or ann.get("date"),
                        "subject": ann.get("desc") or ann.get("subject"),
                        "pdf_url": ann.get("attchmntFile") or ann.get("attachmentUrl"),
                        "source": "NSE Announcement (SAST filter)",
                        "symbol": symbol.upper(),
                    })
            return sast_items or None
        except Exception as e:
            logger.error(f"[NSEClient] SAST disclosures failed for {symbol}: {e}")
            return None

    def get_insider_trades(self, symbol: str) -> Optional[list]:
        """
        Fetch bulk and block deals for a given symbol from NSE.
        Wraps market.bulk_deals module; returns list of Deal dicts or None.
        """
        try:
            from market.bulk_deals import get_deals_for_symbol
            deals = get_deals_for_symbol(symbol.upper())
            if not deals:
                return None
            return [
                {
                    "date": d.date,
                    "client": d.client,
                    "deal_type": d.deal_type,
                    "quantity": d.quantity,
                    "price": d.price,
                    "entity_type": d.entity_type,
                    "deal_class": d.deal_class,
                }
                for d in deals
            ]
        except Exception as e:
            logger.error(f"[NSEClient] Insider/bulk deals failed for {symbol}: {e}")
            return None

    def get_corporate_actions(self, symbol: str) -> Optional[list]:
        """
        Convenience alias for get_actions() — dividends, bonuses, splits, rights.
        Returns list of action dicts or None.
        """
        return self.get_actions(symbol)



# ── Helpers ───────────────────────────────────────────────────

def _net(buy: Any, sell: Any) -> Optional[float]:
    try:
        return round(float(str(buy).replace(",", "")) - float(str(sell).replace(",", "")), 2)
    except (TypeError, ValueError):
        return None


def _num(val: Any) -> Optional[float]:
    try:
        return round(float(str(val).replace(",", "")), 2)
    except (TypeError, ValueError):
        return None


# ── Process-level singleton ────────────────────────────────────
nse_client = _NSEClient()
