"""
FinPilot Nifty Shorts Video Engine — FastAPI Backend
===================================================
Orchestrates script mapping, edge-tts audio synthesis,
and Remotion headless MP4 video rendering for Nifty 50 stocks.

Run with:
    uvicorn main:app --reload --port 8500
"""

import os
import sys
import asyncio
import logging
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from routers.video import router as video_router

# Configure Proactor event loop on Windows
if sys.platform == "win32":
    try:
        asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
    except Exception:
        pass

# Configure logging
logging.basicConfig(
    level=logging.DEBUG,
    format="%(asctime)s | %(name)-20s | %(levelname)-7s | %(message)s",
    datefmt="%H:%M:%S",
)

load_dotenv()

app = FastAPI(
    title="FinPilot Nifty Shorts Video Engine",
    description="Autonomous pipeline converting Nifty Shorts financial scripts into 9:16 vertical animated videos",
    version="1.0.0",
)

# ── CORS ──────────────────────────────────────────────────────────────────────
origins_raw = os.getenv("CORS_ORIGINS", "http://localhost:3000,http://localhost:5173,http://127.0.0.1:3000,http://127.0.0.1:5173")
origins = [o.strip() for o in origins_raw.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins if origins else ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Static File Mounts for direct video and audio streaming ────────────────────
frontend_public = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "frontend", "public"))
videos_dir = os.path.join(frontend_public, "videos")
audio_dir = os.path.join(frontend_public, "audio")
images_dir = os.path.join(frontend_public, "images")

os.makedirs(videos_dir, exist_ok=True)
os.makedirs(audio_dir, exist_ok=True)
os.makedirs(images_dir, exist_ok=True)

app.mount("/videos", StaticFiles(directory=videos_dir), name="videos")
app.mount("/audio", StaticFiles(directory=audio_dir), name="audio")
app.mount("/images", StaticFiles(directory=images_dir), name="images")

# ── Routers ───────────────────────────────────────────────────────────────────
app.include_router(video_router)

@app.get("/")
async def root():
    return {
        "service": "FinPilot Nifty Shorts Video Engine",
        "version": "1.0.0",
        "port": 8500,
        "endpoints": {
            "health": "GET /health",
            "render_single": "POST /api/video/render",
            "batch_render": "POST /api/video/batch",
            "batch_status": "GET /api/video/batch",
            "brief_only": "POST /api/video/brief",
            "video_status": "GET /api/video/status/{symbol}",
        }
    }
