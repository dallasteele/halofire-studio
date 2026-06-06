#!/usr/bin/env python3
"""T45 — build123d parametric-STEP generator (Tier-2 DIMENSIONED parts).

Generates the FULL fire-sprinkler part library as REAL parametric CAD solids
using build123d, each driven by an EXPLICIT, DETERMINISTIC dimension spec
(NPT size, body length, diameters, k-factor label, etc.). For every part it
writes a real ISO-10303-21 STEP file plus a small ASCII-STL preview into:

    apps/studio/public/parts/build123d/<key>.step
    apps/studio/public/parts/build123d/<key>.stl

and regenerates the build123d manifest at:

    apps/studio/public/parts/build123d-parts.json

with ONE entry per part whose STEP file was ACTUALLY written. Each entry carries
a REAL sha256 computed from the on-disk (timestamp-normalized) STEP bytes.

HONESTY (hard, fail-closed):
  - These are REAL parametric CAD dimensions (defensible nominal fire-sprinkler
    values). They are NOT manufacturer-exact, NOT AHJ / PE / permit / code-
    compliant. Tier = "dimensioned_parametric" (engineeringAccurate=false).
  - If build123d (and its OCP/OCCT backend) cannot be imported, this script
    generates NOTHING and exits 0 with build123d_available:false. It NEVER
    fabricates a fake STEP file or a fake manifest entry.
  - If a SPECIFIC part fails to build/export, it is SKIPPED honestly — no
    manifest entry is written for it.
  - Keys MUST match catalog keys in public/parts/parts-manifest.json so the
    consumer (applyBuild123dParts) can upgrade catalog records.
  - Dimensions are hard-coded constants — NO randomness, fully reproducible.
  - STEP FILE_NAME timestamp is normalized to a fixed epoch so the file is
    byte-deterministic and the sha256 is stable across runs.

Output (stdout, last line): a single JSON object:
    {"generated": [...keys...], "skipped": [...], "build123d_available": <bool>}
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable


# Output dir: <repo>/apps/studio/public/parts/build123d
# This file lives at apps/studio/scripts/build123d/generate_parts.py, so the
# studio app root is two parents up from this file's parent (scripts/build123d).
SCRIPT_DIR = Path(__file__).resolve().parent
STUDIO_ROOT = SCRIPT_DIR.parent.parent  # apps/studio
PUBLIC_DIR = STUDIO_ROOT / "public"
OUT_DIR = PUBLIC_DIR / "parts" / "build123d"
MANIFEST_PATH = PUBLIC_DIR / "parts" / "build123d-parts.json"


@dataclass(frozen=True)
class PartSpec:
    """An explicit, deterministic dimension spec for one parametric part.

    All linear dimensions are millimetres. These are honest parametric design
    intents (defensible nominal fire-sprinkler dimensions), NOT manufacturer-
    measured values.
    """

    key: str
    name: str
    product_code: str
    # Free-form dimension fields surfaced into the manifest "dimensions" block.
    dims: dict[str, Any]
    # The geometry builder (closure over build123d, injected at run time).
    build: Callable[[Any, "PartSpec"], Any] = field(repr=False, default=None)  # type: ignore[assignment]
    # OPTIONAL catalog head category this part resolves to (head_pendent /
    # head_upright / head_sidewall). Lets src/lib/catalog-geometry.ts match a
    # catalog SKU by (category, nominalSizeIn). None for non-head parts whose
    # catalog mapping is by key only. Surfaced verbatim into the manifest entry.
    category: str | None = None
    # OPTIONAL nominal NPT size in INCHES this part resolves to (e.g. 0.5, 0.75,
    # 1.0). Used together with `category` for the catalog-SKU geometry match.
    nominal_size_in: float | None = None

    def dimensions(self) -> dict[str, Any]:
        out = dict(self.dims)
        out.setdefault("units", "mm")
        return out


# --------------------------------------------------------------------------- #
# Small geometry helpers (all build123d-native, deterministic).               #
# --------------------------------------------------------------------------- #


def _fuse(b: Any, *shapes: Any) -> Any:
    """Fuse a set of solids/parts into a SINGLE exportable Compound.

    build123d's `Solid + Part` (and chained `+` over geometrically disjoint
    pieces) can yield a `ShapeList`, which export_step cannot serialize
    ("'ShapeList' object has no attribute 'wrapped'"). The robust fix is to
    extract every underlying Solid and wrap them all in one `Compound`, which
    export_step always handles. Overlapping solids remain a valid manifold
    assembly for a dimensioned-parametric massing; we do NOT require a single
    boolean-fused body (these are honest massing proxies, not watertight CAD).
    """
    from build123d import Compound  # type: ignore

    solids: list[Any] = []
    for shape in shapes:
        try:
            extracted = list(shape.solids())
        except Exception:  # noqa: BLE001 - fall back to the shape itself
            extracted = []
        solids.extend(extracted if extracted else [shape])
    return Compound(solids)


def _cyl(b: Any, dia: float, length: float) -> Any:
    """Solid cylinder of `dia` x `length` extruded along +Z from the origin."""
    return b.extrude(b.Circle(radius=dia / 2.0), amount=length)


def _cyl_at(b: Any, dia: float, length: float, z0: float) -> Any:
    """Solid cylinder along +Z starting at z=z0."""
    return b.Pos(0, 0, z0) * _cyl(b, dia, length)


def _disc(b: Any, dia: float, thk: float, z0: float) -> Any:
    """Thin disc along +Z at z=z0."""
    return _cyl_at(b, dia, thk, z0)


def _hex_prism(b: Any, across_flats: float, length: float, z0: float = 0.0) -> Any:
    """Hex prism (wrench body) extruded along +Z from z0."""
    radius = across_flats / math.sqrt(3.0)  # circumradius from across-flats
    body = b.extrude(b.RegularPolygon(radius=radius, side_count=6), amount=length)
    return b.Pos(0, 0, z0) * body


# --------------------------------------------------------------------------- #
# HEADS                                                                        #
# --------------------------------------------------------------------------- #


# Real NPT nominal-size -> (thread boss OD mm, wrench hex across-flats mm).
# Boss OD ~ the NPT major diameter (1/2" NPT ~ 21.2 mm, 3/4" NPT ~ 26.7 mm,
# 1" NPT ~ 33.4 mm OD). Wrench flats are a defensible nominal per size. These
# are honest parametric design intents, NOT manufacturer-measured values.
_NPT_BOSS_HEX_MM: dict[str, tuple[float, float]] = {
    '1/2"': (21.2, 19.0),
    '3/4"': (26.7, 24.0),
    '1"': (33.4, 30.0),
}


def _npt_boss_hex(spec: PartSpec) -> tuple[float, float]:
    """Resolve (boss_dia_mm, hex_af_mm) for the spec's NPT size, defaulting to
    the 1/2" geometry when the size string is not in the table (fail-safe)."""
    npt = str(spec.dims.get("nptSize", '1/2"'))
    return _NPT_BOSS_HEX_MM.get(npt, _NPT_BOSS_HEX_MM['1/2"'])


