"""V2 Phase 4.4 — Trimesh fallback renderer for the 25 new OpenSCAD
templates (heads, fittings, valves, switches, hangers).

Mirrors the per-file .scad geometry in pure Python so GLBs ship even
without OpenSCAD installed. Output lands in:

    packages/halofire-catalog/assets/glb/SM_<Category>_<Name>.glb
    apps/editor/public/halofire-catalog/glb/    (mirror for web)

Run:
    python -m packages.halofire-catalog.authoring.scad.render_phase44_assets
"""
from __future__ import annotations

import math
from pathlib import Path

import numpy as np
import trimesh

_ROOT = Path(__file__).resolve().parents[4]
_ASSETS = _ROOT / "packages" / "halofire-catalog" / "assets" / "glb"
_WEB = _ROOT / "apps" / "editor" / "public" / "halofire-catalog" / "glb"


def _red() -> trimesh.visual.material.PBRMaterial:
    # NFPA 13 §6.7 fire-protection red.
    return trimesh.visual.material.PBRMaterial(
        baseColorFactor=[0.91, 0.26, 0.18, 1.0],
        metallicFactor=0.40, roughnessFactor=0.45,
    )


def _steel() -> trimesh.visual.material.PBRMaterial:
    return trimesh.visual.material.PBRMaterial(
        baseColorFactor=[0.55, 0.57, 0.60, 1.0],
        metallicFactor=0.85, roughnessFactor=0.35,
    )


def _brass() -> trimesh.visual.material.PBRMaterial:
    return trimesh.visual.material.PBRMaterial(
        baseColorFactor=[0.80, 0.68, 0.34, 1.0],
        metallicFactor=0.90, roughnessFactor=0.30,
    )


def _plastic() -> trimesh.visual.material.PBRMaterial:
    return trimesh.visual.material.PBRMaterial(
        baseColorFactor=[0.90, 0.90, 0.88, 1.0],
        metallicFactor=0.0, roughnessFactor=0.85,
    )


def _ymeters(mesh: trimesh.Trimesh) -> trimesh.Trimesh:
    R = trimesh.transformations.rotation_matrix(-math.pi / 2, [1, 0, 0])
    mesh.apply_transform(R)
    mesh.apply_scale(0.001)  # mm → m
    return mesh


def _cyl(h: float, d: float, mat, sections: int = 32) -> trimesh.Trimesh:
    m = trimesh.creation.cylinder(radius=d / 2, height=h, sections=sections)
    m.visual = trimesh.visual.TextureVisuals(material=mat)
    return m


def _box(extents, mat) -> trimesh.Trimesh:
    m = trimesh.creation.box(extents=extents)
    m.visual = trimesh.visual.TextureVisuals(material=mat)
    return m


def _sphere(d: float, mat, sections: int = 24) -> trimesh.Trimesh:
    m = trimesh.creation.icosphere(radius=d / 2, subdivisions=2)
    m.visual = trimesh.visual.TextureVisuals(material=mat)
    return m


def _export(parts: list[trimesh.Trimesh], name: str) -> None:
    mesh = trimesh.util.concatenate(parts)
    _ymeters(mesh)
    for target in (_ASSETS / name, _WEB / name):
        target.parent.mkdir(parents=True, exist_ok=True)
        trimesh.Scene([mesh]).export(str(target), file_type="glb")


# ── Heads ────────────────────────────────────────────────────────────

def render_head_pendant_qr_k80() -> None:
    frame = _cyl(32, 14, _brass())
    frame.apply_translation((0, 0, 16))
    cone = _cyl(6, 10, _brass())
    cone.apply_translation((0, 0, 34))
    bulb = _sphere(3, _red())
    bulb.apply_translation((0, 0, 41))
    defl = _cyl(2, 34, _steel())
    defl.apply_translation((0, 0, 57))
    _export([frame, cone, bulb, defl], "SM_Head_Pendant_QR_K80.glb")


def render_head_upright_esfr_k112() -> None:
    frame = _cyl(40, 22, _brass())
    frame.apply_translation((0, 0, 20))
    cone = _cyl(11, 15, _brass())
    cone.apply_translation((0, 0, 45))
    defl = _cyl(2.5, 56, _steel())
    defl.apply_translation((0, 0, 56))
    _export([frame, cone, defl], "SM_Head_Upright_ESFR_K112.glb")


