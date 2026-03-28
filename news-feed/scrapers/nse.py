import hashlib
from datetime import datetime

import requests

NSE_HOME_URL = "https://www.nseindia.com"
NSE_API_URL = "https://www.nseindia.com/api/corporate-announcements"
NSE_INDICES = ("equities", "sme", "debt", "mf")


def _normalize_nse_attachment_url(attachment: str | None) -> str | None:
    if not attachment:
        return None

    raw = str(attachment).strip()
    if not raw:
        return None

    # NSE occasionally returns malformed prefixes like "https//".
    if raw.startswith("https//"):
        raw = "https://" + raw[len("https//") :]
    elif raw.startswith("http//"):
        raw = "http://" + raw[len("http//") :]

    if raw.startswith("http://") or raw.startswith("https://"):
        return raw

    if raw.startswith("//"):
        return f"https:{raw}"

    if raw.startswith("archives.nseindia.com") or raw.startswith("nsearchives.nseindia.com"):
        return f"https://{raw}"

    if raw.startswith("/"):
        return f"https://archives.nseindia.com{raw}"

    return f"https://archives.nseindia.com/{raw.lstrip('/')}"


def _extract_nse_rows(payload) -> list[dict]:
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        data_rows = payload.get("data")
        if isinstance(data_rows, list):
            return data_rows
    return []



def fetch_nse_announcements() -> list[dict]:
    try:
        session = requests.Session()

        session.get(
            NSE_HOME_URL,
            headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            },
            timeout=15,
        )

        results = []
        seen_hashes = set()
        fetched_at = datetime.utcnow().isoformat()
        day_str = datetime.now().strftime("%d-%m-%Y")

        for index_name in NSE_INDICES:
            normalized_index = index_name.upper()
            response = session.get(
                NSE_API_URL,
                params={
                    "index": index_name,
                    "from_date": day_str,
                    "to_date": day_str,
                },
                headers={
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
                    "Accept": "application/json",
                    "Referer": "https://www.nseindia.com",
                },
                timeout=25,
            )
            response.raise_for_status()

            payload = response.json()
            items = _extract_nse_rows(payload)

            # Fallback: if range query returns empty unexpectedly, try default index call.
            if not items:
                fallback = session.get(
                    NSE_API_URL,
                    params={"index": index_name},
                    headers={
                        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
                        "Accept": "application/json",
                        "Referer": "https://www.nseindia.com",
                    },
                    timeout=20,
                )
                fallback.raise_for_status()
                items = _extract_nse_rows(fallback.json())

            for item in items:
                symbol = str(item.get("symbol") or "")
                subject = str(item.get("desc") or "")
                announced_at = str(item.get("an_dt") or "")
                content_hash = hashlib.sha256(f"{symbol}{subject}{announced_at}".encode("utf-8")).hexdigest()
                if content_hash in seen_hashes:
                    continue

                seen_hashes.add(content_hash)
                attachment = item.get("attchmntFile")
                pdf_url = _normalize_nse_attachment_url(attachment)
                category = item.get("attchmntType") or normalized_index

                results.append(
                    {
                        "source": "NSE",
                        "nse_index": normalized_index,
                        "symbol": symbol,
                        "company": item.get("sm_name"),
                        "subject": subject,
                        "category": category,
                        "announced_at": announced_at,
                        "pdf_url": pdf_url,
                        "content_hash": content_hash,
                        "fetched_at": fetched_at,
                    }
                )

        return results
    except Exception as exc:
        print(f"[news-feed] NSE scraper error: {exc}")
        return []