def _build_pendent_head(b: Any, spec: PartSpec) -> Any:
    """Pendent sprinkler head: hex body + threaded boss stub + deflector disc.

    Deterministic massing of an NPT pendent head: a hex prism body, a
    cylindrical thread boss on top (OD scaled to the NPT nominal size), and a
    thin deflector disc below the frame.
    """
    body_len = float(spec.dims["bodyLengthMm"])
    deflector_dia = float(spec.dims["deflectorDiaMm"])
    boss_dia, hex_af = _npt_boss_hex(spec)
    boss_len = 12.0
    deflector_thk = 1.6

    body = _hex_prism(b, hex_af, body_len)
    boss = _cyl_at(b, boss_dia, boss_len, body_len)
    deflector = _disc(b, deflector_dia, deflector_thk, -deflector_thk)
    return _fuse(b, body, boss, deflector)


def _build_upright_head(b: Any, spec: PartSpec) -> Any:
    """Upright head: hex body, thread boss BELOW, deflector disc ABOVE."""
    body_len = float(spec.dims["bodyLengthMm"])
    deflector_dia = float(spec.dims["deflectorDiaMm"])
    boss_dia, hex_af = _npt_boss_hex(spec)
    boss_len = 12.0
    deflector_thk = 1.6

    body = _hex_prism(b, hex_af, body_len)
    boss = _cyl_at(b, boss_dia, boss_len, -boss_len)
    deflector = _disc(b, deflector_dia, deflector_thk, body_len)
    return _fuse(b, body, boss, deflector)


def _build_sidewall_head(b: Any, spec: PartSpec) -> Any:
    """Sidewall head: hex body along Z with a horizontal deflector plate offset
    to one side (sprays horizontally). Boss on the back (-Z)."""
    body_len = float(spec.dims["bodyLengthMm"])
    deflector_dia = float(spec.dims["deflectorDiaMm"])
    boss_dia, hex_af = _npt_boss_hex(spec)
    boss_len = 12.0
    plate_thk = 1.6

    body = _hex_prism(b, hex_af, body_len)
    boss = _cyl_at(b, boss_dia, boss_len, -boss_len)
    # Deflector plate stands off the front face along +X (sidewall throw).
    plate = b.Pos(deflector_dia / 2.0, 0, body_len) * b.Rot(0, 90, 0) * _cyl(
        b, deflector_dia, plate_thk
    )
    return _fuse(b, body, boss, plate)


def _build_concealed_head(b: Any, spec: PartSpec) -> Any:
    """Concealed pendent: head body recessed inside a cylindrical cup with a
    flush cover plate disc at the ceiling line."""
    body_len = float(spec.dims["bodyLengthMm"])
    cup_dia = float(spec.dims["cupDiaMm"])
    cover_dia = float(spec.dims["coverPlateDiaMm"])
    hex_af = 16.0
    boss_dia = 19.0
    boss_len = 10.0
    cover_thk = 1.2
    cup_wall = 1.2

    inner = _hex_prism(b, hex_af, body_len, z0=cover_thk)
    boss = _cyl_at(b, boss_dia, boss_len, cover_thk + body_len)
    # Cup ring (hollow) around the inner head.
    cup_outer = _cyl_at(b, cup_dia, body_len, cover_thk)
    cup_bore = _cyl_at(b, cup_dia - 2 * cup_wall, body_len, cover_thk)
    cup = cup_outer - cup_bore
    cover = _disc(b, cover_dia, cover_thk, 0.0)
    return _fuse(b, inner, boss, cup, cover)


