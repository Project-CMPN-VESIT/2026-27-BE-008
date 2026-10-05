from typing import Dict, Any, List
from .base import SourceAdapter, AdapterResult
from .db_utils import get_pipeline_data

class LitigationAdapter(SourceAdapter):
    """Fetches auditor remarks and material litigation from the pipeline DB."""
    
    def __init__(self):
        super().__init__(name="Litigation and Audit", default_quality="official_disclosure")

    def _fetch_primary(self, symbol: str, **kwargs) -> Any:
        data = get_pipeline_data(symbol)
        if not data:
            raise Exception(f"No pipeline data found for {symbol}")
            
        litigation = data.get("litigation_and_audit", {})
        
        return litigation

    def _build_evidence(self, symbol: str, research_id: str, result: AdapterResult) -> List[Dict[str, Any]]:
        evidence_list = []
        litigation = result.data or {}
        
        # Auditor Opinion
        auditor_opinion = litigation.get("auditor_report_opinion")
        if auditor_opinion:
            fact = f"Auditor Report Opinion: {auditor_opinion}"
            evidence_list.append({
                "id": f"ev_{symbol.lower()}_auditor_opinion",
                "research_id": research_id,
                "ticker": symbol.upper(),
                "type": "audit_report",
                "category": "litigation_risk",
                "source_quality": result.source_quality,
                "source_name": result.source_name,
                "title": "Auditor Report Opinion",
                "published_at": result.fetched_at,
                "fetched_at": result.fetched_at,
                "excerpt": fact,
                "facts": [{"auditor_opinion": auditor_opinion}],
                "freshness": result.freshness
            })
            
        # Material Litigations
        material_litigations = litigation.get("material_litigations", [])
        for idx, item in enumerate(material_litigations[:5]):
            fact = item.get("summary", str(item))
            evidence_list.append({
                "id": f"ev_{symbol.lower()}_litigation_{idx}",
                "research_id": research_id,
                "ticker": symbol.upper(),
                "type": "audit_report",
                "category": "litigation_risk",
                "source_quality": result.source_quality,
                "source_name": result.source_name,
                "title": "Material Litigation",
                "published_at": result.fetched_at,
                "fetched_at": result.fetched_at,
                "excerpt": fact,
                "facts": [{"litigation": fact}],
                "freshness": result.freshness
            })
            
        return evidence_list
