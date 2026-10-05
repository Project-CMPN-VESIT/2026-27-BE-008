import sqlite3
import os
import time
import threading
import logging
from typing import List, Dict, Any, Optional
import datetime
from dotenv import load_dotenv

env_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../../.env"))
from config.env_loader import load_project_env
load_project_env()

# We will try psycopg2 if available
try:
    import psycopg2
    from psycopg2.extras import RealDictCursor
    HAS_PSYCOPG2 = True
except ImportError:
    HAS_PSYCOPG2 = False

# We will try rapidfuzz if available
try:
    from rapidfuzz import process, fuzz
    HAS_RAPIDFUZZ = True
except ImportError:
    HAS_RAPIDFUZZ = False

# We will try nselib if available
try:
    from nselib import capital_market
    HAS_NSELIB = True
except ImportError:
    HAS_NSELIB = False

logger = logging.getLogger(__name__)

# Fallback map directly from cyro_skill.py
_TICKER_MAP: Dict[str, str] = {
    "reliance": "RELIANCE", "reliance industries": "RELIANCE",
    "tcs": "TCS", "tata consultancy": "TCS",
    "infosys": "INFY", "infy": "INFY",
    "hdfc bank": "HDFCBANK", "hdfcbank": "HDFCBANK",
    "icici bank": "ICICIBANK", "icicibank": "ICICIBANK",
    "wipro": "WIPRO",
    "hcl": "HCLTECH", "hcltech": "HCLTECH",
    "bharti airtel": "BHARTIARTL", "airtel": "BHARTIARTL",
    "kotak": "KOTAKBANK", "kotak mahindra": "KOTAKBANK",
    "axis bank": "AXISBANK", "axisbank": "AXISBANK",
    "larsen": "LT", "l&t": "LT", "lt": "LT",
    "maruti": "MARUTI", "maruti suzuki": "MARUTI",
    "asian paints": "ASIANPAINT",
    "bajaj finance": "BAJFINANCE",
    "titan": "TITAN",
    "ntpc": "NTPC",
    "ongc": "ONGC",
    "sun pharma": "SUNPHARMA", "sunpharma": "SUNPHARMA",
    "adani": "ADANIENT", "adani enterprises": "ADANIENT",
    "sbi": "SBIN", "state bank": "SBIN",
    "itc": "ITC",
    "dr reddy": "DRREDDY", "drreddy": "DRREDDY",
    "cipla": "CIPLA",
    "tata motors": "TATAMOTORS",
    "tata steel": "TATASTEEL",
    "hindalco": "HINDALCO",
    "coal india": "COALINDIA",
    "jswsteel": "JSWSTEEL", "jsw steel": "JSWSTEEL",
    "ultracem": "ULTRACEMCO", "ultratech": "ULTRACEMCO",
    "nestle": "NESTLEIND",
    "tech mahindra": "TECHM", "techm": "TECHM",
    "mahindra": "M&M", "m&m": "M&M",
    "eicher": "EICHERMOT", "royal enfield": "EICHERMOT",
    "hero motocorp": "HEROMOTOCO",
    "bajaj auto": "BAJAJ-AUTO",
    "divis": "DIVISLAB",
    "apollo": "APOLLOHOSP",
    "ltimindtree": "LTIM", "lti": "LTIM",
    "bpcl": "BPCL",
    "grasim": "GRASIM",
    "britannia": "BRITANNIA",
    "hdfc life": "HDFCLIFE",
    "sbi life": "SBILIFE",
    "upl": "UPL",
    "adani ports": "ADANIPORTS",
    "tata consumer": "TATACONSUM",
    "indusind": "INDUSINDBK",
    "bajaj finserv": "BAJAJFINSV",
    "power grid": "POWERGRID",
}

_SM_CACHE_TTL_SEC = 3600
_SM_SINGLETON = None
_SM_LOCK = threading.Lock()


def get_security_master() -> "SecurityMaster":
    """Process-wide shared instance (avoids a Postgres CREATE TABLE + full fetch per call)."""
    global _SM_SINGLETON
    with _SM_LOCK:
        if _SM_SINGLETON is None:
            _SM_SINGLETON = SecurityMaster()
        return _SM_SINGLETON


