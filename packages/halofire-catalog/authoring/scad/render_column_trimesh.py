"""Trimesh fallback for column.scad — emits the same shape via
Python so we don't block on a local OpenSCAD install. Mirrors the
geometry described in column.scad (square or round shaft + chamfered
base + chamfered cap).

Usage:
    python render_column_trimesh.py --size_in 16 --height_ft 10 \
        --out apps/editor/public/halofire-catalog/glb/SM_Column_Concrete_16in_10ft.glb
"""
from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
import trimesh


def square_column(
    size_mm: float, height_mm: float, chamfer_mm: float = 25.0,
) -> trimesh.Trimesh:
    """Square shaft + base flare + cap, all centered at origin."""
    w = size_mm
    f = w + 2 * chamfer_mm  # base / cap footprint
    base = trimesh.creation.box(extents=(f, f, chamfer_mm))
    base.apply_translation((0, 0, -height_mm / 2))
    shaft = trimesh.creation.box(extents=(w, w, height_mm - 2 * chamfer_mm))
    cap = trimesh.creation.box(extents=(f, f, chamfer_mm))
    cap.apply_translation((0, 0, height_mm / 2))
    mesh = trimesh.util.concatenate([base, shaft, cap])
    # Concrete grey PBR
    mat = trimesh.visual.material.PBRMaterial(
        baseColorFactor=[0.62, 0.62, 0.65, 1.0],
        metallicFactor=0.05,
        roughnessFactor=0.85,
    )
    mesh.visual = trimesh.visual.TextureVisuals(material=mat)
    return mesh


def round_column(
    size_mm: float, height_mm: float, chamfer_mm: float = 25.0,
    sections: int = 32,
) -> trimesh.Trimesh:
    """Round shaft + tapered chamfer base/cap."""
    r = size_mm / 2
    base = trimesh.creation.cylinder(
        radius=r + chamfer_mm, height=chamfer_mm, sections=sections,
    )
    base.apply_translation((0, 0, -height_mm / 2))
    shaft = trimesh.creation.cylinder(
        radius=r, height=height_mm - 2 * chamfer_mm, sections=sections,
    )
    cap = trimesh.creation.cylinder(
        radius=r + chamfer_mm, height=chamfer_mm, sections=sections,
    )
    cap.apply_translation((0, 0, height_mm / 2))
    mesh = trimesh.util.concatenate([base, shaft, cap])
    mat = trimesh.visual.material.PBRMaterial(
        baseColorFactor=[0.62, 0.62, 0.65, 1.0],
        metallicFactor=0.05,
        roughnessFactor=0.85,
    )
    mesh.visual = trimesh.visual.TextureVisuals(material=mat)
    return mesh


def render_column_glb(
    out_path: Path,
    size_in: float = 16,
    height_ft: float = 10,
    shape: str = "square",
) -> Path:
    """Generate column.glb at out_path; matches column.scad."""
    mm_per_in = 25.4
    mm_per_ft = mm_per_in * 12
    size_mm = size_in * mm_per_in
    height_mm = height_ft * mm_per_ft
    if shape == "round":
        mesh = round_column(size_mm, height_mm)
    else:
        mesh = square_column(size_mm, height_mm)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    # Y-up convention for three.js / Pascal: rotate so Z-up (OpenSCAD)
    # becomes Y-up
    R = trimesh.transformations.rotation_matrix(-np.pi / 2, [1, 0, 0])
    mesh.apply_transform(R)
    # GLB units = meters
    mesh.apply_scale(0.001)
    scene = trimesh.Scene([mesh])
    scene.export(str(out_path), file_type="glb")
    return out_path


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--size_in", type=float, default=16)
    ap.add_argument("--height_ft", type=float, default=10)
    ap.add_argument("--shape", choices=["square", "round"], default="square")
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args()
    p = render_column_glb(args.out, args.size_in, args.height_ft, args.shape)
    print(f"wrote {p}")


if __name__ == "__main__":
    main()
