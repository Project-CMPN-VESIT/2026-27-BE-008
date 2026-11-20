import logging
import hashlib
import time
import requests
from bs4 import BeautifulSoup
from typing import Dict, Any

logger = logging.getLogger(__name__)

SOURCE_ID = "sebi_orders"

def fetch_page(url: str, session: requests.Session) -> str:
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
    }
    response = session.get(url, headers=headers, timeout=15)
    response.raise_for_status()
    return response.text

def scrape_all(db, max_circulars: int = 20) -> Dict[str, Any]:
    """Scrape SEBI official orders and insert into DB."""
    run_id = db.start_scrape_run(SOURCE_ID)
    records_found = 0
    records_new = 0
    
    try:
        session = requests.Session()
        
        # Hardcoded static URL or get from DB
        base_url = "https://www.sebi.gov.in"
        index_url = f"{base_url}/sebiweb/home/HomeAction.do?doListing=yes&sid=2&ssid=9&smid=2"
        
        html = fetch_page(index_url, session)
        soup = BeautifulSoup(html, "html.parser")
        
        # Find order links
        # SEBI lists them typically in tables or lists under the class 'table'
        links_table = soup.select("table.table tr")
        
        for row in links_table:
            if not row.find("a"):
                continue
            
            a_tag = row.find("a")
            title = a_tag.text.strip()
            link = a_tag["href"]
            
            if not link.startswith("http"):
                link = base_url + link
                
            # Date is usually in the first column or adjacent
            cols = row.find_all("td")
            date_str = None
            if len(cols) > 0:
                date_str = cols[0].text.strip()
            
            records_found += 1
            if max_circulars is not None and records_found > max_circulars:
                break
                
            # Hash to avoid dupes
            content_hash = hashlib.md5((link + title).encode()).hexdigest()
            
            if not db.document_exists(content_hash):
                # We fetch the detail page to get the body text
                time.sleep(1)
                try:
                    detail_html = fetch_page(link, session)
                    dsoup = BeautifulSoup(detail_html, "html.parser")
                    # Usually order text or PDF link is in here
                    # For simplicity, extract visible text
                    content_div = dsoup.select_one(".content-wrapper") or dsoup.select_one("body")
                    raw_text = content_div.text.strip() if content_div else title
                    
                    db.insert_document(
                        source_id=SOURCE_ID,
                        content_hash=content_hash,
                        source_url=link,
                        published_at=date_str,
                        raw_text=f"TITLE: {title}\n\n{raw_text}"
                    )
                    records_new += 1
                except Exception as e:
                    logger.warning(f"Failed to fetch SEBI detail page {link}: {e}")
                    
        db.complete_scrape_run(run_id, "SUCCESS", records_found, records_new, 0)
        db.update_source_last_scraped(SOURCE_ID)
        
    except Exception as e:
        logger.error(f"SEBI Scraper failed: {e}")
        db.complete_scrape_run(run_id, "FAILED", records_found, records_new, 0, str(e))
        db.update_source_last_attempted(SOURCE_ID)
        
    return {
        "status": "success",
        "source": SOURCE_ID,
        "records_found": records_found,
        "records_new": records_new
    }
