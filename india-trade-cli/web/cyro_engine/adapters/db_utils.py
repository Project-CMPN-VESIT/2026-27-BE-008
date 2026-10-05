import sqlite3
import json
import os
import logging
from pathlib import Path

logger = logging.getLogger(__name__)

def get_pipeline_data(symbol: str) -> dict:
    """Retrieves the full JSON payload for a target ticker from the data-pipeline DB."""
    base_dir = Path(__file__).resolve().parent.parent.parent.parent.parent
    db_path = Path(os.getenv("PIPELINE_SQLITE_PATH", base_dir / "data-pipeline" / "output" / "pipeline_data.db"))
    
    if not db_path.exists():
        logger.warning(f"Pipeline DB not found at {db_path}")
        return {}
        
    try:
        with sqlite3.connect(db_path) as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT raw_json FROM company_snapshots WHERE symbol = ?", (symbol.upper(),))
            row = cursor.fetchone()
            if row and row[0]:
                return json.loads(row[0])
    except Exception as e:
        logger.warning(f"Failed to read from pipeline DB for {symbol}: {e}")
    
    return {}
