import hashlib
import math
import xml.etree.ElementTree as ET
from datetime import datetime

import requests

BSE_PAGE_URL = "https://www.bseindia.com/corporates/ann.html"
BSE_API_URL = "https://api.bseindia.com/BseIndiaAPI/api/AnnSubCategoryGetData/w"
BSE_RSS_URL = "https://www.bseindia.com/data/xml/announcements.aspx"


def _fetch_bse_rss(session: requests.Session) -> list[dict]:
    response = session.get(
        BSE_RSS_URL,
        headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
            "Accept": "application/rss+xml, application/xml, text/xml, */*",
            "Referer": BSE_PAGE_URL,
        },
        timeout=20,
    )
    response.raise_for_status()

    root = ET.fromstring(response.content)
    fetched_at = datetime.utcnow().isoformat()
    results = []
    for item in root.findall(".//item"):
        title = (item.findtext("title") or "").strip()
        link = (item.findtext("link") or "").strip() or None
        pub_date = (item.findtext("pubDate") or "").strip()
        description = (item.findtext("description") or "").strip()
        symbol = (item.findtext("scripcode") or "").strip()
        company = title
        subject = description or title

        if symbol and title.endswith(f"({symbol})"):
            company = title[: -(len(symbol) + 2)].strip()

        if not symbol and not subject:
            continue

        content_hash = hashlib.sha256(
            f"{symbol}{subject}{pub_date}".encode("utf-8")
        ).hexdigest()
        results.append({
            "source": "BSE",
            "symbol": symbol,
            "company": company,
            "subject": subject,
            "category": "Corporate Announcement",
            "announced_at": pub_date,
            "pdf_url": link,
            "content_hash": content_hash,
            "fetched_at": fetched_at,
        })
    return results


def _parse_int(value, default=0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _map_bse_item(item: dict, fetched_at: str) -> dict:
    symbol = str(item.get("SCRIP_CD") or "")
    subject = str(item.get("HEADLINE") or item.get("NEWSSUB") or "")
    announced_at = str(item.get("NEWS_DT") or item.get("DissemDT") or "")
    content_hash = hashlib.sha256(f"{symbol}{subject}{announced_at}".encode("utf-8")).hexdigest()

    attachment = item.get("ATTACHMENTNAME")
    pdf_folder = "AttachHis" if str(item.get("PDFFLAG") or "").strip() == "1" else "AttachLive"
    pdf_url = (
        f"https://www.bseindia.com/xml-data/corpfiling/{pdf_folder}/{attachment}"
        if attachment
        else None
    )

    return {
        "source": "BSE",
        "symbol": symbol,
        "company": item.get("SLONGNAME"),
        "subject": subject,
        "category": item.get("CATEGORYNAME") or item.get("SUBCATNAME"),
        "announced_at": announced_at,
        "pdf_url": pdf_url,
        "content_hash": content_hash,
        "fetched_at": fetched_at,
    }


def fetch_bse_announcements() -> list[dict]:
    try:
        session = requests.Session()
        try:
            rss_items = _fetch_bse_rss(session)
            if rss_items:
                print(f"[news-feed] BSE RSS: {len(rss_items)} announcements")
                return rss_items
        except Exception as exc:
            print(f"[news-feed] BSE RSS fallback failed: {exc}")

        browser_headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
            "Accept-Language": "en-IN,en-US;q=0.9,en;q=0.8",
            "Accept-Encoding": "gzip, deflate, br",
            "Cache-Control": "no-cache",
            "Pragma": "no-cache",
            "Referer": "https://www.bseindia.com/",
        }
        api_headers = {
            "User-Agent": browser_headers["User-Agent"],
            "Accept": "application/json, text/plain, */*",
            "Accept-Language": "en-IN,en-US;q=0.9,en;q=0.8",
            "Accept-Encoding": "gzip, deflate, br",
            "Referer": BSE_PAGE_URL,
            "Origin": "https://www.bseindia.com",
            "X-Requested-With": "XMLHttpRequest",
            "Sec-Fetch-Dest": "empty",
            "Sec-Fetch-Mode": "cors",
            "Sec-Fetch-Site": "same-site",
        }

        # Prime session cookies from the official announcements page.
        session.get(BSE_PAGE_URL, headers=browser_headers, timeout=20)

        results = []
        seen_hashes = set()
        fetched_at = datetime.utcnow().isoformat()
        max_pages = 100
        total_pages = None

        for page_no in range(1, max_pages + 1):
            params = {
                "strScrip": "",
                "strCat": "-1",
                "strPrevDate": "",
                "strToDate": "",
                "strSearch": "A",
                "strType": "C",
                "pageno": str(page_no),
                "subcategory": "-1",
            }

            response = session.get(
                BSE_API_URL,
                params=params,
                headers=api_headers,
                timeout=20,
            )
            response.raise_for_status()

            content_type = (response.headers.get("Content-Type") or "").lower()
            if "application/json" not in content_type:
                preview = response.text[:160].replace("\n", " ").replace("\r", " ")
                print(
                    f"[news-feed] BSE non-JSON response status={response.status_code} "
                    f"content_type={content_type} preview={preview}"
                )
                return []

            payload = response.json()
            if not isinstance(payload, dict):
                return []

            items = payload.get("Table") or []
            if not items:
                break

            if total_pages is None:
                declared_page_count = _parse_int(items[0].get("TotalPageCnt"), 0)
                if declared_page_count > 0:
                    total_pages = declared_page_count
                else:
                    row_count = _parse_int((payload.get("Table1") or [{}])[0].get("ROWCNT"), 0)
                    total_pages = max(1, math.ceil(row_count / 50)) if row_count > 0 else None

            page_new_count = 0
            for item in items:
                mapped = _map_bse_item(item, fetched_at)
                content_hash = mapped["content_hash"]
                if content_hash in seen_hashes:
                    continue

                seen_hashes.add(content_hash)
                results.append(mapped)
                page_new_count += 1

            if page_new_count == 0:
                break

            if total_pages and page_no >= total_pages:
                break

            # BSE usually serves ~50 rows per page; a short page indicates last page.
            if len(items) < 50:
                break

        return results
    except Exception as exc:
        print(f"[news-feed] BSE scraper error: {exc}")
        return []
