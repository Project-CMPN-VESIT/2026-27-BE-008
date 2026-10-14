from fastapi import Depends, FastAPI, HTTPException
from pydantic import BaseModel, Field
from database import Database
from mentor_agent import MentorAgent
from firebase_auth import require_firebase_user

app = FastAPI(title="FinPilot Paper Trading API")

db = Database()

def current_user(identity: dict = Depends(require_firebase_user)) -> str:
    db.ensure_user(identity["uid"], identity.get("email"), identity.get("name"), identity.get("picture"))
    return identity["uid"]

class ExecuteTradeRequest(BaseModel):
    ticker: str = Field(min_length=1, max_length=32)
    action: str
    quantity: int = Field(gt=0)
    execution_price: float = Field(gt=0)
    user_thesis: str = ""
    ai_feedback: str = ""
    idempotency_key: str = Field(min_length=1, max_length=128)

class MentorAuditRequest(BaseModel):
    action: str
    quantity: int
    ticker: str
    user_thesis: str
    rk_score: float = 50.0
    pl_score: float = 50.0

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
