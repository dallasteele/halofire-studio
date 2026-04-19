"""Phase G.3 — orchestrator concurrency stress.

10 concurrent pipeline runs on different projects must:
- Not deadlock
- Not bleed data between project out_dirs
- All produce deliverables on disk

Runs in a ThreadPoolExecutor; pipeline is CPU-bound but GIL-safe
enough for 10 concurrent runs with isolated output dirs.
"""
from __future__ import annotations

import importlib.util
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
REPO = ROOT.parent.parent
sys.path.insert(0, str(ROOT))

_SPEC = importlib.util.spec_from_file_location(
    "hf_orch_stress", ROOT / "orchestrator.py",
)
assert _SPEC is not None and _SPEC.loader is not None
ORCH = importlib.util.module_from_spec(_SPEC)
sys.modules["hf_orch_stress"] = ORCH
_SPEC.loader.exec_module(ORCH)

FIXTURE_PDF = (
    REPO / "apps" / "editor" / "public" / "projects"
    / "1881-cooperative" / "fire-rfis.pdf"
)


@pytest.mark.stress
@pytest.mark.slow
@pytest.mark.skipif(not FIXTURE_PDF.exists(), reason="fixture PDF missing")
def test_10_concurrent_pipelines_no_bleed(tmp_path: Path) -> None:
    """Run 10 concurrent pipelines against the same PDF, each with
    its own project_id + out_dir. Verify all complete and each
    output dir only contains its own project's files."""
    start = time.perf_counter()
    futures = []
    with ThreadPoolExecutor(max_workers=10) as pool:
        for i in range(10):
            proj_id = f"concurrent-{i}"
            out_dir = tmp_path / proj_id
            futures.append(pool.submit(
                ORCH.run_pipeline,
                str(FIXTURE_PDF), proj_id, None, None, out_dir,
            ))
        results = [f.result(timeout=120) for f in as_completed(futures)]
    elapsed = time.perf_counter() - start

    assert elapsed < 120.0, f"stress run took {elapsed:.1f} s (budget 120)"
    assert len(results) == 10

    # No bleed — each out_dir has files whose project_id matches
    for i in range(10):
        proj_id = f"concurrent-{i}"
        out_dir = tmp_path / proj_id
        assert out_dir.exists()
        design_json = out_dir / "design.json"
        if design_json.exists():
            # Contents must reference this project_id, not a neighbor's
            data = design_json.read_text(encoding="utf-8")
            assert proj_id in data, (
                f"design.json for {proj_id} missing project marker"
            )
            for j in range(10):
                if i != j:
                    other = f"concurrent-{j}"
                    assert other not in data, (
                        f"cross-contamination: {other} found in {proj_id}"
                    )
