"""H.3 — a1_intake unit tests.

Uses tiny synthetic PDFs written on the fly via PyMuPDF so we don't
ship fixture binaries in the repo. Each test asserts on the pure
extraction helpers where possible so the agent contract stays crisp.
"""
from __future__ import annotations

import asyncio
from pathlib import Path

import pytest

from enrichment_agents._protocol import EnrichmentContext
from enrichment_agents.a1_intake import IntakeAgent, _extract_page1


def _make_pdf_with_image(path: Path, image: bytes) -> None:
    import fitz

    doc = fitz.open()
    page = doc.new_page(width=600, height=800)
    # Insert a visible text block so spec_text extraction is exercised.
    page.insert_text((50, 50), "Model: TEST-SKU\nK-factor: 5.6")
    # Insert the image large enough to pass the 64px minimum.
    pix = fitz.Pixmap(image)
    page.insert_image(fitz.Rect(100, 100, 500, 700), pixmap=pix)
    doc.save(path)
    doc.close()


def _red_png() -> bytes:
    # Minimal 128x128 red PNG generated via PyMuPDF.
    import fitz

    pix = fitz.Pixmap(fitz.csRGB, fitz.IRect(0, 0, 128, 128))
    pix.set_rect(pix.irect, (200, 20, 20))
    return pix.tobytes("png")


@pytest.fixture
def tmp_pdf(tmp_path: Path) -> Path:
    pdf = tmp_path / "test.pdf"
    _make_pdf_with_image(pdf, _red_png())
    return pdf


def test_extract_page1_returns_largest_first(tmp_pdf: Path, tmp_path: Path) -> None:
    photos, spec_text = _extract_page1(tmp_pdf, tmp_path / "work")
    assert photos, "expected at least one photo extracted"
    assert photos[0]["page"] == 1
    assert photos[0]["width"] >= 64
    assert "K-factor" in spec_text


def test_extract_page1_empty_pdf_returns_empty(tmp_path: Path) -> None:
    import fitz

    pdf = tmp_path / "empty.pdf"
    doc = fitz.open()
    doc.new_page()
    doc.save(pdf)
    doc.close()

    photos, spec = _extract_page1(pdf, tmp_path / "work")
    assert photos == []
    assert spec == ""


def test_intake_agent_ok_with_local_pdf(tmp_pdf: Path, tmp_path: Path) -> None:
    ctx = EnrichmentContext(
        sku_id="test_sku",
        catalog_entry={"sku": "test_sku", "kind": "sprinkler_head"},
        cut_sheet_path=tmp_pdf,
        cut_sheet_url=None,
        workdir=tmp_path / "workdir",
        llm_client=None,
        sam_url="http://127.0.0.1:18081",
    )
    agent = IntakeAgent()
    result = asyncio.run(agent.run(ctx))
    assert result.ok
    assert "photos" in (result.artifacts or {})
    assert result.artifacts["cut_sheet_sha256"]


def test_intake_agent_fails_without_cutsheet(tmp_path: Path) -> None:
    ctx = EnrichmentContext(
        sku_id="no_sheet",
        catalog_entry={"sku": "no_sheet", "kind": "sprinkler_head"},
        cut_sheet_path=None,
        cut_sheet_url=None,
        workdir=tmp_path / "wd",
        llm_client=None,
        sam_url="http://127.0.0.1:18081",
    )
    result = asyncio.run(IntakeAgent().run(ctx))
    assert not result.ok
    assert result.reason == "no-cut-sheet"


def test_intake_agent_corrupt_pdf(tmp_path: Path) -> None:
    bad = tmp_path / "bad.pdf"
    bad.write_bytes(b"not a pdf")
    ctx = EnrichmentContext(
        sku_id="bad",
        catalog_entry={"sku": "bad", "kind": "sprinkler_head"},
        cut_sheet_path=bad,
        cut_sheet_url=None,
        workdir=tmp_path / "wd",
        llm_client=None,
        sam_url="http://127.0.0.1:18081",
    )
    result = asyncio.run(IntakeAgent().run(ctx))
    assert not result.ok
    assert "pdf-unreadable" in (result.reason or "")