class SecurityMaster:
    """
    Canonical Security Master for CYRO.
    Uses an idempotent PostgreSQL store (via Neon) as the primary runtime.
    Falls back to SQLite for local development/testing if DATABASE_URL is absent.
    """
    def __init__(self, db_path: str = "cyro_security_master.db"):
        self.db_path = db_path
        self.database_url = os.getenv("DATABASE_URL")
        self.is_postgres = bool(self.database_url and self.database_url.startswith("postgres") and HAS_PSYCOPG2)
        
        self._init_db()

    def _get_pg_conn(self):
        return psycopg2.connect(self.database_url, connect_timeout=3)

    def _init_db(self):
        if self.is_postgres:
            try:
                conn = self._get_pg_conn()
                c = conn.cursor()
                c.execute('''
                    CREATE TABLE IF NOT EXISTS security_master (
                        security_id TEXT PRIMARY KEY,
                        company_name TEXT,
                        normalized_name TEXT,
                        nse_symbol TEXT,
                        bse_code TEXT,
                        exchange TEXT,
                        aliases TEXT,
                        sector TEXT,
                        status TEXT,
                        source_name TEXT,
                        source_quality TEXT,
                        last_updated TIMESTAMP WITH TIME ZONE,
                        created_at TIMESTAMP WITH TIME ZONE
                    )
                ''')
                c.execute('CREATE INDEX IF NOT EXISTS idx_pg_nse_symbol ON security_master(nse_symbol)')
                c.execute('CREATE INDEX IF NOT EXISTS idx_pg_normalized_name ON security_master(normalized_name)')
                c.execute('CREATE INDEX IF NOT EXISTS idx_pg_status ON security_master(status)')
                conn.commit()
                conn.close()
                return
            except Exception as e:
                logger.warning(f"[SecurityMaster] PostgreSQL init failed ({e}). Falling back to SQLite.")
                self.is_postgres = False

        conn = sqlite3.connect(self.db_path)
        c = conn.cursor()
        c.execute('''
            CREATE TABLE IF NOT EXISTS security_master (
                security_id TEXT PRIMARY KEY,
                company_name TEXT,
                normalized_name TEXT,
                nse_symbol TEXT,
                bse_code TEXT,
                exchange TEXT,
                aliases TEXT,
                sector TEXT,
                status TEXT,
                source_name TEXT,
                source_quality TEXT,
                last_updated TEXT,
                created_at TEXT
            )
        ''')
        c.execute('CREATE INDEX IF NOT EXISTS idx_sl_nse_symbol ON security_master(nse_symbol)')
        c.execute('CREATE INDEX IF NOT EXISTS idx_sl_normalized_name ON security_master(normalized_name)')
        c.execute('CREATE INDEX IF NOT EXISTS idx_sl_status ON security_master(status)')
        conn.commit()
        conn.close()
            
    def migrate_from_sqlite(self):
        """
        One-time migration script to move existing data from local SQLite to Neon PostgreSQL.
        Reads from legacy 'securities' table if it exists, otherwise reads from 'security_master'.
        """
        if not self.is_postgres:
            logger.warning("[SecurityMaster] DATABASE_URL not set. Migration to Postgres skipped.")
            return
            
        if not os.path.exists(self.db_path):
            logger.info("[SecurityMaster] Local SQLite db not found. No migration needed.")
            return
            
        # Read from sqlite
        conn_lite = sqlite3.connect(self.db_path)
        conn_lite.row_factory = sqlite3.Row
        c_lite = conn_lite.cursor()
        
        # Check if legacy table exists
        c_lite.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='securities'")
        has_legacy = c_lite.fetchone() is not None
        
        table_to_read = 'securities' if has_legacy else 'security_master'
        try:
            c_lite.execute(f'SELECT * FROM {table_to_read}')
            rows = c_lite.fetchall()
        except sqlite3.OperationalError:
            # Table might not exist
            rows = []
            
        conn_lite.close()
        
        if not rows:
            logger.info(f"[SecurityMaster] No records found in SQLite table {table_to_read}.")
            return
            
        now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
        
        # Upsert into Postgres
        conn_pg = self._get_pg_conn()
        c_pg = conn_pg.cursor()
        
        for row in rows:
            d = dict(row)
            created_at = d.get('created_at', now_iso)
            source_name = d.get('source_name', d.get('source', 'migrated'))
            normalized_name = d.get('normalized_name', str(d.get('company_name', '')).strip().lower())
            
            c_pg.execute('''
                INSERT INTO security_master (
                    security_id, company_name, normalized_name, nse_symbol, bse_code, exchange, 
                    aliases, sector, status, source_name, source_quality, last_updated, created_at
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (security_id) DO UPDATE SET
                    company_name = EXCLUDED.company_name,
                    normalized_name = EXCLUDED.normalized_name,
                    aliases = EXCLUDED.aliases,
                    sector = EXCLUDED.sector,
                    status = EXCLUDED.status,
                    source_name = EXCLUDED.source_name,
                    source_quality = EXCLUDED.source_quality,
                    last_updated = EXCLUDED.last_updated
            ''', (
                d['security_id'], d['company_name'], normalized_name, d['nse_symbol'], d.get('bse_code'),
                d['exchange'], d['aliases'], d['sector'], d['status'], source_name,
                d['source_quality'], d['last_updated'], created_at
            ))
            
        conn_pg.commit()
        conn_pg.close()
        logger.info(f"[SecurityMaster] Successfully migrated {len(rows)} records from SQLite to Neon PostgreSQL.")

    def refresh(self):
        self._cache = None
        """
        Refresh the canonical universe. Idempotent upsert.
        Priority:
        1. Existing fallback map (_TICKER_MAP)
        2. nselib.indices (NIFTY 50, NIFTY NEXT 50, NIFTY MIDCAP 150)
        """
        logger.info("[SecurityMaster] Starting refresh...")
        records_to_upsert = {}

        now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
        
        # 1. Existing fallback map (trusted source)
        for name, ticker in _TICKER_MAP.items():
            sec_id = f"NSE:{ticker}"
            if sec_id not in records_to_upsert:
                records_to_upsert[sec_id] = {
                    "security_id": sec_id,
                    "company_name": name.title(),
                    "normalized_name": name.lower(),
                    "nse_symbol": ticker,
                    "bse_code": None,
                    "exchange": "NSE",
                    "aliases": name.lower(),
                    "sector": None,
                    "status": "active",
                    "source_name": "cyro_skill_map",
                    "source_quality": "trusted_internal",
                    "last_updated": now_iso,
                    "created_at": now_iso
                }
            else:
                existing_aliases = records_to_upsert[sec_id]["aliases"].split(";")
                if name.lower() not in existing_aliases:
                    records_to_upsert[sec_id]["aliases"] += f";{name.lower()}"

        # 2. nselib indices
        if HAS_NSELIB:
            try:
                indices_to_fetch = ["NIFTY 50", "NIFTY NEXT 50", "NIFTY MIDCAP 150"]
                for index_name in indices_to_fetch:
                    df = capital_market.nifty50_equity_list() if index_name == "NIFTY 50" else None
                    if df is not None and not df.empty:
                        for _, row in df.iterrows():
                            sym = str(row.get('Symbol', '')).strip()
                            comp_name = str(row.get('Company Name', '')).strip()
                            sector = str(row.get('Industry', '')).strip()
                            normalized = comp_name.lower()
                            
                            if sym:
                                sec_id = f"NSE:{sym}"
                                if sec_id in records_to_upsert:
                                    records_to_upsert[sec_id]["company_name"] = comp_name
                                    records_to_upsert[sec_id]["normalized_name"] = normalized
                                    records_to_upsert[sec_id]["sector"] = sector
                                    records_to_upsert[sec_id]["source_name"] = "nselib.indices"
                                    records_to_upsert[sec_id]["source_quality"] = "trusted_secondary"
                                    records_to_upsert[sec_id]["last_updated"] = now_iso
                                else:
                                    records_to_upsert[sec_id] = {
                                        "security_id": sec_id,
                                        "company_name": comp_name,
                                        "normalized_name": normalized,
                                        "nse_symbol": sym,
                                        "bse_code": None,
                                        "exchange": "NSE",
                                        "aliases": normalized,
                                        "sector": sector,
                                        "status": "active",
                                        "source_name": "nselib.indices",
                                        "source_quality": "trusted_secondary",
                                        "last_updated": now_iso,
                                        "created_at": now_iso
                                    }
            except Exception as e:
                logger.error(f"[SecurityMaster] Failed to refresh from nselib: {e}")

        # Upsert logic
        if self.is_postgres:
            conn = self._get_pg_conn()
            c = conn.cursor()
            for sec in records_to_upsert.values():
                c.execute('''
                    INSERT INTO security_master (
                        security_id, company_name, normalized_name, nse_symbol, bse_code, exchange, 
                        aliases, sector, status, source_name, source_quality, last_updated, created_at
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (security_id) DO UPDATE SET
                        company_name = EXCLUDED.company_name,
                        normalized_name = EXCLUDED.normalized_name,
                        aliases = EXCLUDED.aliases,
                        sector = EXCLUDED.sector,
                        status = EXCLUDED.status,
                        source_name = EXCLUDED.source_name,
                        source_quality = EXCLUDED.source_quality,
                        last_updated = EXCLUDED.last_updated
                ''', (
                    sec["security_id"], sec["company_name"], sec["normalized_name"], sec["nse_symbol"], sec["bse_code"],
                    sec["exchange"], sec["aliases"], sec["sector"], sec["status"], sec["source_name"],
                    sec["source_quality"], sec["last_updated"], sec["created_at"]
                ))
            conn.commit()
            conn.close()
        else:
            conn = sqlite3.connect(self.db_path)
            c = conn.cursor()
            for sec in records_to_upsert.values():
                c.execute('''
                    INSERT INTO security_master (
                        security_id, company_name, normalized_name, nse_symbol, bse_code, exchange, 
                        aliases, sector, status, source_name, source_quality, last_updated, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(security_id) DO UPDATE SET
                        company_name = excluded.company_name,
                        normalized_name = excluded.normalized_name,
                        aliases = excluded.aliases,
                        sector = excluded.sector,
                        status = excluded.status,
                        source_name = excluded.source_name,
                        source_quality = excluded.source_quality,
                        last_updated = excluded.last_updated
                ''', (
                    sec["security_id"], sec["company_name"], sec["normalized_name"], sec["nse_symbol"], sec["bse_code"],
                    sec["exchange"], sec["aliases"], sec["sector"], sec["status"], sec["source_name"],
                    sec["source_quality"], sec["last_updated"], sec["created_at"]
                ))
            conn.commit()
            conn.close()
            
        logger.info(f"[SecurityMaster] Refresh complete. Upserted {len(records_to_upsert)} records.")

    def get_all_securities(self) -> List[Dict[str, Any]]:
        """Cached read: the security master changes rarely, so avoid a DB round-trip per call."""
        cached = getattr(self, "_cache", None)
        if cached and (time.monotonic() - cached[0]) < _SM_CACHE_TTL_SEC:
            return cached[1]
        rows = self._load_all_securities()
        if rows:
            self._cache = (time.monotonic(), rows)
        return rows

    def _load_all_securities(self) -> List[Dict[str, Any]]:
        if self.is_postgres:
            try:
                conn = self._get_pg_conn()
                c = conn.cursor(cursor_factory=RealDictCursor)
                c.execute('SELECT * FROM security_master')
                rows = c.fetchall()
                conn.close()
                return [dict(row) for row in rows]
            except Exception as e:
                logger.warning(f"[SecurityMaster] PostgreSQL query failed ({e}). Falling back to SQLite.")
                self.is_postgres = False

        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        c = conn.cursor()
        c.execute('SELECT * FROM security_master')
        rows = c.fetchall()
        conn.close()
        return [dict(row) for row in rows]
        
    def resolve(self, query: str) -> Dict[str, Any]:
        """
        Attempt to resolve a query to a canonical security record.
        Returns:
        {
            "status": "resolved" | "ambiguous" | "unresolved",
            "candidates": [...],
            "method": "exact" | "alias" | "fuzzy" | None
        }
        """
        query_clean = query.strip().lower()
        query_upper = query.strip().upper()
        
        # Ensure we have data
        all_secs = self.get_all_securities()
        if not all_secs:
            self.refresh()
            all_secs = self.get_all_securities()
            
        # 1. Exact Ticker Match
        exact_ticker = [s for s in all_secs if s["nse_symbol"] == query_upper]
        if exact_ticker:
            return {
                "status": "resolved",
                "candidates": exact_ticker,
                "method": "exact_ticker"
            }
            
        # 2. Exact Company Match
        exact_company = [s for s in all_secs if s["normalized_name"] == query_clean]
        if exact_company:
            return {
                "status": "resolved",
                "candidates": exact_company,
                "method": "exact_company"
            }
            
        # 3. Alias Match
        alias_matches = []
        for s in all_secs:
            aliases = [a.strip() for a in (s.get("aliases") or "").split(";")]
            if query_clean in aliases:
                alias_matches.append(s)
                
        if len(alias_matches) == 1:
            return {
                "status": "resolved",
                "candidates": alias_matches,
                "method": "alias"
            }
        elif len(alias_matches) > 1:
            return {
                "status": "ambiguous",
                "candidates": alias_matches,
                "method": "alias"
            }
            
        # 4. Fuzzy Match (Typo handling)
        if HAS_RAPIDFUZZ and all_secs:
            # Create a lookup mapping text -> security
            lookup = {}
            choices = []
            for s in all_secs:
                choices.append(s["company_name"])
                lookup[s["company_name"]] = s
                for alias in (s.get("aliases") or "").split(";"):
                    if alias:
                        choices.append(alias)
                        lookup[alias] = s
            
            matches = process.extract(query_clean, choices, scorer=fuzz.partial_ratio, limit=5)
            # Matches are (match_str, score, index)
            high_matches = [m for m in matches if m[1] > 85]
            
            if high_matches:
                unique_secs = {}
                for m in high_matches:
                    sec = lookup[m[0]]
                    unique_secs[sec["security_id"]] = sec
                    
                candidates = list(unique_secs.values())
                
                if len(candidates) == 1:
                    return {
                        "status": "resolved",
                        "candidates": candidates,
                        "method": "fuzzy"
                    }
                else:
                    return {
                        "status": "ambiguous",
                        "candidates": candidates,
                        "method": "fuzzy"
                    }
                    
        return {
            "status": "unresolved",
            "candidates": [],
            "method": None
        }
