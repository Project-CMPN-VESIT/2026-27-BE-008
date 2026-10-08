import os
import shutil
import logging
import asyncio
from typing import Optional, List, Dict
import httpx
from schemas import Scene, NiftyStockItem

logger = logging.getLogger("image_agent")

# Sector and theme keywords for Unsplash high-relevance searches
SECTOR_KEYWORDS = {
    "it": {
        "intro": "modern technology software enterprise office architecture",
        "stock": "stock market trading terminal screens data",
        "chart": "cloud data analytics server technology financial graph",
        "technicals": "candlestick chart technical analysis finance",
        "outlook": "artificial intelligence technology enterprise innovation",
        "outro": "wall street bull statue financial investment success",
    },
    "tech": {
        "intro": "modern technology software enterprise office architecture",
        "stock": "stock market trading terminal screens data",
        "chart": "cloud data analytics server technology financial graph",
        "technicals": "candlestick chart technical analysis finance",
        "outlook": "artificial intelligence technology enterprise innovation",
        "outro": "wall street bull statue financial investment success",
    },
    "auto": {
        "intro": "modern electric automobile car manufacturing vehicle",
        "stock": "stock exchange trading floor market ticker",
        "chart": "automotive assembly line factory manufacturing technology",
        "technicals": "candlestick chart stock trading technical graph",
        "outlook": "modern electric vehicle mobility highway transport",
        "outro": "corporate business headquarters skyline investment",
    },
    "bank": {
        "intro": "banking financial district skyscrapers modern architecture",
        "stock": "financial trading terminal stock market screens",
        "chart": "wealth management investment banking corporate finance",
        "technicals": "candlestick chart technical analysis trading screen",
        "outlook": "banking financial towers corporate skyline sunrise",
        "outro": "wall street charging bull statue financial district victory",
    },
    "finance": {
        "intro": "banking financial district skyscrapers modern architecture",
        "stock": "financial trading terminal stock market screens",
        "chart": "wealth management investment banking corporate finance",
        "technicals": "candlestick chart technical analysis trading screen",
        "outlook": "banking financial towers corporate skyline sunrise",
        "outro": "wall street charging bull statue financial district victory",
    },
    "energy": {
        "intro": "energy petroleum industrial refinery clean power solar",
        "stock": "energy commodity stock exchange trading screen",
        "chart": "industrial energy infrastructure power generation refinery",
        "technicals": "candlestick chart technical analysis finance",
        "outlook": "renewable energy wind turbines solar power horizon",
        "outro": "corporate skyscraper financial district business growth",
    },
    "oil": {
        "intro": "petroleum energy refinery oil gas renewable power",
        "stock": "energy commodity stock exchange trading screen",
        "chart": "industrial energy infrastructure power generation refinery",
        "technicals": "candlestick chart technical analysis finance",
        "outlook": "clean energy solar power wind turbines industrial",
        "outro": "corporate skyscraper financial district business growth",
    },
    "power": {
        "intro": "clean energy power grid solar panels wind turbines",
        "stock": "stock exchange trading terminal financial screens",
        "chart": "industrial power station energy generation electricity grid",
        "technicals": "candlestick chart technical analysis trading screen",
        "outlook": "green renewable energy power infrastructure future",
        "outro": "modern corporate skyline financial success",
    },
    "pharma": {
        "intro": "pharmaceutical healthcare research modern laboratory biotechnology",
        "stock": "stock trading terminal market financial screens",
        "chart": "medical science laboratory research healthcare clinical",
        "technicals": "candlestick chart technical analysis stock trading",
        "outlook": "advanced medical biotechnology healthcare innovation future",
        "outro": "corporate healthcare biotechnology growth financial",
    },
    "health": {
        "intro": "pharmaceutical healthcare research modern laboratory biotechnology",
        "stock": "stock trading terminal market financial screens",
        "chart": "medical science laboratory research healthcare clinical",
        "technicals": "candlestick chart technical analysis stock trading",
        "outlook": "advanced medical biotechnology healthcare innovation future",
        "outro": "corporate healthcare biotechnology growth financial",
    },
    "steel": {
        "intro": "steel manufacturing factory industrial metallurgy metal",
        "stock": "stock exchange trading market terminal",
        "chart": "industrial manufacturing heavy steel production machinery",
        "technicals": "candlestick chart technical analysis trading screen",
        "outlook": "infrastructure construction industrial development skyline",
        "outro": "heavy industry corporate business growth success",
    },
    "metal": {
        "intro": "steel manufacturing factory industrial metallurgy metal",
        "stock": "stock exchange trading market terminal",
        "chart": "industrial manufacturing heavy steel production machinery",
        "technicals": "candlestick chart technical analysis trading screen",
        "outlook": "infrastructure construction industrial development skyline",
        "outro": "heavy industry corporate business growth success",
    },
    "fmcg": {
        "intro": "consumer goods retail shopping supermarket modern products",
        "stock": "stock market trading terminal screens",
        "chart": "retail consumer logistics supply chain business growth",
        "technicals": "candlestick chart technical analysis finance",
        "outlook": "global consumer market retail expansion business",
        "outro": "corporate enterprise business success financial",
    },
    "consumer": {
        "intro": "consumer goods retail shopping supermarket modern products",
        "stock": "stock market trading terminal screens",
        "chart": "retail consumer logistics supply chain business growth",
        "technicals": "candlestick chart technical analysis finance",
        "outlook": "global consumer market retail expansion business",
        "outro": "corporate enterprise business success financial",
    },
    "telecom": {
        "intro": "telecommunications 5g mobile network data communication tower",
        "stock": "stock exchange trading terminal financial screens",
        "chart": "digital communications fiber optics data network technology",
        "technicals": "candlestick chart stock market technical analysis",
        "outlook": "satellite communications global digital network skyline",
        "outro": "telecom technology business growth financial",
    },
    "infra": {
        "intro": "civil engineering mega infrastructure construction bridge skyscraper",
        "stock": "stock market trading terminal monitors",
        "chart": "shipping container port logistics industrial cranes infrastructure",
        "technicals": "candlestick chart technical analysis finance",
        "outlook": "modern architectural city skyline construction development",
        "outro": "infrastructure growth investment business success",
    },
    "port": {
        "intro": "shipping container port cargo logistics infrastructure terminal",
        "stock": "stock market trading terminal monitors",
        "chart": "shipping container port logistics industrial cranes infrastructure",
        "technicals": "candlestick chart technical analysis finance",
        "outlook": "global shipping trade logistics harbor sunrise",
        "outro": "international trade business enterprise investment",
    },
}

