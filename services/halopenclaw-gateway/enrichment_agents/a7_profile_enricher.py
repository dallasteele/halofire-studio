"""Agent 7 — Profile enricher.

Aggregates every upstream artifact into a single enriched record and
atomically writes it into ``packages/halofire-catalog/enriched.json``.
Also promotes the newly-built GLB to ``assets/glb/<sku>.glb`` — but
ONLY when every upstream step succeeded. A failed or escalated run
leaves the crude SCAD render in place as the fallback the UI serves.
"""
from __future__ import annotations

import json
import logging
import os
import shutil
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from ._protocol import AgentStep, EnrichmentContext, StepResult

log = logging.getLogger("halofire.enrichment.a7_enricher")


class ProfileEnricherAgent:
    name = "a7_profile_enricher"

    def __init__(
        self,
        *,
        enriched_json_path: Path,
        glb_latest_dir: Path,
        promote_latest: bool = True,
    ) -> None:
        self.enriched_json_path = enriched_json_path
        self.glb_latest_dir = glb_latest_dir
        self.promote_latest = promote_latest

    async def run(self, ctx: EnrichmentContext) -> StepResult:
        glb_path = ctx.artifacts.get("glb_path")
        if not glb_path:
            return StepResult(ok=False, reason="no-glb-path")

        status = ctx.artifacts.get("status_override") or "validated"
        provenance = ctx.artifacts.get("provenance") or []

        record = {
            "sku_id": ctx.sku_id,
            "status": status,
            "enriched_at": datetime.now(timezone.utc).isoformat(),
            "mesh": {
                "glb_path": str(glb_path),
                "version": ctx.artifacts.get("glb_version"),
                "source": ctx.artifacts.get("geometry_method") or "unknown",
                "bounds_m": ctx.artifacts.get("mesh_bounds"),
            },
            "source_photo": _photo_meta(ctx.artifacts),
            "cut_sheet": {
                "path": ctx.artifacts.get("cut_sheet_path"),
                "sha256": ctx.artifacts.get("cut_sheet_sha256"),
            },
            "grounding": ctx.artifacts.get("grounding"),
            "mask": _mask_meta(ctx.artifacts.get("validated_mask")),
            "mask_rejections": ctx.artifacts.get("mask_rejections") or [],
            "provenance": provenance,
        }

        _atomic_write_record(self.enriched_json_path, record)

        if self.promote_latest and status == "validated":
            self.glb_latest_dir.mkdir(parents=True, exist_ok=True)
            latest = self.glb_latest_dir / f"{ctx.sku_id}.glb"
            try:
                shutil.copyfile(glb_path, latest)
            except OSError as exc:  # pragma: no cover - rare
                log.warning("could not promote %s: %s", latest, exc)

        return StepResult(
            ok=True,
            confidence=1.0,
            artifacts={"enriched_record": record},
        )


# ── pure helpers ────────────────────────────────────────────────────


def _photo_meta(artifacts: dict[str, Any]) -> dict[str, Any] | None:
    photos = artifacts.get("photos") or []
    if not photos:
        return None
    return {
        "path": photos[0].get("path"),
        "width": photos[0].get("width"),
        "height": photos[0].get("height"),
    }


def _mask_meta(mask: dict[str, Any] | None) -> dict[str, Any] | None:
    if not mask:
        return None
    return {
        "iou": mask.get("iou"),
        "area_px": mask.get("area_px"),
        "bbox": mask.get("bbox"),
    }


def _atomic_write_record(path: Path, record: dict[str, Any]) -> None:
    """Upsert ``record`` (keyed by ``sku_id``) into the enriched.json
    file atomically (temp file + rename).
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    existing: dict[str, Any] = {"schema_version": 1, "entries": {}}
    if path.exists():
        try:
            existing = json.loads(path.read_text(encoding="utf-8"))
            if "entries" not in existing:
                existing["entries"] = {}
        except (OSError, json.JSONDecodeError):
            existing = {"schema_version": 1, "entries": {}}

    existing["entries"][record["sku_id"]] = record
    existing["updated_at"] = datetime.now(timezone.utc).isoformat()

    fd, tmp_name = tempfile.mkstemp(
        prefix=path.name + ".", suffix=".tmp", dir=str(path.parent)
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(existing, f, indent=2)
        os.replace(tmp_name, path)
    except Exception:
        try:
            os.unlink(tmp_name)
        except OSError:
            pass
        raise
