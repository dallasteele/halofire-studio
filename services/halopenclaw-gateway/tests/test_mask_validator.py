"""H.3 — a4_mask_validator deterministic geometry checks."""
from __future__ import annotations

import asyncio
from pathlib import Path

from enrichment_agents._protocol import EnrichmentContext
from enrichment_agents.a4_mask_validator import (
    MaskValidatorAgent,
    _expected_aspect,
    _why_reject,
)


def test_expected_aspect_from_params():
    entry = {
        "kind": "sprinkler_head",
        "params": {"length_in": {"default": 2.25}, "body_dia_in": {"default": 1.0}},
    }
    assert _expected_aspect(entry) == 2.25


def test_expected_aspect_kind_default_head():
    entry = {"kind": "sprinkler_head", "params": {}}
    assert _expected_aspect(entry) == 1.5


def test_reject_tiny_area():
    reason = _why_reject(
        {"area_px": 100, "bbox": [0, 0, 10, 10]},
        expected_aspect=1.5,
        grounding_bbox=[0.0, 0.0, 1.0, 1.0],
        image_wh=(100, 100),
    )
    assert reason and "area" in reason


def test_reject_aspect_mismatch():
    # Expected tall (1.5), actual very wide (~0.2)
    reason = _why_reject(
        {"area_px": 5000, "bbox": [0, 45, 500, 55]},
        expected_aspect=1.5,
        grounding_bbox=[0.0, 0.4, 1.0, 0.6],
        image_wh=(500, 100),
    )
    assert reason and "aspect" in reason


def test_accept_matching_aspect():
    # Expected 1.5 tall, actual 1.5 tall
    reason = _why_reject(
        {"area_px": 5000, "bbox": [40, 10, 60, 40]},
        expected_aspect=1.5,
        grounding_bbox=[0.4, 0.1, 0.6, 0.4],
        image_wh=(100, 100),
    )
    assert reason is None


def test_validator_picks_highest_iou(tmp_path: Path):
    ctx = EnrichmentContext(
        sku_id="s",
        catalog_entry={"kind": "sprinkler_head", "params": {"body_dia_in": {"default": 1.0}, "length_in": {"default": 1.5}}},
        cut_sheet_path=None,
        cut_sheet_url=None,
        workdir=tmp_path,
        llm_client=None,
        sam_url="",
        artifacts={
            "photos": [{"width": 100, "height": 100}],
            "grounding": {"bbox": [0.4, 0.1, 0.6, 0.4]},
            "masks": [
                {"iou": 0.5, "area_px": 5000, "bbox": [40, 10, 60, 40]},
                {"iou": 0.9, "area_px": 6000, "bbox": [40, 10, 60, 40]},
                {"iou": 0.1, "area_px": 50, "bbox": [0, 0, 5, 5]},  # noise
            ],
        },
    )
    result = asyncio.run(MaskValidatorAgent().run(ctx))
    assert result.ok
    assert result.artifacts["validated_mask"]["iou"] == 0.9
    # The noise mask should be in rejections
    rejected_ious = [r.get("iou") for r in result.artifacts["mask_rejections"]]
    assert 0.1 in rejected_ious


def test_validator_all_invalid(tmp_path: Path):
    ctx = EnrichmentContext(
        sku_id="s",
        catalog_entry={"kind": "sprinkler_head"},
        cut_sheet_path=None,
        cut_sheet_url=None,
        workdir=tmp_path,
        llm_client=None,
        sam_url="",
        artifacts={
            "photos": [{"width": 100, "height": 100}],
            "grounding": {"bbox": [0.4, 0.4, 0.6, 0.6]},
            "masks": [
                {"iou": 0.4, "area_px": 20, "bbox": [0, 0, 5, 5]},
            ],
        },
    )
    result = asyncio.run(MaskValidatorAgent().run(ctx))
    assert not result.ok
    assert result.reason == "all-masks-invalid"
