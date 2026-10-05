"""
config/env_loader.py
────────────────────
Single, deterministic .env loader for the whole project.

Why this exists:
  - There are two .env files (FinPilot/.env and india-trade-cli/.env) and the
    code used python-dotenv's default override=False, so whichever file (or
    inherited shell variable) was loaded first silently won and stale keys
    were never replaced.
  - uvicorn's reload=True only watches *.py, so editing .env never refreshed
    the running server.

Rules:
  - Precedence (lowest → highest): inherited process env < india-trade-cli/.env
    < FinPilot/.env (repo root is the single source of truth for shared keys).
  - override=True, so edits to .env always replace stale in-process values.
  - reload_if_changed() re-reads the files when their mtime changes; it is cheap
    and is called by the LLM key pool so new keys apply without a restart.
"""

from __future__ import annotations

import os
import threading
from pathlib import Path
from typing import Dict

from dotenv import dotenv_values

_CLI_ROOT = Path(__file__).resolve().parent.parent          # .../india-trade-cli
_REPO_ROOT = _CLI_ROOT.parent                               # .../FinPilot

# Lowest precedence first; later files override earlier ones.
ENV_FILES = [_CLI_ROOT / ".env", _REPO_ROOT / ".env"]

_lock = threading.Lock()
_mtimes: Dict[str, float] = {}
_loaded_names: set = set()   # names we set from files (so removed keys can be unset)


def _stat() -> Dict[str, float]:
    out: Dict[str, float] = {}
    for p in ENV_FILES:
        try:
            out[str(p)] = p.stat().st_mtime
        except OSError:
            out[str(p)] = 0.0
    return out


def load_project_env() -> None:
    """Load all project .env files (override=True, root wins)."""
    with _lock:
        merged: Dict[str, str] = {}
        for p in ENV_FILES:                      # later files win
            if p.is_file():
                merged.update({k: v for k, v in dotenv_values(p, encoding="utf-8-sig").items() if v is not None})
        for gone in _loaded_names - set(merged):  # key deleted from .env → unset
            os.environ.pop(gone, None)
        os.environ.update(merged)
        _loaded_names.clear()
        _loaded_names.update(merged)
        _mtimes.clear()
        _mtimes.update(_stat())


def reload_if_changed() -> bool:
    """Re-load .env files if any changed on disk. Returns True if reloaded."""
    if _mtimes and _stat() == _mtimes:
        return False
    load_project_env()
    return True
