"""
    GET  /screener/meta   fields, presets (with live match counts), sectors, data date
    POST /screener/run    run a screen: {conditions, search, sort_by, sort_desc, limit, offset, symbols}
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from stock_screener import engine

router = APIRouter(prefix="/screener", tags=["Screener"])


class RunRequest(BaseModel):
    conditions: List[Dict[str, Any]] = Field(default_factory=list)
    search: str = ""
    sort_by: str = "mcap_cr"
    sort_desc: bool = True
    limit: int = Field(100, ge=1, le=500)
    offset: int = Field(0, ge=0)
    symbols: Optional[List[str]] = Field(None, max_length=50)


@router.get("/meta")
def get_meta():
    return engine.meta(engine.load_universe())


@router.post("/run")
def run(req: RunRequest):
    rows = engine.load_universe()
    if not rows:
        raise HTTPException(status_code=503, detail="The stock universe is not loaded yet. Run the baskets pipeline first.")
    try:
        out = engine.screen(rows, req.conditions, req.search, req.sort_by, req.sort_desc, req.limit, req.offset, req.symbols)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    out["as_of"] = engine.data_as_of()
    return out
