"""Agent 3 — SAM segmentation.

Wraps the halofire-sam sidecar (``/segment``). Respects the grounded-
only default enforced by H.2 — we always send the grounding bbox and
``require_grounded=True``. If the sidecar is unreachable we surface a
structured failure so the orchestrator can route to the escalation
agent instead of silently falling back to "auto mode".
"""
from __future__ import annotations

import base64
import logging
from pathlib import Path
from typing import Any

import httpx

from ._protocol import AgentStep, EnrichmentContext, StepResult

log = logging.getLogger("halofire.enrichment.a3_sam")


class SamSegmentAgent:
    name = "a3_sam_segment"

    def __init__(self, *, timeout: float = 60.0) -> None:
        self.timeout = timeout

    async def run(self, ctx: EnrichmentContext) -> StepResult:
        photos = ctx.artifacts.get("photos") or []
        grounding = ctx.artifacts.get("grounding") or {}
        if not photos or "bbox" not in grounding:
            return StepResult(ok=False, reason="missing-photo-or-bbox")

        photo_path = Path(photos[0]["path"])
        try:
            image_b64 = base64.b64encode(photo_path.read_bytes()).decode("ascii")
        except OSError as exc:
            return StepResult(ok=False, reason=f"photo-read-failed: {exc}")

        payload = {
            "image_b64": image_b64,
            "bbox": grounding["bbox"],
            "multimask": True,
            "require_grounded": True,
        }

        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                resp = await client.post(f"{ctx.sam_url}/segment", json=payload)
        except httpx.HTTPError as exc:
            log.warning("SAM sidecar unreachable at %s: %s", ctx.sam_url, exc)
            return StepResult(ok=False, reason=f"sam-unavailable: {exc}")

        if resp.status_code // 100 != 2:
            return StepResult(
                ok=False,
                reason=f"sam-status-{resp.status_code}: {resp.text[:200]}",
            )

        try:
            body = resp.json()
        except ValueError as exc:
            return StepResult(ok=False, reason=f"sam-bad-json: {exc}")

        masks = body.get("masks") or []
        if not masks:
            return StepResult(
                ok=False,
                reason="sam-returned-no-masks",
                artifacts={"sam_raw": body},
            )

        return StepResult(
            ok=True,
            confidence=float(masks[0].get("iou", 0.0) or 0.0),
            artifacts={
                "masks": masks,
                "sam_rejected": body.get("rejected") or [],
            },
        )
