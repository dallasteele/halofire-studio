"""Agent 8 — Escalation.

When an upstream step fails or validation rejects every mask the
orchestrator routes here. We hand the intermediate artifacts to
Claude (via HAL V3) and ask for a structured decision:

* ``retry_with`` — run a specified step again with overridden params
* ``use_scad_fallback`` — leave the crude GLB in place, mark status
  ``"fallback"``
* ``flag_for_human`` — mark status ``"needs_review"`` so the Phase H.4
  Catalog panel surfaces it for a PE to adjudicate

Failure-of-LLM inside escalation degrades to ``flag_for_human`` so the
pipeline never wedges.
"""
from __future__ import annotations

import json
import logging
import re
from typing import Any

from ._protocol import AgentStep, EnrichmentContext, StepResult

log = logging.getLogger("halofire.enrichment.a8_escalation")

_SYSTEM_PROMPT = (
    "You are the senior CAD reviewer for a fire-sprinkler design tool. "
    "An automated SKU enrichment pipeline (SAM → mask validation → "
    "axisymmetric revolve) has failed. Given the intermediate outputs "
    "below, pick exactly ONE recovery action and reply with JSON ONLY: "
    "{\"action\": \"retry\"|\"fallback\"|\"flag\", \"retry_with\": "
    "{\"step\": \"a2_grounding\"|\"a3_sam_segment\"|\"a5_geometry\", "
    "\"overrides\": {...}}, \"reasoning\": \"short string\"}. "
    "Use \"retry\" only if you believe a specific parameter change would "
    "fix the pipeline. Use \"fallback\" if the crude parametric mesh is "
    "acceptable. Use \"flag\" when a human must adjudicate."
)


class EscalationAgent:
    name = "a8_escalation"

    async def run(self, ctx: EnrichmentContext) -> StepResult:
        client = ctx.llm_client
        failure_reason = ctx.artifacts.get("failure_reason") or "unknown"
        failure_step = ctx.artifacts.get("failure_step") or "unknown"

        if client is None or not getattr(client, "available", False):
            return _flag_for_human(
                "llm-unavailable-during-escalation",
                original_step=failure_step,
                original_reason=failure_reason,
            )

        prompt = _build_prompt(ctx, failure_step, failure_reason)

        try:
            raw = await client.chat(prompt, system=_SYSTEM_PROMPT, max_tokens=512)
        except Exception as exc:  # pragma: no cover - LLM errors non-fatal
            log.warning("escalation LLM call failed: %s", exc)
            return _flag_for_human(
                f"llm-error: {exc}",
                original_step=failure_step,
                original_reason=failure_reason,
            )

        decision = _parse_decision(raw)
        action = decision.get("action")
        reasoning = decision.get("reasoning") or ""

        if action == "retry":
            retry_with = decision.get("retry_with") or {}
            return StepResult(
                ok=True,
                confidence=0.6,
                artifacts={
                    "escalation": {
                        "action": "retry",
                        "retry_with": retry_with,
                        "reasoning": reasoning,
                    }
                },
            )
        if action == "fallback":
            return StepResult(
                ok=True,
                confidence=0.4,
                artifacts={
                    "escalation": {"action": "fallback", "reasoning": reasoning},
                    "status_override": "fallback",
                },
            )
        # "flag" or unknown
        return _flag_for_human(
            reasoning or "claude flagged for human review",
            original_step=failure_step,
            original_reason=failure_reason,
        )


def _flag_for_human(
    reasoning: str,
    *,
    original_step: str,
    original_reason: str,
) -> StepResult:
    return StepResult(
        ok=True,
        confidence=0.0,
        artifacts={
            "escalation": {
                "action": "flag",
                "reasoning": reasoning,
                "original_step": original_step,
                "original_reason": original_reason,
            },
            "status_override": "needs_review",
        },
    )


def _build_prompt(
    ctx: EnrichmentContext,
    failure_step: str,
    failure_reason: str,
) -> str:
    # Deliberately minimal — we include artifact keys + a few scalars
    # rather than full masks (which would blow out the token budget).
    summary: dict[str, Any] = {
        "sku": ctx.sku_id,
        "kind": ctx.catalog_entry.get("kind"),
        "manufacturer": ctx.catalog_entry.get("manufacturer"),
        "mfg_part_number": ctx.catalog_entry.get("mfg_part_number"),
        "failure_step": failure_step,
        "failure_reason": failure_reason,
        "grounding": ctx.artifacts.get("grounding"),
        "mask_count": len(ctx.artifacts.get("masks") or []),
        "mask_rejections": ctx.artifacts.get("mask_rejections"),
        "has_photo": bool(ctx.artifacts.get("photos")),
        "spec_text_preview": (ctx.artifacts.get("spec_text") or "")[:400],
    }
    return "Pipeline context:\n" + json.dumps(summary, indent=2)


def _parse_decision(raw: str) -> dict[str, Any]:
    if not raw:
        return {"action": "flag", "reasoning": "empty llm response"}
    cleaned = raw.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```[a-zA-Z]*\n?", "", cleaned)
        cleaned = re.sub(r"\n?```$", "", cleaned).strip()
    # Try full parse then first-object fallback
    for candidate in (cleaned, _first_json_object(cleaned) or ""):
        if not candidate:
            continue
        try:
            return json.loads(candidate)
        except json.JSONDecodeError:
            continue
    return {"action": "flag", "reasoning": f"unparseable: {raw[:200]}"}


def _first_json_object(text: str) -> str | None:
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
