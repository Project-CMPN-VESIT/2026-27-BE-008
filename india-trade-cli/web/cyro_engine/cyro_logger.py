"""
web/cyro_engine/cyro_logger.py
────────────────────────────────
CYRO Structured Log System.

Emits machine-readable NDJSON to logs/cyro.ndjson and
human-readable lines to the CYRO_LOG named logger.

SECURITY:
  - Never logs API keys or Authorization headers
  - Summarizes evidence (count only, no raw data)
  - Summarizes context (byte count, item count only)
"""

from __future__ import annotations

import json
import logging
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

# ── File setup ───────────────────────────────────────────────────────────────

_LOG_DIR = Path(__file__).parent.parent.parent.parent / "logs"
_LOG_FILE = _LOG_DIR / "cyro.ndjson"
_file_handler_installed = False
_file_lock = __import__("threading").Lock()

CYRO_LOGGER_NAME = "cyro.structured"
_cyro_log = logging.getLogger(CYRO_LOGGER_NAME)


def _ensure_log_dir():
    global _file_handler_installed
    if _file_handler_installed:
        return
    try:
        _LOG_DIR.mkdir(parents=True, exist_ok=True)
        # We write JSON directly to _LOG_FILE in emit().
        # No longer attaching a FileHandler to _cyro_log which caused human-readable strings to pollute the JSON lines.
        _cyro_log.setLevel(logging.DEBUG)
        _cyro_log.propagate = True
        _file_handler_installed = True
    except Exception as e:
        logging.getLogger(__name__).warning("Could not set up CYRO log file: %s", e)


# ── ANSI colors for terminal ─────────────────────────────────────────────────

_C = {
    "reset": "\033[0m",
    "bold": "\033[1m",
    "dim": "\033[2m",
    "green": "\033[92m",
    "blue": "\033[94m",
    "cyan": "\033[96m",
    "yellow": "\033[93m",
    "red": "\033[91m",
    "magenta": "\033[95m",
    "white": "\033[97m",
    "grey": "\033[90m",
}

_AGENT_COLORS = {
    "agent_1": _C["cyan"],
    "agent_2": _C["blue"],
    "agent_3": _C["magenta"],
    "agent_4": _C["green"],
    "agent_5": _C["green"],
    "agent_6": _C["green"],
    "agent_7": _C["green"],
    "agent_8": _C["green"],
    "agent_9": _C["yellow"],
    "agent_10": _C["white"],
}

_STATUS_COLORS = {
    "success": _C["green"],
    "running": _C["cyan"],
    "warning": _C["yellow"],
    "error": _C["red"],
    "started": _C["blue"],
    "completed": _C["green"],
}


def _fmt_human(record: dict) -> str:
    """Format a structured log record as a human-readable terminal line."""
    ts = record.get("timestamp", "")[-8:] if record.get("timestamp") else ""  # HH:MM:SS only
    agent = record.get("agent", "cyro")
    event = record.get("event", "")
    status = record.get("status", "")
    research_id = record.get("research_id", "")[:12] if record.get("research_id") else ""
    security_id = record.get("security_id", "")
    summary = record.get("summary", "")
    duration = record.get("duration_ms")
    meta = record.get("metadata", {}) or {}

    color = _AGENT_COLORS.get(agent, _C["white"])
    status_color = _STATUS_COLORS.get(status, _C["white"])
    reset = _C["reset"]
    dim = _C["dim"]
    bold = _C["bold"]

    parts = [
        f"{dim}{ts}{reset}",
        f"{color}{bold}[{agent.upper()}]{reset}",
    ]
    if security_id:
        parts.append(f"{_C['grey']}{security_id}{reset}")
    parts.append(f"{status_color}{event}{reset}")
    if summary:
        parts.append(f"| {summary}")
    if duration is not None:
        parts.append(f"{dim}({duration}ms){reset}")

    # Key-pool info if present (safe only)
    if "key_slot" in meta:
        parts.append(f"{dim}slot={meta['key_slot']}{reset}")
    if "context_item_count" in meta:
        parts.append(f"{dim}ctx_items={meta['context_item_count']}{reset}")

    return "  ".join(parts)


# ── Core emit function ───────────────────────────────────────────────────────

