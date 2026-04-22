"""Agent 6 — GLB exporter.

trimesh load OBJ → export GLB. Writes to
``packages/halofire-catalog/assets/glb/enriched/<sku>.v<n>.glb`` so
failed attempts are preserved for later review. The ``latest``
symlink/copy at ``assets/glb/<sku>.glb`` is handled by the profile
enricher (a7) and only updated when the full pipeline succeeds —
preserving the crude SCAD render as a fallback when enrichment fails.
"""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

import trimesh

from ._protocol import AgentStep, EnrichmentContext, StepResult

log = logging.getLogger("halofire.enrichment.a6_glb")


class GlbExporterAgent:
    name = "a6_glb_exporter"

    def __init__(self, *, enriched_dir: Path) -> None:
        self.enriched_dir = enriched_dir

    async def run(self, ctx: EnrichmentContext) -> StepResult:
        obj_path_str = ctx.artifacts.get("mesh_obj_path")
        if not obj_path_str:
            return StepResult(ok=False, reason="no-obj-mesh")

        obj_path = Path(obj_path_str)
        if not obj_path.exists():
            return StepResult(ok=False, reason=f"obj-missing: {obj_path}")

        try:
            mesh = trimesh.load(obj_path, force="mesh")
        except Exception as exc:
            return StepResult(ok=False, reason=f"trimesh-load-failed: {exc}")

        if mesh is None or getattr(mesh, "is_empty", False):
            return StepResult(ok=False, reason="empty-mesh")

        self.enriched_dir.mkdir(parents=True, exist_ok=True)
        version = _next_version(self.enriched_dir, ctx.sku_id)
        glb_path = self.enriched_dir / f"{ctx.sku_id}.v{version}.glb"
        try:
            mesh.export(glb_path)
        except Exception as exc:
            return StepResult(ok=False, reason=f"glb-export-failed: {exc}")

        return StepResult(
            ok=True,
            confidence=1.0,
            artifacts={
                "glb_path": str(glb_path),
                "glb_version": version,
                "mesh_bounds": [list(map(float, mesh.bounds[0])), list(map(float, mesh.bounds[1]))],
            },
        )


def _next_version(dir_: Path, sku_id: str) -> int:
    prefix = f"{sku_id}.v"
    existing = [
        int(p.stem.rsplit(".v", 1)[1])
        for p in dir_.glob(f"{sku_id}.v*.glb")
        if p.stem.rsplit(".v", 1)[-1].isdigit()
    ]
    return (max(existing) if existing else 0) + 1
