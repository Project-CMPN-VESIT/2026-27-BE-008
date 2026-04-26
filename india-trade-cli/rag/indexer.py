"""
rag/indexer.py
──────────────
RAG Indexer — downloads documents from S3, chunks them, embeds them with
Mistral, and stores them in ChromaDB for fast semantic retrieval.

Usage (one-time or scheduled):
    from rag.indexer import index_ticker
    index_ticker("INFY")           # index one ticker
    index_ticker("RELIANCE")

Or via the FastAPI endpoint (added in cyro_skill.py):
    POST /skills/cyro/index?ticker=INFY

S3 structure (from doc_Scrapper):
    {bucket}/doc-scrapper/latest/{TICKER}/{TICKER}_complete_data.json
    {bucket}/doc-scrapper/latest/{TICKER}/{TICKER}_financials.csv
    {bucket}/doc-scrapper/latest/{TICKER}/{TICKER}_ratios.csv
    {bucket}/doc-scrapper/latest/{TICKER}/{TICKER}_shareholding.csv
    {bucket}/doc-scrapper/latest/{TICKER}/{TICKER}_announcements.csv

Environment variables:
    AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_DEFAULT_REGION
    S3_BUCKET          — same bucket as FinPilot (e.g. finpilot-docs)
    S3_PREFIX          — default: doc-scrapper
    CHROMA_DB_PATH     — local path for ChromaDB persistence (default: ./chroma_db)
    MISTRAL_API_KEY    — for mistral-embed embeddings
"""

from __future__ import annotations

import json
import os
import re
import time
from typing import Optional

# ── Dependencies (all lazy-imported so the module can be imported without them) ──


def _get_chroma_collection():
    """Lazy-init ChromaDB and return the CYRO collection."""
    try:
        import chromadb  # type: ignore
    except ImportError:
        raise RuntimeError(
            "chromadb not installed. Run: pip install chromadb"
        )

    db_path = os.environ.get("CHROMA_DB_PATH", "./chroma_db")
    client = chromadb.PersistentClient(path=db_path)

    # Use a custom embedding function (Mistral) rather than ChromaDB default
    collection = client.get_or_create_collection(
        name="cyro_financial_docs",
        metadata={"hnsw:space": "cosine"},
    )
    return collection


def _get_mistral_embeddings(texts: list[str]) -> list[list[float]]:
    """
    Embed a batch of texts using Mistral's mistral-embed model.
    Falls back to a local sentence-transformer if no API key is set.
    Rate-limited: 2 req/s max for free tier.
    """
    api_key = os.environ.get("MISTRAL_API_KEY") or os.environ.get("OPENAI_API_KEY")

    if api_key and os.environ.get("OPENAI_BASE_URL", "").startswith("https://api.mistral.ai"):
        # Use Mistral embeddings via OpenAI-compatible SDK
        try:
            from openai import OpenAI  # type: ignore
            client = OpenAI(
                api_key=api_key,
                base_url="https://api.mistral.ai/v1",
            )
            # Mistral embed accepts up to 16384 tokens per string
            # Process in batches of 32 to stay within rate limits
            all_embeddings = []
            for i in range(0, len(texts), 32):
                batch = texts[i : i + 32]
                resp = client.embeddings.create(
                    model="mistral-embed",
                    input=batch,
                )
                all_embeddings.extend([e.embedding for e in resp.data])
                if i + 32 < len(texts):
                    time.sleep(0.5)  # gentle rate limit
            return all_embeddings
        except Exception as e:
            print(f"  [rag] Mistral embed failed: {e}, falling back to local model")

    # Fallback: sentence-transformers (free, local)
    try:
        from sentence_transformers import SentenceTransformer  # type: ignore
        _model_name = os.environ.get("LOCAL_EMBED_MODEL", "all-MiniLM-L6-v2")
        model = SentenceTransformer(_model_name)
        return model.encode(texts, show_progress_bar=False).tolist()
    except ImportError:
        raise RuntimeError(
            "No embedding backend available.\n"
            "Option A: Set MISTRAL_API_KEY + OPENAI_BASE_URL=https://api.mistral.ai/v1\n"
            "Option B: pip install sentence-transformers"
        )


def _get_s3_client():
    """Return boto3 S3 client using environment credentials."""
    try:
        import boto3  # type: ignore
    except ImportError:
        raise RuntimeError("boto3 not installed. Run: pip install boto3")

    region = os.environ.get("AWS_DEFAULT_REGION", "ap-southeast-2")
    return boto3.client(
        "s3",
        region_name=region,
        aws_access_key_id=os.environ.get("AWS_ACCESS_KEY_ID"),
        aws_secret_access_key=os.environ.get("AWS_SECRET_ACCESS_KEY"),
    )


def _s3_get_text(bucket: str, key: str) -> Optional[str]:
    """Download an S3 object and return as UTF-8 string. Returns None on error."""
    try:
        client = _get_s3_client()
        obj = client.get_object(Bucket=bucket, Key=key)
        return obj["Body"].read().decode("utf-8", errors="replace")
    except Exception as e:
        if "NoSuchKey" in str(e) or "404" in str(e):
            return None
        raise


def _s3_get_bytes(bucket: str, key: str) -> Optional[bytes]:
    """Download an S3 object as bytes. Returns None on error."""
    try:
        client = _get_s3_client()
        obj = client.get_object(Bucket=bucket, Key=key)
        return obj["Body"].read()
    except Exception as e:
        if "NoSuchKey" in str(e) or "404" in str(e):
            return None
        raise


