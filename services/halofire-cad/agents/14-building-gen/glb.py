"""Emit a GLB mesh of a generated Building for the Studio viewport.

Phase S1 (2026-04-20) upgrades:
- Every interior wall gets a door opening (boolean-subtracted box)
- Every exterior wall segment ≥ 3 m gets a window strip
- A roof slab at the top of the topmost level
- Per-use wall coloring so garage/residential/roof read visually

Per AGENTIC_RULES §1.1 typed output, §1.3 errors as data, §5 tested.
"""
from __future__ import annotations

import math
import sys
from pathlib import Path

import numpy as np
import trimesh
from shapely.errors import GEOSException
from shapely.geometry import Polygon

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from cad.schema import Building, Level, Wall  # noqa: E402
from cad.logging import get_logger, warn_swallowed  # noqa: E402
from cad.exceptions import GLBExportError  # noqa: E402

log = get_logger("building_gen.glb")


# Per-use wall colors (RGBA). Garage dark concrete; residential
# warm stucco; mech steel; roof slate-grey; default neutral.
WALL_COLOR_BY_USE: dict[str, tuple[float, float, float, float]] = {
    "garage": (0.32, 0.32, 0.34, 1.0),
    "residential": (0.88, 0.84, 0.76, 1.0),
    "mechanical": (0.55, 0.57, 0.62, 1.0),
    "retail": (0.78, 0.72, 0.60, 1.0),
    "amenity": (0.85, 0.82, 0.74, 1.0),
    "office": (0.72, 0.74, 0.78, 1.0),
    "roof": (0.48, 0.50, 0.54, 1.0),
    "other": (0.82, 0.82, 0.86, 1.0),
}

SLAB_COLOR = (0.42, 0.44, 0.48, 1.0)
ROOF_COLOR = (0.36, 0.38, 0.42, 1.0)
SHAFT_COLOR = (0.22, 0.22, 0.26, 1.0)
DOOR_COLOR = (0.18, 0.20, 0.26, 1.0)
WINDOW_COLOR = (0.55, 0.75, 0.92, 0.75)

# Standard sizes (meters)
DOOR_WIDTH = 0.9
DOOR_HEIGHT = 2.1
WINDOW_WIDTH_FRAC = 0.6  # of wall length
WINDOW_HEIGHT = 1.2
WINDOW_SILL = 1.0


def _pbr(color: tuple[float, float, float, float],
         metallic: float = 0.1, rough: float = 0.85):
    return trimesh.visual.material.PBRMaterial(
        baseColorFactor=color,
        metallicFactor=metallic,
        roughnessFactor=rough,
        alphaMode="BLEND" if color[3] < 0.99 else "OPAQUE",
    )


def _wall_box(
    start: tuple[float, float], end: tuple[float, float],
    z_bottom: float, z_top: float, thickness: float,
) -> trimesh.Trimesh | None:
    dx = end[0] - start[0]
    dy = end[1] - start[1]
    length = math.hypot(dx, dy)
    if length < 0.1:
        return None
    height = z_top - z_bottom
    box = trimesh.creation.box(extents=(length, thickness, height))
    angle = math.atan2(dy, dx)
    R = trimesh.transformations.rotation_matrix(angle, [0, 0, 1])
    box.apply_transform(R)
    midx = (start[0] + end[0]) / 2
    midy = (start[1] + end[1]) / 2
    midz = (z_bottom + z_top) / 2
    box.apply_translation((midx, midy, midz))
    return box