def _build_dry_pendent_head(b: Any, spec: PartSpec) -> Any:
    """Dry pendent: long dry-barrel tube with a pendent head at the bottom and
    a thread inlet boss at the top."""
    barrel_len = float(spec.dims["barrelLengthMm"])
    barrel_dia = float(spec.dims["barrelDiaMm"])
    deflector_dia = float(spec.dims["deflectorDiaMm"])
    inlet_boss_dia = 27.0
    inlet_boss_len = 14.0
    head_len = 16.0
    hex_af = 19.0
    deflector_thk = 1.6

    barrel = _cyl(b, barrel_dia, barrel_len)
    inlet = _cyl_at(b, inlet_boss_dia, inlet_boss_len, barrel_len)
    head = _hex_prism(b, hex_af, head_len, z0=-head_len)
    deflector = _disc(b, deflector_dia, deflector_thk, -head_len - deflector_thk)
    return _fuse(b, barrel, inlet, head, deflector)


def _build_esfr_head(b: Any, spec: PartSpec) -> Any:
    """ESFR storage head: large-orifice pendent — bigger hex body, big boss, and
    a large-diameter deflector (high K-factor storage sprinkler)."""
    body_len = float(spec.dims["bodyLengthMm"])
    deflector_dia = float(spec.dims["deflectorDiaMm"])
    hex_af = 28.0  # larger wrench body (3/4"-1" NPT)
    boss_dia = 33.4  # ~1" NPT boss OD
    boss_len = 16.0
    deflector_thk = 2.4

    body = _hex_prism(b, hex_af, body_len)
    boss = _cyl_at(b, boss_dia, boss_len, body_len)
    deflector = _disc(b, deflector_dia, deflector_thk, -deflector_thk)
    return _fuse(b, body, boss, deflector)


# --------------------------------------------------------------------------- #
# FITTINGS                                                                     #
# --------------------------------------------------------------------------- #


def _build_elbow_90(b: Any, spec: PartSpec) -> Any:
    """90-degree elbow: two cylindrical legs meeting at the origin, plus a
    sphere at the joint to round the corner. Outer-envelope massing."""
    od = float(spec.dims["odMm"])
    leg = float(spec.dims["legLengthMm"])
    leg_z = _cyl(b, od, leg)
    leg_x = b.Rot(0, 90, 0) * _cyl(b, od, leg)
    joint = b.Sphere(radius=od / 2.0)
    return _fuse(b, leg_z, leg_x, joint)


def _build_elbow_45(b: Any, spec: PartSpec) -> Any:
    """45-degree elbow: one leg along +Z, one leg at 45deg, sphere joint."""
    od = float(spec.dims["odMm"])
    leg = float(spec.dims["legLengthMm"])
    leg_z = _cyl(b, od, leg)
    leg_45 = b.Rot(0, 45, 0) * _cyl(b, od, leg)
    joint = b.Sphere(radius=od / 2.0)
    return _fuse(b, leg_z, leg_45, joint)


def _build_tee(b: Any, spec: PartSpec) -> Any:
    """Tee fitting: a straight run (along Z) with a perpendicular branch (along
    X), joined by a sphere at the origin. Outer-envelope massing."""
    od = float(spec.dims["odMm"])
    half_run = float(spec.dims["runLengthMm"]) / 2.0
    branch = float(spec.dims["branchLengthMm"])
    run = _cyl_at(b, od, half_run * 2, -half_run)
    branch_x = b.Rot(0, 90, 0) * _cyl(b, od, branch)
    joint = b.Sphere(radius=od / 2.0)
    return _fuse(b, run, branch_x, joint)


def _build_cross(b: Any, spec: PartSpec) -> Any:
    """Cross fitting: straight run along Z + full branch through X (both ways),
    joined by a sphere at the origin."""
    od = float(spec.dims["odMm"])
    half_run = float(spec.dims["runLengthMm"]) / 2.0
    half_branch = float(spec.dims["branchLengthMm"]) / 2.0
    run = _cyl_at(b, od, half_run * 2, -half_run)
    branch = b.Pos(-half_branch, 0, 0) * b.Rot(0, 90, 0) * _cyl(b, od, half_branch * 2)
    joint = b.Sphere(radius=od / 2.0)
    return _fuse(b, run, branch, joint)


def _build_coupling(b: Any, spec: PartSpec) -> Any:
    """Threaded coupling: a short hollow cylinder (sleeve) joining two pipes."""
    od = float(spec.dims["odMm"])
    length = float(spec.dims["lengthMm"])
    bore = float(spec.dims["boreMm"])
    outer = _cyl(b, od, length)
    inner = _cyl(b, bore, length)
    return outer - inner


def _build_reducer(b: Any, spec: PartSpec) -> Any:
    """Concentric reducer: a truncated cone (large OD -> small OD) with a bore."""
    large_od = float(spec.dims["largeOdMm"])
    small_od = float(spec.dims["smallOdMm"])
    length = float(spec.dims["lengthMm"])
    bore = float(spec.dims["boreMm"])
    # Loft between two circular sections to form the conical body.
    big = b.Circle(radius=large_od / 2.0)
    small = b.Pos(0, 0, length) * b.Circle(radius=small_od / 2.0)
    body = b.loft([big, small])
    inner = _cyl(b, bore, length)
    return body - inner


