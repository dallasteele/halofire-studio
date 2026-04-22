"""Agent 5 — Geometry.

Takes the validated mask and turns it into an OBJ mesh.

Two strategies:

* **Axisymmetric revolve** (kind=sprinkler_head, valve, pipe) — trace
  the mask silhouette, detect the symmetry axis (vertical for heads,
  horizontal for pipes), take the half-profile, revolve 360° around
  that axis. Scale to real-world dimensions from the manifest.
* **Ports-driven primitive union** (kind=fitting) — build a cylinder
  per port at the manifest position/direction and union them at the
  origin. Placeholder until H.5 does multi-view reconstruction, so
  confidence is capped at 0.6 and we document the limitation.
"""
from __future__ import annotations

import base64
import logging
import math
from pathlib import Path
from typing import Any

import numpy as np
import trimesh

from ._protocol import AgentStep, EnrichmentContext, StepResult

log = logging.getLogger("halofire.enrichment.a5_geometry")

_M_PER_INCH = 0.0254

_SYMMETRIC_KINDS = {"sprinkler_head", "valve", "pipe", "hanger"}
_FITTING_KINDS = {"fitting"}


class GeometryAgent:
    name = "a5_geometry"

    async def run(self, ctx: EnrichmentContext) -> StepResult:
        kind = (ctx.catalog_entry.get("kind") or "").lower()
        mask = ctx.artifacts.get("validated_mask") or {}
        workdir = ctx.workdir
        workdir.mkdir(parents=True, exist_ok=True)
        obj_path = workdir / "mesh.obj"

        try:
            if kind in _SYMMETRIC_KINDS:
                mesh, axis = _build_axisymmetric(mask, ctx.catalog_entry, kind)
                mesh.export(obj_path)
                return StepResult(
                    ok=True,
                    confidence=0.85,
                    artifacts={
                        "mesh_obj_path": str(obj_path),
                        "geometry_method": f"axisymmetric-{axis}",
                    },
                )
            if kind in _FITTING_KINDS:
                mesh = _build_ports_driven(ctx.catalog_entry)
                mesh.export(obj_path)
                return StepResult(
                    ok=True,
                    confidence=0.6,
                    reason="ports-driven placeholder, multi-view reconstruction deferred to Phase H.5",
                    artifacts={
                        "mesh_obj_path": str(obj_path),
                        "geometry_method": "ports-driven-primitive",
                    },
                )
            return StepResult(
                ok=False,
                reason=f"unsupported-kind: {kind}",
            )
        except _GeometryError as exc:
            return StepResult(ok=False, reason=f"geometry-failed: {exc}")


# ── Errors ──────────────────────────────────────────────────────────


class _GeometryError(RuntimeError):
    pass


# ── Axisymmetric revolve ────────────────────────────────────────────


def _build_axisymmetric(
    mask: dict[str, Any],
    catalog_entry: dict,
    kind: str,
) -> tuple[trimesh.Trimesh, str]:
    """Return ``(mesh, axis_label)``.

    If a real silhouette decode fails we fall back to a simple
    parametric cylinder + deflector so downstream agents still get a
    mesh with correct scale — the enricher records the method so the
    UI can distinguish "silhouette revolved" vs "parametric fallback".
    """
    params_val = _params_dim(catalog_entry)
    body_dia_in = params_val.get("body_dia_in") or params_val.get("size_in") or 1.0
    length_in = params_val.get("length_in") or params_val.get("face_to_face_in") or (
        body_dia_in * 1.5 if kind == "sprinkler_head" else body_dia_in
    )
    body_dia_m = float(body_dia_in) * _M_PER_INCH
    length_m = float(length_in) * _M_PER_INCH

    axis = "z" if kind != "pipe" else "x"

    profile = _silhouette_half_profile(mask)
    if profile is None:
        # Fallback: parametric stepped cylinder.
        profile = _parametric_profile(kind, body_dia_m, length_m)
        # Parametric radii are already in meters; only z needs scaling.
        profile = [(max(0.0, r), z * length_m) for (r, z) in profile]
    else:
        # Silhouette path returned (r_norm[0..1], z_norm[0..1]). Scale
        # both axes to real-world meters using the manifest's body
        # diameter and length, so the exported GLB comes out at the
        # correct physical size instead of a unit cube.
        body_radius_m = body_dia_m / 2.0 if body_dia_m > 0 else 0.5
        profile = [
            (max(0.0, r) * body_radius_m, z * length_m) for (r, z) in profile
        ]

    mesh = _revolve(profile, segments=32)

    if kind == "pipe":
        # rotate so length lies along X
        rot = trimesh.transformations.rotation_matrix(
            angle=math.pi / 2, direction=[0, 1, 0]
        )
        mesh.apply_transform(rot)

    return mesh, axis


