"""Unit test — submittal sheet-set PDF generation (reportlab)."""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_ROOT))

_spec = importlib.util.spec_from_file_location(
    "submittal",
    _ROOT / "agents" / "09-proposal" / "submittal.py",
)
assert _spec is not None and _spec.loader is not None
SUB = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(SUB)

_HAS_REPORTLAB = SUB._REPORTLAB


_SAMPLE = {
    "project": {
        "name": "The Cooperative 1881",
        "address": "1881 W North Temple, Salt Lake City, UT",
    },
    "generated_at": "2026-04-20",
    "pricing": {"total_usd": 144829.25},
    "levels": [
        {"id": "L0", "name": "Ground", "elevation_ft": 0,
         "head_count": 42, "pipe_total_ft": 400, "room_count": 5},
        {"id": "L1", "name": "Level 1", "elevation_ft": 11,
         "head_count": 88, "pipe_total_ft": 700, "room_count": 12},
    ],
    "systems": [
        {
            "id": "SYS-1", "type": "wet",
            "head_count": 42, "pipe_count": 18,
            "pipe_total_m": 120, "hanger_count": 18,
            "riser_size_in": 4, "fdc_type": "wall_mount",
            "hydraulic": {
                "required_flow_gpm": 250,
                "required_pressure_psi": 50,
                "supply_static_psi": 75,
                "supply_residual_psi": 55,
                "safety_margin_psi": 15,
            },
        },
    ],
    "bom": [
        {
            "sku": "SM_Head_Pendant_Standard_K56",
            "qty": 130, "unit": "ea",
            "unit_cost_usd": 8.50, "extended_usd": 1105.0,
            "do_not_fab": False, "price_stale": False,
            "price_missing": False,
        },
        {
            "sku": "pipe_sch10_2in_ft", "qty": 240, "unit": "ft",
            "unit_cost_usd": 5.60, "extended_usd": 1814.4,
            "do_not_fab": True,  # <3"
            "price_stale": False, "price_missing": False,
        },
    ],
}


@pytest.mark.skipif(not _HAS_REPORTLAB, reason="reportlab not installed")
def test_submittal_pdf_produces_multipage_file(tmp_path: Path) -> None:
    out = SUB.write_submittal_pdf(_SAMPLE, tmp_path)
    assert out.exists()
    # PDF starts with %PDF- and is non-trivial in size
    data = out.read_bytes()
    assert data.startswith(b"%PDF-")
    assert len(data) > 3000  # 6 pages worth
    # ≥ 6 sheets of the expected set
    pages = data.count(b"/Type /Page ") + data.count(b"/Type /Page\n")
    assert pages >= 6


@pytest.mark.skipif(not _HAS_REPORTLAB, reason="reportlab not installed")
def test_submittal_pdf_extra_level_adds_a_page(tmp_path: Path) -> None:
    base_out = SUB.write_submittal_pdf(_SAMPLE, tmp_path)
    base_size = base_out.stat().st_size
    extended = dict(_SAMPLE)
    extended["levels"] = _SAMPLE["levels"] + [
        {"id": "L2", "name": "Level 2", "elevation_ft": 22,
         "head_count": 100, "pipe_total_ft": 900, "room_count": 16},
    ]
    out2 = SUB.write_submittal_pdf(
        extended, tmp_path, filename="submittal2.pdf",
    )
    # Extra plan sheet → larger file
    assert out2.stat().st_size > base_size


def test_fallback_when_reportlab_missing(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setattr(SUB, "_REPORTLAB", False)
    out = SUB.write_submittal_pdf(_SAMPLE, tmp_path)
    assert out.exists()
    content = out.read_text(encoding="utf-8")
    assert "reportlab missing" in content


def test_submittal_pdf_empty_bom_does_not_crash(tmp_path: Path) -> None:
    data = dict(_SAMPLE)
    data["bom"] = []
    data["systems"] = []
    data["levels"] = []
    out = SUB.write_submittal_pdf(data, tmp_path, filename="empty.pdf")
    assert out.exists()
    if _HAS_REPORTLAB:
        assert out.read_bytes().startswith(b"%PDF-")