def _build_cap(b: Any, spec: PartSpec) -> Any:
    """Pipe cap: a closed cup — outer cylinder with a blind bore (closed end)."""
    od = float(spec.dims["odMm"])
    length = float(spec.dims["lengthMm"])
    bore = float(spec.dims["boreMm"])
    wall_end = float(spec.dims["endWallMm"])
    outer = _cyl(b, od, length)
    # Bore is open from the bottom (z=0) up but stops short of the closed top.
    inner = _cyl(b, bore, length - wall_end)
    return outer - inner


# --------------------------------------------------------------------------- #
# GROOVED                                                                      #
# --------------------------------------------------------------------------- #


def _build_grooved_coupling(b: Any, spec: PartSpec) -> Any:
    """Grooved (rigid) coupling: a split-housing ring clamping a grooved pipe
    joint. Modelled as a thick hollow ring with two bolt-pad lugs."""
    od = float(spec.dims["housingOdMm"])
    length = float(spec.dims["lengthMm"])
    bore = float(spec.dims["boreMm"])
    pad = float(spec.dims["boltPadMm"])
    ring = _cyl(b, od, length) - _cyl(b, bore, length)
    # Two bolt pads on opposite sides (±X).
    pad_block = b.Box(pad, pad, length)
    pad_a = b.Pos(od / 2.0, 0, length / 2.0) * pad_block
    pad_b = b.Pos(-od / 2.0, 0, length / 2.0) * pad_block
    return _fuse(b, ring, pad_a, pad_b)


def _build_grooved_flange_adapter(b: Any, spec: PartSpec) -> Any:
    """Grooved flange adapter: a flange disc with a bolt-circle of holes and a
    central bore, with a short grooved hub on the back."""
    flange_dia = float(spec.dims["flangeDiaMm"])
    flange_thk = float(spec.dims["flangeThkMm"])
    bore = float(spec.dims["boreMm"])
    hub_dia = float(spec.dims["hubDiaMm"])
    hub_len = float(spec.dims["hubLengthMm"])
    bolt_circle = float(spec.dims["boltCircleMm"])
    bolt_dia = float(spec.dims["boltHoleMm"])
    bolt_count = int(spec.dims["boltCount"])

    flange = _disc(b, flange_dia, flange_thk, 0.0)
    hub = _cyl_at(b, hub_dia, hub_len, flange_thk)
    body = _fuse(b, flange, hub)
    body = body - _cyl(b, bore, flange_thk + hub_len)
    # Bolt holes on the bolt circle (deterministic angular spacing).
    for i in range(bolt_count):
        ang = (2.0 * math.pi * i) / bolt_count
        x = (bolt_circle / 2.0) * math.cos(ang)
        y = (bolt_circle / 2.0) * math.sin(ang)
        hole = b.Pos(x, y, 0) * _cyl(b, bolt_dia, flange_thk)
        body = body - hole
    return body


# --------------------------------------------------------------------------- #
# PIPE                                                                         #
# --------------------------------------------------------------------------- #


def _build_pipe(b: Any, spec: PartSpec) -> Any:
    """Steel pipe section: a hollow cylinder of the given OD / wall / length."""
    od = float(spec.dims["odMm"])
    wall = float(spec.dims["wallMm"])
    length = float(spec.dims["lengthMm"])
    bore = od - 2.0 * wall
    return _cyl(b, od, length) - _cyl(b, bore, length)


# --------------------------------------------------------------------------- #
# VALVES                                                                       #
# --------------------------------------------------------------------------- #


def _valve_body(b: Any, od: float, face_to_face: float, bore: float) -> Any:
    """Common flanged valve body: a barrel with a flange disc at each end and a
    through bore. Returns the body solid (before any topworks)."""
    flange_dia = od * 1.6
    flange_thk = max(8.0, od * 0.18)
    barrel = _cyl(b, od, face_to_face)
    f0 = _disc(b, flange_dia, flange_thk, 0.0)
    f1 = _disc(b, flange_dia, flange_thk, face_to_face - flange_thk)
    body = _fuse(b, barrel, f0, f1)
    return body - _cyl(b, bore, face_to_face)


def _build_alarm_check_valve(b: Any, spec: PartSpec) -> Any:
    """Alarm check valve: flanged body (vertical run) with a side alarm port
    boss and a small clapper-cover dome on top."""
    od = float(spec.dims["odMm"])
    f2f = float(spec.dims["faceToFaceMm"])
    bore = float(spec.dims["boreMm"])
    body = _valve_body(b, od, f2f, bore)
    # Side alarm port boss (+X) at mid-height.
    port = b.Pos(od / 2.0, 0, f2f / 2.0) * b.Rot(0, 90, 0) * _cyl(b, od * 0.35, od * 0.6)
    # Clapper access cover dome on top.
    cover = b.Pos(0, 0, f2f) * b.Sphere(radius=od * 0.55)
    return _fuse(b, body, port, cover)


def _build_check_valve(b: Any, spec: PartSpec) -> Any:
    """Check valve: a flanged body with a small access-cover boss on top."""
    od = float(spec.dims["odMm"])
    f2f = float(spec.dims["faceToFaceMm"])
    bore = float(spec.dims["boreMm"])
    body = _valve_body(b, od, f2f, bore)
    cover = b.Pos(0, od / 2.0, f2f / 2.0) * b.Rot(-90, 0, 0) * _cyl(b, od * 0.45, od * 0.4)
    return _fuse(b, body, cover)


