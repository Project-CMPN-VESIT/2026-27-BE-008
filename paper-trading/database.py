import os
import sqlite3
import logging

logger = logging.getLogger(__name__)

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "paper_trading.db")

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    virtual_balance REAL DEFAULT 1000000.0,
    created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS positions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,
    ticker TEXT,
    quantity INTEGER,
    average_buy_price REAL,
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(user_id, ticker)
);
CREATE TABLE IF NOT EXISTS trade_journal (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,
    ticker TEXT,
    action TEXT,
    execution_price REAL,
    quantity INTEGER,
    user_thesis TEXT,
    ai_feedback TEXT,
    timestamp TEXT DEFAULT (datetime('now'))
);
"""

class Database:
    def __init__(self):
        self._init_schema()

    def _get_conn(self):
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_schema(self):
        with self._get_conn() as conn:
            conn.executescript(SCHEMA)

    def get_or_create_user(self, user_id: str) -> dict:
        with self._get_conn() as conn:
            user = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
            if not user:
                conn.execute("INSERT INTO users (id) VALUES (?)", (user_id,))
                user = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
            return dict(user)

    def get_user_positions(self, user_id: str) -> list:
        with self._get_conn() as conn:
            rows = conn.execute("SELECT * FROM positions WHERE user_id = ? AND quantity > 0", (user_id,)).fetchall()
            return [dict(r) for r in rows]

    def get_trade_journal(self, user_id: str) -> list:
        with self._get_conn() as conn:
            rows = conn.execute("SELECT * FROM trade_journal WHERE user_id = ? ORDER BY timestamp DESC", (user_id,)).fetchall()
            return [dict(r) for r in rows]

    def execute_trade(self, user_id: str, ticker: str, action: str, quantity: int, price: float, thesis: str, ai_feedback: str) -> dict:
        with self._get_conn() as conn:
            try:
                user = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
                if not user:
                    conn.execute("INSERT INTO users (id) VALUES (?)", (user_id,))
                    user = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
                
                balance = user["virtual_balance"]
                cost = quantity * price

                pos = conn.execute("SELECT * FROM positions WHERE user_id = ? AND ticker = ?", (user_id, ticker)).fetchone()

                if action == "BUY":
                    if balance < cost:
                        return {"success": False, "error": "Insufficient virtual balance"}
                    
                    new_balance = balance - cost
                    conn.execute("UPDATE users SET virtual_balance = ? WHERE id = ?", (new_balance, user_id))

                    if pos:
                        old_qty = pos["quantity"]
                        old_avg = pos["average_buy_price"]
                        new_qty = old_qty + quantity
                        new_avg = ((old_qty * old_avg) + cost) / new_qty
                        conn.execute("UPDATE positions SET quantity = ?, average_buy_price = ? WHERE id = ?", (new_qty, new_avg, pos["id"]))
                    else:
                        conn.execute("INSERT INTO positions (user_id, ticker, quantity, average_buy_price) VALUES (?, ?, ?, ?)", (user_id, ticker, quantity, price))
                
                elif action == "SELL":
                    if not pos or pos["quantity"] < quantity:
                        return {"success": False, "error": "Insufficient holdings to sell"}
                    
                    new_balance = balance + cost
                    conn.execute("UPDATE users SET virtual_balance = ? WHERE id = ?", (new_balance, user_id))
                    
                    new_qty = pos["quantity"] - quantity
                    conn.execute("UPDATE positions SET quantity = ? WHERE id = ?", (new_qty, pos["id"]))

                conn.execute(
                    "INSERT INTO trade_journal (user_id, ticker, action, execution_price, quantity, user_thesis, ai_feedback) VALUES (?, ?, ?, ?, ?, ?, ?)",
                    (user_id, ticker, action, price, quantity, thesis, ai_feedback)
                )
                
                return {"success": True}
            except Exception as e:
                conn.rollback()
                return {"success": False, "error": str(e)}
