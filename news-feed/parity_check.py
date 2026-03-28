"""Manual parity check between live exchange pulls and local news DB.

Run:
    d:/Desktop/FinPilot/.venv/Scripts/python.exe parity_check.py
"""

from __future__ import annotations

from collections import Counter

from database import get_announcements
from scrapers.bse import fetch_bse_announcements
from scrapers.nse import fetch_nse_announcements


def _hash_set(rows: list[dict]) -> set[str]:
    return {str(row.get("content_hash") or "") for row in rows if row.get("content_hash")}


def _print_source_summary(source: str, live_rows: list[dict], db_rows: list[dict], breakdown_key: str) -> None:
    live_hashes = _hash_set(live_rows)
    db_hashes = _hash_set(db_rows)

    missing_in_db = live_hashes - db_hashes
    extra_in_db = db_hashes - live_hashes

    print(f"{source} live rows: {len(live_hashes)}")
    print(f"{source} db rows:   {len(db_hashes)}")
    print(f"{source} missing in db: {len(missing_in_db)}")
    print(f"{source} extra in db:   {len(extra_in_db)}")

    breakdown = Counter(str(row.get(breakdown_key) or "--") for row in live_rows)
    print(f"{source} live breakdown by {breakdown_key}: {dict(sorted(breakdown.items()))}")

    if missing_in_db:
        sample = sorted(missing_in_db)[:5]
        print(f"{source} missing hash sample: {sample}")

    print("-" * 72)


def main() -> None:
    live_nse_rows = fetch_nse_announcements()
    live_bse_rows = fetch_bse_announcements()

    db_nse_rows = get_announcements(source="NSE")
    db_bse_rows = get_announcements(source="BSE")

    print("LIVE VS DB PARITY CHECK")
    print("-" * 72)

    _print_source_summary("NSE", live_nse_rows, db_nse_rows, "nse_index")
    _print_source_summary("BSE", live_bse_rows, db_bse_rows, "category")


if __name__ == "__main__":
    main()
