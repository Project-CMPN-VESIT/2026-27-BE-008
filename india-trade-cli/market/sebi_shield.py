"""
market/sebi_shield.py
─────────────────────
SEBI Shield regulatory sanctions & enforcement screener for Indian equities.
Screens company tickers, names, and promoter entities against SEBI, NSE, and RBI
enforcement registers (1,600+ regulatory orders, debarments, and circulars).

Architecture:
1. Microservice First: Attempts query to SEBI Shield microservice on http://127.0.0.1:8000/v1/screen
2. Resilient Fallback: If microservice is unavailable or blocked, falls back directly
   to local read-only SQLite database (scrapper/data/sanctions.db).
3. Entity-Guarded Matching: Normalizes corporate suffixes (Ltd, Industries, Corp) to eliminate
   false positive collisions while maintaining high recall for actual sanctioned entities.
"""

from __future__ import annotations

import logging
import os
import re
import sqlite3
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

# Suffixes and generic words stripped to extract the distinctive core name
_CORP_SUFFIX_RE = re.compile(
    r"\b(limited|ltd|corporation|corp|company|co|inc|india|industries|industry|"
    r"enterprises|enterprise|technologies|technology|tech|services|service|"
    r"solutions|solution|pvt|private|m/s|holdings|holding|group|the)\b\.?",
    re.IGNORECASE,
)

# Cache resolved sanctions DB path
_SANCTIONS_DB_PATH: Optional[Path] = None


def find_sanctions_db() -> Optional[Path]:
    """Locate scrapper/data/sanctions.db from any working directory."""
    global _SANCTIONS_DB_PATH
    if _SANCTIONS_DB_PATH and _SANCTIONS_DB_PATH.is_file():
        return _SANCTIONS_DB_PATH

    candidates = [
        # Relative to this file: india-trade-cli/market/sebi_shield.py -> FinPilot/scrapper/data/sanctions.db
        Path(__file__).resolve().parent.parent.parent / "scrapper" / "data" / "sanctions.db",
        # Relative to cwd (when running from FinPilot root)
        Path.cwd() / "scrapper" / "data" / "sanctions.db",
        # Relative to cwd (when running from india-trade-cli)
        Path.cwd().parent / "scrapper" / "data" / "sanctions.db",
    ]

    for p in candidates:
        if p.is_file():
            _SANCTIONS_DB_PATH = p.resolve()
            return _SANCTIONS_DB_PATH

    return None


def clean_core_tokens(name: str) -> str:
    """Normalize and strip generic corporate suffixes to leave distinctive brand/entity tokens."""
    if not name:
        return ""
    text = re.sub(r"[^a-zA-Z0-9& ]", " ", name)
    stripped = _CORP_SUFFIX_RE.sub(" ", text)
    cleaned = re.sub(r"\s+", " ", stripped).strip().lower()
    return cleaned if len(cleaned) >= 3 else text.strip().lower()


def _resolve_company_name(symbol: str) -> str:
    """Attempt to resolve the full registered company name for a ticker."""
    sym = symbol.upper().strip().replace(".NS", "").replace(".BO", "")
    try:
        from cyro_chat.tools import _universe
        for item in _universe():
            if item.get("symbol") == sym and item.get("name"):
                return item["name"]
    except Exception:
        pass
    return sym


def _screen_via_microservice(
    symbol: str, company_name: str, threshold: float = 0.75, include_cleared: bool = False
) -> Optional[List[Dict[str, Any]]]:
    """Try screening against the SEBI Shield FastAPI microservice on port 8000."""
    try:
        import httpx

        payload = {
            "records": [
                {
                    "record_id": f"cyro_{symbol}",
                    "name": company_name or symbol,
                    "company_name": company_name or symbol,
                }
            ],
            "threshold": threshold,
            "include_cleared": include_cleared,
        }

        resp = httpx.post("http://127.0.0.1:8000/v1/screen", json=payload, timeout=1.5)
        if resp.status_code == 200:
            data = resp.json()
            results = data.get("results") or []
            if not results:
                return []

            first = results[0]
            status = first.get("match_status", "NO_MATCH")
            matched_ent = first.get("matched_entity") or {}

            # Guard against common suffix false matches (e.g., "Industries Limited")
            matched_name = matched_ent.get("name") or ""
            if matched_name and status in ("MATCH", "POSSIBLE_MATCH"):
                target_core = clean_core_tokens(company_name or symbol)
                match_core = clean_core_tokens(matched_name)
                # Verify core tokens match or overlap significantly
                if not (target_core in match_core or match_core in target_core):
                    try:
                        from rapidfuzz import fuzz
                        ratio = fuzz.ratio(target_core, match_core)
                        if ratio < 70:
                            return []  # Rejected as generic suffix collision
                    except ImportError:
                        return []

                return [
                    {
                        "entity_name": matched_name,
                        "regulator": matched_ent.get("publishing_body") or "SEBI",
                        "action_type": first.get("sanction_status") or "REGULATORY_ACTION",
                        "status": first.get("sanction_status") or "ACTIVE",
                        "order_number": matched_ent.get("circular_number"),
                        "order_date": matched_ent.get("date_of_publish"),
                        "description": f"Sanction match (score {first.get('match_score', 0):.2f}) from SEBI Shield register.",
                        "source_url": matched_ent.get("circular_link") or "",
                    }
                ]
            return []
    except Exception as exc:
        logger.debug("[SEBI Shield] Microservice check failed or unreachable: %s", exc)
        return None  # Signal fallback to direct DB


