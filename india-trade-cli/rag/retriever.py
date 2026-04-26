"""
rag/retriever.py
────────────────
Semantic retriever — query ChromaDB for documents relevant to a question
about a specific ticker.

Returns a list of RetrievedDoc objects, each containing:
  - text     : the chunk text
  - score    : cosine similarity (0–1, higher = more relevant)
  - metadata : source_type, section, page, symbol, etc.
  - citation : a pre-formatted SourceCitation-compatible dict

Used by the search_financial_docs tool registered in agent/tools.py.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field


@dataclass
class RetrievedDoc:
    text: str
    score: float
    metadata: dict = field(default_factory=dict)

    def to_citation_dict(self) -> dict:
        """Return a SourceCitation-compatible dict for XAI rendering."""
        symbol = self.metadata.get("symbol", "?")
        section = self.metadata.get("section") or self.metadata.get("source_type", "s3")
        return {
            "agent": "RAGRetriever",
            "tool_name": "search_financial_docs",
            "source_type": self.metadata.get("source_type", "rag_s3"),
            "label": f"S3 Financial Docs — {symbol} ({section})",
            "input_args": {"symbol": symbol, "section": section},
            "excerpt": self.text[:400],
            "timestamp": "",
        }


def search_financial_docs(
    query: str,
    symbol: str | None = None,
    top_k: int = 5,
    score_threshold: float = 0.30,
) -> list[RetrievedDoc]:
    """
    Semantic search over indexed financial documents.

    Args:
        query:           Natural language question, e.g. "INFY revenue growth trend"
        symbol:          Optional NSE ticker filter (e.g. "INFY"). If None, searches all.
        top_k:           Maximum number of results to return.
        score_threshold: Minimum cosine similarity (0–1). Lower = more results.

    Returns:
        List of RetrievedDoc objects, sorted by relevance.
    """
    try:
        import chromadb  # type: ignore
    except ImportError:
        raise RuntimeError("chromadb not installed. Run: pip install chromadb")

    db_path = os.environ.get("CHROMA_DB_PATH", "./chroma_db")

    try:
        client = chromadb.PersistentClient(path=db_path)
        collection = client.get_collection("cyro_financial_docs")
    except Exception as e:
        # Collection doesn't exist yet — return helpful message
        return [RetrievedDoc(
            text=(
                f"No financial documents indexed yet for {'symbol ' + symbol if symbol else 'any ticker'}. "
                f"Run: from rag.indexer import index_ticker; index_ticker('{symbol or 'RELIANCE'}') "
                f"to index S3 documents. Error: {e}"
            ),
            score=0.0,
            metadata={"symbol": symbol or "", "source_type": "rag_error"},
        )]

    # Build query embedding using the same backend as the indexer
    from rag.indexer import _get_mistral_embeddings
    try:
        query_embed = _get_mistral_embeddings([query])[0]
    except Exception as e:
        return [RetrievedDoc(
            text=f"Embedding error during search: {e}",
            score=0.0,
            metadata={"symbol": symbol or "", "source_type": "rag_error"},
        )]

    # Build where filter
    where_clause: dict | None = None
    if symbol:
        where_clause = {"symbol": symbol.upper()}

    # Query ChromaDB
    try:
        results = collection.query(
            query_embeddings=[query_embed],
            n_results=min(top_k * 2, 20),  # over-fetch then threshold
            where=where_clause,
            include=["documents", "metadatas", "distances"],
        )
    except Exception as e:
        return [RetrievedDoc(
            text=f"ChromaDB query error: {e}",
            score=0.0,
            metadata={"symbol": symbol or "", "source_type": "rag_error"},
        )]

    docs: list[RetrievedDoc] = []
    ids = results.get("ids", [[]])[0]
    distances = results.get("distances", [[]])[0]
    documents = results.get("documents", [[]])[0]
    metadatas = results.get("metadatas", [[]])[0]

    for dist, text, meta in zip(distances, documents, metadatas):
        # ChromaDB cosine distance: 0 = identical, 2 = opposite
        # Convert to similarity score 0–1
        score = max(0.0, 1.0 - dist / 2.0)
        if score < score_threshold:
            continue
        docs.append(RetrievedDoc(text=text, score=score, metadata=meta or {}))

    # Sort by score descending and cap
    docs.sort(key=lambda d: d.score, reverse=True)
    return docs[:top_k]


def format_for_llm(docs: list[RetrievedDoc], max_chars: int = 4000) -> str:
    """
    Format retrieved docs into a compact string for LLM context injection.
    Respects a character budget to avoid blowing the context window.
    """
    parts = []
    used = 0
    for i, doc in enumerate(docs, 1):
        header = (
            f"[Source {i}: {doc.metadata.get('source_type','s3')} | "
            f"{doc.metadata.get('symbol','?')} | "
            f"{doc.metadata.get('section', doc.metadata.get('filename',''))} | "
            f"score={doc.score:.2f}]"
        )
        body = doc.text
        chunk = f"{header}\n{body}\n"
        if used + len(chunk) > max_chars:
            remaining = max_chars - used
            if remaining > 100:
                chunk = chunk[:remaining] + "…"
                parts.append(chunk)
            break
        parts.append(chunk)
        used += len(chunk)

    return "\n".join(parts) if parts else "No relevant financial documents found."
