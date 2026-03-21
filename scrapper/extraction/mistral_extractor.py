"""
Mistral Small LLM-based entity extraction from regulatory text.
Uses JSON mode for structured output with per-field confidence scores.
Handles API rate limits with exponential backoff and retry logic.
"""

import os
import re
import json
import time
import logging
from dotenv import load_dotenv
from mistralai import Mistral

from extraction.regex_extractor import extract_all as regex_extract
from extraction.name_variants import generate_variants

load_dotenv()
logger = logging.getLogger(__name__)

MODEL = "mistral-small-latest"

# --- Rate Limit Configuration ---
MAX_RETRIES = 5
INITIAL_BACKOFF = 2.0        # seconds
MAX_BACKOFF = 60.0            # seconds
BACKOFF_MULTIPLIER = 2.0
REQUEST_DELAY = 1.0           # minimum delay between requests (seconds)

# --- Extraction Prompt ---
EXTRACTION_PROMPT = """You are a regulatory compliance data extraction system. Extract sanctioned entity information from the following regulatory circular text.

**Source**: {publishing_body}
**Circular Number**: {circular_number}

**Text to extract from**:
{text}

**Pre-extracted identifiers** (already found via regex, use these directly):
{regex_results}

**Instructions**:
1. Extract ALL sanctioned individuals and entities mentioned in this circular.
2. For each entity, extract the fields listed below.
3. If a field cannot be determined with confidence, set it to null.
4. Assign a confidence score (0.0 to 1.0) to each extracted field.
5. Pay attention to phrases like "with effect from", "delisted", "listed on" for dates.
6. Names from UN sanctions lists are often referenced in these circulars.

**Output JSON schema** (return a JSON object with this exact structure):
{{
  "entities": [
    {{
      "name": {{"value": "Full Name", "confidence": 0.95}},
      "date_of_birth": {{"value": "YYYY-MM-DD or null", "confidence": 0.0}},
      "country": {{"value": "Country name or ISO code", "confidence": 0.8}},
      "circular_number": {{"value": "As found in text", "confidence": 0.99}},
      "sanction_start_date": {{"value": "YYYY-MM-DD or null", "confidence": 0.7}},
      "sanction_end_date": {{"value": "YYYY-MM-DD or null for indefinite", "confidence": 0.7}},
      "sanction_action": {{"value": "LISTED or DELISTED", "confidence": 0.9}},
      "pan": {{"value": "PAN number or null", "confidence": 0.0}},
      "din": {{"value": "DIN number or null", "confidence": 0.0}},
      "cin": {{"value": "CIN number or null", "confidence": 0.0}}
    }}
  ]
}}

**Example output**:
{{
  "entities": [
    {{
      "name": {{"value": "Ahmad Hussain Al-Sharaa", "confidence": 0.95}},
      "date_of_birth": {{"value": null, "confidence": 0.0}},
      "country": {{"value": null, "confidence": 0.0}},
      "circular_number": {{"value": "DOR.AML.REC.61/14.06.001/2025-26", "confidence": 0.99}},
      "sanction_start_date": {{"value": null, "confidence": 0.0}},
      "sanction_end_date": {{"value": null, "confidence": 0.0}},
      "sanction_action": {{"value": "DELISTED", "confidence": 0.95}},
      "pan": {{"value": null, "confidence": 0.0}},
      "din": {{"value": null, "confidence": 0.0}},
      "cin": {{"value": null, "confidence": 0.0}}
    }}
  ]
}}

Return ONLY the JSON object, no other text."""