def _build_butterfly_valve(b: Any, spec: PartSpec) -> Any:
    """Butterfly valve (supervised): a short wafer body with a disc inside and a
    stem + actuator/gearbox box on top + a supervisory tamper-switch boss."""
    od = float(spec.dims["odMm"])
    f2f = float(spec.dims["faceToFaceMm"])
    bore = float(spec.dims["boreMm"])
    body = _valve_body(b, od, f2f, bore)
    # Disc plate inside the bore (mid).
    disc = b.Pos(0, 0, f2f / 2.0) * _cyl(b, bore * 0.96, 3.0)
    # Stem up +Z and gearbox box.
    stem = _cyl_at(b, od * 0.18, od * 0.9, f2f)
    gearbox = b.Pos(0, 0, f2f + od * 0.9) * b.Box(od * 0.7, od * 0.7, od * 0.5)
    # Tamper-switch boss on the gearbox.
    tamper = b.Pos(od * 0.35, 0, f2f + od * 0.9) * b.Box(od * 0.25, od * 0.4, od * 0.4)
    return _fuse(b, body, disc, stem, gearbox, tamper)


def _build_osy_gate_valve(b: Any, spec: PartSpec) -> Any:
    """OS&Y gate valve: flanged body, a tall rising stem, and a handwheel
    (modelled as a torus ring) at the top."""
    od = float(spec.dims["odMm"])
    f2f = float(spec.dims["faceToFaceMm"])
    bore = float(spec.dims["boreMm"])
    stem_len = float(spec.dims["stemLengthMm"])
    wheel_dia = float(spec.dims["handwheelDiaMm"])
    body = _valve_body(b, od, f2f, bore)
    # Bonnet dome.
    bonnet = b.Pos(0, 0, f2f) * _cyl(b, od * 0.7, od * 0.4)
    # Rising stem.
    stem = _cyl_at(b, od * 0.12, stem_len, f2f + od * 0.4)
    # Handwheel as a torus ring at the top of the stem.
    wheel = b.Pos(0, 0, f2f + od * 0.4 + stem_len) * b.Torus(
        major_radius=wheel_dia / 2.0, minor_radius=wheel_dia * 0.06
    )
    return _fuse(b, body, bonnet, stem, wheel)


def _build_prv(b: Any, spec: PartSpec) -> Any:
    """Pressure reducing valve: angle-pattern body (inlet up, outlet to side)
    with a large spring-bonnet dome on top."""
    od = float(spec.dims["odMm"])
    f2f = float(spec.dims["faceToFaceMm"])
    bore = float(spec.dims["boreMm"])
    body = _valve_body(b, od, f2f, bore)
    # Outlet branch to the side.
    outlet = b.Pos(0, 0, f2f / 2.0) * b.Rot(0, 90, 0) * _cyl(b, od, od * 1.2)
    # Spring bonnet dome on top.
    bonnet = b.Pos(0, 0, f2f) * _cyl(b, od * 1.1, od * 0.9)
    bonnet_dome = b.Pos(0, 0, f2f + od * 0.9) * b.Sphere(radius=od * 0.55)
    return _fuse(b, body, outlet, bonnet, bonnet_dome)


def _build_deluge_valve(b: Any, spec: PartSpec) -> Any:
    """Deluge valve: large flanged body with a diaphragm/priming chamber dome on
    the side and a trim-port boss."""
    od = float(spec.dims["odMm"])
    f2f = float(spec.dims["faceToFaceMm"])
    bore = float(spec.dims["boreMm"])
    body = _valve_body(b, od, f2f, bore)
    # Diaphragm chamber on +X.
    chamber = b.Pos(od * 0.9, 0, f2f / 2.0) * b.Sphere(radius=od * 0.6)
    chamber_neck = b.Pos(od / 2.0, 0, f2f / 2.0) * b.Rot(0, 90, 0) * _cyl(
        b, od * 0.4, od * 0.5
    )
    # Trim port boss on top.
    trim = _cyl_at(b, od * 0.2, od * 0.5, f2f)
    return _fuse(b, body, chamber, chamber_neck, trim)


# --------------------------------------------------------------------------- #
# HANGER                                                                       #
# --------------------------------------------------------------------------- #


def _build_hanger(b: Any, spec: PartSpec) -> Any:
    """Pipe hanger: an adjustable swivel ring (split-ring) hanging from a rod.
    Modelled as a thick ring (torus) sized to the pipe OD with a vertical rod
    stub and a top eye."""
    pipe_od = float(spec.dims["pipeOdMm"])
    ring_thk = float(spec.dims["ringThkMm"])
    rod_dia = float(spec.dims["rodDiaMm"])
    rod_len = float(spec.dims["rodLengthMm"])

    ring_major = (pipe_od + ring_thk) / 2.0
    ring = b.Rot(90, 0, 0) * b.Torus(major_radius=ring_major, minor_radius=ring_thk / 2.0)
    # Rod rising from the top of the ring (+Z).
    rod = _cyl_at(b, rod_dia, rod_len, ring_major)
    # Top eye (torus) for the rod attachment.
    eye = b.Pos(0, 0, ring_major + rod_len) * b.Rot(90, 0, 0) * b.Torus(
        major_radius=rod_dia, minor_radius=rod_dia * 0.4
    )
    return _fuse(b, ring, rod, eye)


# --------------------------------------------------------------------------- #
# Catalogue of specs.                                                          #
# --------------------------------------------------------------------------- #