def emit(
    event: str,
    *,
    agent: str = "cyro",
    research_id: str = "",
    security_id: str = "",
    status: str = "info",
    summary: str = "",
    duration_ms: Optional[int] = None,
    stage: str = "",
    metadata: Optional[dict] = None,
    intent_route_present: bool = False,
    specialist_count: int = 0,
    error_type: str = "",
    request_id: str = "",
    node: str = "",
    entered: bool = False,
    skipped: bool = False,
    ticker: str = "",
    horizon: str = "",
    routing_agents: Optional[list] = None,
    evidence_count: int = 0,
    accepted_count: int = 0,
    report_present: bool = False,
    claim_count: int = 0,
):
    """
    Emit a single structured log event.

    Args:
        event:        Event name (e.g. "intent_completed", "llm_call")
        agent:        Agent identifier (e.g. "agent_1", "agent_6")
        research_id:  Correlation ID for this research request
        security_id:  Stock/security ticker for this request
        status:       "success" | "running" | "warning" | "error" | "started" | "completed"
        summary:      Brief human-readable description (no raw data)
        duration_ms:  How long this step took in milliseconds
        stage:        Pipeline stage name
        metadata:     Additional safe metadata dict (no secrets, no raw data)
    """
    _ensure_log_dir()

    record = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "research_id": research_id,
        "security_id": security_id,
        "agent": agent,
        "stage": stage,
        "event": event,
        "status": status,
        "summary": summary,
        "duration_ms": duration_ms,
        "intent_route_present": intent_route_present,
        "specialist_count": specialist_count,
        "error_type": error_type,
        "request_id": request_id,
        "node": node,
        "entered": entered,
        "skipped": skipped,
        "ticker": ticker,
        "horizon": horizon,
        "routing_agents": routing_agents or [],
        "evidence_count": evidence_count,
        "accepted_count": accepted_count,
        "report_present": report_present,
        "claim_count": claim_count,
        "metadata": metadata or {},
    }

    # Write NDJSON to file (thread-safe)
    try:
        with _file_lock:
            with open(_LOG_FILE, "a", encoding="utf-8") as f:
                f.write(json.dumps(record) + "\n")
    except Exception:
        pass  # Never crash the pipeline due to logging

    # Write human-readable to terminal logger
    human_line = _fmt_human(record)
    level = logging.WARNING if status == "warning" else (logging.ERROR if status == "error" else logging.INFO)
    try:
        _cyro_log.log(level, human_line)
    except Exception:
        pass


# ── Convenience helpers ──────────────────────────────────────────────────────

def research_started(research_id: str, security_id: str, query: str):
    emit("research_started", agent="cyro", research_id=research_id, security_id=security_id,
         status="started", summary=f"Research initiated — {security_id or 'unknown'}")


def intent_started(research_id: str):
    emit("intent_started", agent="agent_1", research_id=research_id, stage="intent", status="started",
         summary="Resolving security and classifying research intent")


def intent_completed(research_id: str, security_id: str, horizon: str, agents: list, duration_ms: int):
    emit("intent_completed", agent="agent_1", research_id=research_id, security_id=security_id,
         stage="intent", status="success", duration_ms=duration_ms,
         summary=f"Resolved {security_id} | horizon={horizon} | agents={','.join(agents)}",
         metadata={"horizon": horizon, "routed_agents": agents})


def context_started(research_id: str, security_id: str):
    emit("context_started", agent="agent_2", research_id=research_id, security_id=security_id,
         stage="context", status="started", summary="Fetching multi-source evidence")


def context_completed(research_id: str, security_id: str, evidence_count: int, fallbacks: list, duration_ms: int):
    emit("context_completed", agent="agent_2", research_id=research_id, security_id=security_id,
         stage="context", status="success", duration_ms=duration_ms,
         summary=f"Gathered {evidence_count} evidence items | fallbacks={len(fallbacks)}",
         metadata={"evidence_count": evidence_count, "fallbacks_used": fallbacks})


def quality_started(research_id: str):
    emit("quality_started", agent="agent_3", research_id=research_id, stage="quality", status="started",
         summary="Validating evidence freshness and relevance")


def quality_completed(research_id: str, accepted: int, rejected: int, warnings: int, gate_status: str, duration_ms: int):
    emit("quality_completed", agent="agent_3", research_id=research_id, stage="quality",
         status="success" if gate_status not in ("failed", "error") else "warning",
         duration_ms=duration_ms,
         summary=f"Gate={gate_status} | accepted={accepted} rejected={rejected} warnings={warnings}",
         metadata={"accepted": accepted, "rejected": rejected, "warnings": warnings, "gate_status": gate_status})


def analyst_started(research_id: str, security_id: str, analyst: str, agent_id: str):
    emit("analyst_started", agent=agent_id, research_id=research_id, security_id=security_id,
         stage=analyst, status="started", summary=f"{analyst} analyst started")


def analyst_completed(research_id: str, security_id: str, analyst: str, agent_id: str,
                      report_status: str, duration_ms: int, key_slot: int = 0, metadata: dict = None):
    m = metadata or {}
    if key_slot:
        m["key_slot"] = key_slot
    emit("analyst_completed", agent=agent_id, research_id=research_id, security_id=security_id,
         stage=analyst, status="success" if report_status not in ("failed", "error") else "warning",
         duration_ms=duration_ms, summary=f"{analyst} completed | status={report_status}", metadata=m)


