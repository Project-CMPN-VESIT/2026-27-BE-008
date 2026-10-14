import time

from web.cyro_engine.adapters.base import SourceAdapter


class EmptyPrimaryAdapter(SourceAdapter):
    def _fetch_primary(self, symbol, **kwargs):
        return []

    def _fetch_fallback(self, symbol, **kwargs):
        return [{"value": 1}], "Secondary API", "HIGH"


def test_empty_primary_runs_fallback_and_preserves_fallback_quality():
    result = EmptyPrimaryAdapter("Primary API", "PRIMARY", timeout=1).fetch("TCS")
    assert result.fallback_used
    assert result.source_name == "Secondary API"
    assert result.source_quality == "HIGH"
    assert result.primary_error == "Primary source returned no data"
    assert result.list_data == [{"value": 1}]


class EmptyEverywhereAdapter(SourceAdapter):
    def _fetch_primary(self, symbol, **kwargs):
        return []

    def _fetch_fallback(self, symbol, **kwargs):
        return [], "RSS", "FALLBACK"


def test_empty_fallback_is_distinguished_from_provider_failure():
    result = EmptyEverywhereAdapter("News", "SECONDARY", timeout=1).fetch("TCS")
    assert result.fallback_used
    assert result.error is None
    assert result.freshness == "empty"
    assert result.source_quality == "FALLBACK"


class SlowPrimaryAdapter(SourceAdapter):
    def _fetch_primary(self, symbol, **kwargs):
        time.sleep(0.5)
        return {"late": True}

    def _fetch_fallback(self, symbol, **kwargs):
        return {"available": True}, "Fallback", "FALLBACK"


def test_provider_wait_is_bounded_by_adapter_timeout():
    started = time.monotonic()
    result = SlowPrimaryAdapter("Slow", "PRIMARY", timeout=0.02).fetch("TCS")
    elapsed = time.monotonic() - started
    assert elapsed < 0.4
    assert result.fallback_used
    assert result.source_name == "Fallback"
    assert "exceeded 0.02s timeout" in result.primary_error
