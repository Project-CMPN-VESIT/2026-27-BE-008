from typing import Dict, Any, List
from .base import SourceAdapter, AdapterResult
from .db_utils import get_pipeline_data

class LitigationAdapter(SourceAdapter):
    """Fetches auditor remarks and material litigation from the pipeline DB."""
    
    def __init__(self):
        super().__init__(name="Litigation and Audit", default_quality="official_disclosure")

    def _fetch_primary(self, symbol: str, **kwargs) -> Any:
        data = get_pipeline_data(symbol) or {}
        litigation = data.get("litigation_and_audit", {})

        # Enrich with SEBI Shield regulatory orders and sanctions
        try:
            from market.sebi_shield import screen_sebi_shield
            sebi_res = screen_sebi_shield(symbol)
            litigation["sebi_shield"] = sebi_res
        except Exception:
            litigation["sebi_shield"] = {"clean": True, "matches": []}

        return litigation

    def _build_evidence(self, symbol: str, research_id: str, result: AdapterResult) -> List[Dict[str, Any]]:
        evidence_list = []
        litigation = result.data or {}

        # SEBI Shield Regulatory Sanctions
        sebi_shield = litigation.get("sebi_shield", {})
        if not sebi_shield.get("clean") and sebi_shield.get("matches"):
            for idx, act in enumerate(sebi_shield["matches"][:3]):
                reg = act.get("regulator", "SEBI")
                act_type = act.get("action_type", "Regulatory action")
                st = act.get("status", "ACTIVE")
                desc = act.get("description", "")
                fact_str = f"{reg} {act_type} ({st}): {desc}"
                evidence_list.append({
                    "id": f"ev_{symbol.lower()}_sebi_shield_{idx}",
                    "research_id": research_id,
                    "ticker": symbol.upper(),
                    "type": "regulatory_sanction",
                    "category": "regulatory_risk",
                    "source_quality": "PRIMARY",
                    "source_name": f"SEBI Shield ({reg})",
                    "title": f"{reg} Regulatory Action: {act_type}",
                    "published_at": act.get("order_date") or result.fetched_at,
                    "fetched_at": result.fetched_at,
                    "excerpt": fact_str,
                    "facts": [{"regulatory_sanction": act_type, "regulator": reg, "status": st, "order_number": act.get("order_number")}],
                    "freshness": result.freshness,
                })

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
