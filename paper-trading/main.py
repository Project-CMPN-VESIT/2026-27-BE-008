from pathlib import Path
from dotenv import load_dotenv

# Ensure root .env and local .env are loaded before initializing database or firebase auth
_paper_dir = Path(__file__).resolve().parent
_root_dir = _paper_dir.parent
if (_root_dir / ".env").exists():
    load_dotenv(_root_dir / ".env", override=True)
if (_paper_dir / ".env").exists():
    load_dotenv(_paper_dir / ".env", override=False)

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, field_validator
from database import Database
from mentor_agent import MentorAgent
from firebase_auth import require_firebase_user

app = FastAPI(title="FinPilot Paper Trading API")


@app.exception_handler(RequestValidationError)
async def validation_error_handler(_: Request, exc: RequestValidationError):
    # The default handler echoes the rejected input back; a NaN/Infinity literal in it cannot be serialised and
    # turned a plain validation failure into an HTTP 500. Report only where and why the field was rejected.
    errors = [{"loc": list(e.get("loc", ())), "msg": e.get("msg", "invalid"), "type": e.get("type", "value_error")} for e in exc.errors()]
    return JSONResponse(status_code=422, content={"detail": errors})

db = Database()

def current_user(identity: dict = Depends(require_firebase_user)) -> str:
    db.ensure_user(identity["uid"], identity.get("email"), identity.get("name"), identity.get("picture"))
    return identity["uid"]

def _clean_action(value: str) -> str:
    action = (value or "").strip().upper()
    if action not in {"BUY", "SELL"}:
        raise ValueError("action must be BUY or SELL")
    return action


class ExecuteTradeRequest(BaseModel):
    ticker: str = Field(min_length=1, max_length=32)
    action: str
    quantity: int = Field(gt=0, le=1_000_000)
    execution_price: float = Field(gt=0, le=10_000_000, allow_inf_nan=False)
    user_thesis: str = Field(default="", max_length=4000)
    ai_feedback: str = Field(default="", max_length=8000)
    idempotency_key: str = Field(min_length=1, max_length=128)

    _action = field_validator("action")(_clean_action)


class MentorAuditRequest(BaseModel):
    action: str
    quantity: int = Field(gt=0, le=1_000_000)
    ticker: str = Field(min_length=1, max_length=32)
    user_thesis: str = Field(default="", max_length=4000)
    rk_score: float = Field(default=50.0, ge=0, le=100, allow_inf_nan=False)
    pl_score: float = Field(default=50.0, ge=0, le=100, allow_inf_nan=False)

    _action = field_validator("action")(_clean_action)

@app.post("/api/trade/execute")
async def execute_trade(req: ExecuteTradeRequest, uid: str = Depends(current_user)):
    result = db.execute_trade(
        uid, req.ticker, req.action, req.quantity,
        req.execution_price, req.user_thesis, req.ai_feedback, req.idempotency_key,
    )
    if not result["success"]:
        raise HTTPException(status_code=400, detail=result["error"])
    return result

@app.get("/api/portfolio")
async def get_portfolio(uid: str = Depends(current_user)):
    user = db.get_or_create_user(uid)
    positions = db.get_user_positions(uid)
    journal = db.get_trade_journal(uid)
    return {
        "balance": user["virtual_balance"],
        "positions": positions,
        "journal": journal
    }

@app.post("/api/mentor-audit")
async def mentor_audit(req: MentorAuditRequest, uid: str = Depends(current_user)):
    try:
        agent = MentorAgent()
        critique = agent.evaluate_trade(
            action=req.action,
            quantity=req.quantity,
            ticker=req.ticker,
            rk_score=req.rk_score,
            pl_score=req.pl_score,
            user_thesis=req.user_thesis
        )
        return {"critique": critique}
    except Exception as e:
        return {"critique": f"Mentor evaluation failed: {e}. Proceed carefully."}
