"""
web/cyro_engine/tools/rag_tools.py
────────────────────────────────────
LangChain @tool wrappers for RAG (Retrieval-Augmented Generation).

Tools provided:
  search_annual_reports       — Semantic search over annual report chunks
  search_earnings_transcripts — Semantic search over earnings call transcripts

Both tools query ChromaDB via rag.retriever.search_financial_docs()
and return formatted, citation-ready results.
"""

from __future__ import annotations

import json

from langchain_core.tools import tool


@tool(parse_docstring=True)
def search_annual_reports(
    query: str,
    symbol: str,
    top_k: int = 5,
) -> str:
    """
    Semantic search over indexed annual reports and investor presentations.

    Searches the ChromaDB vector store for chunks from annual reports,
    investor presentations, and governance disclosures related to the query.

    Example queries:
      - "revenue breakdown by segment"
      - "management guidance for FY25"
      - "risk factors mentioned by auditors"
      - "related party transactions"
      - "capital allocation policy"

    Args:
        query: Natural language question about the company
        symbol: NSE ticker to search within (e.g. "INFY")
        top_k: Maximum number of document chunks to return (default 5)

    Returns:
        JSON string with retrieved text chunks, relevance scores, and citations.
    """
    try:
        from rag.retriever import search_financial_docs, format_for_llm

        docs = search_financial_docs(
            query=query,
            symbol=symbol.upper(),
            top_k=top_k,
            score_threshold=0.25,
        )

        results = []
        for doc in docs:
            results.append({
                "text": doc.text[:800],  # cap per chunk
                "score": round(doc.score, 3),
                "metadata": doc.metadata,
                "citation": doc.to_citation_dict(),
            })

        return json.dumps({
            "query": query,
            "symbol": symbol.upper(),
            "count": len(results),
            "chunks": results,
            "formatted_context": format_for_llm(docs, max_chars=3000),
            "source": "ChromaDB — S3 Financial Documents (annual reports)",
            "evidence_type": "rag_primary_copy",
            "note": (
                "If count=0 or chunks empty: documents not yet indexed. "
                f"Run: from rag.indexer import index_ticker; index_ticker('{symbol.upper()}')"
            ),
        }, default=str)

    except RuntimeError as e:
        # chromadb not installed
        return json.dumps({
            "error": str(e),
            "query": query,
            "symbol": symbol.upper(),
            "fix": "pip install chromadb>=0.5.0",
        })
    except Exception as e:
        return json.dumps({"error": str(e), "query": query, "symbol": symbol.upper()})


@tool(parse_docstring=True)
def search_earnings_transcripts(
    query: str,
    symbol: str,
    top_k: int = 5,
) -> str:
    """
    Semantic search over indexed earnings call transcripts.

    Searches for specific management commentary, forward guidance,
    margin outlook, capex plans, or analyst Q&A from earnings calls.

    Example queries:
      - "management commentary on margins"
      - "capex plan for next year"
      - "order book visibility"
      - "price hike commentary"
      - "analyst concern about competition"

    Args:
        query: Natural language question about the earnings call
        symbol: NSE ticker to search within (e.g. "INFY", "HDFCBANK")
        top_k: Maximum number of document chunks to return (default 5)

    Returns:
        JSON string with retrieved transcript chunks and source citations.
    """
    try:
        from rag.retriever import search_financial_docs, format_for_llm

        # Add "transcript" keyword to improve relevance filtering
        enhanced_query = f"earnings call transcript: {query}"

        docs = search_financial_docs(
            query=enhanced_query,
            symbol=symbol.upper(),
            top_k=top_k,
            score_threshold=0.20,  # slightly lower threshold for transcripts
        )

        # Filter by document type if metadata available
        transcript_docs = [
            d for d in docs
            if "transcript" in (d.metadata.get("document_type") or "").lower()
            or "transcript" in (d.metadata.get("source_type") or "").lower()
        ] or docs  # fall back to all docs if no transcripts indexed separately

        results = []
        for doc in transcript_docs:
            results.append({
                "text": doc.text[:800],
                "score": round(doc.score, 3),
                "metadata": doc.metadata,
                "citation": doc.to_citation_dict(),
            })

        return json.dumps({
            "query": query,
            "symbol": symbol.upper(),
            "count": len(results),
            "chunks": results,
            "formatted_context": format_for_llm(transcript_docs, max_chars=3000),
            "source": "ChromaDB — Earnings Call Transcripts",
            "evidence_type": "rag_primary_copy",
            "note": (
                "If count=0: transcripts not yet indexed. Index them via "
                f"rag.indexer.index_ticker('{symbol.upper()}', doc_type='transcript')"
            ),
        }, default=str)

    except RuntimeError as e:
        return json.dumps({
            "error": str(e),
            "query": query,
            "symbol": symbol.upper(),
            "fix": "pip install chromadb>=0.5.0",
        })
    except Exception as e:
        return json.dumps({"error": str(e), "query": query, "symbol": symbol.upper()})
