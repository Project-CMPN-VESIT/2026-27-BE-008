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
    'kokoro':    'af_heart',    # Expressive, ultra-natural female presenter (Flagship)
    'kokora':    'af_heart',    # Typo tolerance
    'default':   'af_heart',
    'natural':   'af_heart',
    'human':     'af_heart',
    'en-IN-W':   'af_heart',    # Natural female voice
    'en-IN-M':   'am_adam',     # Energetic, punchy male presenter
    'en-IN':     'af_heart',
    'en-US-W':   'af_heart',    # Emotive American female
    'en-US-M':   'am_adam',     # Confident American male
    'en-US':     'af_heart',
    'female':    'af_heart',
    'male':      'am_adam',
    'af_heart':  'af_heart',
    'af_sarah':  'af_sarah',
    'af_bella':  'af_bella',
    'af_nicole': 'af_nicole',
    'am_adam':   'am_adam',
    'am_michael':'am_michael',
    'am_fenrir': 'am_fenrir',
    'bf_emma':   'bf_emma',
    'bm_george': 'bm_george',
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

# Scene-specific conversational pacing tailored for 30-40s dynamic shorts
SCENE_SPEED_MAP = {
    1: 1.08,  # Scene 1 (Hook / Intro): Energetic & captivating
    2: 1.06,  # Scene 2 (Price Action): Dynamic momentum
    3: 1.05,  # Scene 3 (Drivers / Metrics): Crisp & clear
    4: 1.05,  # Scene 4 (Technicals / Gauge): Deliberate yet brisk
    5: 1.06,  # Scene 5 (Outlook & Strategy): Confident forward vision
    6: 1.05,  # Scene 6 (Verdict & Outro): Punchy conclusion
}

def humanize_financial_narration(text: str) -> str:
    """
    Transforms financial shorthand, ticker symbols, percentages, and currencies
    into natural, expressive, human conversational speech for Kokoro TTS.
    """
    if not text:
        return ""

    # Strip SSML / XML tags and markdown formatting
    text = re.sub(r'<[^>]+>', '', text)
    text = re.sub(r'[*_#~`]', '', text)

    # Convert Rupee amounts:
    # ₹4,200.00 -> 4,200 rupees
    text = re.sub(r'[₹]\s*([0-9,]+)\.(?:0|00)\b', r'\1 rupees', text)
    # ₹4,200.50 -> 4,200 rupees and 50 paise
    text = re.sub(r'[₹]\s*([0-9,]+)\.([0-9]{1,2})\b', r'\1 rupees and \2 paise', text)
    # ₹4,200 -> 4,200 rupees
    text = re.sub(r'[₹]\s*([0-9,]+)\b', r'\1 rupees', text)
    # Rs. / INR conversions
    text = re.sub(r'\b(?:Rs\.?|INR)\s*([0-9,]+)\b', r'\1 rupees', text, flags=re.IGNORECASE)

    # Clean zero decimals on technical values: e.g. 62.0 -> 62
    text = re.sub(r'\b([0-9]+)\.0\b', r'\1', text)

    # Convert volume / multiplier multiples: 2.1x or 2.1× -> 2.1 times
    text = re.sub(r'\b([0-9.]+)\s*[x×]\b', r'\1 times', text, flags=re.IGNORECASE)

    # Convert percentages:
    text = re.sub(r'\+0(?:\.00?)?%', 'flat today', text)
    text = re.sub(r'\+([0-9.]+)\s*%', r'up \1 percent', text)
    text = re.sub(r'\-([0-9.]+)\s*%', r'down \1 percent', text)

    # Market acronyms and terminology
    text = re.sub(r'\bLTP\b', 'current price', text)
    text = re.sub(r'\bRSI\(?14\)?\b', 'R S I', text, flags=re.IGNORECASE)
    text = re.sub(r'\bRSI\b', 'R S I', text)
    text = re.sub(r'\bEMA\b', 'E M A', text)
    text = re.sub(r'\bSMA\b', 'S M A', text)
    text = re.sub(r'\bNIFTY 50\b', 'Nifty Fifty', text, flags=re.IGNORECASE)
    text = re.sub(r'\bNIFTY\b', 'Nifty', text, flags=re.IGNORECASE)
    text = re.sub(r'\b52W\b', '52-week', text)
    text = re.sub(r'\bP/E\b', 'P E ratio', text, flags=re.IGNORECASE)
    text = re.sub(r'\bVol Ratio\b', 'volume ratio', text, flags=re.IGNORECASE)

    # Common Indian stock tickers spoken phonetically
    text = re.sub(r'\bTCS\b', 'T-C-S', text)
    text = re.sub(r'\bINFY\b', 'Infosys', text)
    text = re.sub(r'\bHDFCBANK\b', 'H D F C Bank', text)
    text = re.sub(r'\bICICIBANK\b', 'I C I C I Bank', text)
    text = re.sub(r'\bSBIN\b', 'S B I', text)
    text = re.sub(r'\bTATAMOTORS\b', 'Tata Motors', text)
    text = re.sub(r'\bADANIENT\b', 'Adani Enterprises', text)
    text = re.sub(r'\bBHARTIARTL\b', 'Bharti Airtel', text)
    text = re.sub(r'\bRELIANCE\b', 'Reliance', text)

    # Natural conversational punctuation pauses
    text = re.sub(r'[—–]', ', ', text)
    text = re.sub(r'\s+--\s+', ', ', text)
    text = re.sub(r'[()]', '', text)
    text = re.sub(r'\s*,\s*', ', ', text)
    text = re.sub(r'\s*\.\s*', '. ', text)

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
    # British voice handling if bf_/bm_ prefix is used
    lang = "en-gb" if voice.startswith(("bf_", "bm_")) else "en-us"

    def _infer():
        return kokoro.create(clean_text, voice=voice, speed=speed, lang=lang)

    samples, sample_rate = await asyncio.to_thread(_infer)

    def _write_audio():
        os.makedirs(os.path.dirname(out_mp3), exist_ok=True)
        try:
            sf.write(out_mp3, samples, sample_rate, format="MP3")
        except Exception:
            wav_out = out_mp3.replace(".mp3", ".wav")
            sf.write(wav_out, samples, sample_rate)
            if os.path.exists(out_mp3):
                os.remove(out_mp3)
            os.rename(wav_out, out_mp3)

    await asyncio.to_thread(_write_audio)

    try:
        audio_info = MP3(out_mp3)
        return float(audio_info.info.length)
    except Exception:
        return float(len(samples) / sample_rate)

