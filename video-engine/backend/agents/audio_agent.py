import asyncio
import os
import uuid
import random
import re
import logging
import subprocess
from typing import List, Tuple, Optional
import shutil
from schemas import Scene

logger = logging.getLogger("audio_agent")

# Optional imports for Kokoro-82M
_kokoro_instance = None
_kokoro_failed = False

def get_kokoro_model():
    """Lazy-load the Kokoro-82M ONNX model once into memory."""
    global _kokoro_instance, _kokoro_failed
    if _kokoro_instance is not None:
        return _kokoro_instance
    if _kokoro_failed:
        return None

    try:
        from kokoro_onnx import Kokoro
        base_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "models", "kokoro"))
        model_path = os.path.join(base_dir, "kokoro-v1.0.onnx")
        voices_path = os.path.join(base_dir, "voices-v1.0.bin")

        if os.path.exists(model_path) and os.path.exists(voices_path):
            logger.info("Initializing Kokoro-82M ONNX TTS engine...")
            _kokoro_instance = Kokoro(model_path, voices_path)
            logger.info("Kokoro-82M ONNX initialized successfully.")
            return _kokoro_instance
        else:
            logger.warning(f"Kokoro model files not found at {base_dir}. Using Edge-TTS fallback.")
            _kokoro_failed = True
            return None
    except Exception as e:
        logger.warning(f"Could not initialize Kokoro-82M ({e}). Using Edge-TTS fallback.")
        _kokoro_failed = True
        return None

# Voice mappings
KOKORO_VOICE_MAP = {
    'en-IN-W': 'af_heart',    # Expressive, ultra-natural female voice
    'en-IN-M': 'am_adam',     # Energetic, punchy male presenter
    'en-US-W': 'af_heart',    # Emotive American female
    'en-US-M': 'am_adam',     # Confident American male
    'female':   'af_heart',
    'male':     'am_adam',
    'af_heart': 'af_heart',
    'af_sarah': 'af_sarah',
    'af_bella': 'af_bella',
    'am_adam':  'am_adam',
    'am_michael':'am_michael',
}

EDGE_VOICE_MAP = {
    'en-IN-W': 'en-IN-NeerjaNeural',
    'en-IN-M': 'en-IN-PrabhatNeural',
    'en-IN':   'en-IN-NeerjaNeural',
    'female':  'en-IN-NeerjaNeural',
    'male':    'en-IN-PrabhatNeural',
    'hi-IN-W': 'hi-IN-SwaraNeural',
    'hi-IN-M': 'hi-IN-MadhurNeural',
    'en-US-W': 'en-US-AvaMultilingualNeural',
    'en-US-M': 'en-US-AndrewMultilingualNeural',
    'en-GB-W': 'en-GB-SoniaNeural',
    'en-GB-M': 'en-GB-RyanNeural',
}

# Scene-specific conversational pacing
SCENE_SPEED_MAP = {
    1: 1.05,  # Scene 1 (Hook / Intro): Energetic & brisk
    2: 1.02,  # Scene 2 (Price Action): Dynamic momentum
    3: 1.00,  # Scene 3 (Drivers / Metrics): Clear explanation
    4: 0.98,  # Scene 4 (Technicals / Gauge): Measured & deliberate
    5: 1.02,  # Scene 5 (Outlook & Strategy): Confident forward vision
    6: 1.00,  # Scene 6 (Verdict & Outro): Authoritative conclusion
}

