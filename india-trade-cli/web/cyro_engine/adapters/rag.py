from typing import Dict, Any, List
import logging
from datetime import datetime, timezone

from .base import SourceAdapter, AdapterResult

logger = logging.getLogger(__name__)

class RagAdapter(SourceAdapter):
    """
    Fetches long-form contextual documents from ChromaDB.
    Returns targeted evidence chunks strictly scoped to the requested symbol.
    """
    
    def __init__(self):
        super().__init__(name="ChromaDB RAG", default_quality="SECONDARY")

    def _fetch_primary(self, symbol: str, **kwargs) -> Any:
        try:
            import chromadb
        except ImportError:
            raise Exception("chromadb not installed")
            
        from rag.retriever import search_financial_docs
        
        # Exclude structured source types that duplicate our deterministic adapters
        structured_types = ["s3_json", "s3_csv_shareholding", "s3_csv_ratios"]
        
        docs_fundamental = search_financial_docs(
            query="annual report financial performance business overview management guidance",
            symbol=symbol,
            top_k=3,
            score_threshold=0.25,
            exclude_source_types=structured_types
        )
        
        docs_governance = search_financial_docs(
            query="corporate governance risk factors related party transactions auditor",
            symbol=symbol,
            top_k=3,
            score_threshold=0.25,
            exclude_source_types=structured_types
        )
        
        # De-duplicate by text to prevent same chunks from appearing twice
        seen = set()
        unique_docs = []
        for d in docs_fundamental + docs_governance:
            if d.text not in seen:
                seen.add(d.text)
                unique_docs.append({
                    "text": d.text,
                    "score": d.score,
                    "metadata": d.metadata,
                })
                
        return {"documents": unique_docs}

    def _build_evidence(self, symbol: str, research_id: str, result: AdapterResult) -> List[Dict[str, Any]]:
        evidence_list = []
        documents = (result.data or {}).get("documents", [])
        
        for idx, doc in enumerate(documents):
            meta = doc.get("metadata", {})
            score = doc.get("score", 0.0)
            text = doc.get("text", "")
            
            source_type = meta.get("source_type", "rag_s3")
            section = meta.get("section", "Document")
            filename = meta.get("filename", "")
            
            # Determine category for downstream routing (annual_report vs filings)
            doc_type = meta.get("document_type", "").lower()
            if "annual" in doc_type or "annual" in source_type or "report" in section.lower():
                category = "annual_report"
            elif "transcript" in doc_type or "transcript" in source_type:
                category = "transcript"
            else:
                category = "filings" # default governance fallback
                
            headline = f"RAG Excerpt: {section} ({round(score, 2)})"
            if filename:
                headline += f" - {filename}"
                
            evidence = {
                "id": f"ev_{symbol.lower()}_rag_{idx}",
                "research_id": research_id,
                "ticker": symbol.upper(),
                "type": "rag_primary_copy", 
                "category": category,
                "source_quality": self.default_quality,
                "source_name": self.name,
                "title": headline,
                "published_at": datetime.now(timezone.utc).isoformat(), # RAG index time isn't stored, use fetch time as fallback
                "fetched_at": result.fetched_at,
                "excerpt": text[:1500], # Pass the full chunk as the excerpt (bounded to 1500 chars to be safe)
                "facts": [{"rag_chunk": text}],
                "freshness": result.freshness
            }
            evidence_list.append(evidence)
            
        return evidence_list
