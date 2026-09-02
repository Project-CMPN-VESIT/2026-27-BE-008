-- Source registry
CREATE TABLE IF NOT EXISTS sources (
    source_id TEXT PRIMARY KEY,
    source_name TEXT NOT NULL,
    regulator TEXT,
    country TEXT,
    source_type TEXT,
    source_url TEXT NOT NULL,
    is_primary INTEGER DEFAULT 0,
    priority INTEGER DEFAULT 1,
    active INTEGER DEFAULT 1,
    last_successful_sync TEXT,
    last_attempted_sync TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

-- Documents fetched
CREATE TABLE IF NOT EXISTS documents (
    document_id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id TEXT NOT NULL,
    source_url TEXT,
    document_url TEXT,
    content_hash TEXT NOT NULL UNIQUE,
    published_at TEXT,
    fetched_at TEXT DEFAULT (datetime('now')),
    raw_text TEXT,
    parse_status TEXT DEFAULT 'PENDING',
    FOREIGN KEY (source_id) REFERENCES sources(source_id)
);

-- Entities
CREATE TABLE IF NOT EXISTS entities (
    entity_id INTEGER PRIMARY KEY AUTOINCREMENT,
    canonical_name TEXT,
    entity_type TEXT,
    pan TEXT,
    din TEXT,
    cin TEXT,
    normalized_name TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

-- Entity Identifiers (Extracted explicitly)
CREATE TABLE IF NOT EXISTS entity_identifiers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_id INTEGER NOT NULL,
    identifier_type TEXT NOT NULL, -- PAN, DIN, CIN, SEBI_ID, etc
    identifier_value TEXT NOT NULL,
    source TEXT,
    confidence REAL,
    FOREIGN KEY (entity_id) REFERENCES entities(entity_id)
);

-- Regulatory Actions
CREATE TABLE IF NOT EXISTS regulatory_actions (
    action_id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_id INTEGER NOT NULL,
    source_id TEXT NOT NULL,
    document_id INTEGER,
    regulator TEXT NOT NULL,
    action_type TEXT NOT NULL,
    original_action_type TEXT,
    status TEXT NOT NULL, -- ACTIVE, EXPIRED, REVOKED, STAYED, MODIFIED, HISTORICAL, UNKNOWN
    order_number TEXT,
    order_date TEXT,
    effective_date TEXT,
    expiry_date TEXT,
    publication_date TEXT,
    description TEXT,
    confidence REAL DEFAULT 0.0,
    source_url TEXT NOT NULL,
    last_verified_at TEXT DEFAULT (datetime('now')),
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (entity_id) REFERENCES entities(entity_id),
    FOREIGN KEY (source_id) REFERENCES sources(source_id),
    FOREIGN KEY (document_id) REFERENCES documents(document_id)
);

-- Name variants for fuzzy matching
CREATE TABLE IF NOT EXISTS name_variants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_id INTEGER NOT NULL,
    variant TEXT NOT NULL,
    variant_type TEXT NOT NULL,
    FOREIGN KEY (entity_id) REFERENCES entities(entity_id)
);

-- Scrape run audit log
CREATE TABLE IF NOT EXISTS sync_runs (
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
CREATE INDEX IF NOT EXISTS idx_entities_name ON entities(canonical_name);
CREATE INDEX IF NOT EXISTS idx_name_variants_variant ON name_variants(variant);
CREATE INDEX IF NOT EXISTS idx_documents_hash ON documents(content_hash);
CREATE INDEX IF NOT EXISTS idx_reg_actions_entity ON regulatory_actions(entity_id);

-- Paper Trading: Users
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    virtual_balance REAL DEFAULT 1000000.0,
    created_at TEXT DEFAULT (datetime('now'))
);

-- Paper Trading: Positions
CREATE TABLE IF NOT EXISTS positions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    ticker TEXT NOT NULL,
    quantity INTEGER DEFAULT 0,
    average_buy_price REAL DEFAULT 0.0,
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id),
    UNIQUE(user_id, ticker)
);

-- Paper Trading: Trade Journal
CREATE TABLE IF NOT EXISTS trade_journal (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    ticker TEXT NOT NULL,
    action TEXT NOT NULL,
    execution_price REAL NOT NULL,
    quantity INTEGER NOT NULL,
    user_thesis TEXT,
    ai_feedback TEXT,
    timestamp TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
);
