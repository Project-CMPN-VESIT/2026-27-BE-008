"""
web/cyro_engine/equity_db_reader.py
─────────────────────────────────────────────────────────────────────
Read-only bridge from the Upstox data-ingestion DB (equity.db) into
CYRO's evidence pipeline.

The DB lives at D:/Desktop/Finpilot-data-ingestion/data/equity.db and
is populated by the `finpilot-data-ingestion` project.  This module
never writes to that DB — it is strictly a reader.

Schema (relevant tables):
  companies         isin, nse_symbol, company_name
  observations      isin, provider, dataset, period_end, scope,
                    metric, value, unit, fetched_at
  events            isin, event_type, event_date, title, value, unit, details
  macro_observations source, series, observation_date, value, unit

All monetary values from Upstox are in ₹ Crore.
"""

from __future__ import annotations

import os
import sqlite3
import logging
from typing import Optional

logger = logging.getLogger(__name__)

# ── Path resolution ───────────────────────────────────────────────
# Override via EQUITY_DB_PATH environment variable if needed.
_DEFAULT_DB_PATH = os.path.join(
    os.path.dirname(__file__),
    "..", "..", "..", "..", "Finpilot-data-ingestion", "data", "equity.db",
)
EQUITY_DB_PATH = os.getenv(
    "EQUITY_DB_PATH",
    os.path.normpath("D:/Desktop/Finpilot-data-ingestion/data/equity.db"),
)

# ── ISIN lookup cache (populated lazily on first use) ─────────────
_SYMBOL_TO_ISIN: dict[str, str] = {}


