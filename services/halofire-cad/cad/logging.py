"""Standard logger setup for halofire-cad agents.

Per AGENTIC_RULES.md §4.1, every agent logs structured events.
Dev mode: pretty formatter, human-readable.
Prod mode (when HALOFIRE_LOG_JSON=1): single-line JSON per event,
ingestible by Loki/CloudWatch/etc.

Usage inside an agent:

    from cad.logging import get_logger
    log = get_logger("placer")
    log.info("hf.placer.room_complete",
             extra={"room_id": r.id, "heads_placed": n,
                    "hazard": r.hazard_class})

Log event names follow the dotted convention `hf.<agent>.<event>`.
"""
from __future__ import annotations

import json
import logging
import os
import sys
from typing import Any


_JSON_MODE = os.environ.get("HALOFIRE_LOG_JSON") == "1"
_DEFAULT_LEVEL = os.environ.get("HALOFIRE_LOG_LEVEL", "INFO").upper()


class _JSONFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "ts": self.formatTime(record, "%Y-%m-%dT%H:%M:%S%z"),
            "level": record.levelname,
            "event": record.getMessage(),
            "logger": record.name,
        }
        # Copy any `extra=...` fields we set at the call site
        skip = {
            "name", "msg", "args", "levelname", "levelno", "pathname",
            "filename", "module", "exc_info", "exc_text", "stack_info",
            "lineno", "funcName", "created", "msecs", "relativeCreated",
            "thread", "threadName", "processName", "process",
            "message", "asctime",
        }
        for k, v in record.__dict__.items():
            if k in skip:
                continue
            try:
                json.dumps(v)
                payload[k] = v
            except (TypeError, ValueError):
                payload[k] = str(v)
        if record.exc_info:
            payload["exc"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str)


class _PrettyFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        base = super().format(record)
        extras = []
        skip = {
            "name", "msg", "args", "levelname", "levelno", "pathname",
            "filename", "module", "exc_info", "exc_text", "stack_info",
            "lineno", "funcName", "created", "msecs", "relativeCreated",
            "thread", "threadName", "processName", "process",
            "message", "asctime",
        }
        for k, v in record.__dict__.items():
            if k in skip:
                continue
            extras.append(f"{k}={v!r}")
        if extras:
            base = f"{base} | {' '.join(extras)}"
        return base


_CONFIGURED = False


def _ensure_configured() -> None:
    global _CONFIGURED
    if _CONFIGURED:
        return
    root = logging.getLogger("halofire")
    root.setLevel(_DEFAULT_LEVEL)
    handler = logging.StreamHandler(stream=sys.stderr)
    if _JSON_MODE:
        handler.setFormatter(_JSONFormatter())
    else:
        handler.setFormatter(_PrettyFormatter(
            fmt="%(asctime)s %(levelname)-5s %(name)s :: %(message)s",
            datefmt="%H:%M:%S",
        ))
    root.handlers.clear()
    root.addHandler(handler)
    root.propagate = False
    _CONFIGURED = True


def get_logger(agent: str) -> logging.Logger:
    """Return the canonical logger for an agent.

    Convention: `agent` is the short name, not the dir name. So
    `get_logger("placer")` returns the logger named
    `halofire.agent.placer`.
    """
    _ensure_configured()
    return logging.getLogger(f"halofire.agent.{agent}")


def warn_swallowed(
    log: logging.Logger, *, code: str, err: BaseException, **ctx: Any,
) -> None:
    """Canonical helper for 'we swallowed this on purpose.'

    Use this instead of `except Exception: pass` (AGENTIC_RULES §9.3).
    Always passes a stable `code` so operators can grep.
    """
    log.warning(
        "hf.degraded",
        extra={"code": code, "err_type": type(err).__name__,
               "err": str(err), **ctx},
    )
