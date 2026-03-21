"""
RBI Standalone Circulars Scraper.
Two-phase: scrape index page for circular links, then each detail page for content.
"""

import re
import time
import random
import hashlib
import logging
import requests
from bs4 import BeautifulSoup
from datetime import datetime

logger = logging.getLogger(__name__)

# Realistic browser headers to avoid 418/403 blocks
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "Connection": "keep-alive",
    "Upgrade-Insecure-Requests": "1",
}

INDEX_URL = "https://www.rbi.org.in/Scripts/BS_ViewListofstandalonecirculars.aspx"


def scrape_index(session: requests.Session = None, max_circulars: int = None) -> list:
    """
    Scrape the RBI standalone circulars index page.
    Returns list of dicts with: circular_number, url
    """
    if session is None:
        session = requests.Session()
        session.headers.update(HEADERS)

    logger.info(f"Fetching RBI index page: {INDEX_URL}")
    resp = session.get(INDEX_URL, timeout=30)
    resp.raise_for_status()

    soup = BeautifulSoup(resp.text, "lxml")
    circulars = []

    # Find all links to NotificationUser.aspx — these are the circular detail pages
    for link in soup.find_all("a", href=True):
        href = link["href"]
        text = link.get_text(strip=True)

        if "NotificationUser.aspx" in href and text:
            # Build absolute URL
            if href.startswith("/"):
                full_url = f"https://www.rbi.org.in{href}"
            elif href.startswith("http"):
                full_url = href
            else:
                full_url = f"https://www.rbi.org.in/Scripts/{href}"

            # Clean up circular number from link text
            circular_number = text.strip()

            circulars.append({
                "circular_number": circular_number,
                "url": full_url,
            })

    # Deduplicate by URL
    seen = set()
    unique = []
    for c in circulars:
        if c["url"] not in seen:
            seen.add(c["url"])
            unique.append(c)

    if max_circulars:
        unique = unique[:max_circulars]

    logger.info(f"Found {len(unique)} unique circulars on index page")
    return unique


def scrape_circular_detail(url: str, session: requests.Session = None) -> dict:
    """
    Scrape a single RBI circular detail page.
    Returns dict with: date_published, text_content, pdf_links
    """
    if session is None:
        session = requests.Session()
        session.headers.update(HEADERS)

    logger.info(f"Fetching circular detail: {url}")
    resp = session.get(url, timeout=30)
    resp.raise_for_status()

    soup = BeautifulSoup(resp.text, "lxml")

    # Extract the main content area
    # RBI notification pages have the content in a specific div
    content_div = (
        soup.find("div", {"id": "content"}) or
        soup.find("div", {"class": "content"}) or
        soup.find("div", {"id": "divContent"}) or
        soup.find("td", {"class": "tabletext"}) or
        soup.find("div", {"class": "tablecontent"})
    )

    if content_div:
        text_content = content_div.get_text(separator="\n", strip=True)
    else:
        # Fallback: get all text from body, excluding scripts/styles
        for tag in soup.find_all(["script", "style", "nav", "header", "footer"]):
            tag.decompose()
        text_content = soup.get_text(separator="\n", strip=True)

    # Extract date — look for common date patterns in the notification
    date_published = None
    date_patterns = [
        r'(\w+ \d{1,2},?\s*\d{4})',          # November 14, 2025
        r'(\d{1,2}[/\-\.]\d{1,2}[/\-\.]\d{4})',  # 14/11/2025
        r'(\d{4}[/\-\.]\d{1,2}[/\-\.]\d{1,2})',  # 2025-11-14
    ]
    for pattern in date_patterns:
        match = re.search(pattern, text_content[:500])  # Check first 500 chars
        if match:
            date_published = match.group(1)
            break

    # Collect PDF links
    pdf_links = []
    for link in soup.find_all("a", href=True):
        href = link["href"]
        if href.lower().endswith(".pdf"):
            if href.startswith("/"):
                href = f"https://www.rbi.org.in{href}"
            pdf_links.append(href)

    return {
        "date_published": date_published,
        "text_content": text_content,
        "pdf_links": pdf_links,
    }


def compute_hash(text: str) -> str:
    """Compute SHA-256 hash of content for diff detection."""
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def scrape_all(db, max_circulars: int = None, delay_min: float = 2, delay_max: float = 5):
    """
    Full scrape pipeline: index → detail pages → store to DB.
    Returns summary dict.
    """
    source_id = "rbi_standalone_circulars"
    run_id = db.start_scrape_run(source_id)

    session = requests.Session()
    session.headers.update(HEADERS)

    records_found = 0
    records_new = 0
    errors = []

    try:
        # Phase 1: Scrape index
        circulars = scrape_index(session, max_circulars=max_circulars)
        records_found = len(circulars)

        # Phase 2: Scrape each detail page
        for i, circ in enumerate(circulars):
            try:
                # Random delay between requests
                if i > 0:
                    delay = random.uniform(delay_min, delay_max)
                    logger.info(f"  Waiting {delay:.1f}s before next request...")
                    time.sleep(delay)

                detail = scrape_circular_detail(circ["url"], session)

                # Combine text for hashing
                full_text = detail.get("text_content", "")
                if not full_text:
                    logger.warning(f"  No text content for {circ['circular_number']}")
                    continue

                content_hash = compute_hash(full_text)

                # Diff detection: skip if already seen
                if db.record_exists(content_hash):
                    logger.info(f"  [{i+1}/{records_found}] SKIP (already exists): {circ['circular_number']}")
                    continue

                # Store raw record
                record_id = db.insert_raw_record(
                    source_id=source_id,
                    content_hash=content_hash,
                    circular_number=circ["circular_number"],
                    url=circ["url"],
                    date_published=detail.get("date_published"),
                    raw_text=full_text,
                )
                records_new += 1
                logger.info(f"  [{i+1}/{records_found}] NEW: {circ['circular_number']}")

            except requests.RequestException as e:
                error_msg = f"Failed to scrape {circ['url']}: {str(e)}"
                logger.error(f"  {error_msg}")
                errors.append(error_msg)
            except Exception as e:
                error_msg = f"Error processing {circ['circular_number']}: {str(e)}"
                logger.error(f"  {error_msg}")
                errors.append(error_msg)

        # Update source last scraped time
        db.update_source_last_scraped(source_id)

        status = "COMPLETED" if not errors else "COMPLETED_WITH_ERRORS"
        db.complete_scrape_run(
            run_id, status=status,
            records_found=records_found,
            records_new=records_new,
            errors="\n".join(errors) if errors else None,
        )

        logger.info(f"RBI scrape complete: {records_found} found, {records_new} new, {len(errors)} errors")
        return {
            "source": source_id,
            "status": status,
            "records_found": records_found,
            "records_new": records_new,
            "errors": errors,
        }

    except Exception as e:
        logger.exception(f"RBI scrape failed: {e}")
        db.complete_scrape_run(run_id, status="FAILED", errors=str(e))
        raise
