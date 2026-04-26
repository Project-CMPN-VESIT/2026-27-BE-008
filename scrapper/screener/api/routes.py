from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import Dict, Any, List
from pydantic import BaseModel
import time

from ..db.session import get_db
from ..db.models import DerivedMetrics
from ..engine import ScreenerEngine

router = APIRouter(prefix="/api/v1/screener", tags=["Screener"])

class ScreenRequest(BaseModel):
    query_ast: Dict[str, Any]
    sort_by: str = "market_cap"
    sort_desc: bool = True
    limit: int = 50

@router.post("/run")
def run_screen(req: ScreenRequest, db: Session = Depends(get_db)):
    start_time = time.time()
    try:
        # 1. Parse AST to SQLAlchemy condition
        condition = ScreenerEngine.parse_condition(req.query_ast)
        
        # 2. Build Query
        query = db.query(DerivedMetrics).filter(condition)
        
        # 3. Apply sorting (default to market_cap desc)
        if req.sort_by in ScreenerEngine.ALLOWED_FIELDS:
            sort_col = ScreenerEngine.ALLOWED_FIELDS[req.sort_by]
            if req.sort_desc:
                sort_col = sort_col.desc()
            query = query.order_by(sort_col)
            
        # 4. Execute
        results = query.limit(req.limit).all()
        
        # 5. Explainability Layer
        explained_results = ScreenerEngine.generate_explanations(results, req.query_ast)
        
        elapsed_ms = (time.time() - start_time) * 1000
        
        return {
            "success": True,
            "execution_time_ms": round(elapsed_ms, 2),
            "count": len(results),
            "results": explained_results
        }
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        raise HTTPException(status_code=500, detail="Internal Server Error")

from ..db.models import ScreenDefinition
import uuid
from typing import Optional

class SaveScreenRequest(BaseModel):
    name: str
    query_ast: Dict[str, Any]
    user_id: str

@router.post("/screens")
def save_screen(req: SaveScreenRequest, db: Session = Depends(get_db)):
    try:
        new_screen = ScreenDefinition(
            id=f"scr_{uuid.uuid4().hex[:12]}",
            user_id=req.user_id,
            name=req.name,
            query_ast=req.query_ast,
            is_preset=False
        )
        db.add(new_screen)
        db.commit()
        db.refresh(new_screen)
        return {"success": True, "screen_id": new_screen.id}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/screens")
def get_screens(user_id: str, db: Session = Depends(get_db)):
    try:
        # Fetch presets and user screens
        screens = db.query(ScreenDefinition).filter(
            (ScreenDefinition.user_id == user_id) | (ScreenDefinition.is_preset == True)
        ).all()
        
        return {
            "success": True,
            "screens": [
                {
                    "id": s.id,
                    "name": s.name,
                    "query_ast": s.query_ast,
                    "is_preset": s.is_preset
                } for s in screens
            ]
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

class SaveAlertRequest(BaseModel):
    user_id: str
    symbol: str
    metric: str
    condition: str
    threshold: float

@router.post("/alerts")
def save_alert(req: SaveAlertRequest):
    # In Phase 3, this is scaffolded logic to save to a database.
    # We will log it and return success for now until the cron worker is built.
    try:
        # Mock saving alert
        alert_id = f"alrt_{uuid.uuid4().hex[:12]}"
        return {
            "success": True, 
            "alert_id": alert_id,
            "message": f"Alert set for {req.symbol}: {req.metric} {req.condition} {req.threshold}"
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
