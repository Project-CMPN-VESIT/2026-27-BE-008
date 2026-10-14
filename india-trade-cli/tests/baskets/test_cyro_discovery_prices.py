from cyro_chat.tools import discover
from baskets.db import Price, session_scope


def test_discovery_includes_latest_stored_close_and_date(seeded):
    result = discover(cap="large", limit=1)

    assert result["ok"] is True
    row = result["data"][0]
    with session_scope() as session:
        latest = (
            session.query(Price.close, Price.date)
            .filter(Price.symbol == row["symbol"])
            .order_by(Price.date.desc())
            .first()
        )

    assert latest is not None
    assert row["price"] == latest.close
    assert row["price_as_of"] == latest.date.isoformat()
    assert any(source["type"] == "Historical price data" for source in result["sources"])
