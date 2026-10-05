"""SQLAlchemy models + helpers for the baskets engine."""

from __future__ import annotations

import datetime as dt
import logging
from contextlib import contextmanager
from typing import Iterable, Iterator, Sequence

from sqlalchemy import (JSON, Boolean, Column, Date, DateTime, Float, ForeignKey, Integer, String,
                        UniqueConstraint, create_engine)
from sqlalchemy.orm import Session, declarative_base, sessionmaker

from baskets.config import DATABASE_URL

logger = logging.getLogger(__name__)
Base = declarative_base()

_connect_args = {"check_same_thread": False, "timeout": 30} if DATABASE_URL.startswith("sqlite") else {}
engine = create_engine(DATABASE_URL, connect_args=_connect_args, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)


def utcnow() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc).replace(tzinfo=None)


class Stock(Base):
    """One row per symbol in the universe (Nifty 100 + Midcap 150 + Smallcap 250)."""
    __tablename__ = "stocks"
    symbol = Column(String(40), primary_key=True)
    name = Column(String(255))
    sector = Column(String(120))
    industry = Column(String(160))
    cap_class = Column(String(8), index=True)        # large | mid | small
    mcap_cr = Column(Float)
    last_price = Column(Float)
    year_high = Column(Float)
    year_low = Column(Float)
    in_universe = Column(Boolean, default=True, index=True)
    updated_at = Column(DateTime, default=utcnow)


class Price(Base):
    """Daily close + volume. Also holds the benchmark index under BENCHMARK_SYMBOL."""
    __tablename__ = "prices"
    symbol = Column(String(40), primary_key=True)
    date = Column(Date, primary_key=True)
    close = Column(Float, nullable=False)
    volume = Column(Float)


class Fundamental(Base):
    """Latest computed fundamental factors per symbol (JSON, so factors can evolve without migrations)."""
    __tablename__ = "fundamentals"
    symbol = Column(String(40), primary_key=True)
    factors = Column(JSON, nullable=False)
    price_factors = Column(JSON)                      # momentum / trend / liquidity, refreshed with every scoring pass
    fetched_at = Column(DateTime, default=utcnow, index=True)
    ok = Column(Boolean, default=True)


class Score(Base):
    """Legend score per (symbol, model)."""
    __tablename__ = "scores"
    symbol = Column(String(40), primary_key=True)
    model = Column(String(24), primary_key=True)
    score = Column(Float)
    coverage = Column(Float)
    tags_pos = Column(JSON)
    tags_neg = Column(JSON)
    as_of = Column(DateTime, default=utcnow)


class Rebalance(Base):
    """A dated snapshot of a basket's holdings (the basket's live history is the chain of these)."""
    __tablename__ = "rebalances"
    id = Column(Integer, primary_key=True, autoincrement=True)
    basket_id = Column(String(60), index=True, nullable=False)
    as_of = Column(Date, nullable=False)
    created_at = Column(DateTime, default=utcnow)
    __table_args__ = (UniqueConstraint("basket_id", "as_of", name="uq_rebalance_basket_date"),)


class Holding(Base):
    __tablename__ = "holdings"
    id = Column(Integer, primary_key=True, autoincrement=True)
    rebalance_id = Column(Integer, ForeignKey("rebalances.id", ondelete="CASCADE"), index=True, nullable=False)
    symbol = Column(String(40), nullable=False)
    weight = Column(Float, nullable=False)           # 0..1
    score = Column(Float)
    entry_price = Column(Float)


class JobState(Base):
    __tablename__ = "job_state"
    key = Column(String(40), primary_key=True)
    value = Column(JSON)
    updated_at = Column(DateTime, default=utcnow)


def init_db() -> None:
    Base.metadata.create_all(engine)


@contextmanager
def session_scope() -> Iterator[Session]:
    s = SessionLocal()
    try:
        yield s
        s.commit()
    except Exception:
        s.rollback()
        raise
    finally:
        s.close()


def bulk_upsert(session: Session, model, rows: Sequence[dict], key_cols: Iterable[str], chunk: int = 5000) -> None:
    """Dialect-aware upsert (SQLite / Postgres)."""
    if not rows:
        return
    key_cols = list(key_cols)
    dialect = session.bind.dialect.name
    if dialect == "sqlite":
        from sqlalchemy.dialects.sqlite import insert
    elif dialect == "postgresql":
        from sqlalchemy.dialects.postgresql import insert
    else:  # generic fallback
        for r in rows:
            session.merge(model(**r))
        return
    for i in range(0, len(rows), chunk):
        part = rows[i:i + chunk]
        stmt = insert(model.__table__).values(part)
        update_cols = {c: stmt.excluded[c] for c in part[0] if c not in key_cols}
        stmt = stmt.on_conflict_do_update(index_elements=key_cols, set_=update_cols) if update_cols \
            else stmt.on_conflict_do_nothing(index_elements=key_cols)
        session.execute(stmt)
