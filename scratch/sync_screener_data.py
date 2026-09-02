import os
import sys
import sqlite3
import psycopg2
from dotenv import load_dotenv

load_dotenv()
pg_url = os.getenv("DATABASE_URL")
sqlite_path = os.path.abspath("scrapper/data/screener.db")

print(f"Connecting to SQLite: {sqlite_path}")
conn_sqlite = sqlite3.connect(sqlite_path)
conn_sqlite.row_factory = sqlite3.Row

print(f"Connecting to Postgres: {pg_url[:45]}...")
conn_pg = psycopg2.connect(pg_url)
cur_pg = conn_pg.cursor()

# Ensure tables exist
cur_pg.execute("""
CREATE TABLE IF NOT EXISTS companies (
    symbol VARCHAR(50) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    sector VARCHAR(100),
    industry VARCHAR(100),
    data_quality_score INTEGER DEFAULT 100,
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
""")

cur_pg.execute("""
CREATE TABLE IF NOT EXISTS derived_metrics (
    symbol VARCHAR(50) PRIMARY KEY REFERENCES companies(symbol),
    market_cap DOUBLE PRECISION,
    pe_ttm DOUBLE PRECISION,
    pb DOUBLE PRECISION,
    roe DOUBLE PRECISION,
    roce DOUBLE PRECISION,
    debt_equity DOUBLE PRECISION,
    dividend_yield DOUBLE PRECISION,
    sales_growth_5y DOUBLE PRECISION,
    profit_growth_5y DOUBLE PRECISION,
    current_price DOUBLE PRECISION,
    high_52w DOUBLE PRECISION,
    low_52w DOUBLE PRECISION,
    last_updated TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
""")
conn_pg.commit()

companies = [dict(r) for r in conn_sqlite.execute("SELECT * FROM companies").fetchall()]
derived = [dict(r) for r in conn_sqlite.execute("SELECT * FROM derived_metrics").fetchall()]

print(f"Syncing {len(companies)} companies and {len(derived)} metrics...")

for c in companies:
    cur_pg.execute("""
        INSERT INTO companies (symbol, name, sector, industry, data_quality_score)
        VALUES (%s, %s, %s, %s, %s)
        ON CONFLICT (symbol) DO UPDATE SET
            name = EXCLUDED.name,
            data_quality_score = EXCLUDED.data_quality_score;
    """, (c["symbol"], c["name"], c.get("sector"), c.get("industry"), c.get("data_quality_score", 100)))

for d in derived:
    cur_pg.execute("""
        INSERT INTO derived_metrics (
            symbol, market_cap, pe_ttm, pb, roe, roce, debt_equity, dividend_yield,
            sales_growth_5y, profit_growth_5y, current_price, high_52w, low_52w
        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (symbol) DO UPDATE SET
            market_cap = EXCLUDED.market_cap,
            pe_ttm = EXCLUDED.pe_ttm,
            pb = EXCLUDED.pb,
            roe = EXCLUDED.roe,
            roce = EXCLUDED.roce,
            debt_equity = EXCLUDED.debt_equity,
            dividend_yield = EXCLUDED.dividend_yield,
            sales_growth_5y = EXCLUDED.sales_growth_5y,
            profit_growth_5y = EXCLUDED.profit_growth_5y,
            current_price = EXCLUDED.current_price,
            high_52w = EXCLUDED.high_52w,
            low_52w = EXCLUDED.low_52w,
            last_updated = CURRENT_TIMESTAMP;
    """, (
        d["symbol"], d.get("market_cap"), d.get("pe_ttm"), d.get("pb"),
        d.get("roe"), d.get("roce"), d.get("debt_equity"), d.get("dividend_yield"),
        d.get("sales_growth_5y"), d.get("profit_growth_5y"), d.get("current_price"),
        d.get("high_52w"), d.get("low_52w")
    ))

conn_pg.commit()
print("Sync complete successfully!")

cur_pg.execute("SELECT count(*) FROM derived_metrics;")
print(f"Total rows in PostgreSQL derived_metrics: {cur_pg.fetchone()[0]}")
cur_pg.close()
conn_pg.close()
conn_sqlite.close()