def specs() -> list[PartSpec]:
    """The deterministic catalogue of parts this generator emits.

    Keys match catalog part keys in public/parts/parts-manifest.json so
    applyBuild123dParts can upgrade them. Dimensions are defensible nominal
    fire-sprinkler values (mm), NOT manufacturer-measured.
    """
    return [
        # ---- HEADS ----
        # Size-specific head bodies covering the (category, NPT nominal size)
        # combinations the manufacturer catalog actually uses (1/2", 3/4", 1").
        # Each carries category + nominal_size_in so catalog-geometry.ts can map
        # a catalog SKU to the right parametric body. The legacy unsuffixed keys
        # (head_pendent / head_upright / head_sidewall) remain the 1/2" parts so
        # the existing parts-manifest upgrade path is byte-stable.
        PartSpec(
            key="head_pendent",
            name="Pendent Head 1/2 in (parametric)",
            product_code="B123D-HEAD-PEND-050",
            dims={"nptSize": '1/2"', "bodyLengthMm": 18.0, "deflectorDiaMm": 28.0, "kFactorLabel": "K5.6"},
            build=_build_pendent_head,
            category="head_pendent",
            nominal_size_in=0.5,
        ),
        PartSpec(
            key="head_pendent_075",
            name="Pendent Head 3/4 in (parametric)",
            product_code="B123D-HEAD-PEND-075",
            dims={"nptSize": '3/4"', "bodyLengthMm": 20.0, "deflectorDiaMm": 32.0, "kFactorLabel": "K8.0"},
            build=_build_pendent_head,
            category="head_pendent",
            nominal_size_in=0.75,
        ),
        PartSpec(
            key="head_pendent_100",
            name="Pendent Head 1 in (parametric)",
            product_code="B123D-HEAD-PEND-100",
            dims={"nptSize": '1"', "bodyLengthMm": 22.0, "deflectorDiaMm": 36.0, "kFactorLabel": "K8.0"},
            build=_build_pendent_head,
            category="head_pendent",
            nominal_size_in=1.0,
        ),
        PartSpec(
            key="head_upright",
            name="Upright Head 1/2 in (parametric)",
            product_code="B123D-HEAD-UPR-050",
            dims={"nptSize": '1/2"', "bodyLengthMm": 18.0, "deflectorDiaMm": 28.0, "kFactorLabel": "K5.6"},
            build=_build_upright_head,
            category="head_upright",
            nominal_size_in=0.5,
        ),
        PartSpec(
            key="head_upright_075",
            name="Upright Head 3/4 in (parametric)",
            product_code="B123D-HEAD-UPR-075",
            dims={"nptSize": '3/4"', "bodyLengthMm": 20.0, "deflectorDiaMm": 32.0, "kFactorLabel": "K8.0"},
            build=_build_upright_head,
            category="head_upright",
            nominal_size_in=0.75,
        ),
        PartSpec(
            key="head_sidewall",
            name="Sidewall Head 1/2 in (parametric)",
            product_code="B123D-HEAD-SW-050",
            dims={"nptSize": '1/2"', "bodyLengthMm": 18.0, "deflectorDiaMm": 30.0, "kFactorLabel": "K5.6"},
            build=_build_sidewall_head,
            category="head_sidewall",
            nominal_size_in=0.5,
        ),
        PartSpec(
            key="head_sidewall_100",
            name="Sidewall Head 1 in (parametric)",
            product_code="B123D-HEAD-SW-100",
            dims={"nptSize": '1"', "bodyLengthMm": 22.0, "deflectorDiaMm": 38.0, "kFactorLabel": "K8.0"},
            build=_build_sidewall_head,
            category="head_sidewall",
            nominal_size_in=1.0,
        ),
        PartSpec(
            key="head_concealed",
            name="Concealed Pendent Head (parametric)",
            product_code="B123D-HEAD-CNC-050",
            dims={
                "nptSize": '1/2"',
                "bodyLengthMm": 16.0,
                "cupDiaMm": 40.0,
                "coverPlateDiaMm": 70.0,
                "kFactorLabel": "K4.9",
            },
            build=_build_concealed_head,
        ),
        PartSpec(
            key="head_dry_pendent",
            name="Dry Pendent Head (parametric)",
            product_code="B123D-HEAD-DRY-050",
            dims={
                "nptSize": '1"',
                "barrelLengthMm": 150.0,
                "barrelDiaMm": 22.0,
                "deflectorDiaMm": 28.0,
                "kFactorLabel": "K5.6",
            },
            build=_build_dry_pendent_head,
        ),
        PartSpec(
            key="head_esfr",
            name="ESFR Storage Head (parametric)",
            product_code="B123D-HEAD-ESFR-100",
            dims={"nptSize": '1"', "bodyLengthMm": 24.0, "deflectorDiaMm": 50.0, "kFactorLabel": "K25.2"},
            build=_build_esfr_head,
        ),
        # ---- FITTINGS ----
        PartSpec(
            key="fitting_elbow_90",
            name="90 Elbow (parametric)",
            product_code="B123D-ELL90-075",
            dims={"nptSize": '3/4"', "odMm": 26.7, "legLengthMm": 30.0},
            build=_build_elbow_90,
        ),
        PartSpec(
            key="fitting_elbow_45",
            name="45 Elbow (parametric)",
            product_code="B123D-ELL45-075",
            dims={"nptSize": '3/4"', "odMm": 26.7, "legLengthMm": 30.0},
            build=_build_elbow_45,
        ),
        PartSpec(
            key="fitting_tee",
            name="Tee (parametric)",
            product_code="B123D-TEE-100",
            dims={"nptSize": '1"', "odMm": 33.4, "runLengthMm": 64.0, "branchLengthMm": 24.0},
            build=_build_tee,
        ),
        PartSpec(
            key="fitting_cross",
            name="Cross (parametric)",
            product_code="B123D-CROSS-100",
            dims={"nptSize": '1"', "odMm": 33.4, "runLengthMm": 64.0, "branchLengthMm": 64.0},
            build=_build_cross,
        ),
        PartSpec(
            key="fitting_coupling",
            name="Coupling (parametric)",
            product_code="B123D-CPLG-100",
            dims={"nptSize": '1"', "odMm": 42.2, "lengthMm": 40.0, "boreMm": 33.4},
            build=_build_coupling,
        ),
        PartSpec(
            key="fitting_reducer",
            name="Reducer (parametric)",
            product_code="B123D-RED-100-075",
            dims={"nptSize": '1"x3/4"', "largeOdMm": 42.2, "smallOdMm": 34.5, "lengthMm": 45.0, "boreMm": 26.6},
            build=_build_reducer,
        ),
        PartSpec(
            key="fitting_cap",
            name="Cap (parametric)",
            product_code="B123D-CAP-100",
            dims={"nptSize": '1"', "odMm": 42.2, "lengthMm": 30.0, "boreMm": 33.4, "endWallMm": 8.0},
            build=_build_cap,
        ),
        # ---- GROOVED ----
        PartSpec(
            key="grooved_coupling",
            name="Grooved Coupling (parametric)",
            product_code="B123D-GRV-CPLG-200",
            dims={"nominalSize": '2"', "housingOdMm": 90.0, "lengthMm": 60.0, "boreMm": 60.3, "boltPadMm": 28.0},
            build=_build_grooved_coupling,
        ),
        PartSpec(
            key="grooved_flange_adapter",
            name="Grooved Flange Adapter (parametric)",
            product_code="B123D-GRV-FLG-200",
            dims={
                "nominalSize": '2"',
                "flangeDiaMm": 152.0,
                "flangeThkMm": 18.0,
                "boreMm": 60.3,
                "hubDiaMm": 90.0,
                "hubLengthMm": 35.0,
                "boltCircleMm": 120.7,
                "boltHoleMm": 19.0,
                "boltCount": 4,
            },
            build=_build_grooved_flange_adapter,
        ),
        # ---- PIPE ----
        PartSpec(
            key="pipe_sch10",
            name="Schedule 10 Pipe (parametric)",
            product_code="B123D-PIPE-SCH10-200",
            dims={"nominalSize": '2"', "odMm": 60.3, "wallMm": 2.77, "lengthMm": 300.0, "schedule": "Sch10"},
            build=_build_pipe,
        ),
        PartSpec(
            key="pipe_sch40",
            name="Schedule 40 Pipe (parametric)",
            product_code="B123D-PIPE-SCH40-200",
            dims={"nominalSize": '2"', "odMm": 60.3, "wallMm": 3.91, "lengthMm": 300.0, "schedule": "Sch40"},
            build=_build_pipe,
        ),
        # ---- VALVES ----
        PartSpec(
            key="valve_alarm_check",
            name="Alarm Check Valve (parametric)",
            product_code="B123D-VLV-ALMCHK-400",
            dims={"nominalSize": '4"', "odMm": 114.3, "faceToFaceMm": 200.0, "boreMm": 102.0},
            build=_build_alarm_check_valve,
        ),
        PartSpec(
            key="valve_check",
            name="Check Valve (parametric)",
            product_code="B123D-VLV-CHK-400",
            dims={"nominalSize": '4"', "odMm": 114.3, "faceToFaceMm": 180.0, "boreMm": 102.0},
            build=_build_check_valve,
        ),
        PartSpec(
            key="valve_butterfly",
            name="Butterfly Valve (parametric, supervised)",
            product_code="B123D-VLV-BFLY-400",
            dims={"nominalSize": '4"', "odMm": 114.3, "faceToFaceMm": 56.0, "boreMm": 102.0},
            build=_build_butterfly_valve,
        ),
        PartSpec(
            key="valve_osy_gate",
            name="OS&Y Gate Valve (parametric)",
            product_code="B123D-VLV-OSY-400",
            dims={
                "nominalSize": '4"',
                "odMm": 114.3,
                "faceToFaceMm": 230.0,
                "boreMm": 102.0,
                "stemLengthMm": 160.0,
                "handwheelDiaMm": 150.0,
            },
            build=_build_osy_gate_valve,
        ),
        PartSpec(
            key="valve_prv",
            name="Pressure Reducing Valve (parametric)",
            product_code="B123D-VLV-PRV-250",
            dims={"nominalSize": '2.5"', "odMm": 73.0, "faceToFaceMm": 200.0, "boreMm": 64.0},
            build=_build_prv,
        ),
        PartSpec(
            key="valve_deluge",
            name="Deluge Valve (parametric)",
            product_code="B123D-VLV-DLG-400",
            dims={"nominalSize": '4"', "odMm": 114.3, "faceToFaceMm": 220.0, "boreMm": 102.0},
            build=_build_deluge_valve,
        ),
        # ---- HANGER ----
        PartSpec(
            key="hanger",
            name="Pipe Hanger (parametric)",
            product_code="B123D-HNGR-100",
            dims={"nptSize": '1"', "pipeOdMm": 33.4, "ringThkMm": 6.0, "rodDiaMm": 9.5, "rodLengthMm": 60.0},
            build=_build_hanger,
        ),
    ]


