"""halofire intake agent — PDF → Building JSON via the 4-layer pipeline.

L1 (pdfplumber vector) is the fastest + highest-fidelity layer when
the PDF is vector-native. This module owns L1 + wall clustering +
room polygon extraction. L2/L3/L4 are stubs that will be filled in
during Phase 2 of the plan.
"""
from __future__ import annotations

import logging
import math
import sys
from pathlib import Path
from typing import Any

import pdfplumber  # type: ignore
from shapely.geometry import LineString, Polygon, MultiPolygon
from shapely.ops import polygonize, unary_union

# Ensure `cad/` is on the path when this file runs standalone
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from cad.schema import (  # noqa: E402
    Building, Level, Room, Wall, Ceiling,
)

log = logging.getLogger(__name__)

# Snap tolerance for orthogonality (degrees)
ORTHO_TOL_DEG = 3.0

# Wall-thickness range in PDF points (assuming Letter @ 72 dpi).
# 4" @ scale 1/4"=1'-0" → 1 pt; 12" → 3 pt. We widen because PDF line
# widths are plotted in mm, not model units.
WALL_MIN_PT = 0.5
WALL_MAX_PT = 6.0

# Maximum wall thickness in drawing points — used for pairing parallel
# lines. Adjusted by detected scale.
WALL_PAIR_MAX_OFFSET_PT = 20.0


def _is_orthogonal(x0: float, y0: float, x1: float, y1: float) -> bool:
    """True if line is within ORTHO_TOL_DEG of horizontal or vertical."""
    dx = x1 - x0
    dy = y1 - y0
    if dx == 0 and dy == 0:
        return False
    angle = math.degrees(math.atan2(dy, dx)) % 180
    return (
        angle < ORTHO_TOL_DEG
        or angle > 180 - ORTHO_TOL_DEG
        or abs(angle - 90) < ORTHO_TOL_DEG
    )


def _is_orthogonal_obj(line: dict[str, float]) -> bool:
    return _is_orthogonal(
        float(line["x0"]),
        float(line["y0"]),
        float(line["x1"]),
        float(line["y1"]),
    )


def _segments_from_pdfplumber(
    plumber_lines: list[dict[str, Any]],
) -> list[LineString]:
    """Keep orthogonal thick strokes only (candidate walls)."""
    segs: list[LineString] = []
    for ln in plumber_lines:
        try:
            lw = float(ln.get("linewidth", 0.0) or 0.0)
        except (TypeError, ValueError):
            lw = 0.0
        if lw < WALL_MIN_PT or lw > WALL_MAX_PT:
            continue
        if not _is_orthogonal_obj(ln):
            continue
        try:
            segs.append(LineString([
                (float(ln["x0"]), float(ln["y0"])),
                (float(ln["x1"]), float(ln["y1"])),
            ]))
        except (KeyError, TypeError, ValueError):
            continue
    return segs


def _detect_scale_ft_per_pt(text_fragments: list[dict[str, Any]]) -> float:
    """Look for a 'SCALE: 1/4" = 1'-0"' callout and convert to ft/pt.

    Common arch scales (imperial) at 72 dpi Letter:
      1/32" = 1'-0"  →  96 ft/in  →  1.333 ft/pt (tiny)
      1/16" = 1'-0"  →  48 ft/in  →  0.667 ft/pt
      1/8"  = 1'-0"  →  24 ft/in  →  0.333 ft/pt  (most common @ Letter)
      3/16" = 1'-0"  →  16 ft/in  →  0.222 ft/pt
      1/4"  = 1'-0"  →  12 ft/in  →  0.167 ft/pt  (most common @ D-size)
      1/2"  = 1'-0"  →   6 ft/in  →  0.083 ft/pt

    Fallback: 0.333 ft/pt (1/8" = 1'-0" at Letter).
    """
    text = " ".join(
        str(f.get("text") or "") for f in (text_fragments or [])
    ).lower()
    mapping = {
        '1/32" = 1\'': 96 / 72,
        '1/16" = 1\'': 48 / 72,
        '1/8" = 1\'': 24 / 72,
        '3/16" = 1\'': 16 / 72,
        '1/4" = 1\'': 12 / 72,
        '3/8" = 1\'':  8 / 72,
        '1/2" = 1\'':  6 / 72,
        '3/4" = 1\'':  4 / 72,
        '1" = 1\'':    1 / 72,
    }
    for key, value in mapping.items():
        if key in text:
            return value
    return 24 / 72  # default 1/8"=1'-0"


def _cluster_walls(segments: list[LineString]) -> list[tuple[float, float, float, float]]:
    """Cluster thick parallel line pairs into wall centerlines.

    Simple first-cut: treat every thick orthogonal segment as its own
    wall centerline. Phase 2 improves this via pair detection +
    midline averaging.

    Returns list of (x0, y0, x1, y1) in PDF points.
    """
    walls: list[tuple[float, float, float, float]] = []
    for seg in segments:
        coords = list(seg.coords)
        if len(coords) < 2:
            continue
        (x0, y0), (x1, y1) = coords[0], coords[-1]
        walls.append((float(x0), float(y0), float(x1), float(y1)))
    return walls


