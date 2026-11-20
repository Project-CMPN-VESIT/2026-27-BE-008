"""
Server-side chat store for CYRO: sessions, messages and long-term user memory.

Uses CYRO_CHAT_DATABASE_URL or DATABASE_URL for PostgreSQL; SQLite is a local-development fallback.
Memory is an explicit, inspectable key/value store (never hidden): the user can see and edit every fact.
"""

from __future__ import annotations

import datetime as dt
import os
import uuid
import logging
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Dict, Iterator, List, Optional

from sqlalchemy import JSON, Column, DateTime, ForeignKey, Integer, String, Text, create_engine, func, text

# Public-DNS fallback for the PostgreSQL host (see pg_dns_fallback.py at the repository root).
try:
    import sys as _sys
    from pathlib import Path as _Path

    _sys.path.insert(0, str(_Path(__file__).resolve().parents[2]))
    import pg_dns_fallback as _pg_dns_fallback

    _pg_dns_fallback.install()
except Exception:  # never let the safety net stop a service from starting
    pass

from sqlalchemy.orm import Session, declarative_base, sessionmaker

logger = logging.getLogger(__name__)

def is_production() -> bool:
    env_name = (os.getenv("ENV") or os.getenv("NODE_ENV") or os.getenv("ENVIRONMENT") or "").lower()
    return env_name in ("production", "prod") or os.getenv("REQUIRE_POSTGRES", "0") == "1"

_DATA_DIR = Path(os.getenv("CYRO_CHAT_DATA_DIR", Path(__file__).resolve().parent.parent / "data"))
_DATA_DIR.mkdir(parents=True, exist_ok=True)

_raw_url = os.getenv("CYRO_CHAT_DATABASE_URL") or os.getenv("DATABASE_URL")
if not _raw_url:
    if is_production():
        raise RuntimeError(
            "PostgreSQL database URL is required in production. Please set CYRO_CHAT_DATABASE_URL or DATABASE_URL. "
            "Local SQLite fallback is disabled in production environments."
        )
    logger.warning("[CyroChat] Neither CYRO_CHAT_DATABASE_URL nor DATABASE_URL configured. Falling back to SQLite.")
    DATABASE_URL = f"sqlite:///{(_DATA_DIR / 'cyro_chat.db').as_posix()}"
else:
    DATABASE_URL = _raw_url

if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

Base = declarative_base()
_args = {"check_same_thread": False, "timeout": 30} if DATABASE_URL.startswith("sqlite") else {}
engine = create_engine(DATABASE_URL, connect_args=_args, pool_pre_ping=True, pool_recycle=240, pool_size=5, max_overflow=10)
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)

DEFAULT_TITLE = "New chat"


class AppUser(Base):
    __tablename__ = "app_users"
    firebase_uid = Column(String(128), primary_key=True)
    email = Column(String(320))
    display_name = Column(String(200))
    photo_url = Column(Text)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now())


def utcnow() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc).replace(tzinfo=None)


class ChatSession(Base):
    __tablename__ = "cyro_chat_sessions"
    id = Column(String(40), primary_key=True)
    user_id = Column("firebase_uid", String(128), ForeignKey("app_users.firebase_uid", ondelete="CASCADE"), index=True, nullable=False)
    title = Column(String(200), default=DEFAULT_TITLE)
    focus = Column(JSON, default=list)               # tickers currently being discussed (resolves "its", "that stock")
    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow, index=True)


class ChatMessage(Base):
    __tablename__ = "cyro_chat_messages"
    id = Column(Integer, primary_key=True, autoincrement=True)
    session_id = Column(String(40), ForeignKey("cyro_chat_sessions.id", ondelete="CASCADE"), index=True, nullable=False)
    user_id = Column("firebase_uid", String(128), ForeignKey("app_users.firebase_uid", ondelete="CASCADE"), index=True, nullable=False)
    role = Column(String(12), nullable=False)        # user | assistant
    kind = Column(String(12), default="text")        # text | report
    content = Column(Text, default="")
    payload = Column(JSON)                           # sources, suggestions, report events, plan, ...
    created_at = Column(DateTime, default=utcnow)


