"""Unit tests for the OpenSCAD render bridge.

OpenSCAD is not required to run these — we test dispatch + param
synthesis, and mock subprocess for the one test that exercises the
CLI pipeline.
"""
from __future__ import annotations

import importlib.util
import subprocess
import sys
from pathlib import Path
from unittest.mock import patch

import pytest

_HERE = Path(__file__).resolve().parent
_PKG = _HERE.parent

spec = importlib.util.spec_from_file_location(
    "render_from_catalog", _PKG / "render_from_catalog.py",
)
assert spec is not None and spec.loader is not None
RC = importlib.util.module_from_spec(spec)
sys.modules["render_from_catalog"] = RC
spec.loader.exec_module(RC)


# ── dispatch ────────────────────────────────────────────────────

def test_pipe_maps_to_pipe_scad() -> None:
    s = RC.spec_for(
        {"category": "pipe_steel_sch10", "pipe_size_in": 2.0,
         "dims_cm": [6, 6, 100]},
    )
    assert s.template == "pipe.scad"
    assert s.params["size_in"] == 2.0
    assert s.params["schedule"] == "sch10"
    assert s.params["length_m"] == 1.0


def test_sch40_detected_from_category() -> None:
    s = RC.spec_for({"category": "pipe_steel_sch40", "pipe_size_in": 4.0})
    assert s.params["schedule"] == "sch40"


def test_elbow_90_dispatches() -> None:
    s = RC.spec_for({"category": "fitting_elbow_90", "pipe_size_in": 2.0})
    assert s.template == "elbow_90.scad"
    assert s.params["size_in"] == 2.0


def test_tee_equal_dispatches() -> None:
    s = RC.spec_for({"category": "fitting_tee_equal", "pipe_size_in": 2.0})
    assert s.template == "tee_equal.scad"


def test_reducer_extracts_small_size_from_model() -> None:
    s = RC.spec_for(
        {"category": "fitting_reducer", "pipe_size_in": 2.0,
         "model": "Reducer-2to1"},
    )
    assert s.params["size_in_large"] == 2.0
    assert s.params["size_in_small"] == 1.0


def test_reducer_falls_back_to_half_on_missing_model() -> None:
    s = RC.spec_for(
        {"category": "fitting_reducer", "pipe_size_in": 2.0, "model": ""},
    )
    assert s.params["size_in_small"] == 1.0


def test_coupling_dispatches() -> None:
    s = RC.spec_for({"category": "fitting_coupling_grooved", "pipe_size_in": 2.0})
    assert s.template == "coupling.scad"


def test_valve_dispatches_to_inline() -> None:
    for cat in ("valve_osy_gate", "valve_butterfly", "valve_check", "valve_ball"):
        s = RC.spec_for({"category": cat, "pipe_size_in": 4.0})
        assert s.template == "valve_inline.scad", f"bad dispatch for {cat}"


def test_heads_dispatch_by_orientation() -> None:
    s1 = RC.spec_for({"category": "sprinkler_head_pendant", "k_factor": 5.6})
    s2 = RC.spec_for({"category": "sprinkler_head_upright", "k_factor": 5.6})
    s3 = RC.spec_for({"category": "sprinkler_head_sidewall", "k_factor": 5.6})
    s4 = RC.spec_for({"category": "sprinkler_head_concealed", "k_factor": 5.6})
    assert s1.template == "head_pendant.scad"
    assert s2.template == "head_upright.scad"
    assert s3.template == "head_sidewall.scad"
    assert s4.template == "head_pendant.scad"  # concealed uses pendant


def test_unknown_category_falls_back_to_placeholder() -> None:
    s = RC.spec_for(
        {"category": "unknown_thing", "dims_cm": [10, 20, 30]},
    )
    assert s.template == "placeholder.scad"
    assert s.params["dim_l_mm"] == 100.0
    assert s.params["dim_d_mm"] == 200.0


