from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from database import get_announcements, get_stats

app = FastAPI(title="FinPilot News Feed API")

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
    limit: int | None = Query(default=None, ge=1),
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
async def list_news_for_symbol(symbol: str):
    results = get_announcements(symbol=symbol.strip().upper())
    return {
        "count": len(results),
        "results": results,
    }


@app.get("/v1/stats")
async def stats():
    return get_stats()
