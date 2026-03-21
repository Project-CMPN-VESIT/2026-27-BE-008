"""
UN Security Council Consolidated Sanctions List Scraper.
Downloads and parses the XML feed — fully structured, no AI needed.
"""

import hashlib
import logging
import requests
from xml.etree import ElementTree as ET

logger = logging.getLogger(__name__)

XML_URL = "https://scsanctions.un.org/resources/xml/en/consolidated.xml"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Accept": "application/xml,text/xml,*/*;q=0.8",
}


def download_xml(url: str = None) -> ET.Element:
    """Download and parse the UN consolidated sanctions XML."""
    url = url or XML_URL
    logger.info(f"Downloading UN sanctions XML: {url}")

    resp = requests.get(url, headers=HEADERS, timeout=120)
    resp.raise_for_status()

    root = ET.fromstring(resp.content)
    logger.info(f"XML downloaded and parsed successfully")
    return root


def _get_text(element, tag: str, default: str = None) -> str:
    """Safely extract text from an XML element."""
    child = element.find(tag)
    if child is not None and child.text:
        return child.text.strip()
    return default


def _get_all_values(element, tag: str) -> list:
    """Extract all <VALUE> texts from a parent tag."""
    parent = element.find(tag)
    if parent is None:
        return []
    return [v.text.strip() for v in parent.findall("VALUE") if v.text]


def _get_aliases(element) -> list:
    """Extract all aliases from INDIVIDUAL_ALIAS elements."""
    aliases = []
    for alias_el in element.findall("INDIVIDUAL_ALIAS"):
        alias_name = _get_text(alias_el, "ALIAS_NAME")
        quality = _get_text(alias_el, "QUALITY")
        if alias_name:
            aliases.append({"name": alias_name, "quality": quality or "Unknown"})
    return aliases


def _get_dob(element) -> str:
    """Extract date of birth from INDIVIDUAL_DATE_OF_BIRTH."""
    dob_el = element.find("INDIVIDUAL_DATE_OF_BIRTH")
    if dob_el is None:
        return None

    # Try exact date first
    date_val = _get_text(dob_el, "DATE")
    if date_val:
        return date_val

    # Try year only
    year = _get_text(dob_el, "YEAR")
    if year:
        return year

    # Try note (sometimes has "Nov. 1973" format)
    note = _get_text(dob_el, "NOTE")
    if note:
        return note

    return None


def _get_nationality(element) -> str:
    """Extract nationality."""
    values = _get_all_values(element, "NATIONALITY")
    return values[0] if values else None


def _get_documents(element) -> list:
    """Extract document identifiers (passport numbers, etc.)."""
    docs = []
    for doc_el in element.findall("INDIVIDUAL_DOCUMENT"):
        doc_type = _get_text(doc_el, "TYPE_OF_DOCUMENT")
        doc_number = _get_text(doc_el, "NUMBER")
        doc_country = _get_text(doc_el, "ISSUING_COUNTRY")
        if doc_number:
            docs.append({
                "type": doc_type,
                "number": doc_number,
                "country": doc_country,
            })
    return docs


def parse_individuals(root: ET.Element) -> list:
    """Parse all INDIVIDUAL elements from the sanctions XML."""
    individuals = []

    for ind in root.iter("INDIVIDUAL"):
        first_name = _get_text(ind, "FIRST_NAME") or ""
        second_name = _get_text(ind, "SECOND_NAME") or ""
        third_name = _get_text(ind, "THIRD_NAME") or ""
        fourth_name = _get_text(ind, "FOURTH_NAME") or ""

        # Build full name
        name_parts = [p for p in [first_name, second_name, third_name, fourth_name] if p]
        full_name = " ".join(name_parts)

        if not full_name:
            continue

        data_id = _get_text(ind, "DATAID")
        reference = _get_text(ind, "REFERENCE_NUMBER")
        listed_on = _get_text(ind, "LISTED_ON")
        un_list_type = _get_text(ind, "UN_LIST_TYPE")
        gender = _get_text(ind, "GENDER")
        comments = _get_text(ind, "COMMENTS1") or ""
        aliases = _get_aliases(ind)
        dob = _get_dob(ind)
        nationality = _get_nationality(ind)
        documents = _get_documents(ind)

        individuals.append({
            "data_id": data_id,
            "entity_type": "individual",
            "name": full_name,
            "first_name": first_name,
            "second_name": second_name,
            "reference_number": reference,
            "listed_on": listed_on,
            "un_list_type": un_list_type,
            "gender": gender,
            "nationality": nationality,
            "date_of_birth": dob,
            "aliases": aliases,
            "documents": documents,
            "comments": comments,
        })

    logger.info(f"Parsed {len(individuals)} individuals from UN XML")
    return individuals


def parse_entities(root: ET.Element) -> list:
    """Parse all ENTITY elements from the sanctions XML."""
    entities = []

    for ent in root.iter("ENTITY"):
        first_name = _get_text(ent, "FIRST_NAME") or ""
        second_name = _get_text(ent, "SECOND_NAME") or ""

        name_parts = [p for p in [first_name, second_name] if p]
        full_name = " ".join(name_parts)
        if not full_name:
            continue

        data_id = _get_text(ent, "DATAID")
        reference = _get_text(ent, "REFERENCE_NUMBER")
        listed_on = _get_text(ent, "LISTED_ON")
        un_list_type = _get_text(ent, "UN_LIST_TYPE")
        comments = _get_text(ent, "COMMENTS1") or ""

        # Entity aliases
        aliases = []
        for alias_el in ent.findall("ENTITY_ALIAS"):
            alias_name = _get_text(alias_el, "ALIAS_NAME")
            quality = _get_text(alias_el, "QUALITY")
            if alias_name:
                aliases.append({"name": alias_name, "quality": quality or "Unknown"})

        entities.append({
            "data_id": data_id,
            "entity_type": "entity",
            "name": full_name,
            "reference_number": reference,
            "listed_on": listed_on,
            "un_list_type": un_list_type,
            "nationality": None,
            "date_of_birth": None,
            "aliases": aliases,
            "documents": [],
            "comments": comments,
        })

    logger.info(f"Parsed {len(entities)} entities from UN XML")
    return entities


def compute_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def scrape_all(db):
    """
    Full pipeline: download XML → parse → store to DB.
    UN data is structured — no AI extraction needed.
    """
    source_id = "un_sanctions_consolidated"
    run_id = db.start_scrape_run(source_id)

    try:
        root = download_xml()

        individuals = parse_individuals(root)
        entities_list = parse_entities(root)
        all_records = individuals + entities_list

        records_found = len(all_records)
        records_new = 0
        records_processed = 0
        errors = []

        for record in all_records:
            try:
                # Create a content hash from the record's key identifiers
                hash_input = f"{record['data_id']}:{record['name']}:{record['listed_on']}"
                content_hash = compute_hash(hash_input)

                # Diff detection
                if db.record_exists(content_hash):
                    continue

                # Store raw record
                raw_text = f"Name: {record['name']}\nListed: {record['listed_on']}\n"
                raw_text += f"Type: {record['un_list_type']}\nComments: {record['comments']}"

                raw_id = db.insert_raw_record(
                    source_id=source_id,
                    content_hash=content_hash,
                    circular_number=record.get("reference_number"),
                    url=XML_URL,
                    date_published=record.get("listed_on"),
                    raw_text=raw_text,
                )
                records_new += 1

                # Directly insert as entity (no AI needed — data is structured)
                entity_id = db.insert_entity(
                    source_id=source_id,
                    raw_record_id=raw_id,
                    name=record["name"],
                    date_of_birth=record.get("date_of_birth"),
                    country=record.get("nationality"),
                    circular_number=record.get("reference_number"),
                    date_published=record.get("listed_on"),
                    sanction_start=record.get("listed_on"),
                    sanction_end=None,  # UN sanctions are indefinite until delisted
                    link=XML_URL,
                    publishing_body="UNSC",
                    extraction_confidence=0.99,  # Structured XML, high confidence
                    sanction_status="ACTIVE",
                )

                # Store name variants
                from extraction.name_variants import generate_variants
                variants = generate_variants(record["name"])

                # Add aliases as variants too
                for alias in record.get("aliases", []):
                    if alias["name"]:
                        variants.append({"variant": alias["name"], "type": "alias"})
                        # Also generate variants of aliases
                        alias_variants = generate_variants(alias["name"])
                        variants.extend(alias_variants)

                # Deduplicate variants
                seen_variants = set()
                unique_variants = []
                for v in variants:
                    key = v["variant"].lower()
                    if key not in seen_variants:
                        seen_variants.add(key)
                        unique_variants.append(v)

                db.insert_name_variants_bulk([
                    (entity_id, v["variant"], v["type"]) for v in unique_variants
                ])

                db.mark_record_processed(raw_id)
                records_processed += 1

            except Exception as e:
                error_msg = f"Error processing {record.get('name', 'unknown')}: {str(e)}"
                logger.error(error_msg)
                errors.append(error_msg)

        db.update_source_last_scraped(source_id)

        status = "COMPLETED" if not errors else "COMPLETED_WITH_ERRORS"
        db.complete_scrape_run(
            run_id, status=status,
            records_found=records_found,
            records_new=records_new,
            records_processed=records_processed,
            errors="\n".join(errors[:20]) if errors else None,  # Cap error log
        )

        logger.info(f"UN scrape complete: {records_found} found, {records_new} new, {len(errors)} errors")
        return {
            "source": source_id,
            "status": status,
            "records_found": records_found,
            "records_new": records_new,
            "records_processed": records_processed,
            "errors": errors[:10],
        }

    except Exception as e:
        logger.exception(f"UN scrape failed: {e}")
        db.complete_scrape_run(run_id, status="FAILED", errors=str(e))
        raise
