-- FinPilot authenticated user data. Apply with the deployment migration step.
CREATE TABLE IF NOT EXISTS app_users (
    firebase_uid TEXT PRIMARY KEY,
    email TEXT,
    display_name TEXT,
    photo_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_app_users_email ON app_users(email);

CREATE TABLE IF NOT EXISTS user_preferences (
    firebase_uid TEXT PRIMARY KEY REFERENCES app_users(firebase_uid) ON DELETE CASCADE,
    preferences JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS cyro_chat_sessions (
    id VARCHAR(40) PRIMARY KEY,
    firebase_uid TEXT NOT NULL REFERENCES app_users(firebase_uid) ON DELETE CASCADE,
    title VARCHAR(200) NOT NULL DEFAULT 'New chat',
    focus JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_cyro_chat_sessions_uid_updated
    ON cyro_chat_sessions(firebase_uid, updated_at DESC);

CREATE TABLE IF NOT EXISTS cyro_chat_messages (
    id BIGSERIAL PRIMARY KEY,
    session_id VARCHAR(40) NOT NULL REFERENCES cyro_chat_sessions(id) ON DELETE CASCADE,
    firebase_uid TEXT NOT NULL REFERENCES app_users(firebase_uid) ON DELETE CASCADE,
    role VARCHAR(16) NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    kind VARCHAR(16) NOT NULL DEFAULT 'text',
    content TEXT NOT NULL DEFAULT '',
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    sequence INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_cyro_chat_messages_session_seq
    ON cyro_chat_messages(session_id, sequence, id);
CREATE INDEX IF NOT EXISTS idx_cyro_chat_messages_uid ON cyro_chat_messages(firebase_uid);

CREATE TABLE IF NOT EXISTS cyro_user_memory (
    firebase_uid TEXT NOT NULL REFERENCES app_users(firebase_uid) ON DELETE CASCADE,
    key VARCHAR(80) NOT NULL,
    value JSONB NOT NULL,
    source VARCHAR(20) NOT NULL DEFAULT 'chat',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (firebase_uid, key)
);

CREATE TABLE IF NOT EXISTS paper_accounts (
    firebase_uid TEXT PRIMARY KEY REFERENCES app_users(firebase_uid) ON DELETE CASCADE,
    virtual_balance NUMERIC(15, 2) NOT NULL DEFAULT 1000000.00,
    starting_balance NUMERIC(15, 2) NOT NULL DEFAULT 1000000.00,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS paper_positions (
    firebase_uid TEXT NOT NULL REFERENCES app_users(firebase_uid) ON DELETE CASCADE,
    ticker VARCHAR(32) NOT NULL,
    quantity BIGINT NOT NULL CHECK (quantity >= 0),
    average_buy_price NUMERIC(15, 2) NOT NULL CHECK (average_buy_price >= 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (firebase_uid, ticker)
);
CREATE INDEX IF NOT EXISTS idx_paper_positions_uid_qty
    ON paper_positions(firebase_uid) WHERE quantity > 0;
CREATE TABLE IF NOT EXISTS paper_trades (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    idempotency_key VARCHAR(128) NOT NULL,
    firebase_uid TEXT NOT NULL REFERENCES app_users(firebase_uid) ON DELETE CASCADE,
    ticker VARCHAR(32) NOT NULL,
    action VARCHAR(8) NOT NULL CHECK (action IN ('BUY', 'SELL')),
    quantity BIGINT NOT NULL CHECK (quantity > 0),
    execution_price NUMERIC(15, 2) NOT NULL CHECK (execution_price > 0),
    user_thesis TEXT,
    ai_feedback TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(firebase_uid, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_paper_trades_uid_date
    ON paper_trades(firebase_uid, created_at DESC);

CREATE TABLE IF NOT EXISTS user_alerts (
  id TEXT PRIMARY KEY,
  firebase_uid TEXT NOT NULL REFERENCES app_users(firebase_uid) ON DELETE CASCADE,
  stock TEXT NOT NULL,
  type TEXT NOT NULL,
  headline TEXT NOT NULL,
  source TEXT,
  timestamp TIMESTAMPTZ NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  url TEXT
);
CREATE INDEX IF NOT EXISTS idx_user_alerts_uid_timestamp
  ON user_alerts(firebase_uid, timestamp DESC);