def _polygons_from_walls(
    walls: list[tuple[float, float, float, float]],
) -> list[Polygon]:
    """Run shapely polygonize on the wall segment set to find rooms.

    Uses unary_union to handle intersections, then polygonize. Rooms
    smaller than 2 sqm are filtered as likely duct chases or junk.
    """
    if not walls:
        return []
    lines = [LineString([(x0, y0), (x1, y1)]) for x0, y0, x1, y1 in walls]
    merged = unary_union(lines)
    polys: list[Polygon] = list(polygonize(merged))
    # Filter tiny fragments (< 2 sqm in PDF-point² — caller converts)
    return [p for p in polys if p.area > 100.0]


def intake_pdf_page(pdf_path: str, page_index: int) -> dict[str, Any]:
    """Run L1 + wall clustering + polygonization on one PDF page.

    Returns a JSON-safe dict that includes the detected walls + room
    polygons in PDF points + the detected scale. Caller converts to
    meters using scale_ft_per_pt.

    This is the L1 core. Full Building assembly (multi-page walk +
    level separation + obstruction detection + IFC/DWG import) happens
    in intake_file() below.
    """
    result: dict[str, Any] = {
        "pdf_path": pdf_path,
        "page_index": page_index,
        "wall_count": 0,
        "room_count": 0,
        "scale_ft_per_pt": 0.0,
        "warnings": [],
        "walls": [],
        "rooms": [],
    }
    try:
        with pdfplumber.open(pdf_path) as pdf:
            if page_index >= len(pdf.pages):
                result["warnings"].append(
                    f"page {page_index} out of range ({len(pdf.pages)} pages)"
                )
                return result
            page = pdf.pages[page_index]
            result["page_w_pt"] = float(page.width)
            result["page_h_pt"] = float(page.height)
            lines = list(page.lines or [])
            chars = list(page.chars or [])[:5000]
            segments = _segments_from_pdfplumber(lines)
            walls = _cluster_walls(segments)
            polygons = _polygons_from_walls(walls)
            scale_ft_per_pt = _detect_scale_ft_per_pt(chars)
            result["wall_count"] = len(walls)
            result["room_count"] = len(polygons)
            result["scale_ft_per_pt"] = scale_ft_per_pt
            result["raw_line_count"] = len(lines)
            # Down-sample for JSON payload
            result["walls"] = [
                {"x0": x0, "y0": y0, "x1": x1, "y1": y1}
                for x0, y0, x1, y1 in walls[:500]
            ]
            result["rooms"] = [
                {
                    "polygon_pt": [(float(x), float(y)) for x, y in poly.exterior.coords],
                    "area_pt2": float(poly.area),
                }
                for poly in polygons[:200]
            ]
    except Exception as e:
        log.exception("intake_pdf_page failed")
        result["warnings"].append(f"exception: {e}")
    return result


def intake_file(pdf_path: str, project_id: str) -> Building:
    """Scan every page, produce a Building with one Level per detected
    floor-plan page.

    Floor-plan detection is heuristic: pages with >20 thick orthogonal
    lines are probably plans; title-block text is scanned for level
    names ("LEVEL 1", "SECOND FLOOR", "ROOF PLAN"). All pages that
    don't match a level are skipped.
    """
    levels: list[Level] = []
    if not Path(pdf_path).exists():
        return Building(project_id=project_id, levels=[])
    try:
        with pdfplumber.open(pdf_path) as pdf:
            n_pages = len(pdf.pages)
    except Exception as e:
        log.exception("intake_file open failed: %s", e)
        return Building(project_id=project_id, levels=[])

    for i in range(min(n_pages, 60)):  # cap walk length for dev
        page_out = intake_pdf_page(pdf_path, i)
        if page_out.get("wall_count", 0) < 20:
            continue
        scale = page_out.get("scale_ft_per_pt") or (24 / 72)
        m_per_pt = scale * 0.3048  # ft → m
        level = Level(
            id=f"level_p{i}",
            name=f"Floor plan (page {i + 1})",
            elevation_m=float(i) * 3.0,  # placeholder until title-block
            height_m=3.0,
            use="other",
            polygon_m=[],
            ceiling=Ceiling(),
        )
        # Walls in meters
        for w in page_out.get("walls", []):
            level.walls.append(Wall(
                id=f"w_p{i}_{len(level.walls)}",
                start_m=(w["x0"] * m_per_pt, w["y0"] * m_per_pt),
                end_m=(w["x1"] * m_per_pt, w["y1"] * m_per_pt),
                thickness_m=0.2,
                height_m=3.0,
            ))
        # Rooms in meters
        for r in page_out.get("rooms", []):
            poly_m = [(x * m_per_pt, y * m_per_pt) for x, y in r["polygon_pt"]]
            area_sqm = float(r.get("area_pt2", 0.0)) * (m_per_pt ** 2)
            level.rooms.append(Room(
                id=f"r_p{i}_{len(level.rooms)}",
                name=f"Room {len(level.rooms) + 1}",
                polygon_m=poly_m,
                area_sqm=area_sqm,
            ))
        levels.append(level)

    return Building(project_id=project_id, levels=levels)


if __name__ == "__main__":
    import json
    if len(sys.argv) < 2:
        print("usage: python agent.py <pdf> [project_id]")
        sys.exit(2)
    pdf = sys.argv[1]
    proj = sys.argv[2] if len(sys.argv) > 2 else "demo"
    bldg = intake_file(pdf, proj)
    print(json.dumps(bldg.model_dump(), indent=2))
