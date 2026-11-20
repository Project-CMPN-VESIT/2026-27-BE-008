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
    def upsert_source(self, source_id: str, source_name: str, url: str,
                      source_type: str, regulator: str, country: str = "IN",
                      priority: int = 1, active: bool = True):
        conn = self._get_conn()
        try:
            conn.execute("""
                INSERT INTO sources (source_id, source_name, source_url, source_type, regulator, country, priority, active)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(source_id) DO UPDATE SET
                    source_name=excluded.source_name, source_url=excluded.source_url,
                    source_type=excluded.source_type, regulator=excluded.regulator,
                    country=excluded.country, priority=excluded.priority,
                    active=excluded.active
            """, (source_id, source_name, url, source_type, regulator, country, priority, int(active)))
            conn.commit()
        finally:
            conn.close()

    def update_source_last_scraped(self, source_id: str):
        conn = self._get_conn()
        try:
            conn.execute(
                "UPDATE sources SET last_successful_sync = ?, last_attempted_sync = ? WHERE source_id = ?",
                (datetime.utcnow().isoformat(), datetime.utcnow().isoformat(), source_id)
            )
            conn.commit()
        finally:
            conn.close()
            
    def update_source_last_attempted(self, source_id: str):
        conn = self._get_conn()
        try:
            conn.execute(
                "UPDATE sources SET last_attempted_sync = ? WHERE source_id = ?",
                (datetime.utcnow().isoformat(), source_id)
            )
            conn.commit()
        finally:
            conn.close()

    # --- Documents ---
    def document_exists(self, content_hash: str) -> bool:
        conn = self._get_conn()
        try:
            row = conn.execute(
                "SELECT 1 FROM documents WHERE content_hash = ?", (content_hash,)
            ).fetchone()
            return row is not None
        finally:
            conn.close()

    def insert_document(self, source_id: str, content_hash: str,
                        source_url: str = None, document_url: str = None,
                        published_at: str = None, raw_text: str = None) -> int:
        conn = self._get_conn()
        try:
            cursor = conn.execute("""
                INSERT OR IGNORE INTO documents
                    (source_id, content_hash, source_url, document_url, published_at, raw_text)
                VALUES (?, ?, ?, ?, ?, ?)
            """, (source_id, content_hash, source_url, document_url, published_at, raw_text))
            conn.commit()
            return cursor.lastrowid
        finally:
            conn.close()

    def get_unprocessed_documents(self, source_id: str = None) -> list:
        conn = self._get_conn()
        try:
            if source_id:
                rows = conn.execute(
                    "SELECT * FROM documents WHERE parse_status = 'PENDING' AND source_id = ?",
                    (source_id,)
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT * FROM documents WHERE parse_status = 'PENDING'"
                ).fetchall()
            return [dict(r) for r in rows]
        finally:
            conn.close()

    def mark_document_processed(self, document_id: int, status: str = 'COMPLETED'):
        conn = self._get_conn()
        try:
            conn.execute(
                "UPDATE documents SET parse_status = ? WHERE document_id = ?", (status, document_id)
            )
            conn.commit()
        finally:
            conn.close()

    # --- Entities ---
    def insert_entity(self, canonical_name: str, entity_type: str = None, 
                      din: str = None, cin: str = None, pan: str = None) -> int:
        conn = self._get_conn()
        try:
            normalized_name = canonical_name.lower().strip() if canonical_name else None
            cursor = conn.execute("""
                INSERT INTO entities
                    (canonical_name, entity_type, din, cin, pan, normalized_name)
                VALUES (?, ?, ?, ?, ?, ?)
            """, (canonical_name, entity_type, din, cin, pan, normalized_name))
            conn.commit()
            return cursor.lastrowid
        finally:
            conn.close()
            
    def update_entity_identifiers(self, entity_id: int, din: str = None, cin: str = None, pan: str = None):
        conn = self._get_conn()
        try:
            if din:
                conn.execute("UPDATE entities SET din = coalesce(din, ?) WHERE entity_id = ?", (din, entity_id))
            if cin:
                conn.execute("UPDATE entities SET cin = coalesce(cin, ?) WHERE entity_id = ?", (cin, entity_id))
            if pan:
                conn.execute("UPDATE entities SET pan = coalesce(pan, ?) WHERE entity_id = ?", (pan, entity_id))
            conn.commit()
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
            
    # --- Regulatory Actions ---
    def insert_regulatory_action(self, entity_id: int, source_id: str, regulator: str,
                                 action_type: str, status: str, source_url: str,
                                 document_id: int = None, original_action_type: str = None,
                                 order_number: str = None, order_date: str = None,
                                 effective_date: str = None, expiry_date: str = None,
                                 publication_date: str = None, description: str = None,
                                 confidence: float = 0.0) -> int:
        if not source_url:
            raise ValueError("source_url is a hard requirement for regulatory_actions")
            
        conn = self._get_conn()
        try:
            cursor = conn.execute("""
                INSERT INTO regulatory_actions
                    (entity_id, source_id, document_id, regulator, action_type, original_action_type,
                     status, order_number, order_date, effective_date, expiry_date,
                     publication_date, description, confidence, source_url)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (entity_id, source_id, document_id, regulator, action_type, original_action_type,
                  status, order_number, order_date, effective_date, expiry_date,
                  publication_date, description, confidence, source_url))
            conn.commit()
            return cursor.lastrowid
        finally:
            conn.close()
            
    def get_all_actions_with_entities(self) -> list:
        conn = self._get_conn()
        try:
            # We fetch all entities and their active/historical actions
            rows = conn.execute("""
                SELECT 
                    e.entity_id, e.canonical_name as name, e.din, e.cin, e.pan, e.entity_type,
                    ra.action_id, ra.source_id, ra.regulator, ra.action_type, ra.status as sanction_status,
                    ra.source_url as link, ra.order_number as circular_number, 
                    ra.publication_date as date_published, ra.effective_date as sanction_start, 
                    ra.expiry_date as sanction_end, ra.last_verified_at,
                    GROUP_CONCAT(nv.variant, '||') as variants
                FROM entities e
                JOIN regulatory_actions ra ON e.entity_id = ra.entity_id
                LEFT JOIN name_variants nv ON e.entity_id = nv.entity_id
                GROUP BY ra.action_id
            """).fetchall()
            
            results = []
            for r in rows:
                d = dict(r)
                d['variant_list'] = d.get('variants', '').split('||') if d.get('variants') else []
                # Compatibility fields for older UI
                d['id'] = d['entity_id'] 
                d['publishing_body'] = d['regulator']
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
                "INSERT INTO sync_runs (source_id, status) VALUES (?, 'RUNNING')",
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
                UPDATE sync_runs SET
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
            row = conn.execute("SELECT COUNT(DISTINCT entity_id) as cnt FROM entities").fetchone()
            return row['cnt']
        finally:
            conn.close()
            
    def get_action_count(self) -> int:
        conn = self._get_conn()
        try:
            row = conn.execute("SELECT COUNT(*) as cnt FROM regulatory_actions").fetchone()
            return row['cnt']
        finally:
            conn.close()

    def get_source_stats(self) -> list:
        conn = self._get_conn()
        try:
            rows = conn.execute("""
                SELECT s.source_id, s.source_name as name, s.regulator, s.last_successful_sync as last_scraped_at,
                       COUNT(ra.action_id) as action_count,
                       COUNT(DISTINCT ra.entity_id) as entity_count
                FROM sources s
                LEFT JOIN regulatory_actions ra ON s.source_id = ra.source_id
                GROUP BY s.source_id
            """).fetchall()
            return [dict(r) for r in rows]
        finally:
            conn.close()
