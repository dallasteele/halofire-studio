"""Gemma bridge — the ONLY LLM path the HaloFire runtime is allowed
to use. Any attempt to call a non-Gemma tag is rejected at the
import + invocation boundary.

Mirrors services/halofire-cad/pricing/sync_agent.py::_require_gemma
so the policy is enforced in both places.
"""
from __future__ import annotations

import json
import os
import urllib.request

OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://localhost:11434")
DEFAULT_MODEL = os.environ.get("OPENCLAW_MODEL", "gemma3:4b")


def require_gemma(model: str) -> None:
    tag = (model or "").lower().strip()
    if not (
        tag.startswith("gemma3")
        or tag.startswith("gemma2")
        or tag.startswith("gemma")
    ):
        raise ValueError(
            f"model {model!r} rejected — HaloFire is Gemma-only. "
            "Use a 'gemma3:*' or 'gemma2:*' Ollama tag."
        )


require_gemma(DEFAULT_MODEL)


def generate_json(prompt: str, model: str = DEFAULT_MODEL) -> dict | None:
    """Single-shot structured call against a local Ollama daemon.

    Returns parsed JSON or None on any error. Swallows everything —
    Tier 1 diagnosis is advisory, never fatal.
    """
    require_gemma(model)
    body = json.dumps(
        {
            "model": model,
            "prompt": prompt,
            "stream": False,
            "format": "json",
            "options": {"temperature": 0.1},
        },
    ).encode("utf-8")
    req = urllib.request.Request(
        f"{OLLAMA_URL}/api/generate",
        data=body,
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            payload = json.loads(resp.read())
        raw = payload.get("response", "")
        return json.loads(raw)
    except Exception:  # noqa: BLE001
        return None


__all__ = ["DEFAULT_MODEL", "OLLAMA_URL", "require_gemma", "generate_json"]
