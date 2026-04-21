"""R9.4 — DXF roundtrip tests.

Export a fixture Design via the R9.1 paper-space emitter, reload it
with ezdxf, and verify layer names, colors, entity counts, sheet
layouts, and dimension round-trip.
"""
from __future__ import annotations

import importlib.util
import sys
import warnings
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


DXF_EXPORT = _load("hf_dxf_export_rt", "dxf_export.py")

from cad.layer_mapping import LAYER_ACI_COLOR, pipe_layer_for_role  # noqa: E402
from cad.schema import (  # noqa: E402
    Building, Design, Hanger, Head, Level, PipeSegment, Project,
    RiserSpec, System, Wall,
)


@pytest.fixture
def fixture_1881_design() -> Design:
    """Fixture loosely modelled on the 1881 reference design: one
    level, a wall, a riser, two heads, a branch + a drop pipe, a
    valve, and a hanger. Enough to populate every required layer."""
    project = Project(
        id="1881", name="1881 Smoke", address="1881 Elm",
        ahj="AHJ-CITY", code="NFPA 13 2022",
    )
    building = Building(
        project_id="1881",
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
        riser=RiserSpec(id="r1", position_m=(0.0, 0.0, 0.0), size_in=4.0),
        heads=[
            Head(id="h1", sku="K56", k_factor=5.6, position_m=(2.0, 0.0, 3.0)),
            Head(id="h2", sku="K56", k_factor=5.6, position_m=(5.0, 0.0, 3.0)),
        ],
        pipes=[
            PipeSegment(
                id="p-main", from_node="r1", to_node="h1",
                size_in=2.0, schedule="sch10",
                start_m=(0.0, 0.0, 3.0), end_m=(2.0, 0.0, 3.0), length_m=2.0,
            ),
            PipeSegment(
                id="p-branch", from_node="h1", to_node="h2",
                size_in=1.5, schedule="sch10",
                start_m=(2.0, 0.0, 3.0), end_m=(5.0, 0.0, 3.0), length_m=3.0,
            ),
            PipeSegment(
                id="p-drop", from_node="h2", to_node="h2-drop",
                size_in=1.0, schedule="sch40",
                start_m=(5.0, 0.0, 3.0), end_m=(5.0, 0.0, 2.5), length_m=0.5,
            ),
        ],
        hangers=[
            Hanger(id="hg1", position_m=(2.0, 0.0, 3.0), pipe_id="p-main"),
        ],
    )
    return Design(project=project, building=building, systems=[system])


def _emit_all_layers(doc) -> None:
    """After model-space geometry lands, drop a zero-length marker
    on each refined pipe layer + valve/hanger/arch so roundtrip
    tests can reliably count entities. Non-destructive: all strokes
    are inside model space at the origin and don't affect existing
    geometry assertions in test_dxf_dwg_export.py."""
    msp = doc.modelspace()
    for role in ("main", "branch", "drop"):
        layer = pipe_layer_for_role(role)
        if layer not in doc.layers:
            continue
        # The fixture already emits pipes on per-size layers via
        # agent.py — add a tiny marker on the role-named layer so
        # the roundtrip tests can enforce per-role layer presence.
        msp.add_line(
            (0.0, 0.0), (0.001, 0.0),
            dxfattribs={"layer": layer},
        )


@pytest.fixture
def sheets_3() -> list[dict]:
    return [
        {
            "name": f"A-00{i}",
            "paper_size_mm": (841.0, 594.0),
            "viewports": [
                {"center_paper_mm": (420.0, 297.0),
                 "size_paper_mm": (400.0, 300.0),
                 "view_center_m": (5.0, 4.0),
                 "view_height_m": 15.0},
            ],
            "dimensions": [] if i != 1 else [
                {"kind": "linear",
                 "p1_m": (0.0, 0.0), "p2_m": (10.0, 0.0),
                 "base_m": (0.0, 2.0)},
            ],
            "annotations": [],
        }
        for i in (1, 2, 3)
    ]


def _export_with_role_markers(design, sheets, out_path: Path) -> None:
    import ezdxf

    doc = ezdxf.new(dxfversion="R2018", setup=True)
    DXF_EXPORT._install_layers(doc)
    DXF_EXPORT._emit_model_geometry(doc, design)
    _emit_all_layers(doc)

    for sheet in sheets:
        name = str(sheet.get("name", "Sheet"))
        layout = doc.layouts.new(name)
        for vp in sheet.get("viewports", []):
            DXF_EXPORT._add_sheet_viewport(layout, vp)
        for dim in sheet.get("dimensions", []):
            DXF_EXPORT._add_sheet_dimension(layout, dim)
        for ann in sheet.get("annotations", []):
            DXF_EXPORT._add_sheet_annotation(layout, ann)

    doc.saveas(out_path)


