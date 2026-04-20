"""Unit tests for the batch OpenSCAD renderer (dry-run path)."""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

_HERE = Path(__file__).resolve().parent
_PKG = _HERE.parent

_SPEC = importlib.util.spec_from_file_location(
    "batch_render", _PKG / "batch_render.py",
)
assert _SPEC is not None and _SPEC.loader is not None
BR = importlib.util.module_from_spec(_SPEC)
sys.modules["batch_render"] = BR
_SPEC.loader.exec_module(BR)


_CATALOG = [
    {"sku": "ANV-PIPE-SCH10-2in-21ft", "category": "pipe_steel_sch10",
     "pipe_size_in": 2.0, "dims_cm": [6, 6, 640], "model": "SCH10-2in"},
    {"sku": "VIC-ELBOW_90-2in", "category": "fitting_elbow_90",
     "pipe_size_in": 2.0, "model": "V-elbow_90-2"},
    {"sku": "VIC-TEE_EQ-2in", "category": "fitting_tee_equal",
     "pipe_size_in": 2.0},
    {"sku": "VIC-CHECK-4in", "category": "valve_check",
     "pipe_size_in": 4.0},
    {"sku": "VIK-VK-102-165F", "category": "sprinkler_head_pendant",
     "k_factor": 5.6},
]


def test_dry_run_skips_every_sku(tmp_path: Path) -> None:
    rep = BR.batch_render(
        tmp_path, catalog=_CATALOG, dry_run=True, skip_existing=True,
    )
    assert rep.total == len(_CATALOG)
    assert rep.skipped_dry == len(_CATALOG)
    assert rep.rendered == 0
    assert rep.failed == 0
    # No GLBs on disk
    assert list(tmp_path.glob("*.glb")) == []


def test_skip_existing_honors_existing_file(tmp_path: Path) -> None:
    # Seed one existing GLB
    glb = tmp_path / "ANV-PIPE-SCH10-2in-21ft.glb"
    glb.write_bytes(b"glTF\x02\x00\x00\x00" + b"\x00" * 128)
    rep = BR.batch_render(
        tmp_path, catalog=_CATALOG, dry_run=True, skip_existing=True,
    )
    statuses = {r.sku: r.status for r in rep.results}
    assert statuses["ANV-PIPE-SCH10-2in-21ft"] == "skipped_existing"


def test_no_skip_existing_reenters_dry_run(tmp_path: Path) -> None:
    glb = tmp_path / "ANV-PIPE-SCH10-2in-21ft.glb"
    glb.write_bytes(b"glTF\x02\x00\x00\x00" + b"\x00" * 128)
    rep = BR.batch_render(
        tmp_path, catalog=_CATALOG, dry_run=True, skip_existing=False,
    )
    statuses = {r.sku: r.status for r in rep.results}
    # With skip_existing False, even the pre-existing GLB goes
    # through the dry-run path.
    assert statuses["ANV-PIPE-SCH10-2in-21ft"] == "skipped_dry"


def test_filter_fn_restricts_rendered_set(tmp_path: Path) -> None:
    rep = BR.batch_render(
        tmp_path, catalog=_CATALOG, dry_run=True,
        filter_fn=lambda e: e.get("category", "").startswith("valve_"),
    )
    assert rep.total == 1
    assert rep.results[0].sku == "VIC-CHECK-4in"


def test_report_writes_json(tmp_path: Path) -> None:
    rep = BR.batch_render(tmp_path, catalog=_CATALOG, dry_run=True)
    out = tmp_path / "rep.json"
    rep.write(out)
    assert out.exists()
    import json
    data = json.loads(out.read_text(encoding="utf-8"))
    assert data["total"] == len(_CATALOG)
    assert data["skipped_dry"] == len(_CATALOG)
    assert isinstance(data["results"], list)


def test_each_template_is_reported(tmp_path: Path) -> None:
    rep = BR.batch_render(tmp_path, catalog=_CATALOG, dry_run=True)
    templates = {r.template for r in rep.results}
    # pipe.scad, elbow_90.scad, tee_equal.scad, valve_inline.scad,
    # head_pendant.scad — five distinct templates for five categories
    assert len(templates) >= 4


def test_workers_parallel_path(tmp_path: Path) -> None:
    rep = BR.batch_render(
        tmp_path, catalog=_CATALOG, dry_run=True, workers=3,
    )
    assert rep.total == len(_CATALOG)
    assert rep.skipped_dry == len(_CATALOG)


def test_real_render_without_openscad_flagged(tmp_path: Path, monkeypatch) -> None:
    """With dry_run=False and no openscad, every SKU is reported
    'no_openscad' instead of exploding."""
    monkeypatch.setattr(BR.RC, "openscad_available", lambda _=None: False)
    rep = BR.batch_render(tmp_path, catalog=_CATALOG, dry_run=False)
    assert rep.no_openscad == len(_CATALOG)
    assert rep.rendered == 0


def test_batch_report_counters_match_results() -> None:
    rep = BR.BatchReport(started_at=0.0)
    for status in ("rendered", "rendered", "skipped_existing",
                   "failed", "no_openscad", "skipped_dry"):
        rep.add(BR.RenderStat(
            sku="x", template="t", status=status,
        ))
    assert rep.total == 6
    assert rep.rendered == 2
    assert rep.skipped_existing == 1
    assert rep.failed == 1
    assert rep.no_openscad == 1
    assert rep.skipped_dry == 1
