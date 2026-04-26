"""
FastAPI-based screening API.
Accepts batched input records and returns match results with breakdown.
"""

import os
import sys
import logging
from datetime import datetime
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

# Add project root to path
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from db.database import Database

logger = logging.getLogger(__name__)

app = FastAPI(
    title="Regulatory Sanctions Screening API",
    description="Screen individuals and entities against regulatory sanctions databases (RBI, UNSC)",
    version="1.0.0",
)

# Add CORS so the frontend can call the API
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize DB
db = Database()

# Include Screener Router
from screener.api.routes import router as screener_router
from screener.db.session import init_db
init_db() # Initialize the screener DB
app.include_router(screener_router)

# --- Request/Response Models ---

class ScreenInput(BaseModel):
    record_id: str = Field(default="rec_001", description="Unique ID for this input record")
    name: Optional[str] = None
    company_name: Optional[str] = None
    din: Optional[str] = None
    cin: Optional[str] = None
    pan: Optional[str] = None
    date_of_birth: Optional[str] = None
    country: Optional[str] = None


class ScreenRequest(BaseModel):
    records: list[ScreenInput]
    threshold: float = Field(default=0.75, ge=0.0, le=1.0)
    include_cleared: bool = False


class MatchBreakdown(BaseModel):
    exact_id_hit: bool = False
    fuzzy_name_score: float = 0.0
    dob_boost: bool = False
    country_boost: bool = False


class MatchedEntity(BaseModel):
    name: Optional[str] = None
    name_variants: list[str] = []
    din: Optional[str] = None
    cin: Optional[str] = None
    pan: Optional[str] = None
    dob: Optional[str] = None
    country: Optional[str] = None
    circular_number: Optional[str] = None
    date_of_publish: Optional[str] = None
    sanction_start: Optional[str] = None
    sanction_end: Optional[str] = None
    circular_link: Optional[str] = None
    publishing_body: Optional[str] = None
    extraction_confidence: float = 0.0


class ScreenResult(BaseModel):
    input_record_id: str
    match_status: str  # MATCH, POSSIBLE_MATCH, NO_MATCH
    match_score: float
    sanction_status: Optional[str] = None  # ACTIVE, EXPIRED, PREVIOUSLY_SANCTIONED_CLEARED
    matched_entity: Optional[MatchedEntity] = None
    match_breakdown: Optional[MatchBreakdown] = None


class ScreenResponse(BaseModel):
    results: list[ScreenResult]
    total_screened: int
    total_matches: int
    screening_time_ms: float


# --- Matching Logic ---

def fuzzy_name_match(input_name: str, entity_variants: list) -> float:
    """Compute best fuzzy match score between input name and entity variants."""
    if not input_name or not entity_variants:
        return 0.0

    try:
        from thefuzz import fuzz
    except ImportError:
        from fuzzywuzzy import fuzz

    input_lower = input_name.lower().strip()
    best_score = 0.0

    for variant in entity_variants:
        if not variant:
            continue
        variant_lower = variant.lower().strip()

        # Try both ratio and token_sort_ratio, take the best
        score1 = fuzz.ratio(input_lower, variant_lower) / 100.0
        score2 = fuzz.token_sort_ratio(input_lower, variant_lower) / 100.0
        score3 = fuzz.partial_ratio(input_lower, variant_lower) / 100.0

        best = max(score1, score2, score3)
        if best > best_score:
            best_score = best

    return best_score


