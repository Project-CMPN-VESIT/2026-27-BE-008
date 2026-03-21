"""
Deterministic regex-based extraction for structured identifiers.
Runs BEFORE the LLM — extracts PAN, DIN, CIN, and dates for free.
"""

import re
from datetime import datetime


# PAN: 5 uppercase letters, 4 digits, 1 uppercase letter
PAN_PATTERN = re.compile(r'\b([A-Z]{5}[0-9]{4}[A-Z])\b')

# DIN: 8 digits (Director Identification Number)
DIN_PATTERN = re.compile(r'\b(\d{8})\b')

# CIN: L/U + 5 digits + 2 letters(state) + 4 digits(year) + 3 letters(company type) + 6 digits
CIN_PATTERN = re.compile(r'\b([LU]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6})\b')

# Date patterns (various formats found in Indian regulatory docs)
DATE_PATTERNS = [
    # "25 February 2016" or "25th February, 2016"
    (re.compile(r'\b(\d{1,2})(?:st|nd|rd|th)?\s+(January|February|March|April|May|June|July|August|September|October|November|December),?\s+(\d{4})\b', re.IGNORECASE),
     lambda m: _parse_dmy_month(m.group(1), m.group(2), m.group(3))),

    # "February 25, 2016"
    (re.compile(r'\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{4})\b', re.IGNORECASE),
     lambda m: _parse_dmy_month(m.group(2), m.group(1), m.group(3))),

    # "25/02/2016" or "25-02-2016" or "25.02.2016"
    (re.compile(r'\b(\d{1,2})[/\-\.](\d{1,2})[/\-\.](\d{4})\b'),
     lambda m: f"{m.group(3)}-{m.group(2).zfill(2)}-{m.group(1).zfill(2)}"),

    # "2016-02-25" (ISO format)
    (re.compile(r'\b(\d{4})-(\d{1,2})-(\d{1,2})\b'),
     lambda m: f"{m.group(1)}-{m.group(2).zfill(2)}-{m.group(3).zfill(2)}"),
]

MONTHS = {
    'january': '01', 'february': '02', 'march': '03', 'april': '04',
    'may': '05', 'june': '06', 'july': '07', 'august': '08',
    'september': '09', 'october': '10', 'november': '11', 'december': '12',
}


def _parse_dmy_month(day: str, month_name: str, year: str) -> str:
    month_num = MONTHS.get(month_name.lower(), '00')
    return f"{year}-{month_num}-{day.zfill(2)}"


def extract_pans(text: str) -> list:
    """Extract all PAN numbers from text."""
    return list(set(PAN_PATTERN.findall(text)))


def extract_dins(text: str) -> list:
    """Extract candidate DIN numbers (8 digits). May have false positives."""
    candidates = DIN_PATTERN.findall(text)
    # Filter out obvious non-DINs (years, phone numbers, etc.)
    # DINs are typically in 00000001 to 99999999 range
    return list(set(c for c in candidates if not c.startswith('20') and not c.startswith('19')))


def extract_cins(text: str) -> list:
    """Extract all CIN numbers from text."""
    return list(set(CIN_PATTERN.findall(text)))


def extract_dates(text: str) -> list:
    """Extract and normalize all dates found in text to ISO 8601 format."""
    dates = []
    for pattern, converter in DATE_PATTERNS:
        for match in pattern.finditer(text):
            try:
                iso_date = converter(match)
                # Validate the date
                datetime.strptime(iso_date, "%Y-%m-%d")
                dates.append(iso_date)
            except (ValueError, IndexError):
                continue
    return list(set(dates))


def extract_all(text: str) -> dict:
    """
    Run all regex extractors on the text.
    Returns dict of deterministically extracted fields.
    """
    return {
        "pans": extract_pans(text),
        "dins": extract_dins(text),
        "cins": extract_cins(text),
        "dates": extract_dates(text),
    }