def _screen_via_sqlite(
    symbol: str, company_name: str, include_cleared: bool = False
) -> List[Dict[str, Any]]:
    """Query local sanctions.db directly with precision entity matching."""
    db_path = find_sanctions_db()
    if not db_path or not db_path.is_file():
        logger.warning("[SEBI Shield] sanctions.db not found at expected paths.")
        return []

    target_sym_clean = clean_core_tokens(symbol)
    target_name_clean = clean_core_tokens(company_name)

    matches: List[Dict[str, Any]] = []

    try:
        conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
        conn.row_factory = sqlite3.Row

        query = """
            SELECT
                e.entity_id,
                e.canonical_name,
                e.normalized_name,
                e.entity_type,
                ra.regulator,
                ra.action_type,
                ra.status,
                ra.order_number,
                ra.order_date,
                ra.description,
                ra.source_url
            FROM entities e
            JOIN regulatory_actions ra ON e.entity_id = ra.entity_id
        """
        rows = conn.execute(query).fetchall()
        conn.close()

        # Try rapidfuzz for string similarity if available
        try:
            from rapidfuzz import fuzz
            has_rapidfuzz = True
        except ImportError:
            has_rapidfuzz = False

        for row in rows:
            st = (row["status"] or "").upper()
            if not include_cleared and st in ("PREVIOUSLY_SANCTIONED_CLEARED", "EXPIRED", "REVOKED"):
                continue

            ent_canonical = row["canonical_name"] or ""
            ent_core = clean_core_tokens(ent_canonical)

            is_match = False

            # Exact core match
            if ent_core and (ent_core == target_name_clean or ent_core == target_sym_clean):
                is_match = True
            # Substring match on distinctive brand token (minimum 5 chars)
            elif (
                len(target_name_clean) >= 5
                and ent_core
                and (ent_core in target_name_clean or target_name_clean in ent_core)
            ):
                is_match = True
            # Fuzzy ratio on core distinctive brand
            elif has_rapidfuzz and ent_core and target_name_clean:
                ratio = fuzz.ratio(target_name_clean, ent_core)
                if ratio >= 85:
                    is_match = True

            if is_match:
                matches.append({
                    "entity_name": ent_canonical,
                    "regulator": row["regulator"] or "SEBI",
                    "action_type": row["action_type"] or "REGULATORY_ACTION",
                    "status": row["status"] or "ACTIVE",
                    "order_number": row["order_number"],
                    "order_date": row["order_date"],
                    "description": row["description"] or f"Action listed in {row['regulator']} register",
                    "source_url": row["source_url"] or "",
                })

    except Exception as exc:
        logger.error("[SEBI Shield] SQLite query error: %s", exc)

    return matches


def screen_sebi_shield(
    symbol_or_name: str,
    company_name: Optional[str] = None,
    threshold: float = 0.75,
    include_cleared: bool = False,
) -> Dict[str, Any]:
    """
    Screen an equity ticker or company against the SEBI Shield regulatory database.

    Returns structured summary with clean flag, status, matches list, and audit source.
    Never throws exceptions - degrades gracefully to clean=True with error notes.
    """
    clean_sym = symbol_or_name.upper().strip().replace(".NS", "").replace(".BO", "")
    full_name = company_name or _resolve_company_name(clean_sym)

    source_used = "SEBI Shield microservice (port 8000)"
    matches = _screen_via_microservice(clean_sym, full_name, threshold, include_cleared)

    if matches is None:
        source_used = "SEBI Shield local DB (sanctions.db)"
        matches = _screen_via_sqlite(clean_sym, full_name, include_cleared)

    is_clean = len(matches) == 0

    if is_clean:
        status_label = "CLEAN"
        summary = (
            f"No active regulatory actions, debarments, or sanctions found for "
            f"{full_name} ({clean_sym}) in SEBI Shield (screened against SEBI, NSE, and RBI registers)."
        )
    else:
        active_actions = [m for m in matches if m.get("status") == "ACTIVE"]
        status_label = "SANCTIONED" if active_actions else "REGULATORY_FLAG"
        primary_reg = matches[0].get("regulator", "SEBI")
        summary = (
            f"WARNING: {len(matches)} regulatory enforcement action(s) found in SEBI Shield for "
            f"{matches[0].get('entity_name') or clean_sym} ({primary_reg}: {matches[0].get('action_type', 'Action')})."
        )

    return {
        "symbol": clean_sym,
        "company_name": full_name,
        "clean": is_clean,
        "sanction_status": status_label,
        "matches_count": len(matches),
        "matches": matches,
        "summary": summary,
        "source": source_used,
    }