DEFAULT_KEYWORDS = {
    "intro": "modern financial district corporate skyscraper business",
    "stock": "stock market trading terminal financial screens",
    "chart": "business analytics corporate finance data charts",
    "technicals": "candlestick chart technical analysis trading",
    "outlook": "modern city skyline business towers sunrise",
    "outro": "wall street charging bull statue financial victory",
}

def detect_sector_key(sector: str, industry: str = "", company_name: str = "", symbol: str = "") -> str:
    combined = f"{sector} {industry} {company_name} {symbol}".lower()
    if any(k in combined for k in ["tech", "software", "information technology", "it services", "tcs", "infy", "wipro", "hcl"]):
        return "it"
    if any(k in combined for k in ["auto", "motor", "vehicle", "car", "bajaj", "maruti", "eicher", "mahindra"]):
        return "auto"
    if any(k in combined for k in ["bank", "financial", "finance", "hdfc", "icici", "sbi", "kotak", "axis", "bajaj finance"]):
        return "bank"
    if any(k in combined for k in ["oil", "petroleum", "gas", "refinery", "reliance", "ongc", "bpcl"]):
        return "oil"
    if any(k in combined for k in ["power", "energy", "solar", "wind", "ntpc", "power grid", "coal"]):
        return "power"
    if any(k in combined for k in ["pharma", "health", "hospital", "medicine", "drug", "cipla", "sun pharma", "apollo"]):
        return "pharma"
    if any(k in combined for k in ["steel", "metal", "mining", "aluminum", "copper", "jsw", "tata steel", "hindalco"]):
        return "steel"
    if any(k in combined for k in ["fmcg", "consumer", "food", "beverage", "itc", "hindustan unilever", "nestle", "britannia"]):
        return "fmcg"
    if any(k in combined for k in ["telecom", "communication", "airtel", "bharti"]):
        return "telecom"
    if any(k in combined for k in ["port", "shipping", "harbor", "adani ports"]):
        return "port"
    if any(k in combined for k in ["infra", "construction", "cement", "larsen", "ultratech", "grasim"]):
        return "infra"
    return "default"

def get_scene_curated_query(scene_id: int, sector_key: str) -> str:
    scenes_map = {
        1: "intro",
        2: "stock",
        3: "chart",
        4: "technicals",
        5: "outlook",
        6: "outro",
    }
    key_type = scenes_map.get(scene_id, "intro")
    kw_dict = SECTOR_KEYWORDS.get(sector_key, DEFAULT_KEYWORDS)
    return kw_dict.get(key_type, DEFAULT_KEYWORDS.get(key_type, "stock market trading"))

