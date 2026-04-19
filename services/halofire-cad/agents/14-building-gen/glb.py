"""Emit a GLB mesh of a generated Building for the Studio viewport.

Per AGENTIC_RULES §1.1 typed output, §1.3 errors as data, §5 tested.

Walls → extruded prisms, slabs → flat boxes, shafts → hollow
prisms. All meshes share a PBR material for the building shell so
the sprinkler geometry (heads + pipes) stays visually distinct.
"""
from __future__ import annotations

import math
import sys
from pathlib import Path

import numpy as np
import trimesh
from shapely.geometry import Polygon

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from cad.schema import Building  # noqa: E402
from cad.logging import get_logger  # noqa: E402
from cad.exceptions import GLBExportError  # noqa: E402

log = get_logger("building_gen.glb")


SHELL_COLOR = (0.82, 0.82, 0.86, 1.0)
SLAB_COLOR = (0.55, 0.55, 0.58, 1.0)
SHAFT_COLOR = (0.32, 0.32, 0.38, 1.0)


def _shell_material() -> trimesh.visual.material.PBRMaterial:
    return trimesh.visual.material.PBRMaterial(
        baseColorFactor=SHELL_COLOR,
        metallicFactor=0.1, roughnessFactor=0.9,
    )


def _slab_material() -> trimesh.visual.material.PBRMaterial:
    return trimesh.visual.material.PBRMaterial(
        baseColorFactor=SLAB_COLOR,
        metallicFactor=0.05, roughnessFactor=0.95,
    )


def _shaft_material() -> trimesh.visual.material.PBRMaterial:
    return trimesh.visual.material.PBRMaterial(
        baseColorFactor=SHAFT_COLOR,
        metallicFactor=0.2, roughnessFactor=0.8,
    )


def _wall_mesh(
    start: tuple[float, float], end: tuple[float, float],
    z_bottom: float, z_top: float, thickness: float,
) -> trimesh.Trimesh | None:
    dx = end[0] - start[0]
    dy = end[1] - start[1]
    length = math.hypot(dx, dy)
    if length < 0.1:
        return None
    # Axis-aligned or rotated box. Build a box of (length × thickness
    # × height), then rotate + translate into place.
    height = z_top - z_bottom
    box = trimesh.creation.box(extents=(length, thickness, height))
    # Align box's X axis to the wall direction
    angle = math.atan2(dy, dx)
    R = trimesh.transformations.rotation_matrix(angle, [0, 0, 1])
    box.apply_transform(R)
    # Translate centroid to the wall midpoint @ mid-height
    midx = (start[0] + end[0]) / 2
    midy = (start[1] + end[1]) / 2
    midz = (z_bottom + z_top) / 2
    box.apply_translation((midx, midy, midz))
    box.visual = trimesh.visual.TextureVisuals(material=_shell_material())
    return box


def _slab_mesh(
    polygon_m: list[tuple[float, float]], z: float,
    thickness: float = 0.2,
) -> trimesh.Trimesh | None:
    if len(polygon_m) < 3:
        return None
    try:
        shapely_poly = Polygon(polygon_m)
        if not shapely_poly.is_valid:
            shapely_poly = shapely_poly.buffer(0)
        mesh = trimesh.creation.extrude_polygon(shapely_poly, thickness)
    except (ValueError, TypeError, RuntimeError) as e:
        log.warning(
            "hf.building_gen.slab_mesh_failed",
            extra={"err": str(e), "pts": len(polygon_m)},
        )
        return None
    mesh.apply_translation((0, 0, z))
    mesh.visual = trimesh.visual.TextureVisuals(material=_slab_material())
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
    except (ValueError, TypeError, RuntimeError) as e:
        log.warning(
            "hf.building_gen.shaft_mesh_failed", extra={"err": str(e)},
        )
        return None
    mesh.apply_translation((0, 0, z_bottom))
    mesh.visual = trimesh.visual.TextureVisuals(material=_shaft_material())
    return mesh


def building_to_glb(building: Building, out_path: Path) -> str:
    """Emit a single .glb containing the whole building shell.

    Returns the output path string.
    """
    meshes: list[trimesh.Trimesh] = []
    for level in building.levels:
        # Slab
        slab = _slab_mesh(level.polygon_m, level.elevation_m)
        if slab is not None:
            meshes.append(slab)
        # Walls
        for w in level.walls:
            m = _wall_mesh(
                w.start_m, w.end_m,
                level.elevation_m, level.elevation_m + w.height_m,
                w.thickness_m,
            )
            if m is not None:
                meshes.append(m)
        # Stair + elevator shafts (tall columns crossing levels)
        for shaft in level.stair_shafts + level.elevator_shafts:
            m = _shaft_mesh(
                shaft.polygon_m, shaft.bottom_z_m, shaft.top_z_m,
            )
            if m is not None:
                meshes.append(m)

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