async def _synthesize_edge_tts(clean_text: str, voice_key: str, speed: float, out_mp3: str) -> float:
    """Fallback speech synthesis using Microsoft Edge Neural TTS."""
    import edge_tts
    from mutagen.mp3 import MP3

    voice = EDGE_VOICE_MAP.get(voice_key, EDGE_VOICE_MAP.get('en-IN-W', 'en-IN-NeerjaNeural'))
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
    Prioritizes Kokoro-82M (ultra-natural human voice) with seamless fallback to Edge-TTS.
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
    speed = SCENE_SPEED_MAP.get(scene.id, 1.06)

    logger.info(f"Scene {scene.id}: Synthesizing speech (speed={speed:.2f}) for: '{clean_text[:60]}...'")

    duration = 0.0
    used_engine = "None"
    pref_lower = (voice_pref or "").lower()
    explicit_edge = pref_lower.startswith("edge") or pref_lower.startswith("edge-tts")

    # Priority 1: Kokoro-82M for humanized, natural voice (unless caller explicitly specified Edge)
    if not explicit_edge and get_kokoro_model() is not None:
        try:
            duration = await _synthesize_kokoro(clean_text, voice_pref, speed, filepath)
            used_engine = "Kokoro-82M (Natural Human)"
        except Exception as kokoro_err:
            logger.warning(f"Scene {scene.id}: Kokoro synthesis failed ({kokoro_err}), falling back to Edge-TTS...")
            try:
                duration = await _synthesize_edge_tts(clean_text, voice_pref, speed, filepath)
                used_engine = "Edge-TTS (Fallback)"
            except Exception as edge_err:
                logger.error(f"Scene {scene.id}: Both TTS engines failed: {edge_err}")
                return ("", 0.0)
    else:
        # Edge-TTS explicitly requested or Kokoro model not found
        try:
            duration = await _synthesize_edge_tts(clean_text, voice_pref, speed, filepath)
            used_engine = "Edge-TTS"
        except Exception as edge_err:
            logger.warning(f"Scene {scene.id}: Edge-TTS failed ({edge_err}), trying Kokoro fallback...")
            try:
                duration = await _synthesize_kokoro(clean_text, voice_pref, speed, filepath)
                used_engine = "Kokoro-82M (Fallback)"
            except Exception as kokoro_err:
                logger.error(f"Scene {scene.id}: Both TTS engines failed: {kokoro_err}")
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

    # A "narrated" short with no voice is useless and used to be rendered silently (the TTS failure was only logged).
    wanted = [sc for sc in scenes if (sc.narration or "").strip()]
    if wanted and not any(url for url, _ in relative_results):
        raise RuntimeError(
            "Voice-over generation failed for every scene. Install the TTS packages "
            "(pip install edge-tts mutagen soundfile) and make sure this machine can reach Microsoft's speech service "
            "(speech.platform.bing.com); the engine log has the per-scene reason."
        )

    return relative_results
