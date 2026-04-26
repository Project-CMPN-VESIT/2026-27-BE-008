"""
rag/chunkers.py
───────────────
Text chunkers for every file type produced by doc_Scrapper:

  • JSON  — {TICKER}_complete_data.json  (main S3 payload)
  • CSV   — *_financials.csv, *_ratios.csv, *_shareholding.csv, *_announcements.csv
  • PDF   — Annual Report PDFs (via PyMuPDF / pdfminer, optional)

Each chunker returns a list of Chunk objects with:
  - text       : the searchable text content
  - metadata   : dict (symbol, source_type, section, page, etc.)

Design decisions:
  - JSON is not embedded verbatim; we flatten each logical section into a
    human-readable paragraph so the embeddings are semantically rich.
  - CSV rows are batched (5 rows per chunk) so one quarterly result is
    one chunk, not one row per chunk (avoids over-segmentation).
  - PDFs are split by page (≤ 1500 chars per chunk with 200-char overlap).
  - All chunkers are standalone — no network calls.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


# ── Data model ─────────────────────────────────────────────────

@dataclass
class Chunk:
    text: str
    metadata: dict = field(default_factory=dict)


# ── JSON chunker ────────────────────────────────────────────────


def _safe_str(v: Any, max_len: int = 300) -> str:
    if v is None:
        return "N/A"
    s = str(v)
    return s[:max_len] + ("…" if len(s) > max_len else "")


def _num(v: Any) -> str:
    try:
        return f"{float(v):,.2f}"
    except Exception:
        return str(v) if v is not None else "N/A"


def chunk_json(data: dict, symbol: str) -> list[Chunk]:
    """
    Flatten a doc_Scrapper *_complete_data.json into semantic text chunks.
    Produces one chunk per logical section so each embedding covers
    a single coherent topic (valuation, financials, shareholding, etc.).
    """
    chunks: list[Chunk] = []

    def _add(section: str, text: str, extra: dict | None = None) -> None:
        meta = {"symbol": symbol, "source_type": "s3_json", "section": section}
        if extra:
            meta.update(extra)
        chunks.append(Chunk(text=text.strip(), metadata=meta))

    # ── Company profile ──────────────────────────────────────
    yf = data.get("yfinance", {})
    profile = yf.get("profile", {})
    if profile:
        lines = [
            f"Company: {profile.get('company_name', symbol)}",
            f"Sector: {profile.get('sector', 'N/A')} | Industry: {profile.get('industry', 'N/A')}",
            f"Exchange: {profile.get('exchange', 'NSE')} | Currency: {profile.get('currency', 'INR')}",
            f"Website: {profile.get('website', 'N/A')}",
            f"Employees: {_num(profile.get('employees'))}",
        ]
        desc = profile.get("description", "")
        if desc:
            lines.append(f"Business Summary: {_safe_str(desc, 600)}")
        _add("company_profile", "\n".join(lines))

    # ── Valuation metrics ────────────────────────────────────
    km = yf.get("key_metrics", {})
    if km:
        lines = [
            f"{symbol} — Key Valuation & Financial Metrics:",
            f"P/E (TTM): {_num(km.get('pe_ratio'))} | Forward P/E: {_num(km.get('forward_pe'))}",
            f"P/B: {_num(km.get('pb_ratio'))} | P/S: {_num(km.get('ps_ratio'))} | EV/EBITDA: {_num(km.get('ev_to_ebitda'))}",
            f"EPS (TTM): ₹{_num(km.get('eps_ttm'))} | Forward EPS: ₹{_num(km.get('eps_forward'))}",
            f"ROE: {_num(km.get('roe_pct'))}% | ROA: {_num(km.get('roa_pct'))}%",
            f"Revenue Growth: {_num(km.get('revenue_growth_pct'))}% | Earnings Growth: {_num(km.get('earnings_growth_pct'))}%",
            f"Gross Margin: {_num(km.get('gross_margin_pct'))}% | Operating Margin: {_num(km.get('operating_margin_pct'))}%",
            f"Profit Margin: {_num(km.get('profit_margin_pct'))}%",
            f"Debt/Equity: {_num(km.get('debt_to_equity'))} | Current Ratio: {_num(km.get('current_ratio'))}",
            f"Total Debt: ₹{_num(km.get('total_debt_cr'))} Cr | Total Cash: ₹{_num(km.get('total_cash_cr'))} Cr",
            f"Free Cash Flow: ₹{_num(km.get('free_cashflow_cr'))} Cr",
            f"Market Cap: ₹{_num(yf.get('quote', {}).get('market_cap_cr', 'N/A'))} Cr",
            f"52w High: ₹{_num(yf.get('quote', {}).get('52w_high', 'N/A'))} | 52w Low: ₹{_num(yf.get('quote', {}).get('52w_low', 'N/A'))}",
            f"Beta: {_num(km.get('beta'))} | Dividend Yield: {_num(km.get('dividend_yield_pct'))}%",
        ]
        _add("valuation_metrics", "\n".join(lines))

    # ── Screener key ratios (10yr) ───────────────────────────
    screener = data.get("screener", {})
    ratios = screener.get("key_ratios_10yr", {})
    if ratios:
        lines = [f"{symbol} — Screener 10-Year Key Ratios:"]
        for metric, values in list(ratios.items())[:12]:
            # values is a dict of {year: value}
            recent = list(values.items())[-3:] if isinstance(values, dict) else []
            val_str = ", ".join(f"{y}: {v}" for y, v in recent)
            lines.append(f"  {metric}: {val_str}")
        _add("screener_ratios", "\n".join(lines))

    # ── Strengths & concerns ─────────────────────────────────
    analysis = screener.get("screener_analysis", {})
    strengths = analysis.get("strengths", [])
    concerns = analysis.get("concerns", [])
    if strengths or concerns:
        lines = [f"{symbol} — Screener Analysis:"]
        if strengths:
            lines.append("Strengths:")
            lines.extend(f"  + {s}" for s in strengths[:8])
        if concerns:
            lines.append("Concerns:")
            lines.extend(f"  - {c}" for c in concerns[:8])
        _add("screener_analysis", "\n".join(lines))

    # ── Quarterly results (batch: 5 rows per chunk) ──────────
    quarterly = screener.get("quarterly_results", [])
    for i in range(0, len(quarterly), 5):
        batch = quarterly[i : i + 5]
        lines = [f"{symbol} — Quarterly Results (rows {i+1}–{i+len(batch)}):"]
        for row in batch:
            lines.append("  | " + " | ".join(f"{k}: {v}" for k, v in list(row.items())[:8]))
        _add("quarterly_results", "\n".join(lines), {"batch_start": i})

    # ── Annual P&L ───────────────────────────────────────────
    pnl = screener.get("profit_loss_annual", [])
    if pnl:
        lines = [f"{symbol} — Annual P&L:"]
        for row in pnl[:8]:
            lines.append("  " + " | ".join(f"{k}: {v}" for k, v in list(row.items())[:8]))
        _add("profit_loss_annual", "\n".join(lines))

    # ── Balance sheet ────────────────────────────────────────
    bs = screener.get("balance_sheet_annual", [])
    if bs:
        lines = [f"{symbol} — Annual Balance Sheet:"]
        for row in bs[:8]:
            lines.append("  " + " | ".join(f"{k}: {v}" for k, v in list(row.items())[:8]))
        _add("balance_sheet", "\n".join(lines))

    # ── Shareholding pattern ─────────────────────────────────
    sh = screener.get("shareholding_pattern", [])
    if sh:
        lines = [f"{symbol} — Shareholding Pattern (Screener):"]
        for row in sh[:6]:
            lines.append("  " + " | ".join(f"{k}: {v}" for k, v in row.items()))
        _add("shareholding_pattern", "\n".join(lines))

    # ── NSE announcements ────────────────────────────────────
    nse = data.get("nse", {})
    anns = nse.get("nse_announcements", [])
    for i in range(0, min(len(anns), 30), 5):
        batch = anns[i : i + 5]
        lines = [f"{symbol} — NSE Corporate Announcements (batch {i//5 + 1}):"]
        for a in batch:
            lines.append(f"  [{a.get('date', '')}] {_safe_str(a.get('subject', ''), 120)}")
        _add("nse_announcements", "\n".join(lines), {"batch_start": i})

    # ── BSE announcements ────────────────────────────────────
    bse = data.get("bse", {})
    bse_anns = bse.get("bse_announcements", [])
    for i in range(0, min(len(bse_anns), 20), 5):
        batch = bse_anns[i : i + 5]
        lines = [f"{symbol} — BSE Announcements (batch {i//5 + 1}):"]
        for a in batch:
            lines.append(f"  [{a.get('date', '')}] {_safe_str(a.get('headline', ''), 120)}")
        _add("bse_announcements", "\n".join(lines), {"batch_start": i})

    # ── Peer comparison ──────────────────────────────────────
    peers = screener.get("peer_comparison", [])
    if peers:
        lines = [f"{symbol} — Peer Comparison (Screener):"]
        headers = list(peers[0].keys()) if peers else []
        for peer in peers[:10]:
            lines.append("  " + " | ".join(f"{k}: {v}" for k, v in peer.items()))
        _add("peer_comparison", "\n".join(lines))

    # ── Corporate actions ────────────────────────────────────
    ca = nse.get("corporate_actions", [])
    if ca:
        lines = [f"{symbol} — Corporate Actions (dividends, splits, bonus):"]
        for action in ca[:15]:
            lines.append(
                f"  [{action.get('ex_date', '')}] {_safe_str(action.get('purpose', ''), 100)}"
            )
        _add("corporate_actions", "\n".join(lines))

    return chunks


# ── CSV chunker ─────────────────────────────────────────────────


def chunk_csv(csv_text: str, symbol: str, source_name: str) -> list[Chunk]:
    """
    Parse a CSV string and return 5-row batches as chunks.
    source_name: e.g. 'financials', 'ratios', 'shareholding', 'announcements'
    """
    import csv
    import io

    chunks: list[Chunk] = []
    reader = csv.DictReader(io.StringIO(csv_text))
    rows = list(reader)
    if not rows:
        return chunks

    headers = list(rows[0].keys())
    for i in range(0, len(rows), 5):
        batch = rows[i : i + 5]
        lines = [f"{symbol} — {source_name} CSV (rows {i+1}–{i+len(batch)}):"]
        for row in batch:
            lines.append("  " + " | ".join(f"{k}: {v}" for k, v in list(row.items())[:10] if v))
        chunks.append(Chunk(
            text="\n".join(lines),
            metadata={"symbol": symbol, "source_type": f"s3_csv_{source_name}", "batch_start": i},
        ))

    return chunks


# ── PDF chunker (optional — requires PyMuPDF or pdfminer) ──────

_PDF_CHUNK_SIZE = 1500
_PDF_CHUNK_OVERLAP = 200


def chunk_pdf(pdf_bytes: bytes, symbol: str, filename: str) -> list[Chunk]:
    """
    Extract text from a PDF and split into overlapping chunks of ~1500 chars.
    Falls back gracefully if no PDF library is installed.
    """
    chunks: list[Chunk] = []

    # Try PyMuPDF (fitz) first — fastest and most accurate
    try:
        import fitz  # type: ignore
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        for page_num, page in enumerate(doc):
            text = page.get_text("text")
            text = _clean_pdf_text(text)
            if not text.strip():
                continue
            # Split long pages into overlapping chunks
            for offset in range(0, len(text), _PDF_CHUNK_SIZE - _PDF_CHUNK_OVERLAP):
                snippet = text[offset : offset + _PDF_CHUNK_SIZE]
                if len(snippet) < 50:  # skip tiny tail chunks
                    continue
                chunks.append(Chunk(
                    text=f"{symbol} Annual Report — {filename} (page {page_num + 1}):\n{snippet}",
                    metadata={
                        "symbol": symbol,
                        "source_type": "s3_pdf",
                        "filename": filename,
                        "page": page_num + 1,
                    },
                ))
        doc.close()
        return chunks
    except ImportError:
        pass

    # Fallback: pdfminer
    try:
        from pdfminer.high_level import extract_text as _pm_extract  # type: ignore
        import io
        text = _pm_extract(io.BytesIO(pdf_bytes))
        text = _clean_pdf_text(text)
        for offset in range(0, len(text), _PDF_CHUNK_SIZE - _PDF_CHUNK_OVERLAP):
            snippet = text[offset : offset + _PDF_CHUNK_SIZE]
            if len(snippet) < 50:
                continue
            chunks.append(Chunk(
                text=f"{symbol} Annual Report — {filename}:\n{snippet}",
                metadata={"symbol": symbol, "source_type": "s3_pdf", "filename": filename},
            ))
        return chunks
    except ImportError:
        pass

    # No PDF library available — return a placeholder chunk
    chunks.append(Chunk(
        text=f"{symbol} Annual Report PDF [{filename}] — text extraction unavailable. Install PyMuPDF: pip install pymupdf",
        metadata={"symbol": symbol, "source_type": "s3_pdf", "filename": filename},
    ))
    return chunks


def _clean_pdf_text(text: str) -> str:
    """Basic cleanup: collapse whitespace, remove boilerplate page numbers."""
    text = re.sub(r"\n{3,}", "\n\n", text)
    text = re.sub(r"[ \t]{2,}", " ", text)
    text = re.sub(r"^\s*\d+\s*$", "", text, flags=re.MULTILINE)  # page numbers
    return text.strip()