def render_head_concealed_cover() -> None:
    plate = _cyl(2.5, 85, _steel(), sections=64)
    plate.apply_translation((0, 0, 1.25))
    recess = _cyl(6, 60, _plastic(), sections=64)
    recess.apply_translation((0, 0, 5.5))
    _export([plate, recess], "SM_Head_Concealed_Cover.glb")


def render_head_sidewall_horizontal_k80() -> None:
    body = _cyl(60, 18, _brass())
    body.apply_transform(trimesh.transformations.rotation_matrix(
        math.pi / 2, [0, 1, 0]))
    body.apply_translation((30, 0, 0))
    defl = _box((3, 56, 20), _steel())
    defl.apply_translation((60, 0, 0))
    _export([body, defl], "SM_Head_Sidewall_Horizontal_K80.glb")


# ── Fittings ────────────────────────────────────────────────────────

def render_tee_reducing_2x1() -> None:
    run = _cyl(180, 60.3, _red(), sections=48)
    run.apply_transform(trimesh.transformations.rotation_matrix(
        math.pi / 2, [0, 1, 0]))
    branch = _cyl(60, 33.4, _red())
    branch.apply_translation((0, 0, 30))
    hub = _sphere(65, _red())
    _export([run, branch, hub], "SM_Fitting_Tee_Reducing_2x1.glb")


def render_elbow_45() -> None:
    # Approx 45° elbow by torus slice (segments along arc).
    parts: list[trimesh.Trimesh] = []
    r = 72  # centerline radius
    od = 60.3
    n = 10
    for i in range(n):
        a = math.radians(i * 45 / (n - 1))
        s = _cyl(8, od, _red())
        s.apply_transform(trimesh.transformations.rotation_matrix(
            math.pi / 2, [0, 1, 0]))
        s.apply_translation((r * math.cos(a), 0, r * math.sin(a)))
        parts.append(s)
    _export(parts, "SM_Fitting_Elbow_45.glb")


def render_elbow_90_grooved() -> None:
    parts: list[trimesh.Trimesh] = []
    r = 78
    od = 60.3
    for i in range(12):
        a = math.radians(i * 90 / 11)
        s = _cyl(8, od, _red())
        s.apply_transform(trimesh.transformations.rotation_matrix(
            math.pi / 2, [0, 1, 0]))
        s.apply_translation((r * math.cos(a), 0, r * math.sin(a)))
        parts.append(s)
    # Groove rings at both ends
    g1 = _cyl(8, od + 2, _steel())
    g1.apply_transform(trimesh.transformations.rotation_matrix(
        math.pi / 2, [0, 1, 0]))
    g1.apply_translation((r, 0, 0))
    parts.append(g1)
    _export(parts, "SM_Fitting_Elbow_90_Grooved.glb")


def render_reducer_eccentric() -> None:
    # Two flanges + cone hull approximated by stacked cylinders.
    parts = []
    parts.append(_cyl(2, 60.3, _steel()))
    for i in range(1, 10):
        t = i / 10
        d = 60.3 * (1 - t) + 42.2 * t
        off_y = ((60.3 - 42.2) / 2) * t
        c = _cyl(10, d, _red())
        c.apply_transform(trimesh.transformations.rotation_matrix(
            math.pi / 2, [0, 1, 0]))
        c.apply_translation((i * 10, off_y, 0))
        parts.append(c)
    _export(parts, "SM_Fitting_Reducer_Eccentric_2to1_25.glb")


def render_cross_fitting() -> None:
    od = 60.3; L = 180
    run = _cyl(L, od, _red(), sections=48)
    run.apply_transform(trimesh.transformations.rotation_matrix(
        math.pi / 2, [0, 1, 0]))
    cross = _cyl(L, od, _red(), sections=48)
    cross.apply_transform(trimesh.transformations.rotation_matrix(
        math.pi / 2, [1, 0, 0]))
    hub = _sphere(od * 1.15, _red())
    _export([run, cross, hub], "SM_Fitting_Cross_Equal_2in.glb")


def render_cap_end() -> None:
    cap = _cyl(30, 60.3, _red(), sections=48)
    cap.apply_translation((0, 0, 15))
    dome = _sphere(60.3, _red())
    dome.apply_translation((0, 0, 30))
    groove = _cyl(8, 62, _steel(), sections=48)
    groove.apply_translation((0, 0, 4))
    _export([cap, dome, groove], "SM_Fitting_Cap_End_2in.glb")


