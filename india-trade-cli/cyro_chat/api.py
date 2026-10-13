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

from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Header, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from cyro_chat import agent, memory, store

router = APIRouter(prefix="/skills/cyro/chat", tags=["CYRO Chat"])

try:
    store.init_db()
except Exception:          # never stop the API from starting because of the chat store
    pass


def _uid(header: Optional[str], query: Optional[str] = None) -> str:
    return (header or query or "default_user").strip()[:80] or "default_user"


class ChatBody(BaseModel):
    message: str
    session_id: Optional[str] = None
    ticker: Optional[str] = None
    user_id: Optional[str] = None


@router.post("")
async def chat(body: ChatBody, x_cyro_user: Optional[str] = Header(None)):
    from web.cyro_skill import cyro_stream            # the existing report pipeline, reused untouched

    uid = _uid(x_cyro_user, body.user_id)
    gen = agent.chat_turn(body.session_id, uid, body.message, body.ticker, report_runner=cyro_stream)
    return StreamingResponse(gen, media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.get("/sessions")
def sessions(x_cyro_user: Optional[str] = Header(None), user_id: Optional[str] = None):
    return {"sessions": store.list_sessions(_uid(x_cyro_user, user_id))}


class NewSession(BaseModel):
    title: Optional[str] = None


@router.post("/sessions")
def new_session(body: NewSession, x_cyro_user: Optional[str] = Header(None), user_id: Optional[str] = None):
    return store.create_session(_uid(x_cyro_user, user_id), title=body.title or store.DEFAULT_TITLE)


class Rename(BaseModel):
    title: str


@router.patch("/sessions/{session_id}")
def rename(session_id: str, body: Rename, x_cyro_user: Optional[str] = Header(None), user_id: Optional[str] = None):
    if not store.rename_session(session_id, _uid(x_cyro_user, user_id), body.title):
        raise HTTPException(status_code=404, detail="chat not found")
    return {"ok": True}


@router.delete("/sessions/{session_id}")
def remove(session_id: str, x_cyro_user: Optional[str] = Header(None), user_id: Optional[str] = None):
    if not store.delete_session(session_id, _uid(x_cyro_user, user_id)):
        raise HTTPException(status_code=404, detail="chat not found")
    return {"ok": True}


@router.get("/sessions/{session_id}/messages")
def messages(session_id: str, x_cyro_user: Optional[str] = Header(None), user_id: Optional[str] = None):
    sess = store.get_session(session_id, _uid(x_cyro_user, user_id))
    if sess is None:
        raise HTTPException(status_code=404, detail="chat not found")
    return {"session": sess, "messages": store.get_messages(session_id)}


@router.get("/memory")
def get_memory(x_cyro_user: Optional[str] = Header(None), user_id: Optional[str] = None):
    mem = store.get_memory(_uid(x_cyro_user, user_id))
    return {"items": memory.public_view(mem), "schema": {
        "choices": {k: list(v) for k, v in memory.SCALARS.items()}, "lists": list(memory.LISTS), "text": list(memory.FREE_TEXT)}}


class MemoryBody(BaseModel):
    key: str
    value: Any


@router.put("/memory")
def put_memory(body: MemoryBody, x_cyro_user: Optional[str] = Header(None), user_id: Optional[str] = None):
    uid = _uid(x_cyro_user, user_id)
    val = memory.clean_update(body.key, body.value)
    if val is None:
        raise HTTPException(status_code=422, detail=f"invalid value for {body.key}")
    store.set_memory(uid, body.key.strip().lower(), val, source="user")
    return {"items": memory.public_view(store.get_memory(uid))}


@router.delete("/memory")
def forget(key: Optional[str] = Query(None), x_cyro_user: Optional[str] = Header(None), user_id: Optional[str] = None):
    n = store.delete_memory(_uid(x_cyro_user, user_id), key)
    return {"deleted": n}
