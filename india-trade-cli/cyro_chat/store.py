"""
Server-side chat store for CYRO: sessions, messages and long-term user memory.

SQLite by default (data/cyro_chat.db); set CYRO_CHAT_DATABASE_URL to use Postgres.
Memory is an explicit, inspectable key/value store (never hidden): the user can see and edit every fact.
"""

from __future__ import annotations

import datetime as dt
import os
import uuid
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Dict, Iterator, List, Optional

from sqlalchemy import JSON, Column, DateTime, Integer, String, Text, create_engine, func
from sqlalchemy.orm import Session, declarative_base, sessionmaker

_DATA_DIR = Path(os.getenv("CYRO_CHAT_DATA_DIR", Path(__file__).resolve().parent.parent / "data"))
_DATA_DIR.mkdir(parents=True, exist_ok=True)
DATABASE_URL = os.getenv("CYRO_CHAT_DATABASE_URL", f"sqlite:///{(_DATA_DIR / 'cyro_chat.db').as_posix()}")

Base = declarative_base()
_args = {"check_same_thread": False, "timeout": 30} if DATABASE_URL.startswith("sqlite") else {}
engine = create_engine(DATABASE_URL, connect_args=_args, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)

DEFAULT_TITLE = "New chat"


def utcnow() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc).replace(tzinfo=None)


class ChatSession(Base):
    __tablename__ = "chat_sessions"
    id = Column(String(40), primary_key=True)
    user_id = Column(String(80), index=True, nullable=False)
    title = Column(String(200), default=DEFAULT_TITLE)
    focus = Column(JSON, default=list)               # tickers currently being discussed (resolves "its", "that stock")
    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow, index=True)


class ChatMessage(Base):
    __tablename__ = "chat_messages"
    id = Column(Integer, primary_key=True, autoincrement=True)
    session_id = Column(String(40), index=True, nullable=False)
    role = Column(String(12), nullable=False)        # user | assistant
    kind = Column(String(12), default="text")        # text | report
    content = Column(Text, default="")
    payload = Column(JSON)                           # sources, suggestions, report events, plan, ...
    created_at = Column(DateTime, default=utcnow)


class MemoryFact(Base):
    __tablename__ = "chat_memory"
    user_id = Column(String(80), primary_key=True)
    key = Column(String(60), primary_key=True)
    value = Column(JSON)
    source = Column(String(12), default="chat")      # chat | user
    updated_at = Column(DateTime, default=utcnow)


def init_db() -> None:
    Base.metadata.create_all(engine)


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
        out = []
        for r in rows:
            n = s.query(func.count(ChatMessage.id)).filter(ChatMessage.session_id == r.id).scalar() or 0
            last = s.query(ChatMessage).filter(ChatMessage.session_id == r.id, ChatMessage.role == "user") \
                .order_by(ChatMessage.id.desc()).first()
            out.append(_session_dict(r, n, (last.content[:80] if last else "")))
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


def touch_session(session_id: str, title: Optional[str] = None, focus: Optional[List[str]] = None) -> None:
    with scope() as s:
        row = s.get(ChatSession, session_id)
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


def add_message(session_id: str, role: str, content: str, kind: str = "text", payload: Optional[dict] = None) -> Dict[str, Any]:
    with scope() as s:
        row = ChatMessage(session_id=session_id, role=role, kind=kind, content=content, payload=payload or {})
        s.add(row)
        s.flush()
        sess = s.get(ChatSession, session_id)
        if sess is not None:
            sess.updated_at = utcnow()
        return _msg_dict(row)


def get_messages(session_id: str, limit: Optional[int] = None) -> List[Dict[str, Any]]:
    with scope() as s:
        q = s.query(ChatMessage).filter(ChatMessage.session_id == session_id).order_by(ChatMessage.id)
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