def render_flange_150_raised() -> None:
    flange = _cyl(24, 229, _steel(), sections=64)
    flange.apply_translation((0, 0, 12))
    raised = _cyl(2, 171, _steel(), sections=48)
    raised.apply_translation((0, 0, 25))
    _export([flange, raised], "SM_Flange_150_RF_4in.glb")


def render_union_grooved() -> None:
    body = _cyl(70, 60.3, _red(), sections=48)
    body.apply_transform(trimesh.transformations.rotation_matrix(
        math.pi / 2, [0, 1, 0]))
    ring = _cyl(20, 78, _steel(), sections=48)
    ring.apply_transform(trimesh.transformations.rotation_matrix(
        math.pi / 2, [0, 1, 0]))
    _export([body, ring], "SM_Fitting_Union_Grooved_2in.glb")


# ── Valves ──────────────────────────────────────────────────────────

def render_valve_check_swing() -> None:
    body = _cyl(260, 140, _red(), sections=48)
    body.apply_transform(trimesh.transformations.rotation_matrix(
        math.pi / 2, [0, 1, 0]))
    fl1 = _cyl(22, 229, _steel(), sections=48)
    fl1.apply_transform(trimesh.transformations.rotation_matrix(
        math.pi / 2, [0, 1, 0]))
    fl1.apply_translation((-141, 0, 0))
    fl2 = _cyl(22, 229, _steel(), sections=48)
    fl2.apply_transform(trimesh.transformations.rotation_matrix(
        math.pi / 2, [0, 1, 0]))
    fl2.apply_translation((141, 0, 0))
    bonnet = _cyl(40, 90, _steel())
    bonnet.apply_translation((0, 0, 90))
    _export([body, fl1, fl2, bonnet], "SM_Valve_Check_Swing_4in.glb")


def render_valve_ball_threaded() -> None:
    body = _cyl(90, 50, _brass(), sections=40)
    body.apply_transform(trimesh.transformations.rotation_matrix(
        math.pi / 2, [0, 1, 0]))
    stem = _cyl(12, 12, _steel())
    stem.apply_translation((0, 0, 31))
    handle = _box((120, 15, 6), _red())
    handle.apply_translation((0, 0, 43))
    _export([body, stem, handle], "SM_Valve_Ball_Threaded_1in.glb")


def render_valve_globe() -> None:
    run = _cyl(110, 50, _red())
    run.apply_transform(trimesh.transformations.rotation_matrix(
        math.pi / 2, [0, 1, 0]))
    bulb = _sphere(85, _red())
    yoke = _cyl(50, 20, _steel())
    yoke.apply_translation((0, 0, 65))
    wheel = _cyl(5, 70, _steel(), sections=32)
    wheel.apply_translation((0, 0, 92))
    _export([run, bulb, yoke, wheel], "SM_Valve_Globe_2in.glb")


def render_valve_rpz_backflow() -> None:
    body = _cyl(700, 160, _red(), sections=48)
    body.apply_transform(trimesh.transformations.rotation_matrix(
        math.pi / 2, [0, 1, 0]))
    bonnet1 = _cyl(80, 90, _steel())
    bonnet1.apply_translation((-175, 0, 120))
    bonnet2 = _cyl(80, 90, _steel())
    bonnet2.apply_translation((175, 0, 120))
    relief = _cyl(80, 70, _brass())
    relief.apply_translation((0, 0, -120))
    _export([body, bonnet1, bonnet2, relief], "SM_Valve_RPZ_Backflow_4in.glb")


def render_valve_alarm_check() -> None:
    body = _cyl(320, 170, _red(), sections=48)
    body.apply_translation((0, 0, 160))
    fl_top = _cyl(22, 229, _steel(), sections=48)
    fl_top.apply_translation((0, 0, 331))
    fl_bot = _cyl(22, 229, _steel(), sections=48)
    fl_bot.apply_translation((0, 0, -11))
    trim = _cyl(60, 32, _brass())
    trim.apply_transform(trimesh.transformations.rotation_matrix(
        math.pi / 2, [0, 1, 0]))
    trim.apply_translation((115, 0, 128))
    _export([body, fl_top, fl_bot, trim], "SM_Valve_AlarmCheck_WetPipe_4in.glb")


# ── Switches / devices ──────────────────────────────────────────────

def render_flow_switch() -> None:
    saddle = _box((100, 60, 20), _red())
    body = _box((80, 60, 90), _plastic())
    body.apply_translation((0, 0, 55))
    conduit = _cyl(25, 22, _steel())
    conduit.apply_translation((0, 0, 112))
    _export([saddle, body, conduit], "SM_FlowSwitch_Paddle_PotterVSR.glb")