def screen_single_record(record: ScreenInput, all_entities: list,
                          threshold: float, include_cleared: bool) -> ScreenResult:
    """Screen a single input record against all entities."""

    best_match = None
    best_score = 0.0
    best_breakdown = MatchBreakdown()

    for entity in all_entities:
        # Skip cleared entities unless requested
        if not include_cleared and entity.get("sanction_status") == "PREVIOUSLY_SANCTIONED_CLEARED":
            continue

        score = 0.0
        breakdown = MatchBreakdown()

        # 1. Exact ID match (PAN, DIN, CIN)
        exact_hit = False
        if record.pan and entity.get("pan") and record.pan.upper() == entity["pan"].upper():
            exact_hit = True
        if record.din and entity.get("din") and record.din == entity["din"]:
            exact_hit = True
        if record.cin and entity.get("cin") and record.cin.upper() == entity["cin"].upper():
            exact_hit = True

        if exact_hit:
            score = 1.0
            breakdown.exact_id_hit = True
        else:
            # 2. Fuzzy name match
            search_name = record.name or record.company_name
            if search_name:
                # Match against entity name + all variants
                variants = entity.get("variant_list", [])
                if entity.get("name"):
                    variants = [entity["name"]] + variants

                fuzzy_score = fuzzy_name_match(search_name, variants)
                breakdown.fuzzy_name_score = round(fuzzy_score, 4)

                # Base score from fuzzy match (capped at 0.74 for name-only)
                score = fuzzy_score * 0.90

                # 3. DOB boost
                if record.date_of_birth and entity.get("date_of_birth"):
                    if record.date_of_birth == entity["date_of_birth"]:
                        score += 0.10
                        breakdown.dob_boost = True

                # 4. Country boost
                if record.country and entity.get("country"):
                    input_country = record.country.lower().strip()
                    entity_country = entity["country"].lower().strip()
                    if input_country == entity_country or input_country in entity_country:
                        score += 0.05
                        breakdown.country_boost = True

                # Cap at 0.99 (never 1.0 without exact ID match)
                score = min(score, 0.99)

                # Name-only match cap: if no secondary signal, cap at 0.74
                if not breakdown.dob_boost and not breakdown.country_boost:
                    score = min(score, 0.74)

        if score > best_score:
            best_score = score
            best_breakdown = breakdown
            best_match = entity

    # Determine match status
    if best_score >= threshold:
        match_status = "MATCH"
    elif best_score >= 0.50:
        match_status = "POSSIBLE_MATCH"
    else:
        match_status = "NO_MATCH"

    # Build response
    matched_entity = None
    if best_match and best_score >= 0.50:
        matched_entity = MatchedEntity(
            name=best_match.get("name"),
            name_variants=best_match.get("variant_list", [])[:5],
            din=best_match.get("din"),
            cin=best_match.get("cin"),
            pan=best_match.get("pan"),
            dob=best_match.get("date_of_birth"),
            country=best_match.get("country"),
            circular_number=best_match.get("circular_number"),
            date_of_publish=best_match.get("date_published"),
            sanction_start=best_match.get("sanction_start"),
            sanction_end=best_match.get("sanction_end"),
            circular_link=best_match.get("link"),
            publishing_body=best_match.get("publishing_body"),
            extraction_confidence=best_match.get("extraction_confidence", 0.0),
        )

    return ScreenResult(
        input_record_id=record.record_id,
        match_status=match_status,
        match_score=round(best_score, 4),
        sanction_status=best_match.get("sanction_status") if best_match and best_score >= 0.50 else None,
        matched_entity=matched_entity,
        match_breakdown=best_breakdown if best_score > 0 else None,
    )


# --- API Endpoints ---

@app.post("/v1/screen", response_model=ScreenResponse)
async def screen_records(request: ScreenRequest):
    """
    Screen input records against the sanctions database.
    Accepts up to 2000 records per request.
    """
    if len(request.records) > 2000:
        raise HTTPException(400, "Maximum 2000 records per request. Chunk your data.")

    if len(request.records) == 0:
        raise HTTPException(400, "At least one input record required.")

    start_time = datetime.now()

    # Load all entities with their name variants
    all_entities = db.get_all_entities_with_variants()

    if not all_entities:
        return ScreenResponse(
            results=[
                ScreenResult(
                    input_record_id=r.record_id,
                    match_status="NO_MATCH",
                    match_score=0.0,
                )
                for r in request.records
            ],
            total_screened=len(request.records),
            total_matches=0,
            screening_time_ms=0.0,
        )

    # Screen each record
    results = []
    total_matches = 0

    for record in request.records:
        result = screen_single_record(
            record, all_entities, request.threshold, request.include_cleared
        )
        results.append(result)
        if result.match_status == "MATCH":
            total_matches += 1

    elapsed = (datetime.now() - start_time).total_seconds() * 1000

    return ScreenResponse(
        results=results,
        total_screened=len(request.records),
        total_matches=total_matches,
        screening_time_ms=round(elapsed, 2),
    )


@app.get("/v1/stats")
async def get_stats():
    """Get database statistics."""
    entity_count = db.get_entity_count()
    source_stats = db.get_source_stats()
    return {
        "total_entities": entity_count,
        "sources": source_stats,
    }


@app.get("/v1/entities")
async def get_entities(page_size: int = 500):
    """Get all extracted entities for the UI."""
    all_entities = db.get_all_entities_with_variants()
    
    formatted = []
    for e in all_entities[:page_size]:
        formatted.append({
            "id": e["id"],
            "source_id": e["source_id"],
            "name": e["name"],
            "din_number": e.get("din"),
            "pan_number": e.get("pan"),
            "cin_number": e.get("cin"),
            "date_of_publish": e.get("date_published"),
            "link_to_circular": e.get("link"),
            "issuing_body": e.get("publishing_body"),
            "circular_number": e.get("circular_number")
        })
        
    return {"entities": formatted}


@app.post("/v1/pipeline/run")
async def run_pipeline():
    """Run the scraping and extraction pipeline."""
    import subprocess
    run_py_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "run.py")
    process = subprocess.run([sys.executable, run_py_path, "pipeline"], capture_output=True, text=True)
    if process.returncode == 0:
        return {"status": "success", "message": "Pipeline completed successfully."}
    else:
        raise HTTPException(500, f"Pipeline failed: {process.stderr}")


@app.get("/health")
async def health():
    return {"status": "ok", "timestamp": datetime.utcnow().isoformat()}

# --- Paper Trading Endpoints ---

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
        from extraction.mentor_agent import MentorAgent
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
        logger.error(f"Error in mentor audit endpoint: {e}")
        return {"critique": "Mentor evaluation failed. Do you still want to execute this trade?"}
