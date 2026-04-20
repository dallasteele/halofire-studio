"""Batch OpenSCAD renderer for every catalog SKU that lacks a real
authored GLB.

Workflow:
  1. Query the pricing DB (or the TS manifest via bun) for every SKU.
  2. Skip SKUs that already have an `assets/glb/<sku>.glb`.
  3. For each remaining SKU, pick a template via `spec_for` and drive
     the `openscad` CLI. Parallelize with concurrent.futures when
     `--workers > 1`.
  4. Emit a `render_report.json` next to the output dir so Halo can
     audit which SKUs got real geometry vs the placeholder fallback.

Dry-run mode (`--dry-run`) reports what WOULD run without touching
openscad — used for CI smoke-testing on boxes that don't have the
binary installed.
"""
from __future__ import annotations

import argparse
import concurrent.futures
import importlib.util
import json
import sys
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

_HERE = Path(__file__).resolve().parent
_REPO = _HERE.parents[3]  # .../halofire-studio

_SPEC = importlib.util.spec_from_file_location(
    "render_from_catalog", _HERE / "render_from_catalog.py",
)
assert _SPEC is not None and _SPEC.loader is not None
RC = importlib.util.module_from_spec(_SPEC)
sys.modules["render_from_catalog"] = RC
_SPEC.loader.exec_module(RC)


@dataclass
class RenderStat:
    sku: str
    template: str
    status: str       # 'rendered' | 'skipped_existing' | 'skipped_dry' | 'failed' | 'no_openscad'
    path: str | None = None
    error: str | None = None
    duration_ms: int = 0


@dataclass
class BatchReport:
    started_at: float
    finished_at: float | None = None
    total: int = 0
    rendered: int = 0
    skipped_existing: int = 0
    skipped_dry: int = 0
    failed: int = 0
    no_openscad: int = 0
    results: list[RenderStat] = field(default_factory=list)

    def add(self, stat: RenderStat) -> None:
        self.total += 1
        self.results.append(stat)
        if stat.status == "rendered":
            self.rendered += 1
        elif stat.status == "skipped_existing":
            self.skipped_existing += 1
        elif stat.status == "skipped_dry":
            self.skipped_dry += 1
        elif stat.status == "failed":
            self.failed += 1
        elif stat.status == "no_openscad":
            self.no_openscad += 1

    def write(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps(
                {
                    "started_at": self.started_at,
                    "finished_at": self.finished_at,
                    "total": self.total,
                    "rendered": self.rendered,
                    "skipped_existing": self.skipped_existing,
                    "skipped_dry": self.skipped_dry,
                    "failed": self.failed,
                    "no_openscad": self.no_openscad,
                    "results": [asdict(r) for r in self.results],
                },
                indent=2,
            ),
            encoding="utf-8",
        )


def _render_one(
    entry: dict[str, Any], out_dir: Path, openscad: str,
    *, dry_run: bool, skip_existing: bool,
) -> RenderStat:
    sku = str(entry.get("sku") or "")
    spec = RC.spec_for(entry)
    out_file = out_dir / f"{sku}.glb"
    t0 = time.time()
    if skip_existing and out_file.exists() and out_file.stat().st_size > 0:
        return RenderStat(
            sku=sku, template=spec.template,
            status="skipped_existing",
            path=str(out_file),
            duration_ms=int((time.time() - t0) * 1000),
        )
    if dry_run:
        return RenderStat(
            sku=sku, template=spec.template,
            status="skipped_dry",
            duration_ms=int((time.time() - t0) * 1000),
        )
    if not RC.openscad_available(openscad):
        return RenderStat(
            sku=sku, template=spec.template,
            status="no_openscad", error="openscad CLI not on PATH",
            duration_ms=int((time.time() - t0) * 1000),
        )
    ok, msg = RC.render_glb(entry, out_dir, openscad=openscad)
    if ok:
        return RenderStat(
            sku=sku, template=spec.template,
            status="rendered", path=msg,
            duration_ms=int((time.time() - t0) * 1000),
        )
    return RenderStat(
        sku=sku, template=spec.template,
        status="failed", error=msg,
        duration_ms=int((time.time() - t0) * 1000),
    )


def _load_catalog() -> list[dict[str, Any]]:
    """Reuse the same loader render_from_catalog has."""
    return RC._load_catalog()


def batch_render(
    out_dir: Path | str,
    *,
    catalog: list[dict[str, Any]] | None = None,
    openscad: str = "openscad",
    dry_run: bool = False,
    skip_existing: bool = True,
    workers: int = 1,
    filter_fn=None,
) -> BatchReport:
    out = Path(out_dir).resolve()
    out.mkdir(parents=True, exist_ok=True)
    items = list(catalog) if catalog is not None else _load_catalog()
    if filter_fn is not None:
        items = [e for e in items if filter_fn(e)]
    report = BatchReport(started_at=time.time())
    if workers <= 1:
        for entry in items:
            report.add(_render_one(
                entry, out, openscad,
                dry_run=dry_run, skip_existing=skip_existing,
            ))
    else:
        with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as ex:
            futures = [
                ex.submit(
                    _render_one, entry, out, openscad,
                    dry_run=dry_run, skip_existing=skip_existing,
                )
                for entry in items
            ]
            for f in concurrent.futures.as_completed(futures):
                report.add(f.result())
    report.finished_at = time.time()
    return report


# ── CLI ────────────────────────────────────────────────────────

def _cli() -> int:
    ap = argparse.ArgumentParser(description="Batch OpenSCAD GLB renderer")
    ap.add_argument("--out", required=True, help="output directory for GLBs")
    ap.add_argument("--openscad", default="openscad")
    ap.add_argument("--dry-run", action="store_true",
                    help="don't invoke openscad; just list what would run")
    ap.add_argument("--no-skip-existing", action="store_true",
                    help="re-render even if the target GLB already exists")
    ap.add_argument("--workers", type=int, default=1)
    ap.add_argument("--category-prefix", default=None,
                    help="render only SKUs whose category starts with this string")
    ap.add_argument("--report",
                    default=None,
                    help="path to write render_report.json (default: <out>/render_report.json)")
    args = ap.parse_args()
    out = Path(args.out).resolve()

    flt = None
    if args.category_prefix:
        prefix = args.category_prefix.lower()
        flt = lambda e: (e.get("category") or "").lower().startswith(prefix)  # noqa: E731

    report = batch_render(
        out,
        openscad=args.openscad,
        dry_run=args.dry_run,
        skip_existing=not args.no_skip_existing,
        workers=args.workers,
        filter_fn=flt,
    )
    report_path = Path(args.report) if args.report else (out / "render_report.json")
    report.write(report_path)
    print(json.dumps({
        "total": report.total,
        "rendered": report.rendered,
        "skipped_existing": report.skipped_existing,
        "skipped_dry": report.skipped_dry,
        "failed": report.failed,
        "no_openscad": report.no_openscad,
        "report": str(report_path),
    }, indent=2))
    if report.failed or report.no_openscad:
        return 1
    return 0


__all__ = ["batch_render", "BatchReport", "RenderStat"]


if __name__ == "__main__":
    raise SystemExit(_cli())
