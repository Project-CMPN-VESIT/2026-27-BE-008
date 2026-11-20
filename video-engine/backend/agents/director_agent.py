import asyncio
import os
import shutil
import uuid
import logging
import traceback
from datetime import datetime
from typing import Optional, List, Dict, Any
from schemas import (
    NiftyStockItem,
    ShortScript,
    VideoBrief,
    BatchStatusResponse,
    BatchStockStatus,
)
from agents.script_mapper import map_short_to_video_brief
from agents.audio_agent import process_video_audio
from agents.remotion_agent import render_video
from agents.image_agent import process_video_images

logger = logging.getLogger("director_agent")
logger.setLevel(logging.DEBUG)

# Global Batch & Stock Locks
_batch_lock = asyncio.Lock()
_batch_cancel_event = asyncio.Event()
_symbol_locks: Dict[str, asyncio.Lock] = {}

def get_symbol_lock(symbol: str) -> asyncio.Lock:
    if symbol not in _symbol_locks:
        _symbol_locks[symbol] = asyncio.Lock()
    return _symbol_locks[symbol]

_batch_state: Dict[str, Any] = {
    "batch_id": "",
    "date": "",
    "status": "idle",
    "total": 0,
    "completed": 0,
    "failed": 0,
    "current": None,
    "stock_items": {},
}

def get_frontend_public_path(*parts: str) -> str:
    """Helper to locate frontend/public directory."""
    base = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "frontend", "public"))
    return os.path.join(base, *parts)

