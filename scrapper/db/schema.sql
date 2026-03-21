-- Source registry
CREATE TABLE IF NOT EXISTS sources (
    source_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    format_type TEXT NOT NULL,
    publishing_body TEXT NOT NULL,
    active INTEGER DEFAULT 1,
    last_scraped_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

-- Raw scraped records (before AI extraction)
CREATE TABLE IF NOT EXISTS raw_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id TEXT NOT NULL,
    content_hash TEXT NOT NULL UNIQUE,
    circular_number TEXT,
    url TEXT,
    date_published TEXT,
    raw_text TEXT,
    is_processed INTEGER DEFAULT 0,
    scraped_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (source_id) REFERENCES sources(source_id)
);

-- Extracted entities (the 11-field canonical records)
CREATE TABLE IF NOT EXISTS entities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id TEXT NOT NULL,
    raw_record_id INTEGER,
    name TEXT,
    din TEXT,
    cin TEXT,
    pan TEXT,
    date_of_birth TEXT,
    country TEXT,
    circular_number TEXT,
    date_published TEXT,
    sanction_start TEXT,
    sanction_end TEXT,
    link TEXT,
    publishing_body TEXT NOT NULL,
    extraction_confidence REAL DEFAULT 0.0,
    sanction_status TEXT DEFAULT 'ACTIVE',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (source_id) REFERENCES sources(source_id),
    FOREIGN KEY (raw_record_id) REFERENCES raw_records(id)
);

-- Name variants for fuzzy matching
CREATE TABLE IF NOT EXISTS name_variants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_id INTEGER NOT NULL,
    variant TEXT NOT NULL,
    variant_type TEXT NOT NULL,
    FOREIGN KEY (entity_id) REFERENCES entities(id)
);

-- Scrape run audit log
CREATE TABLE IF NOT EXISTS scrape_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id TEXT NOT NULL,
    status TEXT NOT NULL,
    records_found INTEGER DEFAULT 0,
    records_new INTEGER DEFAULT 0,
    records_processed INTEGER DEFAULT 0,
    errors TEXT,
    started_at TEXT DEFAULT (datetime('now')),
    completed_at TEXT,
    FOREIGN KEY (source_id) REFERENCES sources(source_id)
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_entities_pan ON entities(pan);
CREATE INDEX IF NOT EXISTS idx_entities_din ON entities(din);
CREATE INDEX IF NOT EXISTS idx_entities_cin ON entities(cin);
CREATE INDEX IF NOT EXISTS idx_entities_name ON entities(name);
CREATE INDEX IF NOT EXISTS idx_name_variants_variant ON name_variants(variant);
CREATE INDEX IF NOT EXISTS idx_raw_records_hash ON raw_records(content_hash);
CREATE INDEX IF NOT EXISTS idx_entities_source ON entities(source_id);
