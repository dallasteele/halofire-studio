"""Trimesh fallback renderer for the Phase 4.1 OpenSCAD assets.
Mirrors drop_ceiling_tile.scad / hanger.scad / fdc.scad / beam.scad
geometry so we ship GLBs even without OpenSCAD installed.
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
import trimesh

_OUT = Path(__file__).resolve().parents[4] / "apps" / "editor" / "public" / "halofire-catalog" / "glb"
_ASSETS = Path(__file__).resolve().parents[2] / "assets" / "glb"


def _concrete() -> trimesh.visual.material.PBRMaterial:
    return trimesh.visual.material.PBRMaterial(
        baseColorFactor=[0.62, 0.62, 0.65, 1.0],
        metallicFactor=0.05, roughnessFactor=0.85,
    )


def _steel() -> trimesh.visual.material.PBRMaterial:
    return trimesh.visual.material.PBRMaterial(
        baseColorFactor=[0.55, 0.57, 0.60, 1.0],
        metallicFactor=0.85, roughnessFactor=0.35,
    )


def _red_paint() -> trimesh.visual.material.PBRMaterial:
    return trimesh.visual.material.PBRMaterial(
        baseColorFactor=[0.91, 0.26, 0.18, 1.0],  # #e8432d
        metallicFactor=0.40, roughnessFactor=0.45,
    )


def _ceiling_tile() -> trimesh.visual.material.PBRMaterial:
    return trimesh.visual.material.PBRMaterial(
        baseColorFactor=[0.92, 0.91, 0.87, 1.0],
        metallicFactor=0.0, roughnessFactor=0.95,
    )


def _to_y_up_meters(m: trimesh.Trimesh) -> trimesh.Trimesh:
    R = trimesh.transformations.rotation_matrix(-np.pi / 2, [1, 0, 0])
    m.apply_transform(R)
    m.apply_scale(0.001)  # mm → m
    return m


def render_drop_ceiling_tile(out: Path) -> Path:
    """24" T-bar tile + grid frame."""
    tile_w, tile_d, tile_t = 600, 600, 16
    tbar_w, tbar_h = 24, 32
    tile = trimesh.creation.box(extents=(tile_w, tile_d, tile_t))
    tile.apply_translation((0, 0, tile_t / 2))
    tile.visual = trimesh.visual.TextureVisuals(material=_ceiling_tile())
    grids: list[trimesh.Trimesh] = []
    for axis in (0, 1):
        for sgn in (-1, 1):
            if axis == 0:
                g = trimesh.creation.box(extents=(tbar_w, tile_d, tbar_h))
                g.apply_translation((
                    sgn * (tile_w / 2 - tbar_w / 2), 0, -tbar_h / 2,
                ))
            else:
                g = trimesh.creation.box(extents=(tile_w, tbar_w, tbar_h))
                g.apply_translation((
                    0, sgn * (tile_d / 2 - tbar_w / 2), -tbar_h / 2,
                ))
            g.visual = trimesh.visual.TextureVisuals(material=_steel())
            grids.append(g)
    mesh = trimesh.util.concatenate([tile, *grids])
    mesh = _to_y_up_meters(mesh)
    out.parent.mkdir(parents=True, exist_ok=True)
    trimesh.Scene([mesh]).export(str(out), file_type="glb")
    return out


def render_hanger(out: Path, pipe_size_in: float = 2.0) -> Path:
    pipe_dia = pipe_size_in * 25.4
    rod_len = 250
    parts: list[trimesh.Trimesh] = []
    # U-bolt (simplified annulus segment)
    ring = trimesh.creation.annulus(
        r_min=pipe_dia / 2,
        r_max=pipe_dia / 2 + 6,
        height=6,
    )
    R = trimesh.transformations.rotation_matrix(np.pi / 2, [1, 0, 0])
    ring.apply_transform(R)
    parts.append(ring)
    # Rod
    rod = trimesh.creation.cylinder(radius=4.75, height=rod_len, sections=12)
    rod.apply_translation((0, 0, rod_len / 2 + pipe_dia / 2))
    parts.append(rod)
    # Clip
    clip = trimesh.creation.box(extents=(40, 40, 4))
    clip.apply_translation((0, 0, rod_len + pipe_dia / 2))
    parts.append(clip)
    mesh = trimesh.util.concatenate(parts)
    mesh.visual = trimesh.visual.TextureVisuals(material=_steel())
    mesh = _to_y_up_meters(mesh)
    out.parent.mkdir(parents=True, exist_ok=True)
    trimesh.Scene([mesh]).export(str(out), file_type="glb")
    return out


