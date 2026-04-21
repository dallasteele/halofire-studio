"""halofire-pipeline sidecar — stdin JSON job-spec → stdout NDJSON events.

Invoked by the Tauri host (src-tauri/src/commands/pipeline.rs). One
job per invocation. Shape:

    stdin:   {"job_id": "...", "pdf_path": "...", "project_id": "...", "mode": "pipeline"}\n
    stdout:  {"step": "intake", "walls": 312, ...}\n
             {"step": "classify", "hazard_counts": {...}}\n
             ...
             {"step": "done", "files": {"design.json": "...", ...}}\n

Each line is a complete JSON record so the Rust relay can forward it
to the webview as a Tauri event (`pipeline:progress`). stderr is
reserved for human-readable logs (relayed but not treated as events).

Packaging: PyInstaller --onefile → bin/halofire-pipeline-<triple>.exe
placed under src-tauri/bin/ per Tauri's externalBin convention.
"""
from __future__ import annotations

import json
import os
import sys
import time
import traceback
from pathlib import Path

# Locate the monorepo so we can import halofire-cad's orchestrator.
# PyInstaller bundles these sources into the binary itself, so the
# sys.path additions work identically in dev and in the packaged exe.
_HERE = Path(__file__).resolve().parent
_REPO = _HERE.parent.parent.parent
_HFCAD = _REPO / "services" / "halofire-cad"
if str(_HFCAD) not in sys.path:
    sys.path.insert(0, str(_HFCAD))


def emit(event: dict) -> None:
    """Print one JSON line to stdout, flushed."""
    sys.stdout.write(json.dumps(event, default=str) + "\n")
    sys.stdout.flush()


def log(msg: str) -> None:
    """Human-readable log line — stderr only, not a pipeline event."""
    sys.stderr.write(f"[pipeline] {msg}\n")
    sys.stderr.flush()


def main() -> int:
    raw = sys.stdin.readline()
    if not raw:
        emit({"step": "error", "message": "no job spec on stdin"})
        return 1
    try:
        spec = json.loads(raw)
    except json.JSONDecodeError as e:
        emit({"step": "error", "message": f"bad job spec: {e}"})
        return 1

    job_id = spec.get("job_id", "")
    pdf_path = spec.get("pdf_path") or ""
    project_id = spec.get("project_id", "demo")
    mode = spec.get("mode", "pipeline")

    emit({"step": "started", "job_id": job_id, "project_id": project_id})

    try:
        # Lazy-import so a bad spec doesn't pay the Pandas-import cost.
        import importlib.util

        spec_m = importlib.util.spec_from_file_location(
            "hf_orchestrator", _HFCAD / "orchestrator.py",
        )
        if spec_m is None or spec_m.loader is None:
            raise RuntimeError(f"orchestrator not found at {_HFCAD}")
        orch = importlib.util.module_from_spec(spec_m)
        spec_m.loader.exec_module(orch)

        if mode == "quickbid":
            result = orch.run_quickbid(
                total_sqft=float(spec.get("total_sqft", 170000)),
                project_id=project_id,
                level_count=int(spec.get("level_count", 6)),
                standpipe_count=int(spec.get("standpipe_count", 2)),
                dry_systems=int(spec.get("dry_systems", 2)),
            )
            emit({"step": "quickbid", "result": result})
            emit({"step": "done", "files": {}})
            return 0

        if not pdf_path:
            emit({"step": "error", "message": "pdf_path required for pipeline mode"})
            return 2
        if not Path(pdf_path).is_file():
            emit({"step": "error", "message": f"pdf not found: {pdf_path}"})
            return 2

        # Output to Tauri's app_data_dir if provided, else a temp
        # subdir keyed by project_id. The Rust host sets
        # HALOFIRE_OUT_DIR on the child env so we never need to
        # parse platform-specific paths here.
        out_dir_env = os.environ.get("HALOFIRE_OUT_DIR")
        out_dir = Path(out_dir_env) / project_id if out_dir_env else None

        def _progress(event: dict) -> None:
            emit(event)

        summary = orch.run_pipeline(
            pdf_path=pdf_path,
            project_id=project_id,
            out_dir=out_dir,
            progress_callback=_progress,
        )
        emit({
            "step": "done",
            "files": summary.get("files", {}),
            "elapsed_ms": int(
                (time.time() - spec.get("_started_at", time.time())) * 1000
            ),
        })
        return 0
    except Exception as e:  # noqa: BLE001
        log(traceback.format_exc())
        emit({"step": "error", "message": str(e)})
        return 3


if __name__ == "__main__":
    sys.exit(main())