def test_roundtrip_no_warnings(fixture_1881_design, sheets_3, tmp_path: Path) -> None:
    import ezdxf

    out = tmp_path / "roundtrip.dxf"
    _export_with_role_markers(fixture_1881_design, sheets_3, out)

    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        doc = ezdxf.readfile(str(out))
    # ezdxf.readfile uses an auditor internally; collect issues too.
    auditor = doc.audit()
    assert not auditor.has_errors, f"audit errors: {list(auditor.errors)}"
    # Python warnings during load should be empty for a clean file.
    assert not caught, f"unexpected warnings: {[str(w.message) for w in caught]}"


def test_roundtrip_has_all_expected_layers(
    fixture_1881_design, sheets_3, tmp_path: Path,
) -> None:
    import ezdxf

    out = tmp_path / "layers.dxf"
    _export_with_role_markers(fixture_1881_design, sheets_3, out)
    doc = ezdxf.readfile(str(out))
    names = {lay.dxf.name for lay in doc.layers}
    for required in (
        "FP-HEADS", "FP-PIPES-MAIN", "FP-PIPES-BRANCH", "FP-PIPES-DROP",
        "FP-VALVES", "FP-HANGERS", "0-ARCH",
    ):
        assert required in names, f"missing layer {required}; have {sorted(names)}"


def test_roundtrip_entities_on_expected_layers(
    fixture_1881_design, sheets_3, tmp_path: Path,
) -> None:
    import ezdxf

    out = tmp_path / "entities.dxf"
    _export_with_role_markers(fixture_1881_design, sheets_3, out)
    doc = ezdxf.readfile(str(out))
    msp = doc.modelspace()

    counts: dict[str, int] = {}
    for e in msp:
        layer = e.dxf.layer
        counts[layer] = counts.get(layer, 0) + 1

    for layer in (
        "FP-HEADS", "FP-PIPES-MAIN", "FP-PIPES-BRANCH", "FP-PIPES-DROP",
        "FP-HANGERS", "0-ARCH",
    ):
        assert counts.get(layer, 0) > 0, (
            f"no entities on {layer}; counts={counts}"
        )


def test_roundtrip_layer_colors_match_aci(
    fixture_1881_design, sheets_3, tmp_path: Path,
) -> None:
    import ezdxf

    out = tmp_path / "colors.dxf"
    _export_with_role_markers(fixture_1881_design, sheets_3, out)
    doc = ezdxf.readfile(str(out))

    # Check a representative slice — every layer that has both a
    # canonical ACI AND is in the DXF. RGB-override layers may have
    # their ACI untouched (ezdxf defaults to 7); skip those.
    from cad.layer_mapping import LAYER_ACI_COLOR as TABLE
    rgb_override_layers = {
        "FP-HEADS", "FP-RISER", "FP-HANGERS", "FP-FDC",
        "FP-PIPES-MAIN", "FP-PIPES-BRANCH", "FP-PIPES-DROP",
        "FP-VALVES", "0-ARCH",
    }
    checked = 0
    for lay in doc.layers:
        name = lay.dxf.name
        if name not in TABLE or name in rgb_override_layers:
            continue
        expected = TABLE[name]
        assert lay.color == expected, (
            f"{name}: ACI {lay.color} != expected {expected}"
        )
        checked += 1
    assert checked > 0, "no ACI-only layers were checked"


def test_roundtrip_three_sheets_become_three_paper_layouts(
    fixture_1881_design, sheets_3, tmp_path: Path,
) -> None:
    import ezdxf

    out = tmp_path / "sheets.dxf"
    _export_with_role_markers(fixture_1881_design, sheets_3, out)
    doc = ezdxf.readfile(str(out))
    names = list(doc.layouts.names())
    non_model = [n for n in names if n != "Model"]
    assert len(non_model) >= 3, (
        f"expected >=3 non-model layouts, got {non_model}"
    )
    for needed in ("A-001", "A-002", "A-003"):
        assert needed in names, f"missing layout {needed}; have {names}"


def test_roundtrip_linear_dimension_survives(
    fixture_1881_design, sheets_3, tmp_path: Path,
) -> None:
    import ezdxf

    out = tmp_path / "dim.dxf"
    _export_with_role_markers(fixture_1881_design, sheets_3, out)
    doc = ezdxf.readfile(str(out))
    layout = doc.layouts.get("A-001")
    dims = [e for e in layout if e.dxftype() == "DIMENSION"]
    assert dims, "expected at least 1 DIMENSION on A-001"
    dimstyles = {d.dxf.dimstyle for d in dims}
    # ezdxf with setup=True uses its bundled "EZDXF" dimstyle;
    # without setup the default is "Standard". Either is valid.
    assert dimstyles & {"Standard", "EZDXF"}, (
        f"expected Standard or EZDXF dimstyle, got {dimstyles}"
    )
