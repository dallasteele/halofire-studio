"""R10.6 — Cross-engine parity CI: Python side.

Reads the same JSON fixtures as ``packages/hf-core/tests/golden/golden.spec.ts``
and asserts the Python implementation produces identical output.

Blueprint 14 §3 — any drift between TS and Python here is a P0 CI
failure: the DXF export pipeline (Python) would emit layers or
dimension text that the on-screen renderer (TS) doesn't agree with.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Iterator

import pytest

# Fixtures live in the TS package so both sides read the same bytes.
GOLDEN_ROOT = (
    Path(__file__).resolve().parents[3]
    / "packages"
    / "hf-core"
    / "tests"
    / "golden"
)


def _walk_golden() -> Iterator[tuple[str, Path, dict[str, Any]]]:
    if not GOLDEN_ROOT.exists():
        return
    for algo_dir in sorted(GOLDEN_ROOT.iterdir()):
        if not algo_dir.is_dir():
            continue
        for fixture_file in sorted(algo_dir.glob("*.json")):
            fx = json.loads(fixture_file.read_text(encoding="utf-8"))
            yield algo_dir.name, fixture_file, fx


def _fixtures_for(algo: str) -> list[tuple[str, Path, dict[str, Any]]]:
    return [t for t in _walk_golden() if t[0] == algo]


# ── Algorithm runners ───────────────────────────────────────────────


def _run_layer_mapping(fx: dict[str, Any]) -> dict[str, Any]:
    from cad.layer_mapping import (
        LAYER_ACI_COLOR,
        NODE_TYPE_TO_DXF_LAYER,
        pipe_layer_for_role,
    )

    input_ = fx["input"]
    if "node_types" in input_:
        return {
            "layers": [
                NODE_TYPE_TO_DXF_LAYER.get(t, "__UNKNOWN__")
                for t in input_["node_types"]
            ]
        }
    if "roles" in input_:
        return {
            "layers": [pipe_layer_for_role(r) for r in input_["roles"]]
        }
    if "layers" in input_:
        return {
            "colors": [LAYER_ACI_COLOR.get(l, -1) for l in input_["layers"]]
        }
    raise AssertionError(
        "layer-mapping fixture missing node_types | roles | layers"
    )


def _run_dimension_format(fx: dict[str, Any]) -> dict[str, Any]:
    from cad.dimension_format import format_dimension_text

    cases = fx["input"]["cases"]
    return {
        "labels": [
            format_dimension_text(
                c["length_m"], c["unit_display"], c["precision"]
            )
            for c in cases
        ]
    }


_ALGO_RUNNERS = {
    "layer-mapping": _run_layer_mapping,
    "dimension-format": _run_dimension_format,
}


# ── Parametrised parity tests ───────────────────────────────────────


@pytest.mark.parametrize(
    "fixture_file,fx",
    [
        pytest.param(path, fx, id=f"layer-mapping::{fx['name']}")
        for _, path, fx in _fixtures_for("layer-mapping")
    ],
)
def test_layer_mapping_matches_ts_fixture(
    fixture_file: Path, fx: dict[str, Any]
) -> None:
    got = _run_layer_mapping(fx)
    assert got == fx["expected"], (
        f"Python layer-mapping diverges from fixture {fixture_file.name}: "
        f"got={got!r} expected={fx['expected']!r}"
    )


@pytest.mark.parametrize(
    "fixture_file,fx",
    [
        pytest.param(path, fx, id=f"dimension-format::{fx['name']}")
        for _, path, fx in _fixtures_for("dimension-format")
    ],
)
def test_dimension_format_matches_ts_fixture(
    fixture_file: Path, fx: dict[str, Any]
) -> None:
    got = _run_dimension_format(fx)
    assert got == fx["expected"], (
        f"Python dimension-format diverges from fixture {fixture_file.name}: "
        f"got={got!r} expected={fx['expected']!r}"
    )


def test_at_least_one_fixture_per_algorithm() -> None:
    """Regression guard — if the golden tree is deleted or renamed the
    parity job would silently pass with zero coverage. Require at
    least one fixture per registered algorithm."""
    for algo in _ALGO_RUNNERS:
        fixtures = _fixtures_for(algo)
        assert fixtures, f"no golden fixtures for algorithm '{algo}'"


def test_parity_runner_output_dump(tmp_path: Path) -> None:
    """Emit a ``python-parity-output.json`` artifact the
    ``scripts/parity-diff.ts`` drift-guard job can consume. Writes to
    repo-relative ``services/halofire-cad/tests/golden/.parity-py.json``
    so CI can shell out and diff without bespoke fixture discovery."""
    out: dict[str, dict[str, Any]] = {}
    for algo, path, fx in _walk_golden():
        runner = _ALGO_RUNNERS.get(algo)
        if runner is None:
            continue
        key = f"{algo}::{fx['name']}"
        out[key] = runner(fx)

    artifact_dir = Path(__file__).resolve().parent / "golden"
    artifact_dir.mkdir(exist_ok=True)
    (artifact_dir / ".parity-py.json").write_text(
        json.dumps(out, indent=2, sort_keys=True), encoding="utf-8"
    )
    assert out, "parity runner produced no output — fixtures missing?"
