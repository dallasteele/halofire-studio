"""Health aggregator — checks each service module's [health].http and
produces a uniform snapshot. Consumed by the runtime loop (for Tier 0
auto-fix decisions) and by the `openclaw status` CLI command.
"""
from __future__ import annotations

import json
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from time import time
from typing import Iterable

from .registry import Module


@dataclass
class ModuleHealth:
    name: str
    ok: bool
    status_code: int | None
    latency_ms: float | None
    error: str | None = None
    checked_at: float = field(default_factory=time)


def check_module(m: Module) -> ModuleHealth | None:
    """Return None if the module has no [health] block."""
    if m.health is None or not m.health.http:
        return None
    url = m.health.http
    t0 = time()
    try:
        req = urllib.request.Request(url)
        with urllib.request.urlopen(req, timeout=m.health.timeout_s) as resp:
            code = resp.getcode()
            latency_ms = (time() - t0) * 1000
            ok = code == m.health.expect_status
            return ModuleHealth(name=m.name, ok=ok, status_code=code, latency_ms=latency_ms)
    except urllib.error.HTTPError as e:
        return ModuleHealth(
            name=m.name, ok=False, status_code=e.code,
            latency_ms=(time() - t0) * 1000,
            error=f"HTTP {e.code}",
        )
    except Exception as e:  # noqa: BLE001
        return ModuleHealth(
            name=m.name, ok=False, status_code=None,
            latency_ms=(time() - t0) * 1000,
            error=str(e),
        )


def check_all(modules: Iterable[Module]) -> list[ModuleHealth]:
    out: list[ModuleHealth] = []
    for m in modules:
        r = check_module(m)
        if r is not None:
            out.append(r)
    return out


def summary(results: list[ModuleHealth]) -> dict:
    return {
        "healthy": [r.name for r in results if r.ok],
        "unhealthy": [
            {"name": r.name, "status": r.status_code, "error": r.error}
            for r in results
            if not r.ok
        ],
        "checked": len(results),
    }


def to_json(results: list[ModuleHealth]) -> str:
    return json.dumps(summary(results), indent=2)


__all__ = ["ModuleHealth", "check_module", "check_all", "summary", "to_json"]
