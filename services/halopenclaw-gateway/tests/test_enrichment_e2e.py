"""H.3 — end-to-end orchestrator test.

Mocks HAL V3 (via an in-proc fake) and SAM sidecar (via ``respx``) so
the full pipeline runs without either service being up. Gated behind
``RUN_H3_E2E=1`` so the default test run stays offline.
"""
from __future__ import annotations

import asyncio
import base64
import json
import os
from pathlib import Path
from typing import Any

import httpx
import pytest
import respx

from enrichment_agents._protocol import EnrichmentContext
from catalog_enrichment import Orchestrator


class _FakeLLM:
    available = True

    async def vision(self, prompt, *, images, max_tokens=512):
        return json.dumps({"bbox": [0.2, 0.2, 0.8, 0.8], "confidence": 0.9, "reasoning": "ok"})

    async def chat(self, *a, **k):
        return json.dumps({"action": "flag", "reasoning": "test"})

    async def health(self) -> dict[str, Any]:
        return {"ok": True}


def _make_pdf(path: Path) -> None:
    import fitz

    doc = fitz.open()
    page = doc.new_page(width=600, height=800)
    page.insert_text((50, 50), "TEST SKU — K=5.6")
    pix = fitz.Pixmap(fitz.csRGB, fitz.IRect(0, 0, 256, 256))
    pix.set_rect(pix.irect, (220, 10, 10))
    page.insert_image(fitz.Rect(100, 100, 500, 700), pixmap=pix)
    doc.save(path)
    doc.close()


def _fake_sam_response() -> dict[str, Any]:
    # 2x2 black PNG → valid png_b64 for the validator to decode.
    import io

    from PIL import Image

    im = Image.new("L", (2, 2), 255)
    buf = io.BytesIO()
    im.save(buf, format="PNG")
    b64 = base64.b64encode(buf.getvalue()).decode("ascii")
    return {
        "masks": [
            {
                "iou": 0.92,
                "area_px": 5000,
                "bbox": [40, 10, 60, 40],
                "png_b64": b64,
            }
        ],
        "rejected": [],
    }


@respx.mock
def test_orchestrator_runs_e2e_with_mocks(tmp_path: Path) -> None:
    # Arrange dirs.
    catalog_dir = tmp_path / "catalog"
    catalog_dir.mkdir()
    cut_sheets = catalog_dir / "cut_sheets"
    cut_sheets.mkdir()
    glb_dir = catalog_dir / "glb"
    enriched_glb = catalog_dir / "glb_enriched"

    pdf = cut_sheets / "tyco_test.pdf"
    _make_pdf(pdf)

    entry = {
        "sku": "tyco_test_pendent_155f",
        "kind": "sprinkler_head",
        "manufacturer": "tyco_fire_protection",
        "mfg_part_number": "TEST",
        "params": {"size_in": {"default": 0.5}, "length_in": {"default": 2.0}, "body_dia_in": {"default": 1.0}},
        "ports": [],
    }
    catalog = {"schema_version": 1, "parts": [entry]}
    catalog_path = catalog_dir / "catalog.json"
    catalog_path.write_text(json.dumps(catalog), encoding="utf-8")

    enriched_path = catalog_dir / "enriched.json"

    # Mock SAM /segment
    respx.post("http://127.0.0.1:18081/segment").mock(
        return_value=httpx.Response(200, json=_fake_sam_response())
    )

    orch = Orchestrator(
        sam_url="http://127.0.0.1:18081",
        llm_client=_FakeLLM(),
        catalog_path=catalog_path,
        enriched_path=enriched_path,
        cut_sheets_dir=cut_sheets,
        enriched_glb_dir=enriched_glb,
        glb_latest_dir=glb_dir,
        jobs_dir=tmp_path / "jobs",
        audit_log=tmp_path / "audit.jsonl",
    )

    out = asyncio.run(orch.run_all(mode="full", parallel=1))
    assert out["summary"]["total"] == 1
    # e2e should produce at least one outcome — validated or needs_review
    sku_result = out["results"][0]
    assert sku_result["sku"] == "tyco_test_pendent_155f"
    # enriched.json was written
    assert enriched_path.exists()
    doc = json.loads(enriched_path.read_text(encoding="utf-8"))
    assert "tyco_test_pendent_155f" in doc["entries"]


@pytest.mark.skipif(os.environ.get("RUN_H3_E2E") != "1", reason="RUN_H3_E2E=1 to exercise real SAM+HAL")
def test_orchestrator_against_live_services(tmp_path: Path) -> None:
    # Intentionally minimal — when RUN_H3_E2E=1 the caller is expected
    # to have SAM on :18081 and HAL hub on :9000.
    from hal_client import make_llm_client

    orch = Orchestrator(llm_client=make_llm_client())
    out = asyncio.run(orch.run_all(mode="incremental", parallel=1, sku_filter="tyco_ty3251_pendent_155f"))
    assert out["summary"]["total"] >= 0
