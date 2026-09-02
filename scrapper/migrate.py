import sqlite3
import os
import sys

db_path = os.path.join(os.path.dirname(__file__), "data", "sanctions.db")
old_db_path = os.path.join(os.path.dirname(__file__), "data", "sanctions_old.db")

if not os.path.exists(db_path):
    print("No database found.")
    sys.exit(0)

# 1. Rename to old
if os.path.exists(old_db_path):
    os.remove(old_db_path)
os.rename(db_path, old_db_path)

# 2. Init new schema
sys.path.insert(0, os.path.dirname(__file__))
from db.database import Database
db = Database() # creates sanctions.db and runs schema.sql

print("Created new schema.")

old_conn = sqlite3.connect(old_db_path)
old_conn.row_factory = sqlite3.Row

# 3. Copy Paper Trading Data
print("Copying users...")
for u in old_conn.execute("SELECT * FROM users").fetchall():
    db._get_conn().execute("INSERT INTO users (id, virtual_balance, created_at) VALUES (?, ?, ?)", (u['id'], u['virtual_balance'], u['created_at'])).connection.commit()

print("Copying positions...")
for p in old_conn.execute("SELECT * FROM positions").fetchall():
    db._get_conn().execute("INSERT INTO positions (id, user_id, ticker, quantity, average_buy_price, updated_at) VALUES (?, ?, ?, ?, ?, ?)", 
                           (p['id'], p['user_id'], p['ticker'], p['quantity'], p['average_buy_price'], p['updated_at'])).connection.commit()

print("Copying trade_journal...")
for j in old_conn.execute("SELECT * FROM trade_journal").fetchall():
    db._get_conn().execute("INSERT INTO trade_journal (id, user_id, ticker, action, execution_price, quantity, user_thesis, ai_feedback, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", 
                           (j['id'], j['user_id'], j['ticker'], j['action'], j['execution_price'], j['quantity'], j['user_thesis'], j['ai_feedback'], j['timestamp'])).connection.commit()

# 4. Copy RBI data only
print("Copying RBI Entities...")
# We must insert sources first
import json
with open(os.path.join(os.path.dirname(__file__), "config", "sources.json"), "r") as f:
    config = json.load(f)
    for source in config["sources"]:
        db.upsert_source(
            source_id=source["source_id"],
            source_name=source["name"],
            url=source["url"],
            source_type="OFFICIAL",
            regulator=source.get("regulator", "SEBI"),
            country="IN",
            priority=source.get("priority", 1),
            active=True
        )

# Fetch old RBI entities
old_rbi = old_conn.execute("SELECT * FROM entities WHERE source_id = 'rbi_standalone_circulars'").fetchall()
for e in old_rbi:
    # 1. Insert Entity
    ent_id = db.insert_entity(
        canonical_name=e['name'],
        entity_type="UNKNOWN",
        din=e['din'],
        cin=e['cin'],
        pan=e['pan']
    )
    
    # 2. Insert Action
    # Since old data lacked source_url, we will use a fallback or the generic RBI link
    fallback_link = e['link'] if e['link'] else "https://www.rbi.org.in"
    db.insert_regulatory_action(
        entity_id=ent_id,
        source_id='rbi_standalone_circulars',
        regulator='RBI',
        action_type='REGULATORY ACTION',
        status=e['sanction_status'] or 'ACTIVE',
        source_url=fallback_link,
        order_number=e['circular_number'],
        publication_date=e['date_published'],
        effective_date=e['sanction_start'],
        expiry_date=e['sanction_end']
    )

print("Migration completed successfully.")
old_conn.close()