async def fetch_unsplash_url(query: str, access_key: str, width: int = 1080, height: int = 1920) -> Optional[str]:
    """Queries Unsplash API with fallback candidates and returns an optimized portrait image URL."""
    if not access_key:
        return None

    clean_q = query.strip()
    if not clean_q:
        return None

    headers = {
        "Authorization": f"Client-ID {access_key}",
        "Accept-Version": "v1",
    }
    params = {
        "query": clean_q,
        "orientation": "portrait",
        "content_filter": "high",
    }

    # Fallback cascade in case specific query has no photos
    candidates = [
        clean_q,
        "stock market trading terminal screens",
        "financial skyscraper corporate architecture",
        "candlestick chart financial technical analysis",
        "wall street charging bull statue financial district",
    ]

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = None
            for try_q in candidates:
                params["query"] = try_q
                resp = await client.get(
                    "https://api.unsplash.com/photos/random",
                    headers=headers,
                    params=params,
                )
                if resp.status_code == 200:
                    break
                if resp.status_code in (401, 403):
                    logger.warning("Unsplash authorization failed or rate limit hit")
                    return None

        if not resp or resp.status_code != 200:
            return None

        payload = resp.json()
        urls = payload.get("urls", {})
        raw_url = urls.get("raw") or urls.get("regular") or urls.get("full")
        if not raw_url:
            return None

        sep = "&" if "?" in raw_url else "?"
        return f"{raw_url}{sep}w={width}&h={height}&fit=crop&crop=entropy&auto=format&q=85"
    except Exception as e:
        logger.warning(f"Error fetching Unsplash image for '{query}': {e}")
        return None

async def download_image(url: str, dest_path: str) -> bool:
    """Downloads an image from URL and writes to disk, ensuring directory existence."""
    try:
        if os.path.exists(dest_path) and os.path.getsize(dest_path) > 3000:
            return True

        os.makedirs(os.path.dirname(dest_path), exist_ok=True)
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(url, follow_redirects=True)
            if resp.status_code == 200 and len(resp.content) > 1000:
                with open(dest_path, "wb") as f:
                    f.write(resp.content)
                logger.info(f"Downloaded scene image: {dest_path} ({len(resp.content)} bytes)")
                return True
    except Exception as e:
        logger.warning(f"Failed to download image to {dest_path}: {e}")
    return False

async def process_video_images(scenes: List[Scene], stock: NiftyStockItem, effective_date: str) -> None:
    """
    Resolves highly relevant Unsplash background images for every scene,
    downloads them locally to frontend/public/images/nifty-shorts/{date}/{symbol}/scene_{id}.jpg,
    and sets scene.image_url. Also syncs to FinPilot public directory.
    """
    access_key = os.getenv("UNSPLASH_ACCESS_KEY", "").strip().strip('"').strip("'")
    sector_key = detect_sector_key(
        stock.sector or "",
        stock.industry or "",
        stock.company_name or "",
        stock.symbol or "",
    )
    symbol = stock.symbol.upper()

    base_frontend_public = os.path.abspath(
        os.path.join(os.path.dirname(__file__), "..", "..", "frontend", "public")
    )
    finpilot_public = os.path.abspath(
        os.path.join(os.path.dirname(__file__), "..", "..", "..", "public")
    )

    for scene in scenes:
        curated_query = get_scene_curated_query(scene.id, sector_key)
        scene.image_query = curated_query

        rel_img_path = f"images/nifty-shorts/{effective_date}/{symbol}/scene_{scene.id}.jpg"
        local_dest = os.path.join(base_frontend_public, rel_img_path.replace("/", os.sep))
        web_url = f"/{rel_img_path}"

        # If image already downloaded and valid, reuse
        if os.path.exists(local_dest) and os.path.getsize(local_dest) > 3000:
            scene.image_url = web_url
            logger.info(f"[{symbol}] Scene {scene.id} using cached image: {web_url}")
            # Ensure synced to FinPilot public as well
            finpilot_dest = os.path.join(finpilot_public, rel_img_path.replace("/", os.sep))
            try:
                if not os.path.exists(finpilot_dest) or os.path.getsize(finpilot_dest) != os.path.getsize(local_dest):
                    os.makedirs(os.path.dirname(finpilot_dest), exist_ok=True)
                    shutil.copy2(local_dest, finpilot_dest)
            except Exception:
                pass
            continue

        # Fetch from Unsplash
        photo_url = await fetch_unsplash_url(curated_query, access_key)
        if photo_url:
            downloaded = await download_image(photo_url, local_dest)
            if downloaded:
                scene.image_url = web_url
                # Sync to FinPilot public
                finpilot_dest = os.path.join(finpilot_public, rel_img_path.replace("/", os.sep))
                try:
                    os.makedirs(os.path.dirname(finpilot_dest), exist_ok=True)
                    shutil.copy2(local_dest, finpilot_dest)
                except Exception:
                    pass
            else:
                # Fallback to direct external URL
                scene.image_url = photo_url
        else:
            # Leave image_url as is or fallback
            scene.image_url = None

        logger.info(f"[{symbol}] Scene {scene.id} ({curated_query[:30]}...) -> image_url={scene.image_url}")