def risk_started(research_id: str):
    emit("risk_started", agent="agent_9", research_id=research_id, stage="risk", status="started",
         summary="Deterministic risk and contradiction extraction")


def risk_completed(research_id: str, risk_count: int, contradiction_count: int, duration_ms: int):
    emit("risk_completed", agent="agent_9", research_id=research_id, stage="risk", status="success",
         duration_ms=duration_ms,
         summary=f"risks={risk_count} contradictions={contradiction_count}",
         metadata={"risk_count": risk_count, "contradiction_count": contradiction_count})


def committee_started(research_id: str):
    emit("committee_started", agent="agent_10", research_id=research_id, stage="committee", status="started",
         summary="Investment Committee synthesizing final view")


def committee_completed(research_id: str, decision: str, specialists: int, risks: int, duration_ms: int, key_slot: int = 0):
    emit("committee_completed", agent="agent_10", research_id=research_id, stage="committee",
         status="success", duration_ms=duration_ms,
         summary=f"Decision={decision} | specialists={specialists} risks={risks}",
         metadata={"decision": decision, "specialists_received": specialists,
                   "risks_received": risks, "key_slot": key_slot})


def final_report_completed(research_id: str, security_id: str, decision: str, total_ms: int):
    emit("final_report_completed", agent="cyro", research_id=research_id, security_id=security_id,
         stage="final", status="success", duration_ms=total_ms,
         summary=f"Final report ready | {security_id} → {decision}")


def llm_call(research_id: str, agent_id: str, key_slot: int, context_bytes: int, item_count: int):
    emit("llm_call", agent=agent_id, research_id=research_id, stage="llm", status="running",
         summary=f"LLM call dispatched key_slot={key_slot}",
         metadata={"key_slot": key_slot, "context_size_bytes": context_bytes,
                   "context_item_count": item_count, "provider": "mistral"})


def llm_success(research_id: str, agent_id: str, key_slot: int, latency_ms: int):
    emit("llm_success", agent=agent_id, research_id=research_id, stage="llm", status="success",
         duration_ms=latency_ms,
         summary=f"LLM response received key_slot={key_slot}",
         metadata={"key_slot": key_slot, "provider": "mistral"})


def llm_failure(research_id: str, agent_id: str, key_slot: int, error_type: str, latency_ms: int, detail: str = ""):
    emit("llm_failure", agent=agent_id, research_id=research_id, stage="llm", status="error",
         duration_ms=latency_ms,
         summary=f"LLM failed key_slot={key_slot} error_type={error_type}" + (f" | {detail[:140]}" if detail else ""),
         metadata={"key_slot": key_slot, "error_type": error_type, "provider": "mistral", "detail": detail[:300]})


def warning(research_id: str, agent_id: str, message: str, metadata: dict = None):
    emit("warning", agent=agent_id, research_id=research_id, status="warning", summary=message, metadata=metadata)


def error(research_id: str, agent_id: str, message: str, metadata: dict = None):
    metadata = metadata or {}
    emit("error", agent=agent_id, research_id=research_id, status="error", summary=message,
         metadata=metadata, error_type=metadata.get("error_type", "GRAPH_STATE_ERROR"))


def state_event(
    research_id: str,
    node: str,
    agent: str,
    event: str,
    status: str,
    *,
    security_id: str = "",
    intent_route_present: bool = False,
    specialist_count: int = 0,
    duration_ms: Optional[int] = None,
    error_type: str = "",
    request_id: str = "",
    ticker: str = "",
    horizon: str = "",
    routing_agents: Optional[list] = None,
    evidence_count: int = 0,
    accepted_count: int = 0,
    report_present: bool = False,
    claim_count: int = 0,
    entered: bool = True,
    skipped: bool = False,
    metadata: Optional[dict] = None,
):
    """Record a node boundary with the state facts needed for route debugging."""
    emit(
        event,
        agent=agent,
        research_id=research_id,
        security_id=security_id,
        stage=node,
        status=status,
        duration_ms=duration_ms,
        summary=f"{node} {status}",
        intent_route_present=intent_route_present,
        specialist_count=specialist_count,
        error_type=error_type,
        request_id=request_id,
        node=node,
        entered=entered,
        skipped=skipped,
        ticker=ticker,
        horizon=horizon,
        routing_agents=routing_agents,
        evidence_count=evidence_count,
        accepted_count=accepted_count,
        report_present=report_present,
        claim_count=claim_count,
        metadata=metadata,
    )
