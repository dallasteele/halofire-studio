"""halofire DXF paper-space export — R9.1.

Extends the model-space-only emitter in ``agent.py`` with a
paper-space layout pipeline: one DXF per Design, with N paper-space
layouts (one per SheetNode), each containing viewports into the
model, DIMENSION entities (linear/aligned), and MTEXT/LEADER
annotations.

The original ``export_dxf(design, out_path)`` stays intact in
``agent.py`` for back-compat. This module re-exports it and adds
``export_dxf_with_sheets(design, sheets, out_path)``.

Sheets are passed as plain dicts so the Python side doesn't need a
direct mirror of the Pascal SheetNode schema:

    {
        "name": "A-001",
        "paper_size_mm": (841.0, 594.0),   # A1 default
        "viewports": [
            {"center_paper_mm": (420, 297),
             "size_paper_mm": (400, 300),
             "view_center_m": (0.0, 0.0),
             "view_height_m": 20.0,
             "scale": 0.02},              # paper mm per model m (optional)
        ],
        "dimensions": [
            {"kind": "linear",             # or "aligned"
             "p1_m": (0, 0), "p2_m": (5, 0),
             "base_m": (0, 1)},
        ],
        "annotations": [
            {"text": "MATCHLINE",
             "text_position_paper_mm": (50, 50),
             "leader_polyline_paper_mm": [(50,50),(80,60),(120,60)]},
        ],
    }
"""
from __future__ import annotations

import sys
from pathlib import Path
from typing import Any, Sequence

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from cad.schema import Design  # noqa: E402
from cad.logging import get_logger  # noqa: E402

log = get_logger("submittal.dxf")


PIPE_COLOR_BY_SIZE = {
    1.0:  (255, 255, 0),
    1.25: (255, 0, 255),
    1.5:  (0, 255, 255),
    2.0:  (0, 102, 255),
    2.5:  (0, 192, 64),
    3.0:  (232, 67, 45),
    4.0:  (255, 255, 255),
}


def _layer_name_for_pipe(size_in: float) -> str:
    return f"FP-PIPE-{str(size_in).replace('.', '-')}"


# Layer set used by both the back-compat model-only emitter and the
# sheet-aware one. Keys beyond what ``agent.py`` ships are additive
# per the R9.1 blueprint (FP-PIPES-MAIN/BRANCH/DROP, FP-VALVES,
# 0-ARCH for walls).
_BASE_LAYERS = {
    "FP-HEADS": (232, 67, 45),
    "FP-RISER": (255, 255, 255),
    "FP-HANGERS": (128, 128, 128),
    "FP-FDC": (232, 67, 45),
    "FP-PIPES-MAIN": (0, 102, 255),
    "FP-PIPES-BRANCH": (0, 255, 255),
    "FP-PIPES-DROP": (255, 255, 0),
    "FP-VALVES": (232, 67, 45),
    "0-ARCH": (160, 160, 160),
}


def _install_layers(doc: Any) -> None:
    layers = dict(_BASE_LAYERS)
    for size, color in PIPE_COLOR_BY_SIZE.items():
        layers[_layer_name_for_pipe(size)] = color
    for name, (r, g, b) in layers.items():
        if name in doc.layers:
            continue
        lay = doc.layers.add(name)
        lay.rgb = (r, g, b)


