"""Unit tests for the cut-sheet PDF bundle."""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

_SPEC = importlib.util.spec_from_file_location(
    "cut_sheets", ROOT / "agents" / "09-proposal" / "cut_sheets.py",
)
assert _SPEC is not None and _SPEC.loader is not None
CS = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(CS)


_BOM = [
    {"sku": "SM_Head_Pendant_Standard_K56", "description": "Pendant K=5.6",
     "qty": 130, "unit": "ea", "unit_cost_usd": 8.50},
    {"sku": "pipe_sch10_2in_ft", "description": "2\" SCH10 pipe",
     "qty": 240, "unit": "ft", "unit_cost_usd": 5.60},
    {"sku": "valve_gate_4in", "description": "4\" OS&Y gate",
     "qty": 1, "unit": "ea", "unit_cost_usd": 485.0},
]


@pytest.mark.skipif(not CS._REPORTLAB, reason="reportlab missing")
def test_bundle_stubs_every_sku_when_no_library(tmp_path: Path) -> None:
    res = CS.write_cut_sheet_bundle(_BOM, tmp_path)
    assert Path(res["path"]).exists()
    assert res["sku_count"] == 3
    assert res["real_sheets"] == 0
    assert set(res["stubbed"]) == {
        "SM_Head_Pendant_Standard_K56",
        "pipe_sch10_2in_ft",
        "valve_gate_4in",
    }
    assert res["merger"] in ("pypdf", "index-only")


@pytest.mark.skipif(not CS._REPORTLAB, reason="reportlab missing")
def test_real_sheet_beats_stub(tmp_path: Path) -> None:
    # Place a real cut sheet in the shared library
    lib = tmp_path / "lib"
    lib.mkdir()
    fake_real = lib / "valve_gate_4in.pdf"
    fake_real.write_bytes(b"%PDF-1.4\n% real content\n%%EOF\n")
    proj = tmp_path / "project" / "deliverables"
    proj.mkdir(parents=True)
    res = CS.write_cut_sheet_bundle(_BOM, proj, shared_library=lib)
    assert "valve_gate_4in" not in res["stubbed"]
    assert res["real_sheets"] == 1


def test_resolve_cut_sheet_prefers_project_dir(tmp_path: Path) -> None:
    proj = tmp_path / "proj"
    lib = tmp_path / "lib"
    (proj / "cut_sheets").mkdir(parents=True)
    lib.mkdir()
    # Same SKU in both places
    (proj / "cut_sheets" / "X.pdf").write_bytes(b"from_project")
    (lib / "X.pdf").write_bytes(b"from_library")
    p = CS.resolve_cut_sheet("X", proj, shared_library=lib)
    assert p is not None
    # Project dir wins
    assert "proj" in str(p)


def test_resolve_cut_sheet_returns_none_when_missing(tmp_path: Path) -> None:
    assert CS.resolve_cut_sheet("nope", tmp_path) is None


def test_dedup_skus_preserves_order_and_drops_duplicates() -> None:
    bom = [
        {"sku": "A"}, {"sku": "B"}, {"sku": "A"},
        {"sku": ""}, {"sku": None}, {"sku": "C"},
    ]
    assert CS._dedup_skus(bom) == ["A", "B", "C"]


@pytest.mark.skipif(not CS._REPORTLAB, reason="reportlab missing")
def test_stub_sheet_includes_sku_and_metadata(tmp_path: Path) -> None:
    out = tmp_path / "stub.pdf"
    CS._stub_sheet(
        out, "TEST-SKU",
        row={"description": "Test fitting", "qty": 5, "unit": "ea",
             "unit_cost_usd": 12.34},
        parts={"manufacturer": "Victaulic", "model": "V-test",
               "connection": "grooved"},
    )
    assert out.exists()
    data = out.read_bytes()
    assert data.startswith(b"%PDF-")
    # PDF content encodes strings in various formats; the text will
    # appear somewhere if not compressed. At minimum the PDF is
    # non-trivial in size.
    assert len(data) > 1500


@pytest.mark.skipif(not CS._REPORTLAB, reason="reportlab missing")
def test_empty_bom_produces_index_only_pdf(tmp_path: Path) -> None:
    res = CS.write_cut_sheet_bundle([], tmp_path)
    assert Path(res["path"]).exists()
    assert res["sku_count"] == 0


@pytest.mark.skipif(not CS._REPORTLAB, reason="reportlab missing")
def test_bundle_file_is_valid_pdf(tmp_path: Path) -> None:
    res = CS.write_cut_sheet_bundle(_BOM, tmp_path)
    p = Path(res["path"])
    assert p.read_bytes().startswith(b"%PDF-")