class MemoryFact(Base):
    __tablename__ = "cyro_user_memory"
    user_id = Column("firebase_uid", String(128), ForeignKey("app_users.firebase_uid", ondelete="CASCADE"), primary_key=True)
    key = Column(String(80), primary_key=True)
    value = Column(JSON)
    source = Column(String(12), default="chat")      # chat | user
    updated_at = Column(DateTime, default=utcnow)


def init_db() -> None:
    Base.metadata.create_all(engine)


def check_health() -> Dict[str, Any]:
    backend = "sqlite" if DATABASE_URL.startswith("sqlite") else "postgresql"
    try:
        with scope() as s:
            s.execute(text("SELECT 1"))
        return {"ok": True, "backend": backend, "error": None}
    except Exception as exc:
        return {"ok": False, "backend": backend, "error": str(exc)}


def ensure_user(user_id: str, email: Optional[str] = None, name: Optional[str] = None, picture: Optional[str] = None) -> None:
    with scope() as s:
        row = s.get(AppUser, user_id)
        if row is None:
            row = AppUser(firebase_uid=user_id, email=email, display_name=name, photo_url=picture)
            s.add(row)
        else:
            row.email = email or row.email
            row.display_name = row.display_name or name
            row.photo_url = row.photo_url or picture
            row.updated_at = utcnow()


@contextmanager
def scope() -> Iterator[Session]:
    s = SessionLocal()
    try:
        yield s
        s.commit()
    except Exception:
        s.rollback()
        raise
    finally:
        s.close()


# ── sessions ─────────────────────────────────────────────────────────────────────────────────────────────
def _session_dict(s: ChatSession, count: Optional[int] = None, preview: Optional[str] = None) -> Dict[str, Any]:
    return {"id": s.id, "title": s.title, "focus": s.focus or [], "created_at": s.created_at.isoformat(),
            "updated_at": s.updated_at.isoformat(), **({"message_count": count} if count is not None else {}),
            **({"preview": preview} if preview is not None else {})}


def create_session(user_id: str, title: str = DEFAULT_TITLE, session_id: Optional[str] = None) -> Dict[str, Any]:
    with scope() as s:
        row = ChatSession(id=session_id or uuid.uuid4().hex[:16], user_id=user_id, title=title, focus=[])
        s.add(row)
        s.flush()
        return _session_dict(row, 0)


def get_session(session_id: str, user_id: Optional[str] = None) -> Optional[Dict[str, Any]]:
    with scope() as s:
        row = s.get(ChatSession, session_id)
        if row is None or (user_id and row.user_id != user_id):
            return None
        return _session_dict(row)


def list_sessions(user_id: str, limit: int = 100) -> List[Dict[str, Any]]:
    with scope() as s:
        rows = s.query(ChatSession).filter(ChatSession.user_id == user_id).order_by(ChatSession.updated_at.desc()).limit(limit).all()
        ids = [r.id for r in rows]
        counts: Dict[str, int] = {}
        last_user: Dict[str, str] = {}
        if ids:
            # two grouped queries for every chat at once (was two queries per chat)
            counts = dict(s.query(ChatMessage.session_id, func.count(ChatMessage.id))
                          .filter(ChatMessage.session_id.in_(ids)).group_by(ChatMessage.session_id).all())
            latest = (s.query(ChatMessage.session_id, func.max(ChatMessage.id).label("mid"))
                      .filter(ChatMessage.session_id.in_(ids), ChatMessage.role == "user")
                      .group_by(ChatMessage.session_id).subquery())
            for sid, content in (s.query(ChatMessage.session_id, ChatMessage.content)
                                 .join(latest, ChatMessage.id == latest.c.mid).all()):
                last_user[sid] = content or ""
        out = [_session_dict(r, counts.get(r.id, 0), last_user.get(r.id, "")[:80]) for r in rows]
        return out