def _import_build123d() -> Any | None:
    """Import build123d, returning the module or None if unavailable.

    Importing build123d also pulls in the OCP/OCCT backend; an ImportError or
    any backend init failure means we MUST generate nothing (honest).
    """
    try:
        import build123d as b  # type: ignore

        # Touch the symbols we rely on so a partial install fails here.
        _ = (
            b.Part, b.extrude, b.Circle, b.Sphere, b.export_step,
            b.RegularPolygon, b.Pos, b.Rot, b.Box, b.Torus, b.loft,
        )
        return b
    except Exception:  # noqa: BLE001 - any failure => unavailable
        return None


def _normalize_step(path: Path) -> None:
    """Rewrite the STEP FILE_NAME timestamp to a FIXED epoch so the file is
    byte-deterministic across runs (OCCT stamps the current time, which would
    otherwise change the sha256 on every generation). Geometry is untouched."""
    try:
        text = path.read_text(encoding="utf-8", errors="strict")
    except Exception:  # noqa: BLE001
        return
    import re

    # FILE_NAME('name','YYYY-MM-DDThh:mm:ss', ...). Replace the 2nd arg's ISO
    # timestamp with a fixed sentinel so regenerated files hash identically.
    fixed = "1970-01-01T00:00:00"
    text = re.sub(
        r"(FILE_NAME\('[^']*',')[^']*(',)",
        lambda m: m.group(1) + fixed + m.group(2),
        text,
        count=1,
    )
    path.write_text(text, encoding="utf-8")