def humanize_financial_narration(text: str) -> str:
    """
    Transforms financial shorthand, ticker symbols, percentages, and currencies
    into natural, expressive, human conversational speech.
    """
    if not text:
        return ""

    # Strip SSML / XML tags
    text = re.sub(r'<[^>]+>', '', text)

    # Convert Rupee amounts:
    # ₹4,200.00 -> 4,200 rupees
    text = re.sub(r'₹\s*([0-9,]+)\.(?:0|00)\b', r'\1 rupees', text)
    # ₹4,200.50 -> 4,200 rupees and 50 paise
    text = re.sub(r'₹\s*([0-9,]+)\.([0-9]{1,2})\b', r'\1 rupees and \2 paise', text)
    # ₹4,200 -> 4,200 rupees
    text = re.sub(r'₹\s*([0-9,]+)\b', r'\1 rupees', text)

    # Clean zero decimals on technical values: e.g. 62.0 -> 62
    text = re.sub(r'\b([0-9]+)\.0\b', r'\1', text)

    # Convert percentages:
    text = re.sub(r'\+0(?:\.00?)?%', 'flat today', text)
    text = re.sub(r'\+([0-9.]+)\s*%', r'up \1 percent', text)
    text = re.sub(r'\-([0-9.]+)\s*%', r'down \1 percent', text)

    # Market acronyms and terminology
    text = re.sub(r'\bLTP\b', 'current price', text)
    text = re.sub(r'\bRSI\(?14\)?\b', 'R S I momentum', text)
    text = re.sub(r'\bRSI\b', 'R S I', text)
    text = re.sub(r'\bNIFTY 50\b', 'Nifty Fifty', text)
    text = re.sub(r'\bNIFTY\b', 'Nifty', text)
    text = re.sub(r'\b52W\b', '52-week', text)
    text = re.sub(r'\bP/E\b', 'P E ratio', text)
    text = re.sub(r'\bVol Ratio\b', 'Volume Ratio', text)

    # Common Indian stock tickers spoken phonetically
    text = re.sub(r'\bTCS\b', 'T-C-S', text)
    text = re.sub(r'\bINFY\b', 'Infosys', text)
    text = re.sub(r'\bHDFCBANK\b', 'H D F C Bank', text)
    text = re.sub(r'\bICICIBANK\b', 'I C I C I Bank', text)
    text = re.sub(r'\bSBIN\b', 'S B I', text)
    text = re.sub(r'\bTATAMOTORS\b', 'Tata Motors', text)
    text = re.sub(r'\bADANIENT\b', 'Adani Enterprises', text)
    text = re.sub(r'\bBHARTIARTL\b', 'Bharti Airtel', text)

    # Punctuation rhythm: Insert natural breathing pause em-dashes
    text = re.sub(r'\s+today\s+with\s+a\s+', ' today — with a ', text)
    text = re.sub(r'\s+against\s+Nifty', ' — against Nifty', text)

    # Collapse excess spaces
    text = re.sub(r'\s+', ' ', text).strip()
    return text

async def _synthesize_kokoro(clean_text: str, voice_key: str, speed: float, out_mp3: str) -> float:
    """Synthesizes speech using Kokoro-82M ONNX model and converts to MP3."""
    kokoro = get_kokoro_model()
    if not kokoro:
        raise RuntimeError("Kokoro model not available")

    import soundfile as sf
    from mutagen.mp3 import MP3

    voice = KOKORO_VOICE_MAP.get(voice_key, "af_heart")
    wav_temp = out_mp3.replace(".mp3", "_temp.wav")

    def _infer():
        return kokoro.create(clean_text, voice=voice, speed=speed, lang="en-us")

    samples, sample_rate = await asyncio.to_thread(_infer)
    await asyncio.to_thread(sf.write, wav_temp, samples, sample_rate)

    # Convert to MP3 via ffmpeg for lightweight streaming & high compatibility
    cmd = ["ffmpeg", "-y", "-i", wav_temp, "-b:a", "192k", out_mp3]
    proc = await asyncio.to_thread(
        lambda: subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    )

    if os.path.exists(wav_temp):
        try:
            os.remove(wav_temp)
        except Exception:
            pass

    if proc.returncode != 0 or not os.path.exists(out_mp3):
        raise RuntimeError(f"FFmpeg MP3 conversion failed with exit code {proc.returncode}")

    audio_info = MP3(out_mp3)
    return float(audio_info.info.length)

async def _synthesize_edge_tts(clean_text: str, voice_key: str, speed: float, out_mp3: str) -> float:
    """Fallback speech synthesis using Microsoft Edge Neural TTS."""
    import edge_tts
    from mutagen.mp3 import MP3

    voice = EDGE_VOICE_MAP.get(voice_key, EDGE_VOICE_MAP['en-IN-W'])
    rate_pct = int((speed - 1.0) * 100) + random.randint(-1, 2)
    rate_str = f"{rate_pct:+}%"

    communicate = edge_tts.Communicate(clean_text, voice, rate=rate_str)
    await communicate.save(out_mp3)

    if not os.path.exists(out_mp3) or os.path.getsize(out_mp3) < 100:
        raise RuntimeError("Edge-TTS produced empty audio file")

    audio_info = MP3(out_mp3)
    return float(audio_info.info.length)