def _emit_model_geometry(doc: Any, design: Design) -> None:
    """Populate model space with heads, pipes, valves, hangers,
    walls. Shared by ``export_dxf`` (via agent.py) and the sheet-
    aware variant."""
    msp = doc.modelspace()

    # Walls on 0-ARCH
    for level in design.building.levels:
        for w in level.walls:
            msp.add_lwpolyline(
                [(w.start_m[0], w.start_m[1]),
                 (w.end_m[0], w.end_m[1])],
                dxfattribs={"layer": "0-ARCH"},
            )

    for system in design.systems:
        for h in system.heads:
            x, y, _ = h.position_m
            msp.add_circle((x, y), 0.1, dxfattribs={"layer": "FP-HEADS"})

        for s in system.pipes:
            layer = _layer_name_for_pipe(s.size_in)
            msp.add_lwpolyline(
                [(s.start_m[0], s.start_m[1]),
                 (s.end_m[0], s.end_m[1])],
                dxfattribs={"layer": layer},
            )

        r = system.riser
        msp.add_circle(
            (r.position_m[0], r.position_m[1]), 0.15,
            dxfattribs={"layer": "FP-RISER"},
        )

        for hg in system.hangers:
            msp.add_point(
                (hg.position_m[0], hg.position_m[1]),
                dxfattribs={"layer": "FP-HANGERS"},
            )


def _add_sheet_dimension(layout: Any, dim: dict) -> None:
    kind = dim.get("kind", "linear")
    p1 = dim["p1_m"]
    p2 = dim["p2_m"]
    if kind == "aligned":
        distance = float(dim.get("distance", 1.0))
        d = layout.add_aligned_dim(p1=p1, p2=p2, distance=distance)
    else:  # linear
        base = dim.get("base_m", (p1[0], p1[1] + 1.0))
        angle = float(dim.get("angle_deg", 0.0))
        d = layout.add_linear_dim(base=base, p1=p1, p2=p2, angle=angle)
    # add_* helpers return a DimStyleOverride; render() writes the
    # actual DIMENSION entity into the layout.
    d.render()


def _add_sheet_annotation(layout: Any, ann: dict) -> None:
    text = ann.get("text", "")
    pos = ann.get("text_position_paper_mm", (0.0, 0.0))
    if text:
        mt = layout.add_mtext(text, dxfattribs={"layer": "0"})
        mt.set_location(pos)
    leader_pts = ann.get("leader_polyline_paper_mm")
    if leader_pts and len(leader_pts) >= 2:
        layout.add_leader(list(leader_pts), dxfattribs={"layer": "0"})


def _add_sheet_viewport(layout: Any, vp: dict) -> None:
    center = vp.get("center_paper_mm", (0.0, 0.0))
    size = vp.get("size_paper_mm", (200.0, 150.0))
    view_center = vp.get("view_center_m", (0.0, 0.0))
    view_height = float(vp.get("view_height_m", 20.0))
    layout.add_viewport(
        center=center,
        size=size,
        view_center_point=view_center,
        view_height=view_height,
    )


def export_dxf_with_sheets(
    design: Design,
    sheets: Sequence[dict],
    out_path: Path,
) -> str:
    """Emit a DXF with model-space geometry plus one paper-space
    layout per sheet dict. Returns the written path as string."""
    import ezdxf

    doc = ezdxf.new(dxfversion="R2018", setup=True)
    _install_layers(doc)
    _emit_model_geometry(doc, design)

    for sheet in sheets:
        name = str(sheet.get("name", "Sheet"))
        # Avoid clobbering the default Layout1
        if name in doc.layouts:
            name = f"{name}_{id(sheet)}"
        layout = doc.layouts.new(name)
        # Paper size in mm — ezdxf paper_units default is mm when set
        paper = sheet.get("paper_size_mm", (841.0, 594.0))
        try:
            layout.page_setup(
                size=(float(paper[0]), float(paper[1])),
                margins=(5, 5, 5, 5),
                units="mm",
            )
        except Exception as e:  # pragma: no cover — non-fatal
            log.warning("page_setup failed for %s: %s", name, e)

        for vp in sheet.get("viewports", []):
            _add_sheet_viewport(layout, vp)
        for dim in sheet.get("dimensions", []):
            _add_sheet_dimension(layout, dim)
        for ann in sheet.get("annotations", []):
            _add_sheet_annotation(layout, ann)

    doc.saveas(out_path)
    return str(out_path)


__all__ = ["export_dxf_with_sheets"]
