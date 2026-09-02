import sqlite3
import json
conn = sqlite3.connect('scrapper/data/sanctions.db')
conn.row_factory = sqlite3.Row
rows = conn.execute("SELECT raw_text, published_at FROM documents WHERE source_id='nse_circulars' LIMIT 2").fetchall()
print(json.dumps([dict(row) for row in rows], indent=2))