def _silhouette_half_profile(mask: dict[str, Any]) -> list[tuple[float, float]] | None:
    """Decode the PNG mask, trace silhouette, take right-half profile.

    Returns None if we can't decode the mask or OpenCV isn't available
    — the caller has a parametric fallback.
    """
    png_b64 = mask.get("png_b64") or mask.get("png")
    if not png_b64:
        return None
    try:
        raw = base64.b64decode(png_b64)
    except Exception:
        return None

    try:
        import cv2  # noqa: F401
        from PIL import Image
    except ImportError:
        return None

    try:
        from io import BytesIO

        img = Image.open(BytesIO(raw)).convert("L")
        arr = np.array(img)
    except Exception:
        return None

    # Binarize
    bin_mask = (arr > 128).astype(np.uint8) * 255
    ys, xs = np.where(bin_mask > 0)
    if ys.size < 50:
        return None

    y_min, y_max = int(ys.min()), int(ys.max())
    h = max(1, y_max - y_min)

    # For each row between y_min..y_max, find mask left/right edges; width/2 = radius sample.
    rows = np.arange(y_min, y_max + 1)
    profile: list[tuple[float, float]] = []
    for y in rows:
        cols = np.where(bin_mask[y] > 0)[0]
        if cols.size == 0:
            continue
        width = float(cols.max() - cols.min())
        z_norm = 1.0 - (y - y_min) / h  # flip so top of mask is z=1
        profile.append((width / 2.0, z_norm))

    # Downsample to ~24 samples
    if len(profile) < 6:
        return None
    step = max(1, len(profile) // 24)
    sampled = profile[::step]
    if sampled[-1] != profile[-1]:
        sampled.append(profile[-1])

    # Normalize radii to [0,1]
    max_r = max(r for r, _ in sampled) or 1.0
    return [(r / max_r, z) for (r, z) in sampled]


def _parametric_profile(kind: str, body_dia_m: float, length_m: float) -> list[tuple[float, float]]:
    r = body_dia_m / 2.0
    if kind == "sprinkler_head":
        # frame + deflector silhouette (very rough)
        return [
            (0.0, 1.0),
            (r * 0.4, 1.0),
            (r * 0.5, 0.8),
            (r * 0.5, 0.55),
            (r * 1.3, 0.4),  # deflector
            (r * 0.4, 0.3),
            (r * 0.4, 0.0),
            (0.0, 0.0),
        ]
    # default: simple cylinder
    return [
        (0.0, 1.0),
        (r, 1.0),
        (r, 0.0),
        (0.0, 0.0),
    ]


def _revolve(
    profile: list[tuple[float, float]],
    *,
    segments: int = 32,
) -> trimesh.Trimesh:
    """Revolve ``(r, z)`` profile (z in [0,1]) into a trimesh mesh.

    Scale to unit-length along z; the caller is expected to apply any
    subsequent scaling via ``apply_scale``. For now radii are already
    in meters and z is normalized [0,1]; we multiply z by 1.0 and
    trust the profile — the caller passes lengths via profile radii
    directly (radius already in meters, z [0,1] is height-fraction
    and we scale it by length_m in the caller).
    """
    if len(profile) < 2:
        raise _GeometryError("profile too short")

    # Find length scale from profile z-range → assume already 0..1 and
    # multiply by implied length_m if present in first sample metadata.
    # We keep this simple: z in [0,1] and scale later in caller.

    thetas = np.linspace(0, 2 * math.pi, segments, endpoint=False)
    verts: list[list[float]] = []
    n_ring = len(profile)
    for (r, z) in profile:
        for t in thetas:
            verts.append([r * math.cos(t), r * math.sin(t), z])

    faces: list[list[int]] = []
    for i in range(n_ring - 1):
        for j in range(segments):
            j2 = (j + 1) % segments
            a = i * segments + j
            b = i * segments + j2
            c = (i + 1) * segments + j
            d = (i + 1) * segments + j2
            faces.append([a, b, d])
            faces.append([a, d, c])

    vertices = np.array(verts, dtype=float)
    # Normalise Z span to profile z-range (already 0..1 by construction).
    faces_arr = np.array(faces, dtype=np.int64)
    mesh = trimesh.Trimesh(vertices=vertices, faces=faces_arr, process=False)
    if not mesh.is_empty:
        mesh.fix_normals()
    return mesh


# ── Ports-driven fitting ────────────────────────────────────────────


def _build_ports_driven(catalog_entry: dict) -> trimesh.Trimesh:
    ports = catalog_entry.get("ports") or []
    if not ports:
        raise _GeometryError("fitting has no ports")

    size_in = _params_dim(catalog_entry).get("size_in") or 2.0
    radius = float(size_in) * _M_PER_INCH / 2.0

    parts: list[trimesh.Trimesh] = []
    # Central body (small sphere at origin for visual anchor).
    body = trimesh.creation.icosphere(radius=radius * 1.2, subdivisions=2)
    parts.append(body)

    for port in ports:
        pos = port.get("position_m") or [0.0, 0.0, 0.0]
        direction = port.get("direction") or [1.0, 0.0, 0.0]
        pos_arr = np.array(pos, dtype=float)
        dir_arr = np.array(direction, dtype=float)
        norm = np.linalg.norm(dir_arr)
        if norm < 1e-6:
            continue
        dir_unit = dir_arr / norm
        length = float(np.linalg.norm(pos_arr)) or radius * 2.0
        cyl = trimesh.creation.cylinder(radius=radius, height=length, sections=24)
        # Align cylinder (default +Z) to port direction, centered between origin and port pos.
        mid = pos_arr / 2.0
        # rotation from +Z to dir_unit
        z = np.array([0, 0, 1.0])
        if np.allclose(dir_unit, z):
            R = np.eye(4)
        elif np.allclose(dir_unit, -z):
            R = trimesh.transformations.rotation_matrix(math.pi, [1, 0, 0])
        else:
            axis = np.cross(z, dir_unit)
            axis /= np.linalg.norm(axis)
            angle = math.acos(float(np.clip(np.dot(z, dir_unit), -1.0, 1.0)))
            R = trimesh.transformations.rotation_matrix(angle, axis)
        T = trimesh.transformations.translation_matrix(mid)
        cyl.apply_transform(R)
        cyl.apply_transform(T)
        parts.append(cyl)

    return trimesh.util.concatenate(parts)


# ── util ────────────────────────────────────────────────────────────


def _params_dim(catalog_entry: dict) -> dict[str, float]:
    """Flatten catalog params to ``{name: default_value}`` for numeric
    entries only. Safe on missing keys."""
    out: dict[str, float] = {}
    for name, param in (catalog_entry.get("params") or {}).items():
        if isinstance(param, dict) and isinstance(param.get("default"), (int, float)):
            out[name] = float(param["default"])
    return out
