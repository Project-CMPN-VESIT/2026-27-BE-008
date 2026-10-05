"""Per-stock investor insight: all five scores with a why-this-score breakdown, plus similar stocks."""

from __future__ import annotations

from typing import Dict, List, Optional

from baskets.db import Fundamental, Holding, Rebalance, Score, Stock, session_scope
from baskets.definitions import BASKETS
from baskets.scoring import MODELS
from baskets.scoring.labels import PHILOSOPHY, band, breakdown


def stock_factors(session, symbol: str) -> Dict[str, object]:
    """Fundamental + price factors + market cap + financial flag, in the shape the scorers consume."""
    st = session.get(Stock, symbol)
    fund = session.get(Fundamental, symbol)
    f: Dict[str, object] = {**((fund.factors if fund else {}) or {}), **((fund.price_factors if fund else {}) or {})}
    if st is not None:
        if st.mcap_cr:
            f["mcap_cr"] = st.mcap_cr
        f["is_financial"] = st.sector == "Financial Services"
    return f


def _score_rows(session, symbol: str) -> Dict[str, Score]:
    return {r.model: r for r in session.query(Score).filter(Score.symbol == symbol).all()}


def _peers(session, st: Stock, limit: int = 3) -> List[dict]:
    """Same-sector universe stocks, same cap segment first, nearest market cap first."""
    if not st.sector:
        return []
    cands = session.query(Stock).filter(Stock.in_universe.is_(True), Stock.sector == st.sector,
                                        Stock.symbol != st.symbol).all()
    base = st.mcap_cr or 0.0
    cands.sort(key=lambda c: (c.cap_class != st.cap_class, abs((c.mcap_cr or 0.0) - base)))
    out = []
    for c in cands[:limit]:
        rows = _score_rows(session, c.symbol)
        out.append({"symbol": c.symbol, "name": c.name, "cap_class": c.cap_class, "price": c.last_price,
                    "scores": {m: (rows[m].score if m in rows else None) for m in MODELS}})
    return out


def stock_insight(symbol: str, with_peers: bool = True) -> Optional[dict]:
    """Everything the stock page needs. None if the symbol is not in the universe."""
    sym = symbol.strip().upper()
    with session_scope() as s:
        st = s.get(Stock, sym)
        if st is None:
            return None
        rows = _score_rows(s, sym)
        factors = stock_factors(s, sym)
        scores = []
        for m in MODELS.values():
            r = rows.get(m.id)
            scores.append({
                "model": m.id, "label": m.label, "investor": m.investor, "philosophy": PHILOSOPHY[m.id],
                "score": r.score if r else None, "band": band(r.score if r else None),
                "coverage": r.coverage if r else None,
                "tags_pos": (r.tags_pos if r else []) or [], "tags_neg": (r.tags_neg if r else []) or [],
                "breakdown": breakdown(m, factors) if factors else [],
            })
        in_baskets = []
        for d in BASKETS.values():
            last = s.query(Rebalance).filter(Rebalance.basket_id == d.id).order_by(Rebalance.as_of.desc()).first()
            if last and s.query(Holding).filter(Holding.rebalance_id == last.id, Holding.symbol == sym).first():
                in_baskets.append({"id": d.id, "name": d.name})
        best = max((x for x in scores if x["score"] is not None), key=lambda x: x["score"], default=None)
        return {
            "symbol": sym, "name": st.name, "sector": st.sector, "industry": st.industry, "cap_class": st.cap_class,
            "price": st.last_price, "mcap_cr": st.mcap_cr, "scores": scores, "in_baskets": in_baskets,
            "best_fit": {"model": best["model"], "label": best["label"], "score": best["score"]} if best else None,
            "peers": _peers(s, st) if with_peers else [],
            "factors": factors,
        }