class MistralExtractor:
    """
    LLM-based entity extractor using Mistral Small.
    Handles rate limits with exponential backoff.
    """

    def __init__(self, api_key: str = None):
        self.api_key = api_key or os.getenv("MISTRAL_API_KEY")
        if not self.api_key:
            raise ValueError("MISTRAL_API_KEY not set. Add it to .env or pass directly.")

        self.client = Mistral(api_key=self.api_key)
        self._last_request_time = 0

    def _wait_for_rate_limit(self):
        """Enforce minimum delay between API calls."""
        elapsed = time.time() - self._last_request_time
        if elapsed < REQUEST_DELAY:
            sleep_time = REQUEST_DELAY - elapsed
            logger.debug(f"Rate limit: sleeping {sleep_time:.2f}s")
            time.sleep(sleep_time)

    def _call_mistral_with_retry(self, messages: list) -> str:
        """
        Call Mistral API with exponential backoff on rate limit errors.
        Handles HTTP 429 (Too Many Requests) and 529 (Overloaded) gracefully.
        """
        backoff = INITIAL_BACKOFF

        for attempt in range(MAX_RETRIES):
            self._wait_for_rate_limit()

            try:
                self._last_request_time = time.time()
                response = self.client.chat.complete(
                    model=MODEL,
                    messages=messages,
                    response_format={"type": "json_object"},
                    temperature=0.1,  # Low temperature for deterministic extraction
                )
                return response.choices[0].message.content

            except Exception as e:
                error_str = str(e).lower()

                # Check if it's a rate limit or overload error
                is_rate_limit = any(indicator in error_str for indicator in [
                    "429", "rate limit", "too many requests",
                    "529", "overloaded", "quota", "throttl"
                ])

                if is_rate_limit and attempt < MAX_RETRIES - 1:
                    # Try to extract retry-after from error if available
                    retry_after = self._extract_retry_after(str(e))
                    wait_time = retry_after if retry_after else min(backoff, MAX_BACKOFF)

                    logger.warning(
                        f"Rate limited (attempt {attempt+1}/{MAX_RETRIES}). "
                        f"Waiting {wait_time:.1f}s before retry..."
                    )
                    time.sleep(wait_time)
                    backoff *= BACKOFF_MULTIPLIER
                    continue
                else:
                    logger.error(f"Mistral API error (attempt {attempt+1}): {e}")
                    if attempt == MAX_RETRIES - 1:
                        raise
                    time.sleep(backoff)
                    backoff *= BACKOFF_MULTIPLIER

        raise RuntimeError(f"Failed after {MAX_RETRIES} retries")

    @staticmethod
    def _extract_retry_after(error_message: str) -> float:
        """Try to extract Retry-After value from error message."""
        match = re.search(r'retry.?after[:\s]*(\d+\.?\d*)', error_message, re.IGNORECASE)
        if match:
            return float(match.group(1))
        return None

    def extract_entities(self, text: str, circular_number: str = None,
                         publishing_body: str = "RBI") -> list:
        """
        Extract entities from regulatory circular text.
        Runs regex pre-pass first, then LLM for ambiguous fields.
        Returns list of extracted entity dicts.
        """
        if not text or len(text.strip()) < 50:
            logger.warning("Text too short for extraction, skipping")
            return []

        # Step 1: Regex pre-pass (deterministic, free)
        regex_results = regex_extract(text)
        logger.info(
            f"Regex pre-pass: {len(regex_results['pans'])} PANs, "
            f"{len(regex_results['dins'])} DINs, {len(regex_results['cins'])} CINs, "
            f"{len(regex_results['dates'])} dates"
        )

        # Step 2: Truncate text to avoid token limits (Mistral Small context ~32k)
        # Keep first 8000 chars which should cover the main content
        truncated_text = text[:8000]

        # Step 3: LLM extraction
        prompt = EXTRACTION_PROMPT.format(
            publishing_body=publishing_body,
            circular_number=circular_number or "Unknown",
            text=truncated_text,
            regex_results=json.dumps(regex_results, indent=2),
        )

        messages = [
            {"role": "system", "content": "You are a precise regulatory data extraction assistant. Always output valid JSON."},
            {"role": "user", "content": prompt},
        ]

        try:
            response_text = self._call_mistral_with_retry(messages)

            # Parse JSON response
            result = json.loads(response_text)
            entities = result.get("entities", [])

            logger.info(f"LLM extracted {len(entities)} entities")

            # Step 4: Merge regex results with LLM results
            processed = []
            for entity in entities:
                processed_entity = self._process_entity(entity, regex_results, circular_number)
                if processed_entity:
                    processed.append(processed_entity)

            return processed

        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse LLM response as JSON: {e}")
            logger.debug(f"Raw response: {response_text[:500]}")
            return []
        except Exception as e:
            logger.error(f"LLM extraction failed: {e}")
            return []

    def _process_entity(self, entity: dict, regex_results: dict,
                         circular_number: str = None) -> dict:
        """
        Process a single extracted entity.
        Merges LLM output with regex results and calculates overall confidence.
        """
        def get_field(field_data):
            """Extract value and confidence from field dict."""
            if isinstance(field_data, dict):
                return field_data.get("value"), field_data.get("confidence", 0.0)
            return field_data, 0.5  # Fallback for non-dict fields

        name, name_conf = get_field(entity.get("name", {}))
        if not name:
            return None

        dob, dob_conf = get_field(entity.get("date_of_birth", {}))
        country, country_conf = get_field(entity.get("country", {}))
        circ_num, circ_conf = get_field(entity.get("circular_number", {}))
        sanction_start, start_conf = get_field(entity.get("sanction_start_date", {}))
        sanction_end, end_conf = get_field(entity.get("sanction_end_date", {}))
        sanction_action, action_conf = get_field(entity.get("sanction_action", {}))
        pan, pan_conf = get_field(entity.get("pan", {}))
        din, din_conf = get_field(entity.get("din", {}))
        cin, cin_conf = get_field(entity.get("cin", {}))

        # Override with regex results (higher confidence)
        if not pan and regex_results.get("pans"):
            pan = regex_results["pans"][0]
            pan_conf = 0.99

        if not din and regex_results.get("dins"):
            din = regex_results["dins"][0]
            din_conf = 0.95

        if not cin and regex_results.get("cins"):
            cin = regex_results["cins"][0]
            cin_conf = 0.99

        # Use provided circular number if LLM missed it
        if not circ_num and circular_number:
            circ_num = circular_number
            circ_conf = 0.99

        # Determine sanction status
        sanction_status = "ACTIVE"
        if sanction_action and sanction_action.upper() == "DELISTED":
            sanction_status = "PREVIOUSLY_SANCTIONED_CLEARED"
        elif sanction_end:
            try:
                from datetime import datetime
                end_date = datetime.strptime(sanction_end, "%Y-%m-%d")
                if end_date < datetime.now():
                    sanction_status = "EXPIRED"
            except (ValueError, TypeError):
                pass

        # Calculate overall confidence as weighted average
        confidences = [
            (name_conf, 0.3),
            (circ_conf, 0.2),
            (action_conf, 0.2),
            (start_conf, 0.1),
            (country_conf, 0.1),
            (dob_conf, 0.1),
        ]
        overall_confidence = sum(c * w for c, w in confidences if c is not None)

        return {
            "name": name,
            "din": din,
            "cin": cin,
            "pan": pan,
            "date_of_birth": dob,
            "country": country,
            "circular_number": circ_num,
            "sanction_start": sanction_start,
            "sanction_end": sanction_end,
            "sanction_status": sanction_status,
            "extraction_confidence": round(overall_confidence, 3),
            "name_variants": generate_variants(name),
        }


