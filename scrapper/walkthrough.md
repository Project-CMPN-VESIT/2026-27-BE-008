# Regulatory Sanctions Scraper — Walkthrough

## What Was Built

A complete sanctions screening system with **1004 entities** loaded from two live data sources.

### Project Structure
```
d:\scrapper\
├── config/sources.json          # Source registry (RBI + UN)
├── scrapers/
│   ├── rbi_scraper.py           # RBI circulars HTML scraper
│   └── un_scraper.py            # UN sanctions XML parser
├── extraction/
│   ├── regex_extractor.py       # PAN/DIN/CIN regex pre-pass
│   ├── mistral_extractor.py     # Mistral Small LLM extraction
│   └── name_variants.py         # Name variant generator
├── db/
│   ├── schema.sql               # SQLite schema (5 tables)
│   └── database.py              # Database manager
├── api/main.py                  # FastAPI screening endpoint
├── run.py                       # CLI entry point
├── requirements.txt
└── data/sanctions.db            # SQLite database (auto-created)
```

---

## Data Sources

| Source | Type | Records | Method |
|--------|------|---------|--------|
| UN Consolidated Sanctions | XML | 1002 (730 individuals + 272 entities) | Direct XML download, no AI needed |
| RBI Standalone Circulars | HTML | 2 entities from 3 circulars | Scrape + Mistral Small extraction |

---

## Rate Limit Handling

The Mistral extractor ([mistral_extractor.py](file:///d:/scrapper/extraction/mistral_extractor.py)) handles API rate limits with:
- **Exponential backoff**: starts at 2s, doubles up to 60s max
- **5 retries** before failing
- **1s minimum delay** between requests
- Detects **429** (rate limit) and **529** (overloaded) errors
- Extracts `Retry-After` header when available

---

## CLI Usage

```bash
python run.py scrape --source un        # Scrape UN sanctions (fast, ~4s)
python run.py scrape --source rbi       # Scrape RBI circulars (slower, jitter delays)
python run.py scrape --source rbi --max 5  # Scrape first 5 circulars only
python run.py extract                   # Run AI extraction on new records
python run.py serve                     # Start screening API on port 8000
python run.py stats                     # Show DB stats
python run.py pipeline --source rbi --max 5  # Full pipeline
```

---

## Verification Results

### UN Scraper ✅
- 1002 entities parsed (730 individuals + 272 organizations)
- 0 errors, all with name variants and aliases stored

### RBI Scraper ✅
- 3 circulars fetched from live site with jitter delays
- Content hash diff detection working (1 duplicate skipped)
- 0 errors

### Mistral AI Extraction ✅
- 2 RBI records processed → 2 entities extracted
- Rate limit handling configured with exponential backoff
- Per-field confidence scores working

### Screening API ✅
- `GERMAIN KATANGA` matched correctly as ACTIVE sanction (CDi.006)
- Name-only cap at 0.74 working (prevents false positives)
- Screening time: **168ms** for 1 record against 1004 entities
- Full match breakdown returned for audit trail

### API Response Example
```json
{
  "input_record_id": "test_exact",
  "match_status": "MATCH",
  "match_score": 0.74,
  "sanction_status": "ACTIVE",
  "matched_entity": {
    "name": "GERMAIN KATANGA",
    "country": "Democratic Republic of the Congo",
    "circular_number": "CDi.006",
    "sanction_start": "2005-11-01",
    "publishing_body": "UNSC"
  },
  "match_breakdown": {
    "exact_id_hit": false,
    "fuzzy_name_score": 1.0,
    "dob_boost": false,
    "country_boost": false
  }
}
```








