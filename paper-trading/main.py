from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from database import Database
from mentor_agent import MentorAgent

app = FastAPI(title="FinPilot Paper Trading API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

db = Database()

class ExecuteTradeRequest(BaseModel):
    user_id: str
    ticker: str
    action: str
    quantity: int
    execution_price: float
    user_thesis: str
    ai_feedback: str

class MentorAuditRequest(BaseModel):
    action: str
    quantity: int
    ticker: str
    user_thesis: str
    rk_score: float = 50.0
    pl_score: float = 50.0

@app.post("/api/trade/execute")
async def execute_trade(req: ExecuteTradeRequest):
    result = db.execute_trade(
        req.user_id, req.ticker, req.action, req.quantity, 
        req.execution_price, req.user_thesis, req.ai_feedback
    )
    if not result["success"]:
        raise HTTPException(status_code=400, detail=result["error"])
    return result

@app.get("/api/portfolio/{user_id}")
async def get_portfolio(user_id: str):
    user = db.get_or_create_user(user_id)
    positions = db.get_user_positions(user_id)
    journal = db.get_trade_journal(user_id)
    return {
        "balance": user["virtual_balance"],
        "positions": positions,
        "journal": journal
    }

@app.post("/api/mentor-audit")
async def mentor_audit(req: MentorAuditRequest):
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