async def generate_scene_audio(scene: Scene, voice_pref: str, output_dir: str) -> Tuple[str, float]:
    """
    Generate highly expressive, humanized voiceover for a single scene.
    Tries Kokoro-82M first; seamlessly falls back to Edge-TTS.
    Returns (mp3_filepath, duration_seconds).
    """
    raw_narration = scene.narration or ""
    if not raw_narration.strip():
        logger.info(f"Scene {scene.id}: No narration, skipping audio.")
        return ("", 0.0)

    clean_text = humanize_financial_narration(raw_narration)
    if not clean_text:
        return ("", 0.0)

    filename = f"scene_{scene.id}.mp3"
    filepath = os.path.join(output_dir, filename)
    speed = SCENE_SPEED_MAP.get(scene.id, 1.00)

    logger.info(f"Scene {scene.id}: Synthesizing speech (speed={speed:.2f}) for: '{clean_text[:60]}...'")

    duration = 0.0
    is_indian = (
        voice_pref.startswith("en-IN")
        or voice_pref.startswith("hi-IN")
        or voice_pref in ["en-IN", "en-IN-W", "en-IN-M", "hi-IN", "female", "male"]
    )

    if is_indian:
        # Edge-TTS provides authentic Indian English pronunciation (Neerja / Prabhat)
        used_engine = "Edge-TTS (Indian English)"
        try:
            duration = await _synthesize_edge_tts(clean_text, voice_pref, speed, filepath)
        except Exception as edge_err:
            logger.warning(f"Scene {scene.id}: Edge-TTS synthesis failed ({edge_err}), falling back to Kokoro...")
            used_engine = "Kokoro-82M (Fallback)"
            try:
                duration = await _synthesize_kokoro(clean_text, voice_pref, speed, filepath)
            except Exception as kokoro_err:
                logger.error(f"Scene {scene.id}: Both TTS engines failed: {kokoro_err}")
                return ("", 0.0)
    else:
        # Western / General voice preference: Kokoro-82M first, Edge-TTS fallback
        used_engine = "Kokoro-82M"
        try:
            duration = await _synthesize_kokoro(clean_text, voice_pref, speed, filepath)
        except Exception as kokoro_err:
            logger.warning(f"Scene {scene.id}: Kokoro synthesis failed ({kokoro_err}), falling back to Edge-TTS...")
            used_engine = "Edge-TTS"
            try:
                duration = await _synthesize_edge_tts(clean_text, voice_pref, speed, filepath)
            except Exception as edge_err:
                logger.error(f"Scene {scene.id}: Both TTS engines failed: {edge_err}")
                return ("", 0.0)

    logger.info(f"Scene {scene.id}: Generated via {used_engine}, duration={duration:.2f}s ({os.path.getsize(filepath)} bytes)")

    # Sync to FinPilot public directory for native Next.js serving
    try:
        finpilot_audio = os.path.abspath(
            os.path.join(os.path.dirname(__file__), "..", "..", "..", "public", "audio", os.path.basename(output_dir), filename)
        )
        os.makedirs(os.path.dirname(finpilot_audio), exist_ok=True)
        shutil.copy2(filepath, finpilot_audio)
    except Exception as copy_err:
        logger.debug(f"Could not copy audio to FinPilot public: {copy_err}")

    return (filepath, duration)

async def process_video_audio(scenes: List[Scene], voice_pref: str, job_id: str) -> List[Tuple[str, float]]:
    """
    Generates audio sequentially for all scenes in a video.
    Returns a list of tuples: (relative_audio_url, duration_seconds).
    """
    public_dir = os.path.abspath(
        os.path.join(os.path.dirname(__file__), "..", "..", "frontend", "public", "audio", job_id)
    )
    os.makedirs(public_dir, exist_ok=True)
    logger.info(f"Audio output dir: {public_dir}")

    relative_results = []
    for scene in scenes:
        try:
            filepath, duration = await generate_scene_audio(scene, voice_pref, public_dir)
            if filepath:
                rel_path = f"/audio/{job_id}/{os.path.basename(filepath)}"
                relative_results.append((rel_path, duration))
            else:
                relative_results.append(("", 0.0))
        except Exception as e:
            logger.error(f"Scene {scene.id}: Unexpected error in audio processing: {e}")
            relative_results.append(("", 0.0))

    return relative_results