def render_fdc(out: Path) -> Path:
    plate_w, plate_h, plate_t = 200, 250, 6
    inlet_dia = 2.5 * 25.4
    inlet_proj = 80
    parts: list[trimesh.Trimesh] = []
    plate = trimesh.creation.box(extents=(plate_w, plate_h, plate_t))
    plate.apply_translation((0, 0, plate_t / 2))
    plate.visual = trimesh.visual.TextureVisuals(material=_red_paint())
    parts.append(plate)
    for sx in (-1, 1):
        inlet = trimesh.creation.cylinder(
            radius=inlet_dia / 2, height=inlet_proj, sections=24,
        )
        Rx = trimesh.transformations.rotation_matrix(np.pi / 2, [1, 0, 0])
        inlet.apply_transform(Rx)
        inlet.apply_translation((sx * 50, 0, plate_t + inlet_proj / 2))
        inlet.visual = trimesh.visual.TextureVisuals(material=_red_paint())
        parts.append(inlet)
        # Stortz lug ring
        ring = trimesh.creation.cylinder(
            radius=inlet_dia / 2 + 8, height=12, sections=24,
        )
        ring.apply_transform(Rx)
        ring.apply_translation((sx * 50, 0, plate_t + inlet_proj))
        ring.visual = trimesh.visual.TextureVisuals(material=_red_paint())
        parts.append(ring)
    mesh = trimesh.util.concatenate(parts)
    mesh = _to_y_up_meters(mesh)
    out.parent.mkdir(parents=True, exist_ok=True)
    trimesh.Scene([mesh]).export(str(out), file_type="glb")
    return out


def render_beam(out: Path, length_m: float = 6.0) -> Path:
    length = length_m * 1000
    flange_w = 6.5 * 25.4
    depth = 12.2 * 25.4
    flange_t = 0.38 * 25.4
    web_t = 0.23 * 25.4
    top = trimesh.creation.box(extents=(length, flange_w, flange_t))
    top.apply_translation((0, 0, depth / 2 - flange_t / 2))
    bot = trimesh.creation.box(extents=(length, flange_w, flange_t))
    bot.apply_translation((0, 0, -depth / 2 + flange_t / 2))
    web = trimesh.creation.box(extents=(length, web_t, depth - 2 * flange_t))
    mesh = trimesh.util.concatenate([top, bot, web])
    mesh.visual = trimesh.visual.TextureVisuals(material=_steel())
    mesh = _to_y_up_meters(mesh)
    out.parent.mkdir(parents=True, exist_ok=True)
    trimesh.Scene([mesh]).export(str(out), file_type="glb")
    return out


def main() -> None:
    pairs = [
        ("SM_DropCeilingTile_24in_T-bar.glb", render_drop_ceiling_tile, {}),
        ("SM_Hanger_2in_UBolt_10inDrop.glb", render_hanger, {"pipe_size_in": 2.0}),
        ("SM_FDC_2.5in_Stortz_TwoInlet.glb", render_fdc, {}),
        ("SM_Beam_W12x26_6m.glb", render_beam, {"length_m": 6.0}),
    ]
    for fname, fn, kw in pairs:
        for d in (_OUT, _ASSETS):
            p = d / fname
            fn(p, **kw)
            print(f"wrote {p}")


if __name__ == "__main__":
    main()
