"""Dedicated FastAPI app for the Discovery Screener service."""

from datetime import datetime

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api.routes import router as screener_router
from .db.session import init_db

app = FastAPI(
    title="FinPilot Discovery Screener API",
    description="Standalone screener API for saved screens, runs, and alerts.",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

init_db()
app.include_router(screener_router)


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "service": "discovery-screener",
        "timestamp": datetime.utcnow().isoformat(),
    }