def render_tamper_switch() -> None:
    body = _box((70, 45, 55), _red())
    conduit = _cyl(30, 22, _steel())
    conduit.apply_translation((0, 0, 42))
    bracket = _box((6, 65, 55), _steel())
    bracket.apply_translation((35, 0, 0))
    _export([body, conduit, bracket], "SM_TamperSwitch_OSY.glb")


def render_pressure_switch() -> None:
    body = _box((65, 40, 95), _red())
    thread = _cyl(15, 20, _brass())
    thread.apply_translation((0, 0, -55))
    conduit = _cyl(30, 22, _steel())
    conduit.apply_translation((0, 0, 62))
    _export([body, thread, conduit], "SM_PressureSwitch_HiLo.glb")


def render_pressure_gauge_liquid() -> None:
    face = _cyl(20, 90, _steel(), sections=48)
    face.apply_translation((0, 0, 10))
    stem = _cyl(35, 12, _brass())
    stem.apply_translation((0, 0, -17))
    _export([face, stem], "SM_PressureGauge_LiquidFilled_3_5in.glb")


# ── Hangers / supports ──────────────────────────────────────────────

def render_hanger_band_iron() -> None:
    # Ring approximated as a torus.
    ring = trimesh.creation.torus(
        major_radius=20, minor_radius=3, major_sections=32, minor_sections=12,
    )
    ring.visual = trimesh.visual.TextureVisuals(material=_steel())
    rod = _cyl(150, 10, _steel())
    rod.apply_translation((0, 0, 85))
    _export([ring, rod], "SM_Hanger_BandIron_1in.glb")


def render_hanger_trapeze() -> None:
    strut = _box((600, 40, 40), _steel())
    rod_l = _cyl(300, 10, _steel())
    rod_l.apply_translation((-210, 0, 170))
    rod_r = _cyl(300, 10, _steel())
    rod_r.apply_translation((210, 0, 170))
    _export([strut, rod_l, rod_r], "SM_Hanger_Trapeze_2Pipe.glb")


def render_hanger_seismic_sway() -> None:
    brace = _cyl(1200, 33.4, _steel(), sections=24)
    brace.apply_transform(trimesh.transformations.rotation_matrix(
        math.radians(45), [0, 1, 0]))
    brace.apply_translation((420, 0, 420))
    top_fitting = _box((60, 40, 30), _red())
    top_fitting.apply_translation((840, 0, 840))
    base_plate = _box((80, 60, 8), _steel())
    _export([brace, top_fitting, base_plate], "SM_Hanger_SeismicSway_1in.glb")


def render_hanger_c_clamp_beam() -> None:
    body = _box((45, 15, 50), _steel())
    rod = _cyl(40, 10, _steel())
    rod.apply_translation((0, 0, -45))
    _export([body, rod], "SM_Hanger_CClamp_Beam.glb")


ALL_RENDERERS = [
    render_head_pendant_qr_k80,
    render_head_upright_esfr_k112,
    render_head_concealed_cover,
    render_head_sidewall_horizontal_k80,
    render_tee_reducing_2x1,
    render_elbow_45,
    render_elbow_90_grooved,
    render_reducer_eccentric,
    render_cross_fitting,
    render_cap_end,
    render_flange_150_raised,
    render_union_grooved,
    render_valve_check_swing,
    render_valve_ball_threaded,
    render_valve_globe,
    render_valve_rpz_backflow,
    render_valve_alarm_check,
    render_flow_switch,
    render_tamper_switch,
    render_pressure_switch,
    render_pressure_gauge_liquid,
    render_hanger_band_iron,
    render_hanger_trapeze,
    render_hanger_seismic_sway,
    render_hanger_c_clamp_beam,
]


def render_all() -> list[str]:
    """Render every Phase 4.4 asset. Returns list of asset names."""
    names: list[str] = []
    for fn in ALL_RENDERERS:
        try:
            fn()
            names.append(fn.__name__)
        except Exception as e:  # noqa: BLE001
            print(f"  ! {fn.__name__} failed: {e}")
    return names


if __name__ == "__main__":
    rendered = render_all()
    print(f"rendered {len(rendered)} / {len(ALL_RENDERERS)} Phase 4.4 assets")
    print(f"  assets: {_ASSETS}")
    print(f"  web:    {_WEB}")
