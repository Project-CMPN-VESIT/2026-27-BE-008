from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware

from database import get_announcements, get_stats

app = FastAPI(title="FinPilot News Feed API")

# the announcement list is several MB of repetitive JSON; compressing it cuts the transfer ~10x
app.add_middleware(GZipMiddleware, minimum_size=1024)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    return {"status": "ok", "service": "news-feed"}


@app.get("/v1/news")
async def list_news(
    symbol: str | None = None,
    source: str | None = None,
    nse_index: str | None = None,
    limit: int = Query(default=5000, ge=1, le=20000),
):
    normalized_symbol = symbol.strip().upper() if symbol else None
    normalized_source = source.strip().upper() if source else None
    normalized_nse_index = nse_index.strip().upper() if nse_index else None

    if normalized_source and normalized_source not in {"BSE", "NSE"}:
        raise HTTPException(status_code=400, detail="source must be BSE or NSE")

    if normalized_nse_index and normalized_nse_index not in {"EQUITIES", "SME", "DEBT", "MF"}:
        raise HTTPException(status_code=400, detail="nse_index must be EQUITIES, SME, DEBT, or MF")

    if normalized_source == "BSE" and normalized_nse_index:
        raise HTTPException(status_code=400, detail="nse_index can only be used with NSE source")

    results = get_announcements(
        symbol=normalized_symbol,
        source=normalized_source,
        nse_index=normalized_nse_index,
        limit=limit,
    )
    return {
        "count": len(results),
        "results": results,
    }


@app.get("/v1/news/{symbol}")
async def list_news_for_symbol(symbol: str, limit: int = Query(default=500, ge=1, le=5000)):
    normalized = symbol.strip().upper()
    if not normalized or len(normalized) > 40:
        raise HTTPException(status_code=400, detail="symbol must be 1-40 characters")
    results = get_announcements(symbol=normalized, limit=limit)
    return {
        "count": len(results),
        "results": results,
    }


@app.get("/v1/stats")
async def stats():
    return get_stats()
