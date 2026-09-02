"""
Deterministic entity and action extraction from regulatory text.
Completely replaces the Mistral LLM extraction.
"""

import re
import logging
from datetime import datetime

from extraction.regex_extractor import extract_all as regex_extract
from extraction.name_variants import generate_variants

logger = logging.getLogger(__name__)

def determine_action_type(text: str) -> str:
    text_lower = text.lower()
    
    if "debarred" in text_lower or "restrained" in text_lower or "prohibited" in text_lower:
        return "DEBARRED"
    elif "suspend" in text_lower:
        return "SUSPENDED"
    elif "penalty" in text_lower or "penalised" in text_lower or "adjudication" in text_lower:
        return "PENALTY"
    elif "warning" in text_lower or "warned" in text_lower or "caution" in text_lower:
        return "WARNING"
    elif "revoked" in text_lower:
        return "REVOKED"
    elif "settlement" in text_lower:
        return "SETTLEMENT"
    elif "interim order" in text_lower:
        return "INTERIM_ORDER"
    elif "final order" in text_lower:
        return "FINAL_ORDER"
    elif "show cause" in text_lower or "notice" in text_lower:
        return "NOTICE"
    elif "stayed" in text_lower:
        return "STAYED"
    elif "set aside" in text_lower:
        return "SET_ASIDE"
    
    return "REGULATORY_ACTION"

def determine_status(text: str, expiry_date: str) -> str:
    text_lower = text.lower()
    
    # Check text for explicit historical statuses
    if "revoked" in text_lower:
        return "REVOKED"
    elif "stayed" in text_lower:
        return "STAYED"
    elif "set aside" in text_lower:
        return "SET_ASIDE"
        
    # Check expiry date
    if expiry_date:
        try:
            exp_date = datetime.strptime(expiry_date, "%Y-%m-%d")
            if exp_date < datetime.now():
                return "EXPIRED"
        except Exception:
            pass
            
    return "ACTIVE"

def extract_entity_name(text: str) -> str:
    # Try finding "in the matter of X"
    match = re.search(r'in the matter of\s+([^\n\.,;]+)', text, re.IGNORECASE)
    if match:
        name = match.group(1).strip()
        if len(name) > 3 and len(name) < 100:
            return name
            
    # Try finding "concerning X"
    match = re.search(r'concerning\s+([^\n\.,;]+)', text, re.IGNORECASE)
    if match:
        name = match.group(1).strip()
        if len(name) > 3 and len(name) < 100:
            return name
            
    # Try finding the title directly if we prepended it
    match = re.search(r'^TITLE:\s+([^\n]+)', text, re.IGNORECASE)
    if match:
        name = match.group(1).strip()
        # Remove common prefixes from title
        name = re.sub(r'^(final|interim)?\s*order( in the matter of)?\s*', '', name, flags=re.IGNORECASE)
        name = re.sub(r'^notice( in the matter of)?\s*', '', name, flags=re.IGNORECASE)
        if len(name) > 3 and len(name) < 100:
            return name

    return "Multiple/Unknown Entities"

def extract_entities_deterministically(text: str, source_id: str, regulator: str) -> list:
    if not text or len(text.strip()) < 10:
        return []
        
    # 1. Run regex pre-pass
    regex_results = regex_extract(text)
    
    pans = regex_results.get("pans", [])
    dins = regex_results.get("dins", [])
    cins = regex_results.get("cins", [])
    dates = regex_results.get("dates", [])
    
    # 2. Extract Entity Name
    canonical_name = extract_entity_name(text)
    
    # 3. Classify Action
    action_type = determine_action_type(text)
    
    # 4. Dates
    order_date = dates[0] if len(dates) > 0 else None
    effective_date = dates[1] if len(dates) > 1 else order_date
    expiry_date = None # Hard to extract deterministically without complex NLP
    
    # 5. Status
    status = determine_status(text, expiry_date)
    
    # Construct deterministic entity
    entity = {
        "canonical_name": canonical_name,
        "entity_type": "INDIVIDUAL" if len(dins) > 0 else ("COMPANY" if len(cins) > 0 else "UNKNOWN"),
        "din": dins[0] if dins else None,
        "cin": cins[0] if cins else None,
        "pan": pans[0] if pans else None,
        "action_type": action_type,
        "status": status,
        "order_number": None,
        "order_date": order_date,
        "effective_date": effective_date,
        "expiry_date": expiry_date,
        "description": f"Deterministic extraction from {regulator} document.",
        "confidence": 0.8, # Deterministic but we don't have LLM verification
        "name_variants": generate_variants(canonical_name)
    }
    
    return [entity]

def process_unprocessed_records(db, max_records: int = None):
    # We fetch sources to get regulator mapping
    conn = db._get_conn()
    sources = {s['source_id']: s['regulator'] for s in conn.execute("SELECT source_id, regulator FROM sources").fetchall()}
    conn.close()

    records = db.get_unprocessed_documents()
    if max_records:
        records = records[:max_records]

    logger.info(f"Processing {len(records)} unprocessed documents deterministically")
    results = {"processed": 0, "entities_found": 0, "errors": []}

    for i, doc in enumerate(records):
        try:
            logger.info(f"[{i+1}/{len(records)}] Processing doc {doc['document_id']}")
            regulator = sources.get(doc['source_id'], "UNKNOWN")

            entities = extract_entities_deterministically(
                text=doc["raw_text"],
                source_id=doc["source_id"],
                regulator=regulator
            )

            for entity_data in entities:
                entity_id = db.insert_entity(
                    canonical_name=entity_data["canonical_name"],
                    entity_type=entity_data["entity_type"],
                    din=entity_data["din"],
                    cin=entity_data["cin"],
                    pan=entity_data["pan"]
                )

                db.insert_regulatory_action(
                    entity_id=entity_id,
                    source_id=doc["source_id"],
                    document_id=doc["document_id"],
                    regulator=regulator,
                    action_type=entity_data["action_type"],
                    status=entity_data["status"],
                    source_url=doc["source_url"] or "UNKNOWN",
                    order_number=entity_data["order_number"],
                    order_date=entity_data["order_date"],
                    effective_date=entity_data["effective_date"],
                    expiry_date=entity_data["expiry_date"],
                    publication_date=doc["published_at"],
                    description=entity_data["description"],
                    confidence=entity_data["confidence"]
                )

                variants = entity_data.get("name_variants", [])
                for v in variants:
                    db.insert_name_variant(entity_id, v["variant"], v["type"])

                results["entities_found"] += 1

            db.mark_document_processed(doc["document_id"])
            results["processed"] += 1

        except Exception as e:
            error_msg = f"Error processing doc {doc['document_id']}: {str(e)}"
            logger.error(error_msg)
            results["errors"].append(error_msg)

    logger.info(f"Extraction complete: {results['processed']} docs processed, {results['entities_found']} entities found")
    return results
