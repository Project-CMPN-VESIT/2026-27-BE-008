import os
import json
import logging
from typing import Dict, Any, Optional
import psycopg2
from psycopg2.extras import RealDictCursor
from web.cyro_engine.models import QualityGateResult

logger = logging.getLogger(__name__)

class QualityStore:
    """
    Handles structured QualityGate persistence in Neon PostgreSQL.
    Stores metadata and results of the Agent 3 validation cycle.
    """
    def __init__(self):
        self.db_url = os.getenv("DATABASE_URL")
        if not self.db_url:
            logger.warning("[QualityStore] DATABASE_URL not set in environment.")
            
        self._ensure_table_exists()

    def _get_conn(self):
        if not self.db_url:
            return None
        try:
            return psycopg2.connect(self.db_url, cursor_factory=RealDictCursor)
        except Exception as e:
            logger.error(f"[QualityStore] DB Connection Error: {e}")
            return None

    def _ensure_table_exists(self):
        """Creates the cyro_quality_results table if it doesn't exist."""
        conn = self._get_conn()
        if not conn:
            return
            
        try:
            with conn:
                with conn.cursor() as cur:
                    cur.execute("""
                        CREATE TABLE IF NOT EXISTS cyro_quality_results (
                            research_id VARCHAR(255) PRIMARY KEY,
                            gate_status VARCHAR(50) NOT NULL,
                            gate_version VARCHAR(50) NOT NULL,
                            validated_at VARCHAR(100) NOT NULL,
                            security_scope JSONB,
                            evidence_summary JSONB,
                            category_status JSONB,
                            flags JSONB
                        );
                    """)
            logger.info("[QualityStore] cyro_quality_results table is ready.")
        except Exception as e:
            logger.error(f"[QualityStore] Table creation failed: {e}")
        finally:
            conn.close()

    def store_result(self, research_id: str, result: QualityGateResult):
        """
        Idempotent upsert of the quality gate result for a given research run.
        """
        conn = self._get_conn()
        if not conn:
            return
            
        try:
            with conn:
                with conn.cursor() as cur:
                    cur.execute("""
                        INSERT INTO cyro_quality_results (
                            research_id, gate_status, gate_version, validated_at, 
                            security_scope, evidence_summary, category_status, flags
                        ) VALUES (
                            %(research_id)s, %(gate_status)s, %(gate_version)s, %(validated_at)s,
                            %(security_scope)s, %(evidence_summary)s, %(category_status)s, %(flags)s
                        )
                        ON CONFLICT (research_id) DO UPDATE SET
                            gate_status = EXCLUDED.gate_status,
                            gate_version = EXCLUDED.gate_version,
                            validated_at = EXCLUDED.validated_at,
                            security_scope = EXCLUDED.security_scope,
                            evidence_summary = EXCLUDED.evidence_summary,
                            category_status = EXCLUDED.category_status,
                            flags = EXCLUDED.flags
                    """, {
                        "research_id": research_id,
                        "gate_status": result.gate_status,
                        "gate_version": result.metadata.get("gate_version", "1.0.0"),
                        "validated_at": result.metadata.get("validated_at", ""),
                        "security_scope": json.dumps(result.security_scope),
                        "evidence_summary": json.dumps(result.evidence_summary),
                        "category_status": json.dumps(result.category_status),
                        "flags": json.dumps([f.model_dump() for f in result.flags]),
                    })
        except Exception as e:
            logger.error(f"[QualityStore] Store result failed for {research_id}: {e}")
        finally:
            conn.close()