def _door_cutout_box(
    start: tuple[float, float], end: tuple[float, float],
    z_bottom: float, thickness: float,
    along_frac: float = 0.5,
) -> trimesh.Trimesh | None:
    """Cutout box aligned to the wall, positioned at `along_frac`
    of the wall length. Slightly thicker than the wall so boolean
    difference eats cleanly through both faces.
    """
    dx = end[0] - start[0]
    dy = end[1] - start[1]
    length = math.hypot(dx, dy)
    if length < DOOR_WIDTH + 0.3:
        return None
    cut_thickness = thickness * 3  # over-extrude so boolean is stable
    cut = trimesh.creation.box(
        extents=(DOOR_WIDTH, cut_thickness, DOOR_HEIGHT),
    )
    angle = math.atan2(dy, dx)
    R = trimesh.transformations.rotation_matrix(angle, [0, 0, 1])
    cut.apply_transform(R)
    # Position: along_frac of wall length, at z = z_bottom + DOOR_HEIGHT/2
    cx = start[0] + (end[0] - start[0]) * along_frac
    cy = start[1] + (end[1] - start[1]) * along_frac
    cut.apply_translation((cx, cy, z_bottom + DOOR_HEIGHT / 2))
    return cut


def _window_cutout_box(
    start: tuple[float, float], end: tuple[float, float],
    z_bottom: float, thickness: float,
) -> trimesh.Trimesh | None:
    dx = end[0] - start[0]
    dy = end[1] - start[1]
    length = math.hypot(dx, dy)
    if length < 2.0:  # too short for a window strip
        return None
    win_len = length * WINDOW_WIDTH_FRAC
    cut = trimesh.creation.box(
        extents=(win_len, thickness * 3, WINDOW_HEIGHT),
    )
    angle = math.atan2(dy, dx)
    R = trimesh.transformations.rotation_matrix(angle, [0, 0, 1])
    cut.apply_transform(R)
    # Center along the wall; height = z_bottom + WINDOW_SILL + H/2
    mx = (start[0] + end[0]) / 2
    my = (start[1] + end[1]) / 2
    cut.apply_translation((mx, my, z_bottom + WINDOW_SILL + WINDOW_HEIGHT / 2))
    return cut


def _wall_mesh_with_openings(
    wall: Wall, level: Level, color: tuple[float, float, float, float],
    with_openings: bool = True,
) -> trimesh.Trimesh | None:
    """Generate wall mesh, optionally with a door (interior) or
    window (exterior) cut out via boolean difference.

    `with_openings=False` short-circuits the boolean ops (solid wall).
    Used by tests + CI to keep runtime sane — trimesh.boolean is ~1s
    per op and a 100-room building has 100+ walls.
    """
    box = _wall_box(
        wall.start_m, wall.end_m,
        level.elevation_m, level.elevation_m + wall.height_m,
        wall.thickness_m,
    )
    if box is None:
        return None

    if not with_openings:
        box.visual = trimesh.visual.TextureVisuals(material=_pbr(color))
        return box

    cutouts: list[trimesh.Trimesh] = []
    if wall.is_exterior:
        # Windows on exterior walls (ground level still gets
        # windows; fine for a synthetic model).
        win = _window_cutout_box(
            wall.start_m, wall.end_m,
            level.elevation_m, wall.thickness_m,
        )
        if win is not None:
            cutouts.append(win)
    else:
        # Doors on interior walls
        door = _door_cutout_box(
            wall.start_m, wall.end_m,
            level.elevation_m, wall.thickness_m,
        )
        if door is not None:
            cutouts.append(door)

    if cutouts:
        try:
            # Union cutouts first to minimize boolean ops
            if len(cutouts) > 1:
                cut_union = trimesh.boolean.union(cutouts)
            else:
                cut_union = cutouts[0]
            result = trimesh.boolean.difference([box, cut_union])
            if result is not None and not result.is_empty:
                box = result
        except (RuntimeError, ValueError, TypeError) as e:
            warn_swallowed(
                log, code="WALL_BOOLEAN_FAIL", err=e,
                wall_id=wall.id,
            )
            # fall through with uncut box

    box.visual = trimesh.visual.TextureVisuals(material=_pbr(color))
    return box