async def render_single_stock_video(
    stock: NiftyStockItem,
    script: Optional[ShortScript] = None,
    date: Optional[str] = None,
    voice: str = "kokoro",
    force: bool = False,
) -> Dict[str, Any]:
    """
    Renders an animated short-form MP4 video for a single stock.
    1. Check if output already exists (unless force=True)
    2. Maps ShortScript + NiftyStockItem -> VideoBrief (6 scenes)
    3. Generates TTS audio per scene via Kokoro-82M / edge-tts
    4. Renders Remotion composition to MP4
    """
    symbol = stock.symbol.upper()
    effective_date = date or stock.trading_date or datetime.now().strftime("%Y-%m-%d")
    
    rel_path = f"videos/nifty-shorts/{effective_date}/{symbol}.mp4"
    dest_path = get_frontend_public_path("videos", "nifty-shorts", effective_date, f"{symbol}.mp4")
    web_url = f"/{rel_path}"

    logger.info(f"[{symbol}] render_single_stock_video called. date={effective_date}, force={force}")

    # Serialize rendering per stock symbol to prevent duplicate Kokoro/Remotion collisions
    async with get_symbol_lock(symbol):
        logger.info(f"[{symbol}] Acquired stock render lock. Output path: {dest_path}")
        logger.info(f"[{symbol}] Script provided: {script is not None}")

        if os.path.exists(dest_path) and not force and os.path.getsize(dest_path) > 1000:
            logger.info(f"Video for {symbol} ({effective_date}) already exists ({os.path.getsize(dest_path)} bytes). Returning cached URL.")
            try:
                finpilot_public = os.path.abspath(
                    os.path.join(os.path.dirname(__file__), "..", "..", "..", "public", "videos", "nifty-shorts", effective_date, f"{symbol}.mp4")
                )
                if not os.path.exists(finpilot_public) or os.path.getsize(finpilot_public) != os.path.getsize(dest_path):
                    os.makedirs(os.path.dirname(finpilot_public), exist_ok=True)
                    shutil.copy2(dest_path, finpilot_public)
                    logger.info(f"[{symbol}] Synced cached MP4 to FinPilot public: {finpilot_public}")
            except Exception as sync_err:
                logger.warning(f"Could not sync cached video: {sync_err}")

            import json
            brief_json_path = os.path.splitext(dest_path)[0] + "_brief.json"
            if os.path.exists(brief_json_path):
                try:
                    with open(brief_json_path, "r", encoding="utf-8") as bf:
                        saved_brief = json.load(bf)
                        return {
                            "success": True,
                            "cached": True,
                            "video_url": web_url,
                            "video_brief": saved_brief,
                        }
                except Exception as e:
                    logger.warning(f"Could not load saved brief: {e}")

            # Create brief and attach existing audio files if on disk
            brief = map_short_to_video_brief(stock, script)
            audio_parent = get_frontend_public_path("audio")
            if os.path.exists(audio_parent):
                matching_dirs = [d for d in os.listdir(audio_parent) if d.startswith(f"{symbol}_") and os.path.isdir(os.path.join(audio_parent, d))]
                if matching_dirs:
                    matching_dirs.sort(key=lambda d: os.path.getmtime(os.path.join(audio_parent, d)), reverse=True)
                    latest_audio_dir = matching_dirs[0]
                    for idx, sc in enumerate(brief.scenes):
                        mp3_name = f"scene_{idx + 1}.mp3"
                        mp3_full = os.path.join(audio_parent, latest_audio_dir, mp3_name)
                        if os.path.exists(mp3_full):
                            sc.audio_url = f"/audio/{latest_audio_dir}/{mp3_name}"

            # Ensure background images are resolved and cached
            try:
                await process_video_images(brief.scenes, stock, effective_date)
                # Write brief json for future fast hits
                with open(brief_json_path, "w", encoding="utf-8") as bf:
                    import json
                    json.dump(brief.model_dump(), bf, ensure_ascii=False, indent=2)
                finpilot_brief = os.path.splitext(finpilot_public)[0] + "_brief.json"
                os.makedirs(os.path.dirname(finpilot_brief), exist_ok=True)
                shutil.copy2(brief_json_path, finpilot_brief)
            except Exception as e:
                logger.warning(f"Could not persist fallback brief for {symbol}: {e}")

            return {
                "success": True,
                "cached": True,
                "video_url": web_url,
                "video_brief": brief.model_dump(),
            }

        job_id = f"{symbol}_{uuid.uuid4().hex[:8]}"

        # Step 1: Map to VideoBrief
        logger.info(f"[{symbol}] Step 1: Mapping ShortScript to VideoBrief...")
        try:
            brief = map_short_to_video_brief(stock, script)
            logger.info(f"[{symbol}] VideoBrief created: {len(brief.scenes)} scenes, {brief.total_seconds}s total")
        except Exception as e:
            logger.error(f"[{symbol}] Step 1 FAILED: {traceback.format_exc()}")
            raise RuntimeError(f"Script mapping failed for {symbol}: {type(e).__name__}: {e}")

        # Step 2: Generate TTS audio
        logger.info(f"[{symbol}] Step 2: Generating voiceover audio...")
        try:
            audio_results = await process_video_audio(brief.scenes, voice, job_id)

            for i, scene in enumerate(brief.scenes):
                audio_url, duration = audio_results[i]
                scene.audio_url = audio_url
                if duration > 0:
                    # Match scene length with audio duration + 0.3s breath buffer
                    scene.duration_seconds = max(int(round(duration + 0.3)), 3)
                logger.info(f"[{symbol}] Scene {scene.id}: audio_url='{audio_url[:50] if audio_url else 'none'}', duration={duration:.2f}s")

            # Strictly enforce 30-40s short video length constraint
            total_sec = sum(s.duration_seconds for s in brief.scenes)
            if total_sec > 40:
                excess = total_sec - 40
                # Scale down scenes exceeding 5s down to minimum 4s
                for sc in sorted(brief.scenes, key=lambda s: s.duration_seconds, reverse=True):
                    if excess <= 0:
                        break
                    can_reduce = max(sc.duration_seconds - 4, 0)
                    reduction = min(excess, can_reduce)
                    sc.duration_seconds -= reduction
                    excess -= reduction
            elif total_sec < 30:
                deficit = 30 - total_sec
                # Pad slightly across scenes to ensure minimum 30s
                for sc in brief.scenes:
                    if deficit <= 0:
                        break
                    sc.duration_seconds += 1
                    deficit -= 1

            brief.total_seconds = sum(s.duration_seconds for s in brief.scenes)
            logger.info(f"[{symbol}] Audio complete. Total video duration: {brief.total_seconds}s (target 30-40s)")
        except Exception as e:
            logger.error(f"[{symbol}] Step 2 FAILED: {traceback.format_exc()}")
            raise RuntimeError(f"Audio generation failed for {symbol}: {type(e).__name__}: {e}")

        # Step 2.5: Resolve and cache high-relevance scene background images
        logger.info(f"[{symbol}] Step 2.5: Resolving & downloading scene background images...")
        try:
            await process_video_images(brief.scenes, stock, effective_date)
            logger.info(f"[{symbol}] Scene images processed successfully.")
        except Exception as img_err:
            logger.warning(f"[{symbol}] Image processing warning (non-fatal): {img_err}")

        # Step 3: Render via Remotion
        logger.info(f"[{symbol}] Step 3: Rendering Remotion MP4 to {rel_path}...")
        try:
            output_url = await render_video(brief, job_id, custom_rel_path=rel_path)
            logger.info(f"[{symbol}] Render complete: {output_url}")

            # Also sync to FinPilot/public/videos so Next.js serves it natively without proxying
            finpilot_public = os.path.abspath(
                os.path.join(os.path.dirname(__file__), "..", "..", "..", "public", "videos", "nifty-shorts", effective_date, f"{symbol}.mp4")
            )
            try:
                os.makedirs(os.path.dirname(finpilot_public), exist_ok=True)
                shutil.copy2(dest_path, finpilot_public)
                logger.info(f"[{symbol}] Synced to FinPilot public: {finpilot_public}")
            except Exception as copy_err:
                logger.warning(f"[{symbol}] Failed to copy to FinPilot public: {copy_err}")

            # Save brief alongside the rendered MP4 so live engine & cached player load identical state
            try:
                import json
                brief_json_path = os.path.splitext(dest_path)[0] + "_brief.json"
                with open(brief_json_path, "w", encoding="utf-8") as bf:
                    json.dump(brief.model_dump(), bf, ensure_ascii=False, indent=2)
                logger.info(f"[{symbol}] Brief metadata saved to: {brief_json_path}")

                finpilot_brief = os.path.splitext(finpilot_public)[0] + "_brief.json"
                os.makedirs(os.path.dirname(finpilot_brief), exist_ok=True)
                shutil.copy2(brief_json_path, finpilot_brief)
                logger.info(f"[{symbol}] Synced brief to FinPilot public: {finpilot_brief}")
            except Exception as brief_err:
                logger.warning(f"[{symbol}] Failed to save/sync brief json: {brief_err}")

        except Exception as e:
            logger.error(f"[{symbol}] Step 3 FAILED: {traceback.format_exc()}")
            raise RuntimeError(f"Remotion render failed for {symbol}: {type(e).__name__}: {e}")

        return {
            "success": True,
            "cached": False,
            "video_url": output_url,
            "video_brief": brief.model_dump(),
        }

