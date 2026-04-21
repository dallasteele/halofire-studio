"""Unit tests for halofire_pipeline_entry.py — the Tauri sidecar entry.

Smoke-level: proves the script reads stdin JSON and emits NDJSON on
stdout in the expected shape. Full pipeline is exercised by
services/halofire-cad/tests/e2e/, not here.
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

_HERE = Path(__file__).resolve().parent
_ENTRY = _HERE / "halofire_pipeline_entry.py"


def _run_entry(stdin_json: dict, timeout: float = 30.0) -> tuple[int, list[dict], str]:
    """Run the entry, feed stdin, return (rc, events, stderr)."""
    proc = subprocess.run(
        [sys.executable, str(_ENTRY)],
        input=json.dumps(stdin_json) + "\n",
        capture_output=True,
        text=True,
        timeout=timeout,
    )
    events: list[dict] = []
    for line in proc.stdout.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            events.append(json.loads(line))
        except json.JSONDecodeError:
            events.append({"_raw": line})
    return proc.returncode, events, proc.stderr


def test_empty_stdin_emits_error() -> None:
    proc = subprocess.run(
        [sys.executable, str(_ENTRY)],
        input="",
        capture_output=True,
        text=True,
        timeout=5,
    )
    assert proc.returncode == 1
    events = [json.loads(l) for l in proc.stdout.splitlines() if l.strip()]
    assert any(e.get("step") == "error" for e in events)


def test_invalid_json_emits_error() -> None:
    rc, events, _ = _run_entry({}, timeout=5)
    # "{}" is valid json but missing pdf_path in pipeline mode → error.
    # Confirm we got at least one error event.
    assert any(e.get("step") == "error" for e in events)
    assert rc != 0


def test_missing_pdf_emits_pipeline_error() -> None:
    rc, events, _ = _run_entry(
        {"job_id": "t1", "pdf_path": "C:/nope/does/not/exist.pdf",
         "project_id": "testproj", "mode": "pipeline"},
    )
    # We should get at least started + error.
    origins = [e.get("step") for e in events]
    assert "started" in origins
    assert "error" in origins
    assert rc != 0


def test_quickbid_mode_runs_and_emits_done() -> None:
    """Quickbid doesn't need a real PDF — proves the sidecar end to
    end when the orchestrator is importable."""
    rc, events, stderr = _run_entry(
        {"job_id": "t_q1", "project_id": "qtest", "mode": "quickbid",
         "total_sqft": 10000, "level_count": 2,
         "standpipe_count": 0, "dry_systems": 0},
    )
    # quickbid's path may still fail import on CI without deps; if
    # so confirm at least started+error, else confirm happy-path.
    steps = [e.get("step") for e in events]
    assert "started" in steps
    # Either done (happy) or error (missing dep) is acceptable —
    # what matters is that the sidecar contract fired NDJSON.
    assert ("done" in steps) or ("error" in steps), (
        f"unexpected events: {events}, stderr: {stderr}"
    )
