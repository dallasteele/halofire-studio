"""V2 Phase 4.4 — guard that all 25 new catalog GLBs render & parse.

Regenerates the Phase 4.4 asset set into a tmpdir, then walks the
output and asserts each file is (a) non-empty, (b) a readable GLB
that loads without a crash, and (c) yields at least one mesh with
triangles.
"""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest
import trimesh

SCAD_DIR = Path(__file__).resolve().parents[1]
ROOT = Path(__file__).resolve().parents[5]


def _load_renderer():
    spec = importlib.util.spec_from_file_location(
        "render_phase44", SCAD_DIR / "render_phase44_assets.py",
    )
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    sys.modules["render_phase44"] = mod
    spec.loader.exec_module(mod)
    return mod


def test_all_scad_templates_exist() -> None:
    """The 25 .scad files must all be on disk."""
    expected = {
        "head_pendant_qr_k80.scad",
        "head_upright_esfr_k112.scad",
        "head_concealed_cover.scad",
        "head_sidewall_horizontal_k80.scad",
        "tee_reducing_2x1.scad",
        "elbow_45.scad",
        "elbow_90_grooved.scad",
        "reducer_eccentric.scad",
        "cross_fitting.scad",
        "cap_end.scad",
        "flange_150_raised.scad",
        "union_grooved.scad",
        "valve_check_swing.scad",
        "valve_ball_threaded.scad",
        "valve_globe.scad",
        "valve_rpz_backflow.scad",
        "valve_alarm_check.scad",
        "flow_switch.scad",
        "tamper_switch.scad",
        "pressure_switch.scad",
        "pressure_gauge_liquid.scad",
        "hanger_band_iron.scad",
        "hanger_trapeze.scad",
        "hanger_seismic_sway.scad",
        "hanger_c_clamp_beam.scad",
    }
    on_disk = {p.name for p in SCAD_DIR.glob("*.scad")}
    missing = expected - on_disk
    assert not missing, f"missing Phase 4.4 SCAD templates: {missing}"


def test_renderer_has_25_callables() -> None:
    mod = _load_renderer()
    assert len(mod.ALL_RENDERERS) == 25


def test_render_all_succeeds_and_writes_valid_glbs(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    mod = _load_renderer()
    # Redirect output to a tmpdir so the test doesn't require the
    # real asset directory to be writable.
    monkeypatch.setattr(mod, "_ASSETS", tmp_path / "assets")
    monkeypatch.setattr(mod, "_WEB", tmp_path / "web")
    rendered = mod.render_all()
    assert len(rendered) == 25, f"only rendered {rendered}"
    glbs = list((tmp_path / "assets").glob("SM_*.glb"))
    assert len(glbs) == 25
    # Load each and confirm trimesh can parse + find geometry
    for glb in glbs:
        scene = trimesh.load(str(glb), force="scene")
        meshes = [
            g for g in scene.geometry.values()
            if isinstance(g, trimesh.Trimesh)
        ]
        assert meshes, f"{glb.name}: no mesh geometry"
        tri_sum = sum(len(m.faces) for m in meshes)
        assert tri_sum > 0, f"{glb.name}: zero triangles"
