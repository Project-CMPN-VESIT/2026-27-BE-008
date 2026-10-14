"""PostgreSQL persistence for authenticated paper-trading accounts."""

from __future__ import annotations

import os
import logging
from decimal import Decimal
from typing import Optional

from psycopg2.extras import RealDictCursor
from psycopg2.pool import ThreadedConnectionPool

logger = logging.getLogger(__name__)


class Database:
    def __init__(self):
        self._pool: Optional[ThreadedConnectionPool] = None

    def _get_pool(self) -> ThreadedConnectionPool:
        if self._pool:
            return self._pool
        database_url = os.getenv("DATABASE_URL")
        if not database_url:
            raise RuntimeError("DATABASE_URL is required for paper trading")
        options = {"sslmode": os.environ["PGSSLMODE"]} if os.getenv("PGSSLMODE") else {}
        self._pool = ThreadedConnectionPool(1, 10, database_url, **options)
        return self._pool

    def _run(self, operation):
        pool = self._get_pool()
        conn = pool.getconn()
        try:
            with conn:
                with conn.cursor(cursor_factory=RealDictCursor) as cursor:
                    return operation(cursor)
        finally:
            pool.putconn(conn)

    def ensure_user(self, uid: str, email: str = None, name: str = None, picture: str = None) -> None:
        def operation(cur):
            cur.execute(
                """INSERT INTO app_users (firebase_uid, email, display_name, photo_url)
                   VALUES (%s, %s, %s, %s)
                   ON CONFLICT (firebase_uid) DO UPDATE SET
                     email = EXCLUDED.email,
                     display_name = COALESCE(app_users.display_name, EXCLUDED.display_name),
                     photo_url = COALESCE(app_users.photo_url, EXCLUDED.photo_url),
                     updated_at = CURRENT_TIMESTAMP""",
                (uid, email, name, picture),
            )
            cur.execute("INSERT INTO paper_accounts (firebase_uid) VALUES (%s) ON CONFLICT DO NOTHING", (uid,))
        self._run(operation)

    def get_or_create_user(self, uid: str) -> dict:
        def operation(cur):
            cur.execute("INSERT INTO paper_accounts (firebase_uid) VALUES (%s) ON CONFLICT DO NOTHING", (uid,))
            cur.execute("SELECT firebase_uid, virtual_balance FROM paper_accounts WHERE firebase_uid = %s", (uid,))
            return dict(cur.fetchone())
        return self._run(operation)

    def get_user_positions(self, uid: str) -> list:
        return self._run(lambda cur: (cur.execute(
            "SELECT ticker, quantity, average_buy_price, updated_at FROM paper_positions WHERE firebase_uid = %s AND quantity > 0 ORDER BY ticker",
            (uid,),
        ), [dict(r) for r in cur.fetchall()])[1])

    def get_trade_journal(self, uid: str) -> list:
        return self._run(lambda cur: (cur.execute(
            """SELECT id, ticker, action, execution_price, quantity, user_thesis, ai_feedback, created_at AS timestamp
               FROM paper_trades WHERE firebase_uid = %s ORDER BY created_at DESC""",
            (uid,),
        ), [dict(r) for r in cur.fetchall()])[1])

    def execute_trade(
        self, uid: str, ticker: str, action: str, quantity: int, price: float,
        thesis: str = "", ai_feedback: str = "", idempotency_key: str = "",
    ) -> dict:
        ticker = ticker.strip().upper()
        action = action.strip().upper()
        if not ticker or action not in {"BUY", "SELL"} or quantity <= 0 or Decimal(str(price)) <= 0:
            return {"success": False, "error": "Invalid trade details"}
        if not idempotency_key or len(idempotency_key) > 128:
            return {"success": False, "error": "A valid idempotency key is required"}

        def operation(cur):
            cur.execute(
                "SELECT id FROM paper_trades WHERE firebase_uid = %s AND idempotency_key = %s",
                (uid, idempotency_key),
            )
            existing = cur.fetchone()
            if existing:
                return {"success": True, "duplicate": True, "trade_id": str(existing["id"])}

            cur.execute(
                "INSERT INTO paper_accounts (firebase_uid) VALUES (%s) ON CONFLICT DO NOTHING", (uid,),
            )
            cur.execute("SELECT virtual_balance FROM paper_accounts WHERE firebase_uid = %s FOR UPDATE", (uid,))
            account = cur.fetchone()
            # Recheck after taking the account lock so concurrent retries return the first result.
            cur.execute(
                "SELECT id FROM paper_trades WHERE firebase_uid = %s AND idempotency_key = %s",
                (uid, idempotency_key),
            )
            existing = cur.fetchone()
            if existing:
                return {"success": True, "duplicate": True, "trade_id": str(existing["id"])}
            balance = Decimal(account["virtual_balance"])
            execution_price = Decimal(str(price))
            amount = execution_price * quantity

            cur.execute(
                "SELECT quantity, average_buy_price FROM paper_positions WHERE firebase_uid = %s AND ticker = %s FOR UPDATE",
                (uid, ticker),
            )
            position = cur.fetchone()
            old_quantity = int(position["quantity"]) if position else 0
            old_average = Decimal(position["average_buy_price"]) if position else Decimal("0")

            if action == "BUY":
                if balance < amount:
                    return {"success": False, "error": "Insufficient virtual balance"}
                new_quantity = old_quantity + quantity
                new_average = ((old_quantity * old_average) + amount) / new_quantity
                new_balance = balance - amount
                cur.execute(
                    """INSERT INTO paper_positions (firebase_uid, ticker, quantity, average_buy_price)
                       VALUES (%s, %s, %s, %s)
                       ON CONFLICT (firebase_uid, ticker) DO UPDATE SET
                         quantity = EXCLUDED.quantity, average_buy_price = EXCLUDED.average_buy_price,
                         updated_at = CURRENT_TIMESTAMP""",
                    (uid, ticker, new_quantity, new_average),
                )
            else:
                if old_quantity < quantity:
                    return {"success": False, "error": "Insufficient holdings to sell"}
                new_quantity = old_quantity - quantity
                new_balance = balance + amount
                cur.execute(
                    "UPDATE paper_positions SET quantity = %s, updated_at = CURRENT_TIMESTAMP WHERE firebase_uid = %s AND ticker = %s",
                    (new_quantity, uid, ticker),
                )

            cur.execute(
                "UPDATE paper_accounts SET virtual_balance = %s, updated_at = CURRENT_TIMESTAMP WHERE firebase_uid = %s",
                (new_balance, uid),
            )
            cur.execute(
                """INSERT INTO paper_trades
                   (firebase_uid, idempotency_key, ticker, action, quantity, execution_price, user_thesis, ai_feedback)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s) RETURNING id""",
                (uid, idempotency_key, ticker, action, quantity, execution_price, thesis, ai_feedback),
            )
            return {"success": True, "trade_id": str(cur.fetchone()["id"])}

        try:
            return self._run(operation)
        except Exception as exc:
            logger.exception("Paper trade transaction failed")
            return {"success": False, "error": "Trade could not be completed"}