# ── argv synthesis ──────────────────────────────────────────────

def test_argv_contains_define_flags_and_output(tmp_path: Path) -> None:
    s = RC.RenderSpec(template="pipe.scad", params={"size_in": 2.0, "schedule": "sch10"})
    out = tmp_path / "x.glb"
    scad = _PKG / "pipe.scad"
    argv = s.argv("openscad", scad, out)
    assert argv[0] == "openscad"
    assert "--export-format" in argv
    assert "glb" in argv
    assert "-o" in argv
    assert str(out) in argv
    # Quoted string param + unquoted number param
    assert '-D' in argv
    joined = " ".join(argv)
    assert "size_in=2.0" in joined
    assert 'schedule="sch10"' in joined


# ── render_glb: missing PATH returns (False, reason) ────────────

def test_render_glb_without_openscad_returns_false(tmp_path: Path) -> None:
    with patch.object(RC, "openscad_available", return_value=False):
        ok, msg = RC.render_glb(
            {"sku": "TEST", "category": "pipe_steel_sch10",
             "pipe_size_in": 2.0, "dims_cm": [6, 6, 100]},
            tmp_path,
        )
    assert ok is False
    assert "openscad" in msg.lower()


def test_render_glb_propagates_openscad_failure(tmp_path: Path) -> None:
    class _FakeResult:
        returncode = 1
        stderr = "oopsy"
        stdout = ""

    with patch.object(RC, "openscad_available", return_value=True), \
         patch.object(subprocess, "run", return_value=_FakeResult()):
        ok, msg = RC.render_glb(
            {"sku": "TEST", "category": "fitting_elbow_90",
             "pipe_size_in": 2.0},
            tmp_path,
        )
    assert ok is False
    assert "exited 1" in msg


def test_render_glb_rejects_entry_without_sku(tmp_path: Path) -> None:
    ok, msg = RC.render_glb({"category": "pipe_steel_sch10"}, tmp_path)
    assert ok is False
    assert "sku" in msg


# ── smoke: every bundled template file exists on disk ───────────

def test_every_template_file_exists() -> None:
    for name in (
        "pipe.scad", "elbow_90.scad", "tee_equal.scad", "reducer.scad",
        "coupling.scad", "valve_inline.scad", "head_pendant.scad",
        "head_upright.scad", "head_sidewall.scad", "placeholder.scad",
    ):
        assert (_PKG / name).exists(), f"missing template {name}"


def test_every_catalog_category_has_a_dispatch() -> None:
    """No CATALOG category may fall through to 'placeholder.scad'
    except the truly unsupported ones. Keeps the template library
    honest as new categories are added."""
    # Only these fall back to placeholder by design:
    allowed_placeholder = {
        "hanger_clevis", "hanger_ring", "hanger_seismic_brace",
        "external_alarm_bell", "external_piv", "external_standpipe",
        "sign_hydraulic_placard", "riser_manifold", "riser_tamper_switch",
        "riser_flow_switch", "riser_pressure_gauge", "riser_test_drain",
        "external_fdc",
    }
    # Minimum set: the categories we claim are supported
    supported = [
        "pipe_steel_sch10", "pipe_steel_sch40", "pipe_copper", "pipe_cpvc",
        "fitting_elbow_90", "fitting_elbow_45",
        "fitting_tee_equal", "fitting_tee_reducing",
        "fitting_reducer",
        "fitting_coupling_grooved", "fitting_coupling_flexible",
        "valve_osy_gate", "valve_butterfly", "valve_check", "valve_ball",
        "sprinkler_head_pendant", "sprinkler_head_upright",
        "sprinkler_head_sidewall", "sprinkler_head_concealed",
        "sprinkler_head_residential",
    ]
    for cat in supported:
        t = RC._template_for(cat)
        assert t != "placeholder.scad", f"{cat} fell through to placeholder"
    for cat in allowed_placeholder:
        assert RC._template_for(cat) == "placeholder.scad"
