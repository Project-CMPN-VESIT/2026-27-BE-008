import hashlib
import os
import sqlite3
from datetime import datetime

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "news.db")

SCHEMA = """
CREATE TABLE IF NOT EXISTS announcements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT,
    nse_index TEXT,
    symbol TEXT,
    company TEXT,
    subject TEXT,
    category TEXT,
    announced_at TEXT,
    pdf_url TEXT,
    content_hash TEXT UNIQUE,
    fetched_at TEXT
);
"""


def _get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def _build_content_hash(item: dict) -> str:
    symbol = str(item.get("symbol") or "")
    subject = str(item.get("subject") or "")
    announced_at = str(item.get("announced_at") or "")
    value = f"{symbol}{subject}{announced_at}"
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _ensure_schema_migrations():
    with _get_conn() as conn:
        rows = conn.execute("PRAGMA table_info(announcements)").fetchall()
        columns = {row["name"] for row in rows}
        if "nse_index" not in columns:
            conn.execute("ALTER TABLE announcements ADD COLUMN nse_index TEXT")


def _normalize_pdf_url(source: str | None, pdf_url: str | None) -> str | None:
    if not pdf_url:
        return None

    value = str(pdf_url).strip()
    if not value:
        return None

    if (source or "").upper() == "NSE":
        value = value.replace("https://archives.nseindia.comhttps://", "https://")
        value = value.replace("https://archives.nseindia.comhttps//", "https://")
        value = value.replace("https://archives.nseindia.comhttp://", "http://")
        value = value.replace("https://archives.nseindia.comhttp//", "http://")

    return value


def _repair_legacy_nse_pdf_urls():
    with _get_conn() as conn:
        conn.execute(
            """
            UPDATE announcements
            SET pdf_url = REPLACE(pdf_url, 'https://archives.nseindia.comhttps://', 'https://')
            WHERE source = 'NSE'
              AND pdf_url LIKE 'https://archives.nseindia.comhttps://%'
            """
        )
        conn.execute(
            """
            UPDATE announcements
            SET pdf_url = REPLACE(pdf_url, 'https://archives.nseindia.comhttps//', 'https://')
            WHERE source = 'NSE'
              AND pdf_url LIKE 'https://archives.nseindia.comhttps//%'
            """
        )
        conn.execute(
            """
            UPDATE announcements
            SET pdf_url = REPLACE(pdf_url, 'https://archives.nseindia.comhttp://', 'http://')
            WHERE source = 'NSE'
              AND pdf_url LIKE 'https://archives.nseindia.comhttp://%'
            """
        )
        conn.execute(
            """
            UPDATE announcements
            SET pdf_url = REPLACE(pdf_url, 'https://archives.nseindia.comhttp//', 'http://')
            WHERE source = 'NSE'
              AND pdf_url LIKE 'https://archives.nseindia.comhttp//%'
            """
        )


def _repair_legacy_nse_index():
    with _get_conn() as conn:
        conn.execute(
            """
            UPDATE announcements
            SET nse_index = UPPER(category)
            WHERE source = 'NSE'
                            AND (nse_index IS NULL OR TRIM(nse_index) = '')
              AND UPPER(COALESCE(category, '')) IN ('EQUITIES', 'SME', 'DEBT', 'MF')
            """
        )


def init_db():
    with _get_conn() as conn:
        conn.executescript(SCHEMA)

    _ensure_schema_migrations()
    _repair_legacy_nse_index()
    _repair_legacy_nse_pdf_urls()


def insert_announcement(item: dict) -> bool:
    source = item.get("source")
    nse_index = str(item.get("nse_index") or "").strip().upper() or None
    fetched_at = item.get("fetched_at") or datetime.utcnow().isoformat()
    content_hash = item.get("content_hash") or _build_content_hash(item)
    pdf_url = _normalize_pdf_url(source, item.get("pdf_url"))

    with _get_conn() as conn:
        try:
            conn.execute(
                """
                INSERT INTO announcements (
                    source,
                    nse_index,
                    symbol,
                    company,
                    subject,
                    category,
                    announced_at,
                    pdf_url,
                    content_hash,
                    fetched_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    source,
                    nse_index,
                    item.get("symbol"),
                    item.get("company"),
                    item.get("subject"),
                    item.get("category"),
                    item.get("announced_at"),
                    pdf_url,
                    content_hash,
                    fetched_at,
                ),
            )
            return True
        except sqlite3.IntegrityError as exc:
            if "announcements.content_hash" in str(exc):
                conn.execute(
                    """
                    UPDATE announcements
                    SET
                        nse_index = COALESCE(nse_index, ?),
                        pdf_url = CASE
                            WHEN pdf_url IS NULL
                                OR pdf_url = ''
                                OR pdf_url LIKE 'https://archives.nseindia.comhttp%'
                            THEN COALESCE(?, pdf_url)
                            ELSE pdf_url
                        END
                    WHERE content_hash = ?
                    """,
                    (nse_index, pdf_url, content_hash),
                )
                return False
            raise


def get_announcements(symbol=None, source=None, nse_index=None, limit=None) -> list[dict]:
    query = """
    SELECT
        id,
        source,
        nse_index,
        symbol,
        company,
        subject,
        category,
        announced_at,
        pdf_url,
        content_hash,
        fetched_at
    FROM announcements
    """

    clauses = []
    params = []

    if symbol:
        clauses.append("symbol = ?")
        params.append(symbol)

    if source:
        clauses.append("source = ?")
        params.append(source)

    if nse_index:
        clauses.append("nse_index = ?")
        params.append(nse_index)

    if clauses:
        query += " WHERE " + " AND ".join(clauses)

    query += " ORDER BY announced_at DESC, id DESC"

    if limit is not None:
        query += " LIMIT ?"
        params.append(int(limit))

    with _get_conn() as conn:
        rows = conn.execute(query, params).fetchall()
        return [dict(row) for row in rows]


def get_stats() -> dict:
    with _get_conn() as conn:
        total = conn.execute("SELECT COUNT(*) AS count FROM announcements").fetchone()["count"]
        bse = conn.execute("SELECT COUNT(*) AS count FROM announcements WHERE source = 'BSE'").fetchone()["count"]
        nse = conn.execute("SELECT COUNT(*) AS count FROM announcements WHERE source = 'NSE'").fetchone()["count"]

    return {
        "total": total,
        "bse": bse,
        "nse": nse,
    }
