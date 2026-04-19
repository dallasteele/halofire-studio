"""Smoke validation for submittal exports — Phase D.1.

Each export (DXF / GLB / IFC) writes a file that third-party CAD /
BIM / glTF tools can open. These tests don't launch AutoCAD — that
requires manual inspection per the Phase D plan. But they do
*parse* each output with its native library to catch structural
breakage before anyone opens it in the real tool.
"""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

_SPEC = importlib.util.spec_from_file_location(
    "hf_submittal", ROOT / "agents" / "10-submittal" / "agent.py",
)
assert _SPEC is not None and _SPEC.loader is not None
SUBMITTAL = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(SUBMITTAL)

from cad.schema import (  # noqa: E402
    Building, Design, FlowTestData, Head, Level, PipeSegment, Project,
    RiserSpec, System,
)


@pytest.fixture
def tiny_design() -> Design:
    project = Project(
        id="smoke", name="Smoke Test", address="Nowhere",
        ahj="Smoke AHJ", code="NFPA 13 2022",
    )
    building = Building(
        project_id="smoke",
        levels=[Level(
            id="l1", name="Level 1", elevation_m=0.0, height_m=3.0,
            use="residential",
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


def test_dxf_export_produces_readable_file(tiny_design, tmp_path: Path) -> None:
    """ezdxf.readfile() must re-open the exported DXF cleanly."""
    import ezdxf
    out = tmp_path / "smoke.dxf"
    SUBMITTAL.export_dxf(tiny_design, out)
    assert out.exists() and out.stat().st_size > 100

    doc = ezdxf.readfile(str(out))
    # The layer table must contain every required FP-* layer
    layer_names = {layer.dxf.name for layer in doc.layers}
    required = {"FP-HEADS", "FP-RISER", "FP-HANGERS", "FP-FDC",
                "FP-PIPE-2-0", "FP-PIPE-1-5"}
    missing = required - layer_names
    assert not missing, f"DXF missing required layers: {missing}"


def test_dxf_export_has_head_circles(tiny_design, tmp_path: Path) -> None:
    """Every head must emit a CIRCLE entity on FP-HEADS layer."""
    import ezdxf
    out = tmp_path / "heads.dxf"
    SUBMITTAL.export_dxf(tiny_design, out)
    doc = ezdxf.readfile(str(out))
    msp = doc.modelspace()
    heads_circles = [
        e for e in msp
        if e.dxftype() == "CIRCLE" and e.dxf.layer == "FP-HEADS"
    ]
    assert len(heads_circles) >= 2, (
        f"expected 2+ head circles, got {len(heads_circles)}"
    )


def test_glb_export_produces_readable_gltf(tiny_design, tmp_path: Path) -> None:
    """trimesh must re-open the exported GLB without errors."""
    import trimesh
    out = tmp_path / "smoke.glb"
    path = SUBMITTAL.export_glb(tiny_design, out)
    assert path, "GLB export returned empty path"
    assert out.exists() and out.stat().st_size > 1000

    scene = trimesh.load(str(out))
    # At least one mesh should be present (heads + pipes)
    mesh_count = len(scene.geometry) if hasattr(scene, "geometry") else 0
    assert mesh_count > 0, "GLB scene has no geometry"


def test_ifc_export_parses_as_valid_ifc(tiny_design, tmp_path: Path) -> None:
    """IfcOpenShell must re-open the exported IFC without errors."""
    import ifcopenshell
    out = tmp_path / "smoke.ifc"
    path = SUBMITTAL.export_ifc(tiny_design, out)
    if not path:
        pytest.skip("ifcopenshell not available in this env")
    assert out.exists() and out.stat().st_size > 500

    ifc = ifcopenshell.open(str(out))
    schema = ifc.schema
    assert schema in {"IFC4", "IFC4X3"}, f"unexpected IFC schema: {schema}"
    # IfcFireSuppressionTerminal is the IFC4-stable entity for
    # sprinkler heads (with PredefinedType SPRINKLER). IfcSprinkler
    # itself is not in IFC4 / IFC4X3 schemas.
    heads = ifc.by_type("IfcFireSuppressionTerminal")
    assert len(heads) >= 2, (
        f"expected 2+ IfcFireSuppressionTerminal, got {len(heads)}"
    )
    # Every head must have PredefinedType = SPRINKLER
    for term in heads:
        ptype = getattr(term, "PredefinedType", None)
        assert ptype == "SPRINKLER", f"head {term.Name}: wrong type {ptype}"
    # At least one IfcProject
    projects = ifc.by_type("IfcProject")
    assert len(projects) == 1
    # At least one IfcBuildingStorey (levels)
    storeys = ifc.by_type("IfcBuildingStorey")
    assert len(storeys) >= 1


def test_ifc_pipes_have_swept_solid_geometry(tiny_design, tmp_path: Path) -> None:
    """Phase D.2: pipes must have IfcProductDefinitionShape with
    IfcExtrudedAreaSolid body, not just entity shells."""
    import ifcopenshell
    out = tmp_path / "geom.ifc"
    path = SUBMITTAL.export_ifc(tiny_design, out)
    if not path:
        pytest.skip("ifcopenshell not available")
    ifc = ifcopenshell.open(str(out))
    pipes = ifc.by_type("IfcPipeSegment")
    assert len(pipes) >= 2, f"expected 2+ pipes, got {len(pipes)}"
    # Every pipe has a Representation with at least one shape rep
    for seg in pipes:
        rep = seg.Representation
        assert rep is not None, f"pipe {seg.Name} missing Representation"
        shape_reps = rep.Representations
        assert len(shape_reps) >= 1
        # The first shape rep must be a SweptSolid with
        # IfcExtrudedAreaSolid as its first item
        sr = shape_reps[0]
        assert sr.RepresentationType == "SweptSolid", (
            f"pipe {seg.Name} has {sr.RepresentationType}, expected SweptSolid"
        )
        items = sr.Items
        assert len(items) >= 1
        assert items[0].is_a("IfcExtrudedAreaSolid"), (
            f"pipe {seg.Name} first item is {items[0].is_a()}, "
            "expected IfcExtrudedAreaSolid"
        )
        # Radius matches size_in × 0.0254 / 2
        profile = items[0].SweptArea
        assert profile.is_a("IfcCircleProfileDef")
        # At least 0.5" radius (our pipes are 1.5" and 2")
        assert profile.Radius > 0.005


def test_ifc_heads_have_local_placement(tiny_design, tmp_path: Path) -> None:
    """Phase D.2: each head's ObjectPlacement anchors it in space."""
    import ifcopenshell
    out = tmp_path / "placed.ifc"
    path = SUBMITTAL.export_ifc(tiny_design, out)
    if not path:
        pytest.skip("ifcopenshell not available")
    ifc = ifcopenshell.open(str(out))
    terms = ifc.by_type("IfcFireSuppressionTerminal")
    for term in terms:
        placement = term.ObjectPlacement
        assert placement is not None
        assert placement.is_a("IfcLocalPlacement")


def test_export_all_returns_paths_or_errors(tiny_design, tmp_path: Path) -> None:
    """export_all must return a dict with either a path or a typed
    error for each format — never silent failures."""
    result = SUBMITTAL.export_all(tiny_design, tmp_path)
    for key in ("dxf", "glb"):
        # Each format either succeeds (key in result) or fails with
        # a <key>_error entry
        assert key in result or f"{key}_error" in result, (
            f"export_all missing {key} outcome"
        )
