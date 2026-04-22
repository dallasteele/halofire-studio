"""H.3 — a2_grounding unit tests. LLM mocked via an in-proc fake."""
from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any

import pytest

from enrichment_agents._protocol import EnrichmentContext
from enrichment_agents.a2_grounding import (
    GroundingAgent,
    _FALLBACK_BBOX,
    _parse_llm_response,
)


class _FakeClient:
    def __init__(self, *, response: str = "", available: bool = True):
        self._response = response
        self.available = available
        self.calls: list[dict[str, Any]] = []

    async def vision(self, prompt: str, *, images, max_tokens: int = 512) -> str:
        self.calls.append({"prompt": prompt, "n_images": len(images), "max_tokens": max_tokens})
        return self._response

    async def chat(self, *args, **kwargs) -> str:  # pragma: no cover
        return self._response


def _ctx(tmp_path: Path, llm) -> EnrichmentContext:
    photo = tmp_path / "p.png"
    # Write tiny bytes — the agent only reads them, doesn't decode.
    photo.write_bytes(b"\x89PNG\r\n\x1a\nfakepng")
    return EnrichmentContext(
        sku_id="sku1",
        catalog_entry={
            "sku": "sku1",
            "kind": "sprinkler_head",
            "manufacturer": "tyco",
            "mfg_part_number": "TY3251",
            "params": {"size_in": {"default": 0.5}, "length_in": {"default": 2.25}},
        },
        cut_sheet_path=None,
        cut_sheet_url=None,
        workdir=tmp_path,
        llm_client=llm,
        sam_url="http://127.0.0.1:18081",
        artifacts={"photos": [{"path": str(photo), "width": 400, "height": 600}], "spec_text": "K=5.6"},
    )


def test_grounding_happy_path(tmp_path: Path):
    llm = _FakeClient(
        response=json.dumps(
            {"bbox": [0.2, 0.3, 0.8, 0.9], "confidence": 0.88, "reasoning": "centered body"}
        )
    )
    result = asyncio.run(GroundingAgent().run(_ctx(tmp_path, llm)))
    assert result.ok
    g = result.artifacts["grounding"]
    assert g["source"] == "llm"
    assert g["bbox"] == [0.2, 0.3, 0.8, 0.9]
    assert g["confidence"] == pytest.approx(0.88)


def test_grounding_fallback_on_unavailable(tmp_path: Path):
    llm = _FakeClient(available=False)
    result = asyncio.run(GroundingAgent().run(_ctx(tmp_path, llm)))
    assert result.ok  # fallback keeps pipeline moving
    g = result.artifacts["grounding"]
    assert g["source"] == "fallback"
    assert g["bbox"] == list(_FALLBACK_BBOX)


def test_grounding_fallback_on_unparseable(tmp_path: Path):
    llm = _FakeClient(response="sorry, I can't help with that")
    result = asyncio.run(GroundingAgent().run(_ctx(tmp_path, llm)))
    assert result.ok
    assert result.artifacts["grounding"]["source"] == "fallback"


def test_grounding_extracts_json_from_fenced_block(tmp_path: Path):
    llm = _FakeClient(
        response="Sure, here:\n```json\n"
        + json.dumps({"bbox": [0.1, 0.1, 0.5, 0.5], "confidence": 0.5})
        + "\n```\n"
    )
    result = asyncio.run(GroundingAgent().run(_ctx(tmp_path, llm)))
    g = result.artifacts["grounding"]
    assert g["source"] == "llm"
    assert g["bbox"] == [0.1, 0.1, 0.5, 0.5]


def test_parse_llm_response_rejects_degenerate_box():
    bbox, conf, reason, source = _parse_llm_response(
        json.dumps({"bbox": [0.5, 0.5, 0.5, 0.5]})
    )
    assert source == "fallback"


def test_parse_llm_response_clamps_coords():
    bbox, *_ = _parse_llm_response(
        json.dumps({"bbox": [-0.1, 0.0, 1.2, 0.9], "confidence": 0.9})
    )
    assert bbox[0] == 0.0
    assert bbox[2] == 1.0


def test_grounding_no_photo(tmp_path: Path):
    ctx = EnrichmentContext(
        sku_id="x",
        catalog_entry={},
        cut_sheet_path=None,
        cut_sheet_url=None,
        workdir=tmp_path,
        llm_client=_FakeClient(),
        sam_url="",
        artifacts={},
    )
    result = asyncio.run(GroundingAgent().run(ctx))
    assert not result.ok
    assert result.reason == "no-photo-to-ground"