def process_unprocessed_records(db, max_records: int = None):
    """
    Process all unprocessed RBI raw records through the AI extraction pipeline.
    """
    extractor = MistralExtractor()

    records = db.get_unprocessed_records(source_id="rbi_standalone_circulars")
    if max_records:
        records = records[:max_records]

    logger.info(f"Processing {len(records)} unprocessed records through AI extraction")

    results = {"processed": 0, "entities_found": 0, "errors": []}

    for i, record in enumerate(records):
        try:
            logger.info(f"[{i+1}/{len(records)}] Processing: {record.get('circular_number', 'unknown')}")

            entities = extractor.extract_entities(
                text=record["raw_text"],
                circular_number=record.get("circular_number"),
                publishing_body="RBI",
            )

            for entity_data in entities:
                # Insert entity
                entity_id = db.insert_entity(
                    source_id="rbi_standalone_circulars",
                    raw_record_id=record["id"],
                    name=entity_data["name"],
                    din=entity_data.get("din"),
                    cin=entity_data.get("cin"),
                    pan=entity_data.get("pan"),
                    date_of_birth=entity_data.get("date_of_birth"),
                    country=entity_data.get("country"),
                    circular_number=entity_data.get("circular_number"),
                    date_published=record.get("date_published"),
                    sanction_start=entity_data.get("sanction_start"),
                    sanction_end=entity_data.get("sanction_end"),
                    link=record.get("url"),
                    publishing_body="RBI",
                    extraction_confidence=entity_data.get("extraction_confidence", 0.0),
                    sanction_status=entity_data.get("sanction_status", "ACTIVE"),
                )

                # Insert name variants
                variants = entity_data.get("name_variants", [])
                if variants:
                    db.insert_name_variants_bulk([
                        (entity_id, v["variant"], v["type"]) for v in variants
                    ])

                results["entities_found"] += 1

            db.mark_record_processed(record["id"])
            results["processed"] += 1

        except Exception as e:
            error_msg = f"Error processing record {record.get('id')}: {str(e)}"
            logger.error(error_msg)
            results["errors"].append(error_msg)

    logger.info(
        f"AI extraction complete: {results['processed']} records processed, "
        f"{results['entities_found']} entities found, {len(results['errors'])} errors"
    )
    return results