def _s3_list_keys(bucket: str, prefix: str) -> list[str]:
    """List all object keys under a prefix."""
    try:
        client = _get_s3_client()
        paginator = client.get_paginator("list_objects_v2")
        keys = []
        for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
            for obj in page.get("Contents", []):
                keys.append(obj["Key"])
        return keys
    except Exception:
        return []


def _upsert_chunks(collection, chunks, symbol: str) -> int:
    """
    Embed and upsert chunks into ChromaDB.
    Uses deterministic IDs (symbol + section + batch) so re-indexing is idempotent.
    """
    from rag.chunkers import Chunk

    if not chunks:
        return 0

    texts = [c.text for c in chunks]
    metadatas = [c.metadata for c in chunks]

    # Build stable IDs
    ids = [
        _make_chunk_id(symbol, m.get("section", "unknown"), m.get("batch_start", i))
        for i, m in enumerate(metadatas)
    ]

    # Embed in batches of 64
    all_embeds: list[list[float]] = []
    for i in range(0, len(texts), 64):
        batch_texts = texts[i : i + 64]
        batch_embeds = _get_mistral_embeddings(batch_texts)
        all_embeds.extend(batch_embeds)
        if i + 64 < len(texts):
            time.sleep(0.3)

    # Ensure all metadata values are primitive (ChromaDB requirement)
    clean_metas = [
        {k: (str(v) if not isinstance(v, (str, int, float, bool)) else v)
         for k, v in m.items()}
        for m in metadatas
    ]

    collection.upsert(
        ids=ids,
        documents=texts,
        embeddings=all_embeds,
        metadatas=clean_metas,
    )
    return len(chunks)


def _make_chunk_id(symbol: str, section: str, idx: int | str) -> str:
    """Create a deterministic, URL-safe chunk ID."""
    raw = f"{symbol}_{section}_{idx}"
    return re.sub(r"[^a-zA-Z0-9_-]", "_", raw)[:128]


# ── Public API ──────────────────────────────────────────────────


def index_ticker(symbol: str, *, verbose: bool = True) -> dict:
    """
    Download all doc_Scrapper data for a ticker from S3 and index it
    into ChromaDB with Mistral embeddings.

    Returns a summary dict with counts.
    """
    from rag.chunkers import chunk_json, chunk_csv, chunk_pdf

    bucket = os.environ.get("S3_BUCKET", "")
    if not bucket:
        raise RuntimeError("S3_BUCKET environment variable not set")

    prefix = os.environ.get("S3_PREFIX", "doc-scrapper")
    base = f"{prefix}/latest/{symbol}"

    if verbose:
        print(f"[rag] indexing {symbol} from s3://{bucket}/{base}/")

    collection = _get_chroma_collection()
    total = 0

    # ── 1. Main JSON ─────────────────────────────────────────
    json_key = f"{base}/{symbol}_complete_data.json"
    json_text = _s3_get_text(bucket, json_key)

    if json_text:
        # Sanitise NaN (Python json.loads rejects it)
        json_text = json_text.replace(": NaN", ": null").replace(":NaN", ":null")
        try:
            data = json.loads(json_text)
            chunks = chunk_json(data, symbol)
            n = _upsert_chunks(collection, chunks, symbol)
            total += n
            if verbose:
                print(f"  [rag] JSON → {n} chunks indexed")
        except json.JSONDecodeError as e:
            print(f"  [rag] JSON parse error for {symbol}: {e}")
    else:
        if verbose:
            print(f"  [rag] JSON not found in S3: {json_key}")

    # ── 2. CSVs ──────────────────────────────────────────────
    csv_files = [
        (f"{base}/{symbol}_financials.csv", "financials"),
        (f"{base}/{symbol}_ratios.csv", "ratios"),
        (f"{base}/{symbol}_shareholding.csv", "shareholding"),
        (f"{base}/{symbol}_announcements.csv", "announcements"),
    ]
    for csv_key, csv_type in csv_files:
        csv_text = _s3_get_text(bucket, csv_key)
        if csv_text:
            chunks = chunk_csv(csv_text, symbol, csv_type)
            n = _upsert_chunks(collection, chunks, symbol)
            total += n
            if verbose:
                print(f"  [rag] {csv_type}.csv → {n} chunks indexed")

    # ── 3. Annual Report PDFs ────────────────────────────────
    pdf_prefix = f"{base}/annual_reports/"
    pdf_keys = [k for k in _s3_list_keys(bucket, pdf_prefix) if k.endswith(".pdf")]

    for pdf_key in pdf_keys[:5]:  # cap at 5 PDFs per ticker to avoid cost
        filename = pdf_key.split("/")[-1]
        pdf_bytes = _s3_get_bytes(bucket, pdf_key)
        if pdf_bytes:
            chunks = chunk_pdf(pdf_bytes, symbol, filename)
            n = _upsert_chunks(collection, chunks, symbol)
            total += n
            if verbose:
                print(f"  [rag] {filename} → {n} PDF chunks indexed")

    if verbose:
        print(f"[rag] {symbol}: total {total} chunks indexed ✓")

    return {
        "symbol": symbol,
        "total_chunks": total,
        "collection": "cyro_financial_docs",
        "db_path": os.environ.get("CHROMA_DB_PATH", "./chroma_db"),
    }


def get_index_stats(symbol: Optional[str] = None) -> dict:
    """Return ChromaDB collection stats, optionally filtered by symbol."""
    collection = _get_chroma_collection()
    total = collection.count()

    if symbol:
        results = collection.get(where={"symbol": symbol})
        return {
            "collection": "cyro_financial_docs",
            "total_chunks": total,
            "symbol_chunks": len(results.get("ids", [])),
            "symbol": symbol,
        }

    return {"collection": "cyro_financial_docs", "total_chunks": total}
