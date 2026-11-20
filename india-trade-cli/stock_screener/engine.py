"""
Screener engine: loads the universe once, applies a list of AND-ed conditions and explains every match.

A stock that has no value for a field used in a condition never matches that condition (missing data is not a
pass). Results report the actual value next to each threshold so a user can see why a stock qualified.
"""

from __future__ import annotations

import math
import statistics
import threading
import time
from typing import Any, Dict, List, Optional, Sequence

from stock_screener.fields import BOOL_OPS, CAT_OPS, DEFAULT_COLUMNS, FIELDS, MAX_CONDITIONS, NUM_OPS
from stock_screener.presets import PRESETS

_CACHE: Dict[str, Any] = {"at": 0.0, "rows": None, "as_of": None}
_LOCK = threading.Lock()
_TTL = 120.0


def _num(v: Any) -> Optional[float]:
    if isinstance(v, bool) or v is None:
        return None
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    return None if (math.isnan(x) or math.isinf(x)) else x


def build_rows(stocks: Sequence[Any], factors: Dict[str, Dict[str, Any]], price_factors: Dict[str, Dict[str, Any]]) -> List[dict]:
    """Flatten stocks + factor JSON into one record per stock."""
    rows = []
    for s in stocks:
        f, p = factors.get(s.symbol) or {}, price_factors.get(s.symbol) or {}
        row: Dict[str, Any] = {"symbol": s.symbol, "name": s.name or s.symbol}
        for key, fld in FIELDS.items():
            if fld.src == "stock":
                v = getattr(s, fld.source_key, None)
                row[key] = v if v else None
            else:
                raw = (f if fld.src == "f" else p).get(fld.source_key)
                if fld.kind == "bool":
                    row[key] = raw if isinstance(raw, bool) else None
                else:
                    row[key] = _num(raw)
        if row.get("price") is None:
            row["price"] = _num(getattr(s, "last_price", None))
        if row.get("mcap_cr") is None:
            row["mcap_cr"] = _num(getattr(s, "mcap_cr", None))
        row["industry"] = getattr(s, "industry", None)
        rows.append(row)
    return rows


def load_universe(force: bool = False) -> List[dict]:
    """The Nifty 500 records, cached for a couple of minutes (the pipeline refreshes once a day)."""
    now = time.time()
    with _LOCK:
        if not force and _CACHE["rows"] is not None and now - _CACHE["at"] < _TTL:
            return _CACHE["rows"]
    from baskets.db import Fundamental, Stock, session_scope
    with session_scope() as s:
        stocks = s.query(Stock).filter(Stock.in_universe.is_(True)).all()
        funds = {f.symbol: f for f in s.query(Fundamental).all()}
        rows = build_rows(stocks, {k: v.factors for k, v in funds.items()}, {k: v.price_factors for k, v in funds.items()})
        stamps = [v.fetched_at for v in funds.values() if v.fetched_at]
    rows.sort(key=lambda r: -(r.get("mcap_cr") or 0))
    with _LOCK:
        _CACHE.update(at=now, rows=rows, as_of=max(stamps).isoformat() if stamps else None)
    return rows


def data_as_of() -> Optional[str]:
    return _CACHE.get("as_of")


# ----------------------------------------------------------------------------------------- conditions
def validate(conditions: Sequence[dict]) -> List[dict]:
    if len(conditions) > MAX_CONDITIONS:
        raise ValueError(f"at most {MAX_CONDITIONS} conditions are allowed")
    out = []
    for c in conditions:
        key, op, val = c.get("field"), c.get("op"), c.get("value")
        fld = FIELDS.get(key)
        if fld is None:
            raise ValueError(f"unknown field '{key}'")
        allowed = {"num": NUM_OPS, "cat": CAT_OPS, "bool": BOOL_OPS}[fld.kind]
        if op not in allowed:
            raise ValueError(f"operator '{op}' is not valid for {fld.label}")
        if fld.kind == "num":
            if op == "between":
                if not (isinstance(val, (list, tuple)) and len(val) == 2 and all(_num(x) is not None for x in val)):
                    raise ValueError(f"{fld.label}: 'between' needs two numbers")
                lo, hi = sorted(float(x) for x in val)
                val = [lo, hi]
            else:
                if _num(val) is None:
                    raise ValueError(f"{fld.label}: value must be a number")
                val = float(val)
        elif fld.kind == "bool":
            if not isinstance(val, bool):
                raise ValueError(f"{fld.label}: value must be true or false")
        else:
            if op == "in":
                if not isinstance(val, (list, tuple)):
                    raise ValueError(f"{fld.label}: 'in' needs a list")
                val = [str(x) for x in val]
            else:
                val = str(val)
        out.append({"field": key, "op": op, "value": val})
    return out


