"""Phase D.4.A — SCAD → GLB render runner for the full halofire catalog.

Walks every `authoring/scad/*.scad` file (the D.3 authored components plus
the D.1 template-driven parts) and invokes the OpenSCAD CLI to emit a GLB
next to the existing 50 renders under `packages/halofire-catalog/assets/glb/`.

Design:
  - Content-hash cache at `packages/halofire-catalog/assets/glb/.render_cache.json`
    — re-runs only re-render when the .scad source hash changes.
  - Parallel via ProcessPoolExecutor (default workers = cpu_count()//2).
  - Skips SKUs whose GLB is newer than the .scad source AND has a matching
    cached hash.
  - Honest failure reporting — if OpenSCAD isn't available or a specific
    part triggers a CGAL/non-manifold error, we log it and continue.

GLB-name convention:
  - D.3 authored parts emit `<sku>.glb` (sku == .scad basename), matching
    the entries in `catalog.json` that list `scad_source: "<sku>.scad"`.
  - Existing 50 GLBs keep their `SM_*.glb` names (driven by the template
    pipeline in `authoring/scad/batch_render.py`). This runner does NOT
    touch those — it only processes `.scad` files NOT named like templates.

OpenSCAD discovery order:
  1. `--openscad <path>` CLI flag
  2. `HALOFIRE_OPENSCAD` env var
  3. `shutil.which("openscad")`
  4. Common Windows install paths (`C:\\Program Files\\OpenSCAD\\openscad.exe`)

If no OpenSCAD is found, the runner exits with code 2 and a clear message —
the SCAD authoring itself is intact and can be rendered later on a box
with OpenSCAD installed.
"""
from __future__ import annotations

import argparse
import concurrent.futures
import hashlib
import json
import os
import shutil
import subprocess
import sys
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

_REPO = Path(__file__).resolve().parents[1]
_SCAD_DIR = _REPO / "packages" / "halofire-catalog" / "authoring" / "scad"
_GLB_DIR = _REPO / "packages" / "halofire-catalog" / "assets" / "glb"
_CACHE_FILE = _GLB_DIR / ".render_cache.json"

# Template files in the SCAD dir are parameter-driven (column.scad,
# pipe.scad, elbow_90.scad, ...). Skip them — they're handled by
# `authoring/scad/batch_render.py` from catalog entries, not standalone.
_TEMPLATE_NAMES = {
    "column.scad", "pipe.scad", "elbow_90.scad", "tee_equal.scad",
    "reducer.scad", "coupling.scad", "valve_inline.scad",
    "head_pendant.scad", "head_upright.scad", "head_sidewall.scad",
    "placeholder.scad", "hanger.scad",
}


@dataclass
class RenderStat:
    sku: str
    scad: str
    status: str          # rendered | cached | failed | missing_openscad
    out: str | None = None
    error: str | None = None
    duration_ms: int = 0
    bytes: int = 0


@dataclass
class RunReport:
    started_at: float
    finished_at: float | None = None
    openscad_bin: str | None = None
    total: int = 0
    rendered: int = 0
    cached: int = 0
    failed: int = 0
    missing_openscad: int = 0
    results: list[RenderStat] = field(default_factory=list)

    def add(self, s: RenderStat) -> None:
        self.total += 1
        self.results.append(s)
        if s.status == "rendered":
            self.rendered += 1
        elif s.status == "cached":
            self.cached += 1
        elif s.status == "failed":
            self.failed += 1
        elif s.status == "missing_openscad":
            self.missing_openscad += 1

    def write(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps(
                {
                    "started_at": self.started_at,
                    "finished_at": self.finished_at,
                    "openscad_bin": self.openscad_bin,
                    "total": self.total,
                    "rendered": self.rendered,
                    "cached": self.cached,
                    "failed": self.failed,
                    "missing_openscad": self.missing_openscad,
                    "results": [asdict(r) for r in self.results],
                },
                indent=2,
            ),
            encoding="utf-8",
        )


# ── openscad discovery ─────────────────────────────────────────

_WIN_CANDIDATES = (
    r"C:\Program Files\OpenSCAD\openscad.exe",
    r"C:\Program Files (x86)\OpenSCAD\openscad.exe",
    os.path.expanduser(r"~\AppData\Local\Programs\OpenSCAD\openscad.exe"),
)


def discover_openscad(override: str | None = None) -> str | None:
    if override:
        return override if Path(override).exists() or shutil.which(override) else None
    env = os.environ.get("HALOFIRE_OPENSCAD")
    if env and (Path(env).exists() or shutil.which(env)):
        return env
    found = shutil.which("openscad")
    if found:
        return found
    for p in _WIN_CANDIDATES:
        if Path(p).exists():
            return p
    return None


# ── cache ──────────────────────────────────────────────────────

def _hash_file(p: Path) -> str:
    h = hashlib.sha256()
    h.update(p.read_bytes())
    return h.hexdigest()