async def _batch_worker(stocks: List[NiftyStockItem], date: str, force: bool, voice: str):
    """Sequential background worker that processes all stocks."""
    global _batch_state
    _batch_cancel_event.clear()

    try:
        for idx, stock in enumerate(stocks):
            if _batch_cancel_event.is_set():
                _batch_state["status"] = "cancelled"
                logger.info("Batch render cancelled by user.")
                break

            symbol = stock.symbol.upper()
            _batch_state["current"] = symbol
            _batch_state["stock_items"][symbol]["status"] = "rendering"

            try:
                result = await render_single_stock_video(
                    stock=stock,
                    script=stock.script,
                    date=date,
                    voice=voice,
                    force=force,
                )
                _batch_state["stock_items"][symbol]["status"] = "done"
                _batch_state["stock_items"][symbol]["progress"] = 100
                _batch_state["stock_items"][symbol]["video_url"] = result.get("video_url")
                _batch_state["completed"] += 1
            except Exception as e:
                logger.error(f"Error rendering {symbol}: {traceback.format_exc()}")
                _batch_state["stock_items"][symbol]["status"] = "failed"
                _batch_state["stock_items"][symbol]["error"] = str(e)
                _batch_state["failed"] += 1

            # Brief cooldown between renders to free memory & CPU
            await asyncio.sleep(1.5)

        if not _batch_cancel_event.is_set():
            _batch_state["status"] = "completed"
            _batch_state["current"] = None

    except Exception as e:
        logger.error(f"Batch worker uncaught exception: {traceback.format_exc()}")
        _batch_state["status"] = "failed"
    finally:
        _batch_state["current"] = None

async def start_batch_render(
    stocks: List[NiftyStockItem],
    date: str,
    force: bool = False,
    voice: str = "kokoro",
) -> Dict[str, Any]:
    """Initiates a batch render for stocks if one is not currently running."""
    global _batch_state

    async with _batch_lock:
        if _batch_state["status"] == "running":
            return {
                "started": False,
                "message": "A batch is already currently running.",
                "batch_state": get_batch_status(),
            }

        batch_id = f"batch_{date}_{uuid.uuid4().hex[:6]}"
        stock_items = {}
        for s in stocks:
            sym = s.symbol.upper()
            stock_items[sym] = {
                "symbol": sym,
                "status": "pending",
                "progress": 0,
                "video_url": None,
                "error": None,
            }

        _batch_state = {
            "batch_id": batch_id,
            "date": date,
            "status": "running",
            "total": len(stocks),
            "completed": 0,
            "failed": 0,
            "current": None,
            "stock_items": stock_items,
        }

        asyncio.create_task(_batch_worker(stocks, date, force, voice))

        return {
            "started": True,
            "batch_id": batch_id,
            "total": len(stocks),
            "date": date,
        }

def get_batch_status() -> Dict[str, Any]:
    """Returns current batch execution progress."""
    return dict(_batch_state)

def cancel_batch() -> Dict[str, Any]:
    """Signals the active batch worker to cancel."""
    if _batch_state["status"] == "running":
        _batch_cancel_event.set()
        return {"cancelled": True, "message": "Batch cancellation requested."}
    return {"cancelled": False, "message": "No batch is currently running."}
