"""Agent 2 — Grounding.

Asks the LLM via HAL V3 to locate the physical part in the product
photo and return a normalized bounding box. Degrades gracefully to a
near-full-frame fallback when the hub is unavailable or the response
can't be parsed — the pipeline never stalls on an LLM hiccup.
"""
from __future__ import annotations

import json
import logging
import re
from pathlib import Path
from typing import Any

from ._protocol import AgentStep, EnrichmentContext, StepResult

log = logging.getLogger("halofire.enrichment.a2_grounding")

_FALLBACK_BBOX = [0.1, 0.1, 0.9, 0.9]
_FALLBACK_CONF = 0.3

_SYSTEM_PROMPT = (
    "You are a fire-protection CAD assistant. Given a sprinkler-system "
    "part photo and the manufacturer specs, reply with ONLY a compact "
    "JSON object: {\"bbox\": [x0,y0,x1,y1] with each value between 0 "
    "and 1, \"confidence\": 0..1, \"reasoning\": \"short string\"}. "
    "bbox coordinates are normalized (0,0)=top-left, (1,1)=bottom-right. "
    "No prose outside the JSON."
)


class GroundingAgent:
    name = "a2_grounding"

    async def run(self, ctx: EnrichmentContext) -> StepResult:
        photos = ctx.artifacts.get("photos") or []
        if not photos:
            return StepResult(ok=False, reason="no-photo-to-ground")

        primary = photos[0]
        photo_path = Path(primary["path"])

        client = ctx.llm_client
        if client is None or not getattr(client, "available", False):
            return StepResult(
                ok=True,
                confidence=_FALLBACK_CONF,
                reason="llm-unavailable, using full-frame fallback",
                artifacts={
                    "grounding": {
                        "bbox": list(_FALLBACK_BBOX),
                        "confidence": _FALLBACK_CONF,
                        "reasoning": "llm client reports unavailable",
                        "source": "fallback",
                    }
                },
            )

        user_prompt = _build_prompt(ctx.catalog_entry, ctx.artifacts.get("spec_text", ""))

        raw = ""
        try:
            img_bytes = photo_path.read_bytes()
            raw = await client.vision(
                user_prompt,
                images=[img_bytes],
                max_tokens=512,
            )
        except Exception as exc:  # network/LLMError — don't kill the pipeline
            log.warning("grounding vision call raised %s", exc)
            raw = ""

        bbox, confidence, reasoning, source = _parse_llm_response(raw)
        return StepResult(
            ok=True,
            confidence=confidence,
            artifacts={
                "grounding": {
                    "bbox": bbox,
                    "confidence": confidence,
                    "reasoning": reasoning,
                    "source": source,
                }
            },
        )


def _build_prompt(catalog_entry: dict, spec_text: str) -> str:
    relevant = {
        k: catalog_entry.get(k)
        for k in (
            "sku",
            "kind",
            "category",
            "display_name",
            "manufacturer",
            "mfg_part_number",
        )
        if catalog_entry.get(k) is not None
    }
    # Include params (dims) flattened to values only — types don't help the LLM.
    params_flat: dict[str, Any] = {}
    for name, param in (catalog_entry.get("params") or {}).items():
        if isinstance(param, dict) and "default" in param:
            params_flat[name] = param["default"]
    relevant["params"] = params_flat

    trimmed_spec = (spec_text or "")[:1500]
    return (
        "Manufacturer part:\n"
        f"{json.dumps(relevant, indent=2)}\n\n"
        f"Cut-sheet page text (truncated):\n{trimmed_spec}\n\n"
        "Return JSON only."
    )


_JSON_RE = re.compile(r"\{[^{}]*\"bbox\"[^{}]*\}", re.S)


def _parse_llm_response(raw: str) -> tuple[list[float], float, str, str]:
    if not raw:
        return (
            list(_FALLBACK_BBOX),
            _FALLBACK_CONF,
            "empty llm response",
            "fallback",
        )
    # Strip any accidental fenced code blocks.
    cleaned = raw.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```[a-zA-Z]*\n?", "", cleaned)
        cleaned = re.sub(r"\n?```$", "", cleaned).strip()

    # Try direct parse first, then a relaxed regex extract.
    for candidate in (cleaned, _first_json_object(cleaned)):
        if not candidate:
            continue
        try:
            obj = json.loads(candidate)
        except (json.JSONDecodeError, ValueError):
            continue
        bbox = obj.get("bbox")
        if not _looks_like_bbox(bbox):
            continue
        x0, y0, x1, y1 = (float(v) for v in bbox)
        x0 = max(0.0, min(1.0, x0))
        y0 = max(0.0, min(1.0, y0))
        x1 = max(0.0, min(1.0, x1))
        y1 = max(0.0, min(1.0, y1))
        if x1 <= x0 or y1 <= y0:
            continue
        confidence = float(obj.get("confidence", 0.7))
        confidence = max(0.0, min(1.0, confidence))
        reasoning = str(obj.get("reasoning") or "")[:400]
        return [x0, y0, x1, y1], confidence, reasoning, "llm"

    return (
        list(_FALLBACK_BBOX),
        _FALLBACK_CONF,
        f"unparseable llm output: {raw[:140]}",
        "fallback",
    )


def _first_json_object(text: str) -> str | None:
    # Simple brace-balancing extractor — handles nested {} inside a string.
    depth = 0
    start = -1
    for i, ch in enumerate(text):
        if ch == "{":
            if depth == 0:
                start = i
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0 and start >= 0:
                return text[start : i + 1]
    return None


def _looks_like_bbox(v: Any) -> bool:
    return (
        isinstance(v, (list, tuple))
        and len(v) == 4
        and all(isinstance(x, (int, float)) for x in v)
    )