def _get_connection() -> Optional[sqlite3.Connection]:
    """Return a read-only SQLite connection, or None if DB is missing."""
    if not os.path.isfile(EQUITY_DB_PATH):
        logger.warning(
            "[EquityDB] equity.db not found at %s — Upstox data unavailable", EQUITY_DB_PATH
        )
        return None
    conn = sqlite3.connect(f"file:{EQUITY_DB_PATH}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    return conn


def _resolve_isin(symbol: str, conn: sqlite3.Connection) -> Optional[str]:
    """NSE symbol → ISIN, cached after first lookup."""
    sym = symbol.upper()
    if sym in _SYMBOL_TO_ISIN:
        return _SYMBOL_TO_ISIN[sym]
    cur = conn.cursor()
    cur.execute("SELECT isin FROM companies WHERE nse_symbol = ? LIMIT 1", (sym,))
    row = cur.fetchone()
    if row:
        _SYMBOL_TO_ISIN[sym] = row["isin"]
        return row["isin"]
    logger.warning("[EquityDB] Symbol %s not found in equity.db companies table", sym)
    return None


def _pivot_observations(rows: list[sqlite3.Row]) -> dict[str, dict]:
    """
    Convert long-format observation rows into a nested dict:
      { period_end → { metric → value } }
    sorted newest-period first.
    """
    pivoted: dict[str, dict] = {}
    for r in rows:
        period = r["period_end"]
        metric = r["metric"]
        value = r["value"]
        pivoted.setdefault(period, {})[metric] = value
    # Sort periods newest-first (lexicographic works for "Mar 2026", "Mar 2025", …)
    return dict(sorted(pivoted.items(), reverse=True))


# ─────────────────────────────────────────────────────────────────
# Public API
# ─────────────────────────────────────────────────────────────────

def get_annual_financials(symbol: str, years: int = 4) -> dict:
    """
    Return a structured annual financial summary for the given NSE symbol.

    Covers (consolidated scope, Upstox provider):
      Income Statement : revenue, operating_profit, net_profit, eps___basic,
                         total_expenses, other_income, tax
      Cash Flow        : cash_flow_from_operations, cash_flow_from_investing,
                         cash_flow_from_financing, total_cash_flow
      Balance Sheet    : total_assets, current_assets, current_liabilities,
                         non_current_assets, net_current_asset,
                         total_equity_&_liabilities

    Returns a dict with:
      "periods"         — list of period strings newest-first, e.g. ["Mar 2026", ...]
      "income"          — { period → { metric → value (₹ Crore) } }
      "cashflow"        — { period → { metric → value (₹ Crore) } }
      "balance"         — { period → { metric → value (₹ Crore) } }
      "key_ratios"      — { metric → value } (latest cross-sectional snapshot)
      "derived"         — computed metrics: ebitda_margin, net_margin, ocf_margin,
                          revenue_cagr (if ≥2 yrs), ocf_to_net_profit
      "available"       — True if data was found, False if symbol not in DB
      "unit"            — "crore_inr"
    """
    conn = _get_connection()
    if conn is None:
        return {"available": False, "reason": "equity.db not found"}

    try:
        isin = _resolve_isin(symbol, conn)
        if not isin:
            return {"available": False, "reason": f"{symbol} not in equity.db"}

        cur = conn.cursor()

        # ── Income Statement ─────────────────────────────────────
        cur.execute(
            """
            SELECT period_end, metric, value FROM observations
            WHERE isin = ? AND dataset = 'income-statement'
              AND scope = 'consolidated' AND provider = 'upstox'
            ORDER BY period_end DESC
            """,
            (isin,),
        )
        income_pivot = _pivot_observations(cur.fetchall())
        income_periods = list(income_pivot.keys())[:years]
        income = {p: income_pivot[p] for p in income_periods}

        # ── Cash Flow ────────────────────────────────────────────
        cur.execute(
            """
            SELECT period_end, metric, value FROM observations
            WHERE isin = ? AND dataset = 'cash-flow'
              AND scope = 'consolidated' AND provider = 'upstox'
            ORDER BY period_end DESC
            """,
            (isin,),
        )
        cf_pivot = _pivot_observations(cur.fetchall())
        cf_periods = list(cf_pivot.keys())[:years]
        cashflow = {p: cf_pivot[p] for p in cf_periods}

        # ── Balance Sheet ────────────────────────────────────────
        cur.execute(
            """
            SELECT period_end, metric, value FROM observations
            WHERE isin = ? AND dataset = 'balance-sheet'
              AND scope = 'consolidated' AND provider = 'upstox'
            ORDER BY period_end DESC
            """,
            (isin,),
        )
        bs_pivot = _pivot_observations(cur.fetchall())
        bs_periods = list(bs_pivot.keys())[:years]
        balance = {p: bs_pivot[p] for p in bs_periods}

        # ── Key Ratios ───────────────────────────────────────────
        # key-ratios are cross-sectional (no meaningful period_end), take latest
        cur.execute(
            """
            SELECT metric, value FROM observations
            WHERE isin = ? AND dataset = 'key-ratios'
              AND scope = 'consolidated' AND provider = 'upstox'
            ORDER BY fetched_at DESC
            """,
            (isin,),
        )
        key_ratios: dict = {}
        for r in cur.fetchall():
            # Deduplicate: first occurrence per metric is newest
            if r["metric"] not in key_ratios:
                key_ratios[r["metric"]] = r["value"]

        # ── Derived Metrics ──────────────────────────────────────
        derived: dict = {}
        if income_periods:
            latest_p = income_periods[0]
            inc = income.get(latest_p, {})
            cf = cashflow.get(latest_p, {})

            revenue = inc.get("revenue") or inc.get("total_revenue") or 0
            op_profit = inc.get("operating_profit") or 0
            net_profit = inc.get("net_profit") or inc.get("profit_after_tax") or 0
            ocf = cf.get("cash_flow_from_operations") or cf.get("operating") or 0

            if revenue > 0:
                derived["ebitda_margin_pct"] = round(op_profit / revenue * 100, 2)
                derived["net_margin_pct"] = round(net_profit / revenue * 100, 2)
                derived["ocf_margin_pct"] = round(ocf / revenue * 100, 2)

            if net_profit and net_profit != 0:
                derived["ocf_to_net_profit"] = round(ocf / net_profit, 3)

            # Revenue CAGR over available periods
            if len(income_periods) >= 2:
                oldest_p = income_periods[-1]
                oldest_inc = income.get(oldest_p, {})
                rev_old = oldest_inc.get("revenue") or oldest_inc.get("total_revenue") or 0
                if rev_old > 0 and revenue > 0:
                    n_years = len(income_periods) - 1
                    import math
                    cagr = (revenue / rev_old) ** (1 / n_years) - 1
                    derived["revenue_cagr_pct"] = round(cagr * 100, 2)
                    derived["revenue_cagr_years"] = n_years

        all_periods = sorted(set(income_periods + cf_periods + bs_periods), reverse=True)

        return {
            "available": True,
            "isin": isin,
            "symbol": symbol,
            "unit": "crore_inr",
            "periods": all_periods,
            "income": income,
            "cashflow": cashflow,
            "balance": balance,
            "key_ratios": key_ratios,
            "derived": derived,
        }

    except Exception as e:
        logger.error("[EquityDB] get_annual_financials(%s) failed: %s", symbol, e, exc_info=True)
        return {"available": False, "reason": str(e)}
    finally:
        conn.close()


def get_shareholding_trend(symbol: str, quarters: int = 6) -> dict:
    """
    Return multi-quarter Promoter / FII / DII / MF / Retail holding percentages.

    Uses the `share-holdings` dataset in observations (consolidated scope).
    Metrics: promoters, fii, mutual_funds, other_dii, retail_and_other.

    Returns:
      "available"   — bool
      "trend"       — list of { period, promoters, fii, mutual_funds,
                                other_dii, retail_and_other }  newest-first
      "latest"      — dict of latest-quarter values
      "delta_qoq"   — change in promoter/FII between last two quarters (if avail)
    """
    conn = _get_connection()
    if conn is None:
        return {"available": False, "reason": "equity.db not found"}

    try:
        isin = _resolve_isin(symbol, conn)
        if not isin:
            return {"available": False, "reason": f"{symbol} not in equity.db"}

        cur = conn.cursor()
        cur.execute(
            """
            SELECT period_end, metric, value FROM observations
            WHERE isin = ? AND dataset = 'share-holdings'
              AND scope = 'consolidated' AND provider = 'upstox'
            ORDER BY period_end DESC
            """,
            (isin,),
        )
        pivoted = _pivot_observations(cur.fetchall())
        periods = list(pivoted.keys())[:quarters]

        trend = []
        for p in periods:
            row = pivoted[p]
            trend.append({
                "period": p,
                "promoters_pct": row.get("promoters"),
                "fii_pct": row.get("fii"),
                "mutual_funds_pct": row.get("mutual_funds"),
                "other_dii_pct": row.get("other_dii"),
                "retail_and_other_pct": row.get("retail_and_other"),
            })

        latest = trend[0] if trend else {}
        delta_qoq: dict = {}
        if len(trend) >= 2:
            prev = trend[1]
            for key in ("promoters_pct", "fii_pct"):
                curr_v = latest.get(key)
                prev_v = prev.get(key)
                if curr_v is not None and prev_v is not None:
                    delta_qoq[f"{key}_qoq_change"] = round(curr_v - prev_v, 2)

        return {
            "available": bool(trend),
            "trend": trend,
            "latest": latest,
            "delta_qoq": delta_qoq,
        }

    except Exception as e:
        logger.error("[EquityDB] get_shareholding_trend(%s) failed: %s", symbol, e, exc_info=True)
        return {"available": False, "reason": str(e)}
    finally:
        conn.close()


def get_corporate_events(symbol: str, limit: int = 15) -> dict:
    """
    Return corporate events (dividends, splits, bonuses) from the events table.

    Returns:
      "available"  — bool
      "events"     — list of { event_type, event_date, title, value, unit, details }
    """
    conn = _get_connection()
    if conn is None:
        return {"available": False, "reason": "equity.db not found"}

    try:
        isin = _resolve_isin(symbol, conn)
        if not isin:
            return {"available": False, "reason": f"{symbol} not in equity.db"}

        cur = conn.cursor()
        cur.execute(
            """
            SELECT event_type, event_date, title, value, unit, details
            FROM events
            WHERE isin = ?
            ORDER BY event_date DESC
            LIMIT ?
            """,
            (isin, limit),
        )
        events = [
            {
                "event_type": r["event_type"],
                "event_date": r["event_date"],
                "title": r["title"],
                "value": r["value"],
                "unit": r["unit"],
                "details": r["details"],
            }
            for r in cur.fetchall()
        ]
        return {"available": bool(events), "events": events}

    except Exception as e:
        logger.error("[EquityDB] get_corporate_events(%s) failed: %s", symbol, e, exc_info=True)
        return {"available": False, "reason": str(e)}
    finally:
        conn.close()


def build_financials_summary(symbol: str) -> dict:
    """
    Convenience wrapper: assemble the full Upstox financial picture for
    a single symbol.  Returns:

      {
        "available"         : bool,
        "annual_financials" : <get_annual_financials result>,
        "shareholding"      : <get_shareholding_trend result>,
        "corporate_events"  : <get_corporate_events result>,
      }
    """
    fin = get_annual_financials(symbol)
    sholding = get_shareholding_trend(symbol)
    events = get_corporate_events(symbol)
    return {
        "available": fin.get("available", False)
                     or sholding.get("available", False)
                     or events.get("available", False),
        "annual_financials": fin,
        "shareholding": sholding,
        "corporate_events": events,
    }