def rename_session(session_id: str, user_id: str, title: str) -> bool:
    with scope() as s:
        row = s.get(ChatSession, session_id)
        if row is None or row.user_id != user_id:
            return False
        row.title = title.strip()[:120] or DEFAULT_TITLE
        return True


def delete_session(session_id: str, user_id: str) -> bool:
    with scope() as s:
        row = s.get(ChatSession, session_id)
        if row is None or row.user_id != user_id:
            return False
        s.query(ChatMessage).filter(ChatMessage.session_id == session_id).delete()
        s.delete(row)
        return True


def touch_session(session_id: str, title: Optional[str] = None, focus: Optional[List[str]] = None, user_id: Optional[str] = None) -> None:
    with scope() as s:
        q = s.query(ChatSession).filter(ChatSession.id == session_id)
        if user_id:
            q = q.filter(ChatSession.user_id == user_id)
        row = q.first()
        if row is None:
            return
        row.updated_at = utcnow()
        if title:
            row.title = title
        if focus is not None:
            row.focus = focus


# ── messages ─────────────────────────────────────────────────────────────────────────────────────────────
def _msg_dict(m: ChatMessage) -> Dict[str, Any]:
    return {"id": m.id, "role": m.role, "kind": m.kind, "content": m.content, "payload": m.payload or {},
            "created_at": m.created_at.isoformat()}


def add_message(session_id: str, role: str, content: str, kind: str = "text", payload: Optional[dict] = None, user_id: Optional[str] = None) -> Dict[str, Any]:
    with scope() as s:
        owner_query = s.query(ChatSession).filter(ChatSession.id == session_id)
        if user_id:
            owner_query = owner_query.filter(ChatSession.user_id == user_id)
        owner = owner_query.first()
        if owner is None:
            raise ValueError("Chat session not found")
        row = ChatMessage(session_id=session_id, user_id=owner.user_id, role=role, kind=kind, content=content, payload=payload or {})
        s.add(row)
        s.flush()
        sess = s.get(ChatSession, session_id)
        if sess is not None:
            sess.updated_at = utcnow()
        return _msg_dict(row)


def get_messages(session_id: str, limit: Optional[int] = None, user_id: Optional[str] = None) -> List[Dict[str, Any]]:
    with scope() as s:
        q = s.query(ChatMessage).filter(ChatMessage.session_id == session_id)
        if user_id:
            q = q.filter(ChatMessage.user_id == user_id)
        q = q.order_by(ChatMessage.id)
        rows = q.all()
        if limit:
            rows = rows[-limit:]
        return [_msg_dict(m) for m in rows]


def recent_user_topics(user_id: str, exclude_session: Optional[str] = None, limit: int = 5) -> List[Dict[str, Any]]:
    """Titles + focus tickers of the user's other recent chats (cross-session recall)."""
    with scope() as s:
        q = s.query(ChatSession).filter(ChatSession.user_id == user_id, ChatSession.title != DEFAULT_TITLE)
        if exclude_session:
            q = q.filter(ChatSession.id != exclude_session)
        return [{"title": r.title, "focus": r.focus or [], "when": r.updated_at.date().isoformat()}
                for r in q.order_by(ChatSession.updated_at.desc()).limit(limit).all()]


# ── memory ───────────────────────────────────────────────────────────────────────────────────────────────
def get_memory(user_id: str) -> Dict[str, Any]:
    with scope() as s:
        return {r.key: r.value for r in s.query(MemoryFact).filter(MemoryFact.user_id == user_id).all()}


def set_memory(user_id: str, key: str, value: Any, source: str = "chat") -> None:
    with scope() as s:
        row = s.get(MemoryFact, (user_id, key))
        if row is None:
            s.add(MemoryFact(user_id=user_id, key=key, value=value, source=source))
        else:
            row.value, row.source, row.updated_at = value, source, utcnow()


def delete_memory(user_id: str, key: Optional[str] = None) -> int:
    with scope() as s:
        q = s.query(MemoryFact).filter(MemoryFact.user_id == user_id)
        if key:
            q = q.filter(MemoryFact.key == key)
        return q.delete()