def _load_cache() -> dict[str, str]:
    if not _CACHE_FILE.exists():
        return {}
    try:
        return json.loads(_CACHE_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _write_cache(cache: dict[str, str]) -> None:
    _CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
    _CACHE_FILE.write_text(json.dumps(cache, indent=2, sort_keys=True), encoding="utf-8")


# ── render ─────────────────────────────────────────────────────

def _render_one(
    scad: Path, out_dir: Path, openscad_bin: str, timeout_s: int,
) -> RenderStat:
    sku = scad.stem
    out = out_dir / f"{sku}.glb"
    t0 = time.time()
    argv = [openscad_bin, "--export-format", "glb", "-o", str(out), str(scad)]
    try:
        res = subprocess.run(  # noqa: S603
            argv, capture_output=True, text=True, timeout=timeout_s,
        )
    except subprocess.TimeoutExpired:
        return RenderStat(
            sku=sku, scad=scad.name, status="failed",
            error=f"timeout after {timeout_s}s",
            duration_ms=int((time.time() - t0) * 1000),
        )
    dur_ms = int((time.time() - t0) * 1000)
    if res.returncode != 0:
        return RenderStat(
            sku=sku, scad=scad.name, status="failed",
            error=f"exit {res.returncode}: {res.stderr.strip()[:300]}",
            duration_ms=dur_ms,
        )
    if not out.exists():
        return RenderStat(
            sku=sku, scad=scad.name, status="failed",
            error="openscad produced no output file", duration_ms=dur_ms,
        )
    sz = out.stat().st_size
    if sz < 100:
        return RenderStat(
            sku=sku, scad=scad.name, status="failed",
            error=f"output too small ({sz} bytes) — likely empty mesh",
            duration_ms=dur_ms, bytes=sz,
        )
    return RenderStat(
        sku=sku, scad=scad.name, status="rendered",
        out=str(out), duration_ms=dur_ms, bytes=sz,
    )


def _collect_scads() -> list[Path]:
    return sorted(
        p for p in _SCAD_DIR.glob("*.scad")
        if p.name not in _TEMPLATE_NAMES
    )


# ── driver ─────────────────────────────────────────────────────

def run(
    *,
    openscad_override: str | None = None,
    workers: int | None = None,
    force: bool = False,
    timeout_s: int = 120,
    dry_run: bool = False,
) -> RunReport:
    _GLB_DIR.mkdir(parents=True, exist_ok=True)
    report = RunReport(started_at=time.time())
    scads = _collect_scads()
    cache = _load_cache()
    openscad_bin = discover_openscad(openscad_override)
    report.openscad_bin = openscad_bin

    if dry_run:
        for p in scads:
            report.add(RenderStat(
                sku=p.stem, scad=p.name, status="cached",
                out=str(_GLB_DIR / f"{p.stem}.glb"),
            ))
        report.finished_at = time.time()
        return report

    if openscad_bin is None:
        for p in scads:
            report.add(RenderStat(
                sku=p.stem, scad=p.name, status="missing_openscad",
                error="openscad CLI not found on PATH or common install locations",
            ))
        report.finished_at = time.time()
        return report

    # Partition: cached vs. to-render
    pending: list[Path] = []
    for p in scads:
        out = _GLB_DIR / f"{p.stem}.glb"
        cur_hash = _hash_file(p)
        if (
            not force
            and out.exists() and out.stat().st_size >= 100
            and cache.get(p.name) == cur_hash
        ):
            report.add(RenderStat(
                sku=p.stem, scad=p.name, status="cached",
                out=str(out), bytes=out.stat().st_size,
            ))
            continue
        pending.append(p)

    max_workers = workers or max(1, (os.cpu_count() or 2) // 2)
    if pending:
        with concurrent.futures.ProcessPoolExecutor(max_workers=max_workers) as ex:
            futs = {
                ex.submit(_render_one, p, _GLB_DIR, openscad_bin, timeout_s): p
                for p in pending
            }
            for fut in concurrent.futures.as_completed(futs):
                stat = fut.result()
                report.add(stat)
                if stat.status == "rendered":
                    src = _SCAD_DIR / stat.scad
                    if src.exists():
                        cache[stat.scad] = _hash_file(src)

    _write_cache(cache)
    report.finished_at = time.time()
    return report


def _cli() -> int:
    ap = argparse.ArgumentParser(description="Phase D.4.A SCAD→GLB batch renderer")
    ap.add_argument("--openscad", default=None,
                    help="path to openscad binary (overrides auto-discovery)")
    ap.add_argument("--workers", type=int, default=None,
                    help="parallel workers (default: cpu_count()//2)")
    ap.add_argument("--force", action="store_true",
                    help="ignore cache; re-render everything")
    ap.add_argument("--timeout", type=int, default=120,
                    help="per-part openscad timeout in seconds")
    ap.add_argument("--dry-run", action="store_true",
                    help="list what would run without invoking openscad")
    ap.add_argument("--report", default=None,
                    help="report path (default: assets/glb/.render_report.json)")
    args = ap.parse_args()

    report = run(
        openscad_override=args.openscad,
        workers=args.workers,
        force=args.force,
        timeout_s=args.timeout,
        dry_run=args.dry_run,
    )
    rp = Path(args.report) if args.report else (_GLB_DIR / ".render_report.json")
    report.write(rp)
    summary = {
        "total": report.total,
        "rendered": report.rendered,
        "cached": report.cached,
        "failed": report.failed,
        "missing_openscad": report.missing_openscad,
        "openscad_bin": report.openscad_bin,
        "report": str(rp),
    }
    print(json.dumps(summary, indent=2))
    if report.missing_openscad:
        print(
            "\nOpenSCAD not found. Install from https://openscad.org/downloads.html "
            "then re-run. The authored .scad sources are committed and the runner "
            "will resume from its cache.",
            file=sys.stderr,
        )
        return 2
    if report.failed:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(_cli())
