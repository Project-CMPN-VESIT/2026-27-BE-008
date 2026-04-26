"""
scripts/index_s3_docs.py
────────────────────────
One-shot CLI to index S3 doc_Scrapper data into ChromaDB.

Usage:
    # Index specific tickers
    python scripts/index_s3_docs.py INFY TCS RELIANCE

    # Index all Nifty 50
    python scripts/index_s3_docs.py --nifty50

    # Check collection stats
    python scripts/index_s3_docs.py --stats

    # Check stats for a specific ticker
    python scripts/index_s3_docs.py --stats INFY

Environment (set in .env or shell before running):
    AWS_ACCESS_KEY_ID=...
    AWS_SECRET_ACCESS_KEY=...
    AWS_DEFAULT_REGION=ap-southeast-2
    S3_BUCKET=your-finpilot-bucket
    S3_PREFIX=doc-scrapper          # default

    # Mistral embeddings (recommended):
    MISTRAL_API_KEY=...
    OPENAI_BASE_URL=https://api.mistral.ai/v1

    # OR local fallback:
    # pip install sentence-transformers
    # LOCAL_EMBED_MODEL=all-MiniLM-L6-v2

    CHROMA_DB_PATH=./chroma_db      # default
"""

import sys
import os
from pathlib import Path

# ── Load .env ──────────────────────────────────────────────────
_env = Path(__file__).parent.parent / ".env"
if _env.exists():
    for line in _env.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        k, v = k.strip(), v.strip().strip('"').strip("'")
        if k and k not in os.environ:
            os.environ[k] = v

# ── Add project root to path ───────────────────────────────────
sys.path.insert(0, str(Path(__file__).parent.parent))

from rag.indexer import index_ticker, get_index_stats

NIFTY50 = [
    "RELIANCE", "TCS", "HDFCBANK", "INFY", "ICICIBANK", "HINDUNILVR", "ITC", "SBIN",
    "BHARTIARTL", "KOTAKBANK", "LT", "AXISBANK", "MARUTI", "ASIANPAINT", "BAJFINANCE",
    "HCLTECH", "TITAN", "WIPRO", "NTPC", "POWERGRID", "SUNPHARMA", "ULTRACEMCO",
    "BAJAJFINSV", "NESTLEIND", "TECHM", "M&M", "ADANIENT", "ONGC", "COALINDIA", "JSWSTEEL",
    "GRASIM", "TATASTEEL", "DRREDDY", "DIVISLAB", "CIPLA", "TATAMOTORS", "HINDALCO",
    "APOLLOHOSP", "LTIM", "BPCL", "HEROMOTOCO", "INDUSINDBK", "EICHERMOT", "TATACONSUM",
    "BRITANNIA", "HDFCLIFE", "SBILIFE", "BAJAJ-AUTO", "UPL", "ADANIPORTS",
]


def main():
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        sys.exit(0)

    # Stats mode
    if args[0] == "--stats":
        ticker = args[1].upper() if len(args) > 1 else None
        stats = get_index_stats(symbol=ticker)
        print("\n📊 ChromaDB Collection Stats")
        print("─" * 40)
        for k, v in stats.items():
            print(f"  {k}: {v}")
        return

    # Nifty 50 bulk mode
    if args[0] == "--nifty50":
        tickers = NIFTY50
        print(f"📦 Indexing all {len(tickers)} Nifty 50 tickers...")
    else:
        tickers = [t.upper() for t in args]

    # Validate required env
    bucket = os.environ.get("S3_BUCKET", "")
    if not bucket:
        print("❌ S3_BUCKET environment variable not set.")
        print("   Set it in .env or: $env:S3_BUCKET = 'your-bucket-name'")
        sys.exit(1)

    print(f"\n🔍 Source:  s3://{bucket}/{os.environ.get('S3_PREFIX','doc-scrapper')}/latest/")
    print(f"🗄️  Target:  {os.environ.get('CHROMA_DB_PATH', './chroma_db')}")
    embed_backend = (
        "mistral-embed (Mistral API)"
        if os.environ.get("MISTRAL_API_KEY") or (
            os.environ.get("OPENAI_API_KEY") and
            "mistral" in os.environ.get("OPENAI_BASE_URL", "")
        )
        else "sentence-transformers (local)"
    )
    print(f"🧠 Embeddings: {embed_backend}\n")

    total_chunks = 0
    failed = []

    for i, ticker in enumerate(tickers, 1):
        print(f"[{i}/{len(tickers)}] Indexing {ticker}...")
        try:
            result = index_ticker(ticker)
            total_chunks += result.get("total_chunks", 0)
            print(f"  ✓ {ticker}: {result.get('total_chunks', 0)} chunks")
        except Exception as e:
            print(f"  ✗ {ticker}: {e}")
            failed.append(ticker)

    print(f"\n{'='*40}")
    print(f"✅ Done. {total_chunks:,} total chunks indexed.")
    if failed:
        print(f"⚠️  Failed tickers: {', '.join(failed)}")

    stats = get_index_stats()
    print(f"📊 Collection now has: {stats.get('total_chunks', '?')} total chunks")


if __name__ == "__main__":
    main()
