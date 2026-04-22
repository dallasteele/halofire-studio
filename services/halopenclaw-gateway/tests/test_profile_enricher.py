"""H.3 — a7_profile_enricher atomic upsert + GLB promotion."""
from __future__ import annotations

import asyncio
import json
from pathlib import Path

from enrichment_agents._protocol import EnrichmentContext
from enrichment_agents.a7_profile_enricher import ProfileEnricherAgent, _atomic_write_record


def test_atomic_write_upsert(tmp_path: Path):
    path = tmp_path / "enriched.json"
    _atomic_write_record(path, {"sku_id": "a", "status": "validated"})
    _atomic_write_record(path, {"sku_id": "b", "status": "fallback"})
    _atomic_write_record(path, {"sku_id": "a", "status": "needs_review"})  # upsert
    doc = json.loads(path.read_text(encoding="utf-8"))
    assert set(doc["entries"].keys()) == {"a", "b"}
    assert doc["entries"]["a"]["status"] == "needs_review"
    assert doc["entries"]["b"]["status"] == "fallback"


def test_enricher_promotes_glb_only_on_validated(tmp_path: Path):
    glb = tmp_path / "src.glb"
    glb.write_bytes(b"glbdata")
    enriched_json = tmp_path / "enriched.json"
    latest_dir = tmp_path / "latest"

    ctx = EnrichmentContext(
        sku_id="sku_ok",
        catalog_entry={"sku": "sku_ok"},
        cut_sheet_path=None,
        cut_sheet_url=None,
        workdir=tmp_path,
        llm_client=None,
        sam_url="",
        artifacts={
            "glb_path": str(glb),
            "glb_version": 1,
            "geometry_method": "axisymmetric-z",
            "photos": [{"path": "p", "width": 400, "height": 600}],
            "validated_mask": {"iou": 0.9, "area_px": 4000, "bbox": [10, 10, 50, 50]},
            "provenance": [{"agent": "a1_intake", "ok": True}],
        },
    )
    agent = ProfileEnricherAgent(
        enriched_json_path=enriched_json,
        glb_latest_dir=latest_dir,
    )
    result = asyncio.run(agent.run(ctx))
    assert result.ok
    assert (latest_dir / "sku_ok.glb").exists()
    doc = json.loads(enriched_json.read_text(encoding="utf-8"))
    assert doc["entries"]["sku_ok"]["status"] == "validated"


def test_enricher_does_not_promote_on_needs_review(tmp_path: Path):
    glb = tmp_path / "src.glb"
    glb.write_bytes(b"glbdata")
    enriched_json = tmp_path / "enriched.json"
    latest_dir = tmp_path / "latest"

    ctx = EnrichmentContext(
        sku_id="sku_nr",
        catalog_entry={"sku": "sku_nr"},
        cut_sheet_path=None,
        cut_sheet_url=None,
        workdir=tmp_path,
        llm_client=None,
        sam_url="",
        artifacts={
            "glb_path": str(glb),
            "status_override": "needs_review",
            "provenance": [],
        },
    )
    agent = ProfileEnricherAgent(
        enriched_json_path=enriched_json,
        glb_latest_dir=latest_dir,
    )
    result = asyncio.run(agent.run(ctx))
    assert result.ok
    assert not (latest_dir / "sku_nr.glb").exists()
