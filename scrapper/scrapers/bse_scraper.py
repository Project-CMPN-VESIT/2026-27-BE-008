import logging
import hashlib
import time
import requests
from typing import Dict, Any

logger = logging.getLogger(__name__)
SOURCE_ID = "bse_notices"

def scrape_all(db, max_circulars: int = 20) -> Dict[str, Any]:
    run_id = db.start_scrape_run(SOURCE_ID)
    records_found = 0
    records_new = 0
    
    try:
        session = requests.Session()
        headers = {
            "User-Agent": "Mozilla/5.0",
        }
        
        url = "https://api.bseindia.com/BseIndiaAPI/api/AnnSubCategoryGetData/w?pageno=1&strSearch=&iscategory=Exchange&Category=Surveillance&SubCategory=Notices"
        try:
            response = session.get(url, headers=headers, timeout=5)
            data = response.json() if response.status_code == 200 else {"Table": []}
        except Exception:
            data = {"Table": []}
            
        for item in data.get("Table", [])[:max_circulars]:
            title = item.get("HEADLINE", "")
            date_str = item.get("NEWS_DT", "")
            news_id = item.get("NEWSID", "")
            link = f"https://www.bseindia.com/markets/MarketInfo/DispNewNoticesCirculars.aspx?page={date_str[:10]}/{news_id}.pdf"
            
            content_hash = hashlib.md5((link + title).encode()).hexdigest()
            records_found += 1
            
            if not db.document_exists(content_hash):
                db.insert_document(
                    source_id=SOURCE_ID,
                    content_hash=content_hash,
                    source_url=link,
                    published_at=date_str,
                    raw_text=f"TITLE: {title}\nBSE Notice Date: {date_str}"
                )
                records_new += 1
                
        db.complete_scrape_run(run_id, "SUCCESS", records_found, records_new, 0)
        db.update_source_last_scraped(SOURCE_ID)
        
    except Exception as e:
        logger.error(f"BSE Scraper failed: {e}")
        db.complete_scrape_run(run_id, "FAILED", records_found, records_new, 0, str(e))
        db.update_source_last_attempted(SOURCE_ID)
        
    return {
        "status": "success",
        "source": SOURCE_ID,
        "records_found": records_found,
        "records_new": records_new
    }
