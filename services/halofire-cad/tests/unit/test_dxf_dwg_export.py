"""R9.1 + R9.2 — DXF paper-space + DWG export.

Covers:
1. Back-compat ``export_dxf`` still produces a DXF ezdxf can reload.
2. ``export_dxf_with_sheets`` emits one paper-space layout per sheet.
3. Dimensions in a sheet become DIMENSION entities on the layout.
4. ``export_dwg`` with ODA absent emits a placeholder (no raise).
5. The placeholder DWG starts with the AC1024 magic bytes.
6. ``agent.export_all`` drops both DXF and DWG into the bundle dir.
"""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

_SUBMITTAL_DIR = ROOT / "agents" / "10-submittal"


def _load(name: str, filename: str):
    spec = importlib.util.spec_from_file_location(
        name, _SUBMITTAL_DIR / filename,
    )
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


AGENT = _load("hf_submittal_agent", "agent.py")
DXF_EXPORT = _load("hf_dxf_export", "dxf_export.py")
DWG_EXPORT = _load("hf_dwg_export", "dwg_export.py")

from cad.schema import (  # noqa: E402
    Building, Design, Head, Level, PipeSegment, Project,
    RiserSpec, System, Wall,
)


@pytest.fixture
def tiny_design() -> Design:
    project = Project(
        id="r9", name="R9 Smoke", address="Nowhere",
        ahj="AHJ", code="NFPA 13 2022",
    )
    building = Building(
        project_id="r9",
        levels=[Level(
            id="l1", name="Level 1", elevation_m=0.0, height_m=3.0,
            use="residential",
            walls=[
                Wall(id="w1", start_m=(0, 0), end_m=(10, 0)),
                Wall(id="w2", start_m=(10, 0), end_m=(10, 8)),
            ],
        )],
    )
    system = System(
        id="sys1", type="wet",
        riser=RiserSpec(id="r1", position_m=(0, 0, 0), size_in=4.0),
        heads=[
            Head(id="h1", sku="K56", k_factor=5.6, position_m=(1, 0, 3)),
            Head(id="h2", sku="K56", k_factor=5.6, position_m=(3, 0, 3)),
        ],
        pipes=[
            PipeSegment(
                id="p1", from_node="r1", to_node="h1",
                size_in=2.0, schedule="sch10",
                start_m=(0, 0, 3), end_m=(1, 0, 3), length_m=1.0,
            ),
            PipeSegment(
                id="p2", from_node="h1", to_node="h2",
                size_in=1.5, schedule="sch10",
                start_m=(1, 0, 3), end_m=(3, 0, 3), length_m=2.0,
            ),
        ],
    )
    return Design(project=project, building=building, systems=[system])


@pytest.fixture
def sample_sheets() -> list[dict]:
    return [
        {
            "name": "A-001",
            "paper_size_mm": (841.0, 594.0),
            "viewports": [
                {"center_paper_mm": (420.0, 297.0),
                 "size_paper_mm": (400.0, 300.0),
                 "view_center_m": (5.0, 4.0),
                 "view_height_m": 15.0},
            ],
            "dimensions": [
                {"kind": "linear",
                 "p1_m": (0.0, 0.0), "p2_m": (10.0, 0.0),
                 "base_m": (0.0, 2.0)},
                {"kind": "aligned",
                 "p1_m": (0.0, 0.0), "p2_m": (10.0, 8.0),
                 "distance": 1.5},
            ],
            "annotations": [
                {"text": "MATCHLINE — see A-002",
                 "text_position_paper_mm": (50.0, 50.0),
                 "leader_polyline_paper_mm": [(50, 50), (80, 70), (120, 70)]},
            ],
        },
        {
            "name": "A-002",
            "paper_size_mm": (594.0, 420.0),
            "viewports": [
                {"center_paper_mm": (297.0, 210.0),
                 "size_paper_mm": (300.0, 225.0),
                 "view_center_m": (2.0, 2.0),
                 "view_height_m": 10.0},
            ],
            "dimensions": [],
            "annotations": [],
        },
    ]


def test_export_dxf_back_compat_readable(tiny_design, tmp_path: Path) -> None:
    import ezdxf
    out = tmp_path / "compat.dxf"
    AGENT.export_dxf(tiny_design, out)
    assert out.exists() and out.stat().st_size > 100
    doc = ezdxf.readfile(str(out))
    # Model-space path still works; no extra sheet layouts added.
    assert "Model" in list(doc.layouts.names())


def test_export_dxf_with_sheets_creates_paper_layouts(
    tiny_design, sample_sheets, tmp_path: Path,
) -> None:
    import ezdxf
    out = tmp_path / "sheets.dxf"
    DXF_EXPORT.export_dxf_with_sheets(tiny_design, sample_sheets, out)
    doc = ezdxf.readfile(str(out))
    layout_names = set(doc.layouts.names())
    assert "A-001" in layout_names
    assert "A-002" in layout_names


def test_sheet_dimensions_emit_dimension_entities(
    tiny_design, sample_sheets, tmp_path: Path,
) -> None:
    import ezdxf
    out = tmp_path / "dims.dxf"
    DXF_EXPORT.export_dxf_with_sheets(tiny_design, sample_sheets, out)
    doc = ezdxf.readfile(str(out))
    sheet = doc.layouts.get("A-001")
    dims = [e for e in sheet if e.dxftype() == "DIMENSION"]
    # 2 dims in A-001 (one linear + one aligned)
    assert len(dims) >= 2, f"expected >=2 DIMENSION entities, got {len(dims)}"


def test_export_dwg_without_oda_emits_placeholder(
    tiny_design, tmp_path: Path, monkeypatch, caplog,
) -> None:
    # Force ODA lookup to fail regardless of host state.
    monkeypatch.setattr(DWG_EXPORT, "_oda_binary", lambda: None)
    out = tmp_path / "design.dwg"
    with caplog.at_level("WARNING", logger="submittal.dwg"):
        result = DWG_EXPORT.export_dwg(tiny_design, out)
    assert result == out
    assert out.exists() and out.stat().st_size > 20
    assert any("placeholder" in rec.message.lower()
               or "oda file converter" in rec.message.lower()
               for rec in caplog.records)


def test_placeholder_dwg_has_ac1024_magic(
    tiny_design, tmp_path: Path, monkeypatch,
) -> None:
    monkeypatch.setattr(DWG_EXPORT, "_oda_binary", lambda: None)
    out = tmp_path / "magic.dwg"
    DWG_EXPORT.export_dwg(tiny_design, out)
    head = out.read_bytes()[:6]
    assert head == b"AC1024", f"bad magic: {head!r}"


def test_export_all_produces_dxf_and_dwg(
    tiny_design, tmp_path: Path, monkeypatch,
) -> None:
    # Force placeholder path so the test runs on hosts without ODA.
    # agent.export_all loads dwg_export via importlib, which imports
    # the module fresh — patch shutil.which at that layer instead.
    import shutil as _shutil
    real_which = _shutil.which

    def fake_which(name, *a, **kw):
        if "ODAFileConverter" in name or name == "oda_fc":
            return None
        return real_which(name, *a, **kw)

    monkeypatch.setattr(_shutil, "which", fake_which)

    out_dir = tmp_path / "bundle"
    result = AGENT.export_all(tiny_design, out_dir)
    assert "dxf" in result, f"dxf missing from export_all: {result}"
    assert "dwg" in result, f"dwg missing from export_all: {result}"
    assert (out_dir / "design.dxf").exists()
    assert (out_dir / "design.dwg").exists()
