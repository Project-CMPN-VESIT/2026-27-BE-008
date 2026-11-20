"""
HTTP API for the CYRO chat agent.

    POST   /skills/cyro/chat                      SSE: one conversational turn (may trigger a full report)
    GET    /skills/cyro/chat/sessions             list this user's chats
    POST   /skills/cyro/chat/sessions             create a chat
    PATCH  /skills/cyro/chat/sessions/{id}        rename
    DELETE /skills/cyro/chat/sessions/{id}        delete
    GET    /skills/cyro/chat/sessions/{id}/messages
    GET    /skills/cyro/chat/memory               what CYRO remembers about the user
    PUT    /skills/cyro/chat/memory               edit one remembered fact
    DELETE /skills/cyro/chat/memory               forget one fact (?key=) or everything
"""

import asyncio
import logging
import threading
import time
from typing import Any, Optional

from fastapi import APIRouter, Header, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from cyro_chat import agent, memory, store
from cyro_chat.firebase_auth import require_firebase_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/skills/cyro/chat", tags=["CYRO Chat"])

DB_STATUS = {"ok": False, "backend": "unknown", "error": "Not initialized"}

def init_startup_db() -> None:
    global DB_STATUS
    try:
        store.init_db()
        DB_STATUS = store.check_health()
        if not DB_STATUS["ok"]:
            logger.error("[CyroChat] Database health check failed on startup: %s", DB_STATUS["error"])
            if store.is_production():
                raise RuntimeError(f"Database health check failed in production: {DB_STATUS['error']}")
    except Exception as exc:
        backend = "sqlite" if store.DATABASE_URL.startswith("sqlite") else "postgresql"
        DB_STATUS = {"ok": False, "backend": backend, "error": str(exc)}
        logger.error("[CyroChat] Database initialization error on startup: %s", exc)
        if store.is_production():
            raise

init_startup_db()


@router.get("/health")
def health():
    status = store.check_health()
    if not status["ok"]:
        raise HTTPException(status_code=503, detail={"status": "degraded", "database": status})
    return {"status": "ok", "database": status}


_USER_SYNCED: dict = {}
_USER_SYNC_TTL_S = 300


def _uid(authorization: Optional[str], header: Optional[str] = None) -> str:
    identity = require_firebase_user(authorization, header)
    # The user row only needs syncing now and then; writing it on every request cost one DB round trip each time.
    now = time.monotonic()
    if now - _USER_SYNCED.get(identity["uid"], -1e9) < _USER_SYNC_TTL_S:
        return identity["uid"]
    try:
        store.ensure_user(identity["uid"], identity.get("email"), identity.get("name"), identity.get("picture"))
        _USER_SYNCED[identity["uid"]] = now
        if len(_USER_SYNCED) > 5000:
            _USER_SYNCED.clear()
    except Exception as exc:
        logger.error("[CyroChat] Failed to synchronize app user: %s", exc)
        raise HTTPException(status_code=503, detail=f"Database service degraded: {exc}")
    return identity["uid"]


class ChatBody(BaseModel):
    message: str = Field(min_length=1, max_length=4000)
    session_id: Optional[str] = Field(default=None, max_length=64)
    ticker: Optional[str] = Field(default=None, max_length=40)


@router.post("")
async def chat(request: Request, body: ChatBody, authorization: Optional[str] = Header(None), x_cyro_user: Optional[str] = Header(None)):
    from web.cyro_skill import cyro_stream            # the existing report pipeline, reused untouched

    uid = _uid(authorization, x_cyro_user)
    cancel_event = threading.Event()

    async def stream_wrapper():
        try:
            async for chunk in agent.chat_turn(
                body.session_id,
                uid,
                body.message,
                body.ticker,
                report_runner=cyro_stream,
                authorization=authorization,
                cancel_event=cancel_event,
            ):
                if await request.is_disconnected():
                    cancel_event.set()
                    logger.info("[CyroChat] Client disconnected from chat stream")
                    break
                yield chunk
        except (asyncio.CancelledError, GeneratorExit):
            cancel_event.set()
            logger.info("[CyroChat] Stream cancelled by client abort")
            raise
        finally:
            cancel_event.set()

    return StreamingResponse(
        stream_wrapper(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/sessions")
def sessions(authorization: Optional[str] = Header(None), x_cyro_user: Optional[str] = Header(None)):
    return {"sessions": store.list_sessions(_uid(authorization, x_cyro_user))}


class NewSession(BaseModel):
    title: Optional[str] = Field(default=None, max_length=120)


@router.post("/sessions")
def new_session(body: NewSession, authorization: Optional[str] = Header(None), x_cyro_user: Optional[str] = Header(None)):
    return store.create_session(_uid(authorization, x_cyro_user), title=body.title or store.DEFAULT_TITLE)


class Rename(BaseModel):
    title: str = Field(min_length=1, max_length=120)


@router.patch("/sessions/{session_id}")
def rename(session_id: str, body: Rename, authorization: Optional[str] = Header(None), x_cyro_user: Optional[str] = Header(None)):
    if not store.rename_session(session_id, _uid(authorization, x_cyro_user), body.title):
        raise HTTPException(status_code=404, detail="chat not found")
    return {"ok": True}


@router.delete("/sessions/{session_id}")
def remove(session_id: str, authorization: Optional[str] = Header(None), x_cyro_user: Optional[str] = Header(None)):
    if not store.delete_session(session_id, _uid(authorization, x_cyro_user)):
        raise HTTPException(status_code=404, detail="chat not found")
    return {"ok": True}


@router.get("/sessions/{session_id}/messages")
def messages(session_id: str, authorization: Optional[str] = Header(None), x_cyro_user: Optional[str] = Header(None)):
    uid = _uid(authorization, x_cyro_user)
    sess = store.get_session(session_id, uid)
    if sess is None:
        raise HTTPException(status_code=404, detail="chat not found")
    return {"session": sess, "messages": store.get_messages(session_id, user_id=uid)}


@router.get("/memory")
def get_memory(authorization: Optional[str] = Header(None), x_cyro_user: Optional[str] = Header(None)):
    mem = store.get_memory(_uid(authorization, x_cyro_user))
    return {"items": memory.public_view(mem), "schema": {
        "choices": {k: list(v) for k, v in memory.SCALARS.items()}, "lists": list(memory.LISTS), "text": list(memory.FREE_TEXT)}}


class MemoryBody(BaseModel):
    key: str = Field(min_length=1, max_length=40)
    value: Any


@router.put("/memory")
def put_memory(body: MemoryBody, authorization: Optional[str] = Header(None), x_cyro_user: Optional[str] = Header(None)):
    uid = _uid(authorization, x_cyro_user)
    key = body.key.strip().lower()
    if key in memory.LISTS and isinstance(body.value, (list, tuple)) and len(body.value) == 0:
        store.delete_memory(uid, key)
        return {"items": memory.public_view(store.get_memory(uid))}
    val = memory.clean_update(body.key, body.value)
    if val is None:
        raise HTTPException(status_code=422, detail=f"invalid value for {body.key}")
    if isinstance(val, (list, tuple)) and len(val) == 0:
        store.delete_memory(uid, key)
    else:
        store.set_memory(uid, key, val, source="user")
    return {"items": memory.public_view(store.get_memory(uid))}


@router.delete("/memory")
def forget(key: Optional[str] = Query(None), authorization: Optional[str] = Header(None), x_cyro_user: Optional[str] = Header(None)):
    n = store.delete_memory(_uid(authorization, x_cyro_user), key)
    return {"deleted": n}