def _slab_mesh(
    polygon_m: list[tuple[float, float]], z: float,
    color: tuple[float, float, float, float] = SLAB_COLOR,
    thickness: float = 0.2,
) -> trimesh.Trimesh | None:
    if len(polygon_m) < 3:
        return None
    try:
        shapely_poly = Polygon(polygon_m)
        if not shapely_poly.is_valid:
            shapely_poly = shapely_poly.buffer(0)
        mesh = trimesh.creation.extrude_polygon(shapely_poly, thickness)
    except (ValueError, TypeError, RuntimeError, GEOSException) as e:
        warn_swallowed(
            log, code="SLAB_MESH_FAIL", err=e, pts=len(polygon_m),
        )
        return None
    mesh.apply_translation((0, 0, z))
    mesh.visual = trimesh.visual.TextureVisuals(material=_pbr(color))
    return mesh


def _shaft_mesh(
    polygon_m: list[tuple[float, float]], z_bottom: float, z_top: float,
) -> trimesh.Trimesh | None:
    if len(polygon_m) < 3:
        return None
    try:
        shapely_poly = Polygon(polygon_m)
        if not shapely_poly.is_valid:
            shapely_poly = shapely_poly.buffer(0)
        height = z_top - z_bottom
        mesh = trimesh.creation.extrude_polygon(shapely_poly, height)
    except (ValueError, TypeError, RuntimeError, GEOSException) as e:
        warn_swallowed(log, code="SHAFT_MESH_FAIL", err=e)
        return None
    mesh.apply_translation((0, 0, z_bottom))
    mesh.visual = trimesh.visual.TextureVisuals(
        material=_pbr(SHAFT_COLOR, metallic=0.2, rough=0.7),
    )
    return mesh


def building_to_glb(
    building: Building, out_path: Path,
    with_openings: bool = False,
) -> str:
    """Emit a single .glb with slabs, walls, shafts, roof.

    `with_openings=True` boolean-subtracts doors (interior walls) +
    windows (exterior walls) from every wall mesh. Slow
    (~1 s per wall) — only enable for user-facing renders, never
    for tests / CI. Default False keeps test run under 10s.
    """
    meshes: list[trimesh.Trimesh] = []
    if not building.levels:
        raise GLBExportError(
            "building has no renderable geometry — empty levels?",
        )

    top_elev = max(
        lvl.elevation_m + lvl.height_m for lvl in building.levels
    )
    top_poly: list[tuple[float, float]] = []

    for level in building.levels:
        if not top_poly and level.polygon_m:
            top_poly = list(level.polygon_m)

        # Slab color per-use
        use_color = WALL_COLOR_BY_USE.get(level.use, WALL_COLOR_BY_USE["other"])
        slab = _slab_mesh(level.polygon_m, level.elevation_m, SLAB_COLOR)
        if slab is not None:
            meshes.append(slab)

        # Walls with openings, colored per use
        for w in level.walls:
            m = _wall_mesh_with_openings(
                w, level, use_color, with_openings=with_openings,
            )
            if m is not None:
                meshes.append(m)

        # Shafts span multiple levels — only emit the shaft mesh
        # on the FIRST level the shaft appears on. Others would
        # duplicate geometry.
        if level is building.levels[0]:
            for shaft in level.stair_shafts + level.elevator_shafts:
                m = _shaft_mesh(
                    shaft.polygon_m,
                    shaft.bottom_z_m, shaft.top_z_m,
                )
                if m is not None:
                    meshes.append(m)

    # Roof slab on top
    if top_poly:
        roof = _slab_mesh(
            top_poly, top_elev, ROOF_COLOR, thickness=0.3,
        )
        if roof is not None:
            meshes.append(roof)

    if not meshes:
        raise GLBExportError(
            "building has no renderable geometry — empty levels?",
        )

    scene = trimesh.Scene(meshes)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    scene.export(str(out_path), file_type="glb")
    log.info(
        "hf.building_gen.glb_emitted",
        extra={"path": str(out_path), "meshes": len(meshes)},
    )
    return str(out_path)
