"""
DNS safety net for PostgreSQL connections.

Some home and campus routers refuse to resolve cloud database hosts (for example the managed PostgreSQL host in
DATABASE_URL), which makes every Python service fail with "could not translate host name ... Name or service not
known" while the same name resolves fine through a public resolver. The web app already falls back to public DNS;
this module does the same for psycopg2, and therefore for SQLAlchemy and every service that uses it.

How it works: `install()` wraps `psycopg2.connect`. Nothing changes while the normal lookup works. When a connection
fails only because the host name cannot be resolved, the name is looked up directly against 8.8.8.8 and 1.1.1.1 (a
plain UDP DNS query, no extra dependency) and the connection is retried with libpq's `hostaddr` parameter, which
supplies the IP address but keeps the original host name for TLS.
"""

from __future__ import annotations

import logging
import random
import socket
import struct
import time
from typing import Dict, Optional, Tuple

logger = logging.getLogger("pg_dns_fallback")

PUBLIC_RESOLVERS = ("8.8.8.8", "1.1.1.1")
_CACHE_TTL_S = 300
_cache: Dict[str, Tuple[float, str]] = {}
# hosts the system resolver is known to fail for: skip the doomed lookup (and its delay) on the next connections
_system_failed: Dict[str, float] = {}
_FAILED_TTL_S = 600


def _build_query(host: str) -> Tuple[int, bytes]:
    ident = random.randint(0, 0xFFFF)
    header = struct.pack(">HHHHHH", ident, 0x0100, 1, 0, 0, 0)            # recursion desired, one question
    qname = b"".join(bytes([len(p)]) + p.encode("ascii") for p in host.rstrip(".").split(".")) + b"\x00"
    return ident, header + qname + struct.pack(">HH", 1, 1)                # type A, class IN


def _skip_name(data: bytes, pos: int) -> int:
    while True:
        length = data[pos]
        if length == 0:
            return pos + 1
        if length & 0xC0 == 0xC0:                                          # compression pointer
            return pos + 2
        pos += 1 + length


def _parse_a_records(ident: int, data: bytes) -> list:
    if len(data) < 12 or struct.unpack(">H", data[:2])[0] != ident:
        return []
    _, flags, qd, an, _, _ = struct.unpack(">HHHHHH", data[:12])
    if flags & 0x000F:                                                      # non-zero response code
        return []
    pos = 12
    for _ in range(qd):
        pos = _skip_name(data, pos) + 4
    ips = []
    for _ in range(an):
        pos = _skip_name(data, pos)
        rtype, _, _, rdlen = struct.unpack(">HHIH", data[pos:pos + 10])
        pos += 10
        if rtype == 1 and rdlen == 4:
            ips.append(socket.inet_ntoa(data[pos:pos + 4]))
        pos += rdlen
    return ips


def resolve_with_public_dns(host: str, timeout: float = 2.5) -> Optional[str]:
    """First IPv4 address for `host` from a public resolver, or None."""
    cached = _cache.get(host)
    if cached and time.time() - cached[0] < _CACHE_TTL_S:
        return cached[1]
    for server in PUBLIC_RESOLVERS:
        try:
            ident, query = _build_query(host)
            with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
                sock.settimeout(timeout)
                sock.sendto(query, (server, 53))
                data, _ = sock.recvfrom(2048)
            ips = _parse_a_records(ident, data)
            if ips:
                _cache[host] = (time.time(), ips[0])
                return ips[0]
        except Exception as exc:                                            # noqa: BLE001
            logger.debug("public DNS %s failed for %s: %s", server, host, exc)
    return None


def _host_of(dsn, kwargs) -> Optional[str]:
    host = kwargs.get("host")
    if not host and isinstance(dsn, str) and dsn:
        try:
            from psycopg2.extensions import parse_dsn

            host = parse_dsn(dsn).get("host")
        except Exception:                                                   # noqa: BLE001
            host = None
    return host.split(",")[0] if host else None


def install() -> None:
    """Wrap psycopg2.connect once per process."""
    import psycopg2

    if getattr(psycopg2.connect, "_finpilot_dns_fallback", False):
        return
    original = psycopg2.connect

    def connect(dsn=None, *args, **kwargs):
        host = _host_of(dsn, kwargs)
        # Known-bad host: go straight to the public-DNS address instead of failing a system lookup on every connection.
        if host and "hostaddr" not in kwargs and time.time() - _system_failed.get(host, 0) < _FAILED_TTL_S:
            ip = resolve_with_public_dns(host)
            if ip:
                try:
                    return original(dsn, *args, hostaddr=ip, **kwargs)
                except psycopg2.OperationalError:
                    _system_failed.pop(host, None)      # the cached address went stale: start over with a normal attempt
        try:
            return original(dsn, *args, **kwargs)
        except psycopg2.OperationalError as exc:
            message = str(exc)
            unresolved = "could not translate host name" in message or "Name or service not known" in message
            if not unresolved or not host or "hostaddr" in kwargs:
                raise
            ip = resolve_with_public_dns(host)
            if not ip:
                raise
            if time.time() - _system_failed.get(host, 0) >= _FAILED_TTL_S:
                logger.warning("system DNS could not resolve %s; using public DNS result %s from now on", host, ip)
            _system_failed[host] = time.time()
            return original(dsn, *args, hostaddr=ip, **kwargs)

    connect._finpilot_dns_fallback = True  # type: ignore[attr-defined]
    psycopg2.connect = connect
