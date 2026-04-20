"""Delta reporter — runs every cruel test and prints a compact
table of actual vs truth deltas. Use in commit messages.

Usage:
    python services/halofire-cad/tests/delta_report.py

Output example:

    metric              actual    truth   delta   tol   status
    head_count            1396     1303    7%    15%   PASS
    total_bid_usd     $502,310  $538,792   7%    15%   PASS
    system_count             7        7    0%    0%    PASS
    level_count             12       12    0%    0%    PASS

Exits 0 when every available metric is within tolerance. Otherwise
exits non-zero so CI can gate.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

_HERE = Path(__file__).resolve().parent
_REPO = _HERE.parents[2]
sys.path.insert(0, str(_HERE.parents[0]))

from truth.db import truth_for  # noqa: E402


_DELIVERABLES = _REPO / "services" / "halopenclaw-gateway" / "data" / "1881-cooperative" / "deliverables"


def _delta(actual: float, truth: float) -> float:
    if truth == 0:
        return float("inf") if actual != 0 else 0.0
    return abs(actual - truth) / abs(truth)


def _load(path: Path) -> dict | None:
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None


def _row(metric: str, actual, truth, tol: float) -> tuple[str, int]:
    """Build one report row. Returns (formatted_line, exit_code_delta)
    where exit_code_delta is 1 if this metric fails tol, else 0."""
    if truth is None:
        return (f"  {metric:<20s} skipped — truth is None", 0)
    if actual is None:
        return (f"  {metric:<20s} skipped — actual is None", 0)
    d = _delta(float(actual), float(truth))
    status = "PASS" if d <= tol else "FAIL"
    fail = 0 if d <= tol else 1
    # Format numbers neatly — currency for bid, count for int
    if "_usd" in metric:
        af = f"${float(actual):>12,.0f}"
        tf = f"${float(truth):>12,.0f}"
    elif "_ft" in metric:
        af = f"{float(actual):>12,.0f}"
        tf = f"{float(truth):>12,.0f}"
    else:
        af = f"{int(actual):>8d}"
        tf = f"{int(truth):>8d}"
    return (
        f"  {metric:<20s} {af}  {tf}   {d*100:5.1f}%   {int(tol*100):3d}%   {status}",
        fail,
    )


def _append_history(row: dict) -> None:
    """Append-only breadcrumb at docs/delta_history.jsonl. Every
    run logs the numbers so the ratchet is visible over time."""
    from datetime import datetime, timezone
    history = _REPO / "docs" / "delta_history.jsonl"
    history.parent.mkdir(parents=True, exist_ok=True)
    row = {
        "ts": datetime.now(timezone.utc).isoformat(),
        **row,
    }
    with history.open("a", encoding="utf-8") as f:
        f.write(json.dumps(row) + "\n")


def main() -> int:
    t = truth_for("1881-cooperative")
    if t is None:
        print("no truth record for 1881-cooperative", file=sys.stderr)
        return 2
    design = _load(_DELIVERABLES / "design.json") or {}
    proposal = _load(_DELIVERABLES / "proposal.json") or {}
    raw = _load(_DELIVERABLES / "building_raw.json") or {}
    systems = design.get("systems") or []
    heads = sum(len(s.get("heads") or []) for s in systems)
    pipes_m = sum(
        float(p.get("length_m") or 0.0)
        for s in systems for p in s.get("pipes") or []
    )
    pipes_ft = pipes_m * 3.281
    bid_usd = float((proposal.get("pricing") or {}).get("total_usd") or 0.0)
    demands = [
        float((s.get("hydraulic") or {}).get("required_flow_gpm") or 0.0)
        for s in systems
    ]
    gpm = max(demands) if demands else 0.0
    level_count = len(raw.get("levels") or [])

    print()
    print("HaloFire cruel-test delta report — 1881-cooperative")
    print("=" * 64)
    print(f"  {'metric':<20s} {'actual':>13s}  {'truth':>13s}   delta    tol   status")
    print("-" * 64)
    rows = [
        _row("head_count",       heads,       t.head_count,     0.15),
        _row("total_bid_usd",    bid_usd,     t.total_bid_usd,  0.15),
        _row("system_count",     len(systems), t.system_count,  0.0),
        _row("level_count",      level_count, t.level_count,    0.0),
        _row("pipe_total_ft",    pipes_ft,    t.pipe_total_ft,  0.20),
        _row("hydraulic_gpm",    gpm,         t.hydraulic_gpm,  0.10),
    ]
    fail = 0
    for line, f in rows:
        print(line)
        fail += f
    print("=" * 64)
    print(f"  {fail} metric(s) out of tolerance")
    # History breadcrumb
    _append_history({
        "project_id": "1881-cooperative",
        "head_count": heads,
        "total_bid_usd": bid_usd,
        "system_count": len(systems),
        "level_count": level_count,
        "pipe_total_ft": pipes_ft,
        "hydraulic_gpm": gpm,
        "fail_count": fail,
    })
    return 0 if fail == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
