"""Offline tests for the PostgreSQL public-DNS fallback (no network: the DNS reply is built by hand)."""

import socket
import struct
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

import pg_dns_fallback as f  # noqa: E402


def reply(ident, answers, rcode=0):
    header = struct.pack(">HHHHHH", ident, 0x8180 | rcode, 1, len(answers), 0, 0)
    question = b"\x03db1\x04test\x00" + struct.pack(">HH", 1, 1)
    body = b""
    for rtype, rdata in answers:
        body += b"\xc0\x0c" + struct.pack(">HHIH", rtype, 1, 60, len(rdata)) + rdata   # name = pointer to the question
    return header + question + body


def test_query_has_the_right_shape():
    ident, q = f._build_query("db1.test")
    assert struct.unpack(">H", q[:2])[0] == ident and q.endswith(struct.pack(">HH", 1, 1))
    assert b"\x03db1\x04test\x00" in q


def test_a_record_is_extracted_even_behind_a_cname():
    cname = b"\x05other\x04test\x00"
    data = reply(7, [(5, cname), (1, socket.inet_aton("52.14.39.200"))])
    assert f._parse_a_records(7, data) == ["52.14.39.200"]


def test_wrong_id_or_error_code_is_ignored():
    assert f._parse_a_records(8, reply(7, [(1, socket.inet_aton("1.2.3.4"))])) == []
    assert f._parse_a_records(7, reply(7, [], rcode=3)) == []


def test_connect_retries_with_hostaddr_only_for_resolution_errors(monkeypatch):
    import psycopg2

    calls = []

    def fake_connect(dsn=None, *a, **kw):
        calls.append(kw)
        if "hostaddr" not in kw:
            raise psycopg2.OperationalError('could not translate host name "db1.test" to address')
        return "connected"

    monkeypatch.setattr(psycopg2, "connect", fake_connect)
    monkeypatch.setattr(f, "resolve_with_public_dns", lambda host: "9.9.9.9")
    f.install()
    assert psycopg2.connect("postgresql://u:p@db1.test/x") == "connected"
    assert calls[-1]["hostaddr"] == "9.9.9.9"

    def refused(dsn=None, *a, **kw):
        raise psycopg2.OperationalError("password authentication failed")

    monkeypatch.setattr(f, "install", lambda: None)
    wrapped = psycopg2.connect
    # an unrelated failure must propagate untouched
    monkeypatch.setattr(psycopg2, "connect", refused)
    with pytest.raises(psycopg2.OperationalError, match="password"):
        psycopg2.connect("postgresql://u:p@db1.test/x")
    assert wrapped is not refused
