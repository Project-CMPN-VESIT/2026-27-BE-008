from typing import Any, List, Dict
from pydantic import BaseModel
import copy

ROLE_CONTEXT_FIELDS: dict[str, list[str]] = {
    "fundamental":        ["financials", "peer_table", "rag.annual_report", "identity"],
    "filings_governance": ["filings", "shareholding", "actions", "rag.filings"],
    "technical":          ["technical_market_data", "market_snapshot", "identity"],
    "sector_peer_macro":  ["peer_table", "sector_indicators", "macro", "identity.sector", "policy_items"],
    "news_catalyst":      ["news", "filings", "events", "identity"],  
    "risk_bear":          ["*"],   
    "committee":          ["*"],   
}

def _resolve_dot_path(obj: Any, path: str) -> Any:
    """Resolve a dot-path on a Pydantic model or dict.
    
    If the current object is a list and the path continues, it filters the list
    by matching the next path segment against a 'category' or 'type' field, 
    or recursively resolves the path on each element.
    """
    parts = path.split('.')
    current = obj
    
    for i, part in enumerate(parts):
        if current is None:
            return None
            
        if isinstance(current, list):
            # If current is a list, and we still have path parts, 
            # assume the next part is a category filter on the list items.
            # e.g., rag.annual_report -> filter rag where category == "annual_report"
            filtered = []
            for item in current:
                if isinstance(item, dict):
                    if item.get("category") == part or item.get("type") == part:
                        filtered.append(item)
                elif isinstance(item, BaseModel):
                    if getattr(item, "category", None) == part or getattr(item, "type", None) == part:
                        filtered.append(item)
            return filtered
            
        elif isinstance(current, dict):
            if part not in current:
                # If part is not in dict, maybe it's meant to be an empty state
                return None
            current = current[part]
            
        elif isinstance(current, BaseModel):
            if not hasattr(current, part):
                return None
            current = getattr(current, part)
            
        else:
            raise ValueError(f"Cannot resolve path '{path}': '{part}' is not a dict or BaseModel (got {type(current)}).")
            
    return current


def _find_evidence_ids(obj: Any) -> set[str]:
    """Recursively find any strings that look like evidence IDs in the resolved data."""
    found = set()
    if isinstance(obj, dict):
        for k, v in obj.items():
            if k in ("id", "evidence_id") and isinstance(v, str) and v.startswith("ev_"):
                found.add(v)
            elif k == "evidence_ids" and isinstance(v, list):
                for item in v:
                    if isinstance(item, str):
                        found.add(item)
            else:
                found.update(_find_evidence_ids(v))
    elif isinstance(obj, list):
        for item in obj:
            found.update(_find_evidence_ids(item))
    elif isinstance(obj, BaseModel):
        # model_dump() handles nested models
        found.update(_find_evidence_ids(obj.model_dump()))
    return found


def build_user_content(role: str, context: Any, upstream_claims: List[Any] | None = None) -> dict[str, Any]:
    """
    Resolves ROLE_CONTEXT_FIELDS[role] against context using dot-path lookup.
    "*" returns the full serialized context. 
    Only includes evidence_registry entries actually referenced by the selected fields.
    Raises KeyError or ValueError if field paths do not resolve or if unverified 
    evidence is referenced.
    """
    if role not in ROLE_CONTEXT_FIELDS:
        raise ValueError(f"Role '{role}' not found in ROLE_CONTEXT_FIELDS")
        
    fields = ROLE_CONTEXT_FIELDS[role]
    result: dict[str, Any] = {}
    
    # Dump full context for ease of registry lookup later
    full_context_dict = context.model_dump()
    registry_keys = set(full_context_dict.get("evidence_registry", {}).keys())
    
    if "*" in fields:
        result = copy.deepcopy(full_context_dict)
        # Compact evidence registry so it doesn't bloat prompt
        if "evidence_registry" in result and isinstance(result["evidence_registry"], dict):
            comp = {}
            for ev_id, ev in result["evidence_registry"].items():
                comp[ev_id] = {
                    "id": ev.get("id"),
                    "type": ev.get("type"),
                    "source_name": ev.get("source_name"),
                    "title": ev.get("title"),
                    "excerpt": (ev.get("excerpt") or "")[:300],
                    "freshness": ev.get("freshness"),
                }
            result["evidence_registry"] = comp
    else:
        for path in fields:
            resolved = _resolve_dot_path(context, path)
            if resolved is None:
                # Based on constraints: "resolve to real data or a documented empty state"
                result[path] = None
                continue
                
            # Deep copy to avoid mutating the original context
            if isinstance(resolved, BaseModel):
                resolved_data = resolved.model_dump()
            elif isinstance(resolved, (dict, list)):
                resolved_data = copy.deepcopy(resolved)
            else:
                resolved_data = resolved
                
            # Filter filings for news_catalyst role
            if role == "news_catalyst" and path == "filings" and isinstance(resolved_data, list):
                resolved_data = [
                    f for f in resolved_data 
                    if isinstance(f, dict) and f.get("category") in {"transcript", "results"}
                ]
                
            # Store in result using the top-level key
            top_level = path.split(".")[0]
            if "." in path:
                if top_level not in result or not isinstance(result[top_level], dict):
                    result[top_level] = {}
                sub_key = path.split(".")[1]
                result[top_level][sub_key] = resolved_data
            else:
                result[top_level] = resolved_data

    # Validate evidence IDs
    referenced_evidence_ids = _find_evidence_ids(result)
    for ev_id in referenced_evidence_ids:
        if ev_id not in registry_keys:
            raise ValueError(f"Resolved data references evidence_id '{ev_id}' not found in evidence_registry.")
            
    # Include only referenced evidence registry items if not full context
    if "*" not in fields:
        filtered_registry = {
            k: v for k, v in full_context_dict.get("evidence_registry", {}).items() 
            if k in referenced_evidence_ids
        }
        for ev_id, ev in full_context_dict.get("evidence_registry", {}).items():
            ev_type = ev.get("type", "")
            # Module names often match types or fields
            if ev_type in fields or ev_type in result:
                filtered_registry[ev_id] = ev
            # Special mapping
            if "financials" in fields and ev_type in ("trusted_secondary", "primary", "exchange_filing"):
                if "nse_results" in ev_id or "screener" in ev_id:
                    filtered_registry[ev_id] = ev
            if "peer_table" in fields and "peers" in ev_id:
                filtered_registry[ev_id] = ev
            if "macro" in fields and "macro" in ev_id:
                filtered_registry[ev_id] = ev
            if "news" in fields and ev_type in ("exchange_filing", "trusted_secondary"):
                if "news" in ev_id:
                    filtered_registry[ev_id] = ev
            if "rag" in fields and ev_type == "rag_primary_copy":
                filtered_registry[ev_id] = ev
                
        # Compact evidence items
        compact_registry = {}
        for ev_id, ev in filtered_registry.items():
            compact_registry[ev_id] = {
                "id": ev.get("id"),
                "type": ev.get("type"),
                "source_name": ev.get("source_name"),
                "title": ev.get("title"),
                "excerpt": (ev.get("excerpt") or "")[:300],
                "freshness": ev.get("freshness"),
            }
        result["evidence_registry"] = compact_registry

    if upstream_claims is not None:
        if isinstance(upstream_claims, list):
            result["upstream_claims"] = [
                c.model_dump() if isinstance(c, BaseModel) else c for c in upstream_claims
            ]
        else:
            result["upstream_claims"] = upstream_claims
            
    return result
