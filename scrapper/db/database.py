"""
SQLite database manager for the regulatory sanctions scraper.
Handles schema initialization, CRUD operations, and diff detection.
"""

import sqlite3
import os
import logging
from pathlib import Path
from datetime import datetime

logger = logging.getLogger(__name__)

DB_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "sanctions.db")
SCHEMA_PATH = os.path.join(os.path.dirname(__file__), "schema.sql")


class Database:
    def __init__(self, db_path: str = None):
        self.db_path = db_path or DB_PATH
        os.makedirs(os.path.dirname(self.db_path), exist_ok=True)
        self._init_schema()

    def _get_conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON")
        return conn

    def _init_schema(self):
        with open(SCHEMA_PATH, "r") as f:
            schema_sql = f.read()
        conn = self._get_conn()
        try:
            conn.executescript(schema_sql)
            conn.commit()
            logger.info(f"Database initialized at {self.db_path}")
        finally:
            conn.close()

    # --- Source Registry ---
    def upsert_source(self, source_id: str, name: str, url: str,
                      format_type: str, publishing_body: str, active: bool = True):
        conn = self._get_conn()
        try:
            conn.execute("""
                INSERT INTO sources (source_id, name, url, format_type, publishing_body, active)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(source_id) DO UPDATE SET
                    name=excluded.name, url=excluded.url,
                    format_type=excluded.format_type, active=excluded.active
            """, (source_id, name, url, format_type, publishing_body, int(active)))
            conn.commit()
        finally:
            conn.close()

    def update_source_last_scraped(self, source_id: str):
        conn = self._get_conn()
        try:
            conn.execute(
                "UPDATE sources SET last_scraped_at = ? WHERE source_id = ?",
                (datetime.utcnow().isoformat(), source_id)
            )
            conn.commit()
        finally:
            conn.close()

    # --- Raw Records (with diff detection) ---
    def record_exists(self, content_hash: str) -> bool:
        conn = self._get_conn()
        try:
            row = conn.execute(
                "SELECT 1 FROM raw_records WHERE content_hash = ?", (content_hash,)
            ).fetchone()
            return row is not None
        finally:
            conn.close()

    def insert_raw_record(self, source_id: str, content_hash: str,
                          circular_number: str = None, url: str = None,
                          date_published: str = None, raw_text: str = None) -> int:
        conn = self._get_conn()
        try:
            cursor = conn.execute("""
                INSERT OR IGNORE INTO raw_records
                    (source_id, content_hash, circular_number, url, date_published, raw_text)
                VALUES (?, ?, ?, ?, ?, ?)
            """, (source_id, content_hash, circular_number, url, date_published, raw_text))
            conn.commit()
            return cursor.lastrowid
        finally:
            conn.close()

    def get_unprocessed_records(self, source_id: str = None) -> list:
        conn = self._get_conn()
        try:
            if source_id:
                rows = conn.execute(
                    "SELECT * FROM raw_records WHERE is_processed = 0 AND source_id = ?",
                    (source_id,)
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT * FROM raw_records WHERE is_processed = 0"
                ).fetchall()
            return [dict(r) for r in rows]
        finally:
            conn.close()

    def mark_record_processed(self, record_id: int):
        conn = self._get_conn()
        try:
            conn.execute(
                "UPDATE raw_records SET is_processed = 1 WHERE id = ?", (record_id,)
            )
            conn.commit()
        finally:
            conn.close()

    # --- Entities ---
    def insert_entity(self, source_id: str, raw_record_id: int = None,
                      name: str = None, din: str = None, cin: str = None,
                      pan: str = None, date_of_birth: str = None, country: str = None,
                      circular_number: str = None, date_published: str = None,
                      sanction_start: str = None, sanction_end: str = None,
                      link: str = None, publishing_body: str = "UNKNOWN",
                      extraction_confidence: float = 0.0,
                      sanction_status: str = "ACTIVE") -> int:
        conn = self._get_conn()
        try:
            cursor = conn.execute("""
                INSERT INTO entities
                    (source_id, raw_record_id, name, din, cin, pan, date_of_birth,
                     country, circular_number, date_published, sanction_start,
                     sanction_end, link, publishing_body, extraction_confidence,
                     sanction_status)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (source_id, raw_record_id, name, din, cin, pan, date_of_birth,
                  country, circular_number, date_published, sanction_start,
                  sanction_end, link, publishing_body, extraction_confidence,
                  sanction_status))
            conn.commit()
            return cursor.lastrowid
        finally:
            conn.close()

    def insert_name_variant(self, entity_id: int, variant: str, variant_type: str):
        conn = self._get_conn()
        try:
            conn.execute(
                "INSERT INTO name_variants (entity_id, variant, variant_type) VALUES (?, ?, ?)",
                (entity_id, variant, variant_type)
            )
            conn.commit()
        finally:
            conn.close()

    def insert_name_variants_bulk(self, variants: list):
        """Insert multiple name variants. Each item: (entity_id, variant, variant_type)"""
        conn = self._get_conn()
        try:
            conn.executemany(
                "INSERT INTO name_variants (entity_id, variant, variant_type) VALUES (?, ?, ?)",
                variants
            )
            conn.commit()
        finally:
            conn.close()

    def search_entities_by_id(self, pan: str = None, din: str = None,
                              cin: str = None) -> list:
        conn = self._get_conn()
        try:
            conditions = []
            params = []
            if pan:
                conditions.append("pan = ?")
                params.append(pan.upper())
            if din:
                conditions.append("din = ?")
                params.append(din)
            if cin:
                conditions.append("cin = ?")
                params.append(cin.upper())

            if not conditions:
                return []

            query = f"SELECT * FROM entities WHERE {' OR '.join(conditions)}"
            rows = conn.execute(query, params).fetchall()
            return [dict(r) for r in rows]
        finally:
            conn.close()

    def get_all_entities_with_variants(self) -> list:
        conn = self._get_conn()
        try:
            rows = conn.execute("""
                SELECT e.*, GROUP_CONCAT(nv.variant, '||') as variants
                FROM entities e
                LEFT JOIN name_variants nv ON e.id = nv.entity_id
                GROUP BY e.id
            """).fetchall()
            results = []
            for r in rows:
                d = dict(r)
                d['variant_list'] = d.get('variants', '').split('||') if d.get('variants') else []
                results.append(d)
            return results
        finally:
            conn.close()

    def get_entity_variants(self, entity_id: int) -> list:
        conn = self._get_conn()
        try:
            rows = conn.execute(
                "SELECT variant FROM name_variants WHERE entity_id = ?", (entity_id,)
            ).fetchall()
            return [r['variant'] for r in rows]
        finally:
            conn.close()

    # --- Scrape Runs ---
    def start_scrape_run(self, source_id: str) -> int:
        conn = self._get_conn()
        try:
            cursor = conn.execute(
                "INSERT INTO scrape_runs (source_id, status) VALUES (?, 'RUNNING')",
                (source_id,)
            )
            conn.commit()
            return cursor.lastrowid
        finally:
            conn.close()

    def complete_scrape_run(self, run_id: int, status: str, records_found: int = 0,
                            records_new: int = 0, records_processed: int = 0,
                            errors: str = None):
        conn = self._get_conn()
        try:
            conn.execute("""
                UPDATE scrape_runs SET
                    status = ?, records_found = ?, records_new = ?,
                    records_processed = ?, errors = ?,
                    completed_at = datetime('now')
                WHERE id = ?
            """, (status, records_found, records_new, records_processed, errors, run_id))
            conn.commit()
        finally:
            conn.close()

    def get_entity_count(self) -> int:
        conn = self._get_conn()
        try:
            row = conn.execute("SELECT COUNT(*) as cnt FROM entities").fetchone()
            return row['cnt']
        finally:
            conn.close()

    def get_source_stats(self) -> list:
        conn = self._get_conn()
        try:
            rows = conn.execute("""
                SELECT s.source_id, s.name, s.last_scraped_at,
                       COUNT(e.id) as entity_count
                FROM sources s
                LEFT JOIN entities e ON s.source_id = e.source_id
                GROUP BY s.source_id
            """).fetchall()
            return [dict(r) for r in rows]
        finally:
            conn.close()