def _test(actual: Any, op: str, val: Any, kind: str) -> bool:
    if actual is None:
        return False
    if kind == "cat":
        return (actual in val) if op == "in" else ((actual == val) if op == "==" else (actual != val))
    if kind == "bool":
        return actual == val
    if op == "between":
        return val[0] <= actual <= val[1]
    return {">": actual > val, ">=": actual >= val, "<": actual < val, "<=": actual <= val,
            "==": actual == val, "!=": actual != val}[op]


def describe(c: dict) -> str:
    fld = FIELDS[c["field"]]
    v = c["value"]
    unit = f" {fld.unit}" if fld.unit else ""
    if c["op"] == "between":
        return f"{fld.label} between {v[0]:g} and {v[1]:g}{unit}"
    if isinstance(v, list):
        return f"{fld.label} in {', '.join(v)}"
    if isinstance(v, bool):
        return f"{fld.label}: {'yes' if v else 'no'}"
    if isinstance(v, str):
        return f"{fld.label} {c['op']} {v}"
    return f"{fld.label} {c['op']} {v:g}{unit}"


def screen(rows: Sequence[dict], conditions: Sequence[dict], search: str = "", sort_by: str = "mcap_cr",
           sort_desc: bool = True, limit: int = 100, offset: int = 0, symbols: Optional[Sequence[str]] = None) -> dict:
    conds = validate(conditions)
    if sort_by not in FIELDS and sort_by not in ("symbol", "name"):
        raise ValueError(f"cannot sort by '{sort_by}'")
    q = (search or "").strip().lower()
    wanted = {s.upper() for s in symbols} if symbols else None
    matched = []
    for r in rows:
        if wanted is not None and r["symbol"].upper() not in wanted:
            continue
        if q and q not in r["symbol"].lower() and q not in (r["name"] or "").lower():
            continue
        if all(_test(r.get(c["field"]), c["op"], c["value"], FIELDS[c["field"]].kind) for c in conds):
            matched.append(r)

    if sort_by in ("symbol", "name"):
        matched.sort(key=lambda r: (r[sort_by] or "").lower(), reverse=sort_desc)
    else:
        present = [r for r in matched if r.get(sort_by) is not None]
        absent = [r for r in matched if r.get(sort_by) is None]       # missing values always last
        present.sort(key=lambda r: r[sort_by], reverse=sort_desc)
        matched = present + absent

    page = matched[offset: offset + limit]
    results = []
    for r in page:
        results.append({
            "symbol": r["symbol"], "name": r["name"], "sector": r.get("sector"), "cap_class": r.get("cap_class"),
            "metrics": {k: r.get(k) for k, f in FIELDS.items() if f.kind != "cat"},
            "why": [{"text": describe(c), "field": c["field"], "actual": r.get(c["field"])} for c in conds],
        })
    return {"total_universe": len(rows), "matched": len(matched), "returned": len(results),
            "conditions": conds, "results": results, "summary": summarise(matched)}


def summarise(matched: Sequence[dict]) -> dict:
    def med(k: str):
        v = [r[k] for r in matched if isinstance(r.get(k), (int, float)) and not isinstance(r.get(k), bool)]
        return round(statistics.median(v), 2) if v else None

    sectors: Dict[str, int] = {}
    caps: Dict[str, int] = {}
    for r in matched:
        if r.get("sector"):
            sectors[r["sector"]] = sectors.get(r["sector"], 0) + 1
        if r.get("cap_class"):
            caps[r["cap_class"]] = caps.get(r["cap_class"], 0) + 1
    return {"median": {k: med(k) for k in ("pe", "roe", "div_yield", "profit_cagr", "ret_12m")},
            "sectors": sorted(({"sector": k, "count": v} for k, v in sectors.items()), key=lambda x: -x["count"])[:8],
            "caps": caps}


def meta(rows: Sequence[dict]) -> dict:
    sectors = sorted({r["sector"] for r in rows if r.get("sector")})
    groups: Dict[str, list] = {}
    for f in FIELDS.values():
        groups.setdefault(f.group, []).append({"key": f.key, "label": f.label, "unit": f.unit, "kind": f.kind, "hint": f.hint})
    presets = [{**p, "matches": (screen(rows, p["conditions"], limit=1)["matched"] if rows else 0)} for p in PRESETS]
    return {"universe": len(rows), "as_of": data_as_of(), "sectors": sectors, "caps": ["large", "mid", "small"],
            "groups": [{"group": g, "fields": fs} for g, fs in groups.items()], "default_columns": DEFAULT_COLUMNS,
            "presets": presets,
            "note": "Presets are FinPilot's own rules, inspired by the kinds of screens NSE describes for Market Lens; "
                    "thresholds differ. Screens are research aids, not investment recommendations."}
