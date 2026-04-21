"""V2 step 4 — OpenSCAD runtime tests.

These tests don't require OpenSCAD to be installed. They verify:

  - detect_openscad() returns None when no binary is present (via env
    override to an empty path + monkeypatched hints)
  - when OpenSCAD is absent, .render() falls back to the pre-baked
    Trimesh GLB
  - cache_key is stable across param orderings and changes on content
  - cache_path round-trip: rendering twice hits the cache on the
    second call
  - _trimesh_fallback matches valve_globe.scad → SM_Valve_Globe_2in.glb
  - when OPENSCAD_PATH is set to a valid-looking binary, the runtime
    advertises itself as available

If OPENSCAD is on the system PATH the subprocess-call integration test
runs too.
"""
from __future__ import annotations

import importlib.util
import os
import shutil
import sys
from pathlib import Path

import pytest

_HERE = Path(__file__).resolve().parent
_MOD = _HERE.parent / "openscad_runtime.py"
_spec = importlib.util.spec_from_file_location("scad_runtime", _MOD)
assert _spec is not None and _spec.loader is not None
scad_runtime = importlib.util.module_from_spec(_spec)
sys.modules["scad_runtime"] = scad_runtime
_spec.loader.exec_module(scad_runtime)


def _repo_root() -> Path:
    p = _HERE.parent.parent.parent
    assert (p / "packages").is_dir()
    return p


def _scad_file(name: str) -> Path:
    return (
        _repo_root()
        / "packages" / "halofire-catalog" / "authoring" / "scad" / name
    )


def test_detect_openscad_returns_string_or_none() -> None:
    result = scad_runtime.detect_openscad()
    # Either None (not installed) or an existing file on disk.
    assert result is None or Path(result).is_file()


def test_detect_openscad_respects_explicit_env(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
) -> None:
    fake = tmp_path / "openscad-fake"
    fake.write_text("# not a real binary, but detect_openscad only checks existence")
    monkeypatch.setenv("OPENSCAD_PATH", str(fake))
    # Must hit the env-var branch before PATH lookup.
    assert scad_runtime.detect_openscad() == str(fake)


def test_runtime_available_property(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
) -> None:
    monkeypatch.delenv("OPENSCAD_PATH", raising=False)
    # Force detect to miss by emptying PATH + hints.
    monkeypatch.setattr(scad_runtime, "_WINDOWS_HINTS", [])
    monkeypatch.setattr(scad_runtime, "_POSIX_HINTS", [])
    monkeypatch.setattr(shutil, "which", lambda _name: None)
    rt = scad_runtime.OpenScadRuntime(
        cache_dir=tmp_path / "cache",
    )
    assert rt.available is False


def test_cache_key_stable_across_param_orderings(tmp_path: Path) -> None:
    rt = scad_runtime.OpenScadRuntime(cache_dir=tmp_path / "c")
    scad = _scad_file("valve_globe.scad")
    assert scad.is_file(), "test fixture missing"
    k1 = rt.cache_key(scad, {"size_in": 2, "schedule": "SCH10"})
    k2 = rt.cache_key(scad, {"schedule": "SCH10", "size_in": 2})
    assert k1 == k2
    # Different params → different key
    k3 = rt.cache_key(scad, {"size_in": 4, "schedule": "SCH10"})
    assert k3 != k1


def test_cache_key_changes_on_content_edit(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    rt = scad_runtime.OpenScadRuntime(cache_dir=tmp_path / "c")
    a = tmp_path / "a.scad"
    b = tmp_path / "b.scad"
    a.write_text("cube(10);")
    b.write_text("cube(20);")
    assert rt.cache_key(a, {}) != rt.cache_key(b, {})


def test_render_falls_back_to_trimesh_when_openscad_missing(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
) -> None:
    # Force OpenSCAD to appear missing.
    monkeypatch.delenv("OPENSCAD_PATH", raising=False)
    monkeypatch.setattr(scad_runtime, "_WINDOWS_HINTS", [])
    monkeypatch.setattr(scad_runtime, "_POSIX_HINTS", [])
    monkeypatch.setattr(shutil, "which", lambda _name: None)
    rt = scad_runtime.OpenScadRuntime(cache_dir=tmp_path / "cache")
    assert rt.available is False
    scad = _scad_file("valve_globe.scad")
    result = rt.render(scad, params={"size_in": 4})
    assert result.engine == "trimesh"
    assert result.path.is_file()
    assert result.path.stat().st_size > 0


def test_render_cache_hit_on_repeat_call(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
) -> None:
    monkeypatch.delenv("OPENSCAD_PATH", raising=False)
    monkeypatch.setattr(scad_runtime, "_WINDOWS_HINTS", [])
    monkeypatch.setattr(scad_runtime, "_POSIX_HINTS", [])
    monkeypatch.setattr(shutil, "which", lambda _name: None)
    rt = scad_runtime.OpenScadRuntime(cache_dir=tmp_path / "cache")
    scad = _scad_file("valve_globe.scad")
    _ = rt.render(scad, params={"size_in": 4})  # first call populates cache
    second = rt.render(scad, params={"size_in": 4})
    # Second call is served from cache regardless of engine.
    assert second.cache_hit is True
    assert second.path.is_file()


def test_trimesh_fallback_matches_valve_globe() -> None:
    rt = scad_runtime.OpenScadRuntime()
    scad = _scad_file("valve_globe.scad")
    match = rt._trimesh_fallback(scad)  # type: ignore[attr-defined]
    assert match is not None
    assert match.name == "SM_Valve_Globe_2in.glb"


def test_trimesh_fallback_matches_head_pendant() -> None:
    rt = scad_runtime.OpenScadRuntime()
    scad = _scad_file("head_pendant_qr_k80.scad")
    match = rt._trimesh_fallback(scad)  # type: ignore[attr-defined]
    assert match is not None
    assert "Pendant" in match.name
    assert "K80" in match.name or "k80" in match.name.lower()


def test_clear_cache_removes_files(tmp_path: Path) -> None:
    rt = scad_runtime.OpenScadRuntime(cache_dir=tmp_path / "c")
    (tmp_path / "c").mkdir(exist_ok=True)
    (tmp_path / "c" / "a.glb").write_text("x")
    (tmp_path / "c" / "b.glb").write_text("x")
    assert rt.clear_cache() == 2
    assert rt.clear_cache() == 0


@pytest.mark.skipif(
    scad_runtime.detect_openscad() is None,
    reason="openscad binary not installed on this machine",
)
def test_integration_real_openscad_renders_cube(tmp_path: Path) -> None:
    """Real subprocess invocation. Only runs when OpenSCAD is present."""
    rt = scad_runtime.OpenScadRuntime(cache_dir=tmp_path / "cache")
    assert rt.available is True
    # Write a tiny SCAD so we don't depend on fitting catalog geometry
    scad = tmp_path / "cube.scad"
    scad.write_text("cube(10);")
    result = rt.render(scad, params={}, output_format="stl")
    assert result.engine in {"openscad", "cache"}
    assert result.path.is_file()
    assert result.path.stat().st_size > 0