def _export_stl(b: Any, solid: Any, path: Path) -> None:
    """Write an ASCII-STL preview. Uses build123d's exporter if present,
    else a Mesher fallback. STL preview is best-effort; STEP is the contract."""
    try:
        b.export_stl(solid, str(path), ascii_format=True)
        return
    except Exception:  # noqa: BLE001
        pass
    try:
        from build123d import Mesher  # type: ignore

        mesher = Mesher()
        mesher.add_shape(solid)
        mesher.write(str(path))
    except Exception:  # noqa: BLE001
        # Preview is optional; swallow so STEP generation still counts.
        pass


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    h.update(path.read_bytes())
    return h.hexdigest()


def main() -> int:
    b = _import_build123d()
    if b is None:
        # HONEST: no build123d -> generate NOTHING and ship an empty manifest.
        try:
            MANIFEST_PATH.parent.mkdir(parents=True, exist_ok=True)
            MANIFEST_PATH.write_text(
                json.dumps({"entries": []}, indent=2) + "\n", encoding="utf-8"
            )
        except OSError:
            pass
        print(json.dumps({
            "generated": [],
            "skipped": [s.key for s in specs()],
            "build123d_available": False,
        }))
        return 0

    OUT_DIR.mkdir(parents=True, exist_ok=True)

    generated_keys: list[str] = []
    skipped: list[dict[str, Any]] = []
    entries: list[dict[str, Any]] = []

    for spec in specs():
        step_path = OUT_DIR / f"{spec.key}.step"
        stl_path = OUT_DIR / f"{spec.key}.stl"
        try:
            solid = spec.build(b, spec)
            # Real STEP export — this is the dimensioned-parametric contract.
            b.export_step(solid, str(step_path))
            if not step_path.exists() or step_path.stat().st_size == 0:
                raise RuntimeError("STEP export produced no file")
            _normalize_step(step_path)
            _export_stl(b, solid, stl_path)
            sha = _sha256(step_path)
            entry: dict[str, Any] = {
                "key": spec.key,
                "source": "build123d",
                "productCode": spec.product_code,
                "name": spec.name,
                "stepUrl": f"/parts/build123d/{spec.key}.step",
                "sha256": sha,
                "dimensions": spec.dimensions(),
            }
            # Catalog-SKU resolution hints (heads only). When present, these let
            # catalog-geometry.ts map a catalog SKU by (category, nominalSizeIn).
            if spec.category is not None:
                entry["category"] = spec.category
            if spec.nominal_size_in is not None:
                entry["nominalSizeIn"] = spec.nominal_size_in
            entries.append(entry)
            generated_keys.append(spec.key)
        except Exception as exc:  # noqa: BLE001
            # A failed part is skipped honestly; never write a fake STEP/entry.
            if step_path.exists() and step_path.stat().st_size == 0:
                try:
                    step_path.unlink()
                except OSError:
                    pass
            skipped.append({"key": spec.key, "error": str(exc)})

    # Stable ordering for byte-deterministic manifest output.
    entries.sort(key=lambda e: e["key"])
    MANIFEST_PATH.write_text(
        json.dumps({"entries": entries}, indent=2) + "\n", encoding="utf-8"
    )

    print(json.dumps({
        "generated": generated_keys,
        "skipped": skipped,
        "build123d_available": True,
    }))
    return 0


if __name__ == "__main__":
    sys.exit(main())
