import os
import json
import math
import logging
from typing import Dict, Any, List, Optional
import psycopg2
from psycopg2.extras import RealDictCursor

logger = logging.getLogger(__name__)


def _clean_nan(obj):
    """Recursively replace NaN/Inf floats with None (Postgres JSON rejects them)."""
    if isinstance(obj, float):
        return obj if math.isfinite(obj) else None
    if isinstance(obj, dict):
        return {k: _clean_nan(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_clean_nan(v) for v in obj]
    return obj


def _json_safe(obj) -> str:
    return json.dumps(_clean_nan(obj), default=str)


class EvidenceStore:
    _table_ready = False
    """
    Handles structured evidence persistence in Neon PostgreSQL.
    Stores and retrieves normalized CYRO EvidenceItem objects.
    """
    def __init__(self):
        self.db_url = os.getenv("DATABASE_URL")
        if not self.db_url:
            logger.warning("[EvidenceStore] DATABASE_URL not set in environment.")

        # The DDL is idempotent but costs several Neon round-trips; run it once per process.
        if not EvidenceStore._table_ready:
            EvidenceStore._table_ready = self._ensure_table_exists()

    def _get_conn(self):
        if not self.db_url:
            return None
        try:
            return psycopg2.connect(self.db_url, cursor_factory=RealDictCursor, connect_timeout=5)
        except Exception as e:
            logger.error(f"[EvidenceStore] DB Connection Error: {e}")
            return None

    def _ensure_table_exists(self):
        """Creates the cyro_evidence_items table if it doesn't exist."""
        conn = self._get_conn()
        if not conn:
            return False
            
        try:
            with conn:
                with conn.cursor() as cur:
                    cur.execute("""
                        CREATE TABLE IF NOT EXISTS cyro_evidence_items (
                            id VARCHAR(255) PRIMARY KEY,
                            research_id VARCHAR(255) NOT NULL,
                            security_id VARCHAR(255) NOT NULL,
                            ticker VARCHAR(100) NOT NULL,
                            type VARCHAR(100) NOT NULL,
                            category VARCHAR(100),
                            source_quality VARCHAR(100) NOT NULL,
                            source_name VARCHAR(255) NOT NULL,
                            title TEXT NOT NULL,
                            url TEXT,
                            published_at VARCHAR(100),
                            fetched_at VARCHAR(100) NOT NULL,
                            locator JSONB,
                            excerpt TEXT NOT NULL,
                            facts JSONB,
                            freshness VARCHAR(50) NOT NULL,
                            content_hash VARCHAR(255)
                        );
                        
                        CREATE INDEX IF NOT EXISTS idx_cyro_evidence_research 
                        ON cyro_evidence_items (research_id);
                        
                        CREATE INDEX IF NOT EXISTS idx_cyro_evidence_ticker 
                        ON cyro_evidence_items (ticker);
                    """)
            logger.info("[EvidenceStore] cyro_evidence_items table is ready.")
            return True
        except Exception as e:
            logger.error(f"[EvidenceStore] Table creation failed: {e}")
            return False
        finally:
            conn.close()

    def store_evidence(self, item_dict: Dict[str, Any]):
        """
        Idempotent upsert of a single EvidenceItem dict.
        """
        conn = self._get_conn()
        if not conn:
            return False
            
        try:
            with conn:
                with conn.cursor() as cur:
                    locator_json = _json_safe(item_dict.get("locator")) if item_dict.get("locator") else None
                    facts_json = _json_safe(item_dict.get("facts", []))
                    
                    cur.execute("""
                        INSERT INTO cyro_evidence_items (
                            id, research_id, security_id, ticker, type, category, 
                            source_quality, source_name, title, url, published_at, 
                            fetched_at, locator, excerpt, facts, freshness, content_hash
                        ) VALUES (
                            %(id)s, %(research_id)s, %(security_id)s, %(ticker)s, %(type)s, %(category)s,
                            %(source_quality)s, %(source_name)s, %(title)s, %(url)s, %(published_at)s,
                            %(fetched_at)s, %(locator)s, %(excerpt)s, %(facts)s, %(freshness)s, %(content_hash)s
                        )
                        ON CONFLICT (id) DO UPDATE SET
                            research_id = EXCLUDED.research_id,
                            category = EXCLUDED.category,
                            title = EXCLUDED.title,
                            url = EXCLUDED.url,
                            published_at = EXCLUDED.published_at,
                            fetched_at = EXCLUDED.fetched_at,
                            locator = EXCLUDED.locator,
                            excerpt = EXCLUDED.excerpt,
                            facts = EXCLUDED.facts,
                            freshness = EXCLUDED.freshness,
                            content_hash = EXCLUDED.content_hash
                    """, {
                        "id": item_dict.get("id"),
                        "research_id": item_dict.get("research_id"),
                        "security_id": item_dict.get("security_id") or item_dict.get("ticker"), # Fallback to ticker if security_id missing
                        "ticker": item_dict.get("ticker"),
                        "type": item_dict.get("type"),
                        "category": item_dict.get("category"),
                        "source_quality": item_dict.get("source_quality"),
                        "source_name": item_dict.get("source_name"),
                        "title": item_dict.get("title", ""),
                        "url": item_dict.get("url"),
                        "published_at": item_dict.get("published_at"),
                        "fetched_at": item_dict.get("fetched_at"),
                        "locator": locator_json,
                        "excerpt": item_dict.get("excerpt", ""),
                        "facts": facts_json,
                        "freshness": item_dict.get("freshness", "current"),
                        "content_hash": item_dict.get("content_hash"),
                    })
            return True
        except Exception as e:
            logger.error(f"[EvidenceStore] Store evidence failed for {item_dict.get('id')}: {e}")
            return False
        finally:
            conn.close()

    _COLS = ("id", "research_id", "security_id", "ticker", "type", "category", "source_quality",
             "source_name", "title", "url", "published_at", "fetched_at", "locator", "excerpt",
             "facts", "freshness", "content_hash")

    def _row(self, d: Dict[str, Any]) -> tuple:
        return (
            d.get("id"), d.get("research_id"), d.get("security_id") or d.get("ticker"), d.get("ticker"),
            d.get("type"), d.get("category"), d.get("source_quality"), d.get("source_name"),
            d.get("title", ""), d.get("url"), d.get("published_at"), d.get("fetched_at"),
            _json_safe(d.get("locator")) if d.get("locator") else None,
            d.get("excerpt", ""), _json_safe(d.get("facts", [])),
            d.get("freshness", "current"), d.get("content_hash"),
        )

    def store_evidence_batch(self, items: List[Dict[str, Any]]):
        """Upsert all evidence items over ONE connection in ONE round-trip (was one connection per item)."""
        if not items:
            return True
        conn = self._get_conn()
        if not conn:
            return False
        try:
            from psycopg2.extras import execute_values

            unique = {}  # ON CONFLICT cannot touch the same id twice in a single statement
            for it in items:
                unique[it.get("id")] = it
            rows = [self._row(it) for it in unique.values()]
            cols = ", ".join(self._COLS)
            updates = ", ".join(f"{c} = EXCLUDED.{c}" for c in self._COLS if c != "id")
            with conn:
                with conn.cursor() as cur:
                    execute_values(
                        cur,
                        f"INSERT INTO cyro_evidence_items ({cols}) VALUES %s "
                        f"ON CONFLICT (id) DO UPDATE SET {updates}",
                        rows,
                    )
            return True
        except Exception as e:
            logger.error(f"[EvidenceStore] Batch store failed ({len(items)} items): {e}")
            return False
        finally:
            conn.close()

    def store_evidence_batch_async(self, items: List[Dict[str, Any]]):
        """Persist in a background thread: nothing in the pipeline reads evidence back from the DB."""
        import threading
        threading.Thread(
            target=self.store_evidence_batch, args=(list(items),), daemon=True, name="cyro-evidence-store"
        ).start()
