import os
import logging
import traceback
from typing import Optional
from datetime import datetime
import httpx
from fastapi import APIRouter, HTTPException, Query
from schemas import (
    StockRenderRequest,
    BatchRenderRequest,
    NiftyStockItem,
    GenerateResponse,
)
from agents.director_agent import (
    render_single_stock_video,
    start_batch_render,
    get_batch_status,
    cancel_batch,
    get_frontend_public_path,
)
from agents.script_mapper import map_short_to_video_brief
from agents.image_agent import process_video_images

logger = logging.getLogger("video_router")
router = APIRouter()

@router.get("/health")
async def health():
    return {
        "status": "ok",
        "service": "FinPilot Nifty Shorts Video Engine",
        "timestamp": datetime.now().isoformat(),
    }

@router.post("/api/video/render")
async def render_stock(req: StockRenderRequest):
    """
    Renders an animated short-form video for an individual stock.
    Takes stock_data and optional script.
    """
    logger.info(f"Render request for {req.stock_data.symbol}, script={'yes' if req.script else 'no'}, date={req.date}")
    try:
        result = await render_single_stock_video(
            stock=req.stock_data,
            script=req.script,
            date=req.date,
            voice=req.voice or "en-IN-W",
            force=req.force or False,
        )
        return result
    except Exception as e:
        error_detail = f"{type(e).__name__}: {str(e)}" if str(e) else f"{type(e).__name__}: {traceback.format_exc()[-500:]}"
        logger.error(f"Render failed for {req.stock_data.symbol}: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"Rendering failed: {error_detail}")

@router.post("/api/video/brief")
async def get_brief(req: StockRenderRequest):
    """
    Generates and returns the VideoBrief schema without rendering MP4 video.
    Useful for quick UI previews and inspection. Pre-resolves background images.
    """
    try:
        brief = map_short_to_video_brief(req.stock_data, req.script)
        target_date = req.date or req.stock_data.trading_date or datetime.now().strftime("%Y-%m-%d")
        try:
            await process_video_images(brief.scenes, req.stock_data, target_date)
        except Exception as img_err:
            logger.warning(f"Failed to pre-resolve images in brief endpoint: {img_err}")
        return {"success": True, "video_brief": brief.model_dump()}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Brief mapping failed: {str(e)}")

@router.post("/api/video/batch")
async def batch_render(req: BatchRenderRequest):
    """
    Starts batch rendering for multiple stocks.
    Renders sequential videos in background.
    """
    try:
        result = await start_batch_render(
            stocks=req.stocks,
            date=req.date,
            force=req.force or False,
            voice=req.voice or "en-IN-W",
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Batch start failed: {str(e)}")

@router.get("/api/video/batch")
async def batch_status():
    """Returns the current progress of the batch rendering queue."""
    return get_batch_status()

@router.delete("/api/video/batch")
async def batch_cancel():
    """Cancels the currently active batch rendering process."""
    return cancel_batch()

@router.get("/api/video/status/{symbol}")
async def stock_video_status(symbol: str, date: Optional[str] = Query(default=None)):
    """Checks if a rendered MP4 already exists for the given stock and date."""
    target_date = date or datetime.now().strftime("%Y-%m-%d")
    sym = symbol.upper()
    dest_path = get_frontend_public_path("videos", "nifty-shorts", target_date, f"{sym}.mp4")
    
    exists = os.path.exists(dest_path) and os.path.getsize(dest_path) > 1000
    rel_url = f"/videos/nifty-shorts/{target_date}/{sym}.mp4" if exists else None
    
    return {
        "symbol": sym,
        "date": target_date,
        "exists": exists,
        "video_url": rel_url,
    }

@router.get("/api/images/unsplash")
async def get_unsplash_image(query: str, width: int = 400, height: int = 720):
    """
    Returns an Unsplash image URL for background visuals.
    Uses backend UNSPLASH_ACCESS_KEY.
    """
    access_key = os.getenv("UNSPLASH_ACCESS_KEY", "").strip().strip('"').strip("'")
    if not access_key:
        return {"image_url": None, "query_used": query}

    q = (query or "").strip()
    if not q:
        return {"image_url": None}

    safe_w = min(max(width, 240), 1920)
    safe_h = min(max(height, 240), 1920)

    headers = {
        "Authorization": f"Client-ID {access_key}",
        "Accept-Version": "v1",
    }
    params = {
        "query": q,
        "orientation": "portrait" if safe_h >= safe_w else "landscape",
        "content_filter": "high",
    }

    fallback_queries = [q, "indian stock market", "stock market trading", "finance business", "candlestick chart"]

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = None
            used_q = q
            for try_q in fallback_queries:
                used_q = try_q
                params["query"] = try_q
                resp = await client.get(
                    "https://api.unsplash.com/photos/random",
                    headers=headers,
                    params=params,
                )
                if resp.status_code == 200:
                    break
                if resp.status_code in (401, 403):
                    return {"image_url": None, "error": "Unsplash authorization failed"}

        if not resp or resp.status_code != 200:
            return {"image_url": None}

        payload = resp.json()
        urls = payload.get("urls", {})
        raw_url = urls.get("raw") or urls.get("regular") or urls.get("full")
        if not raw_url:
            return {"image_url": None}

        separator = "&" if "?" in raw_url else "?"
        optimized_url = (
            f"{raw_url}{separator}w={safe_w}&h={safe_h}&fit=crop&crop=entropy&auto=format&q=80"
        )
        return {
            "image_url": optimized_url,
            "query_used": used_q,
            "photographer": (payload.get("user") or {}).get("name"),
        }
    except Exception as exc:
        return {"image_url": None, "error": str(exc)}

