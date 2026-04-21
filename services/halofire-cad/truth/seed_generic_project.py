"""Generic second-project truth seed (parametric).

This is the scaffolding for R11.1 (IMPLEMENTATION_PLAN.md). The
1881-Cooperative seed (`seed_1881.py`) hard-codes every field
because those numbers came from a single, fully-reviewed bid
package. When a second real Halo bid PDF lands we do NOT want to
fork-copy that entire file — we want to call into this module
with the new project's numbers and have the cruel-test scoreboard
wire up automatically.

Differences from `seed_1881.py`:
  * Accepts every truth field via function args (or CLI flags).
  * Synthesizes per-level placeholder rows from `levels` count +
    total_sqft (evenly divided) — real per-level outlines arrive
    in a Phase 1b DWG pass, same pattern as 1881.
  * Idempotent: DELETE existing rows for `project_id` before
    INSERTing, so re-running the seed does not stack stale rows.
    (seed_1881.py acquired the same guard on 2026-04-20 after a
    prior run left 12 placeholder levels behind.)
  * Writable to a custom `out_path` so tests can point at a tmp
    DuckDB file instead of the canonical `truth.duckdb`.

Usage:
    python seed_generic_project.py \\
        --project-id gomez-warehouse \\
        --levels 3 \\
        --hazard ordinary_group_2 \\
        --total-sqft 120000 \\
        --expected-heads 850 \\
        --expected-bid-usd 420000 \\
        --expected-systems 3

Writes into services/halofire-cad/truth/truth.duckdb (or the path
passed via --out-path). Existing rows for the same project_id are
replaced, not appended.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

_HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(_HERE.parent))

from truth.db import LevelTruth, TruthDB, TruthRecord  # noqa: E402


def seed_project(
    project_id: str,
    levels: int,
    hazard: str,
    total_sqft: float,
    expected_heads: int,
    expected_bid_usd: float,
    expected_systems: int,
    out_path: Path | None = None,
    project_name: str | None = None,
    architect_pdf_path: str | None = None,
    as_built_pdf_path: str | None = None,
    notes: str | None = None,
) -> None:
    """Seed (or re-seed) truth rows for `project_id`.

    Idempotent: any existing `bids_truth` + `bids_level_truth` rows
    for this project_id are dropped before the new rows are written.

    The per-level rows are placeholders — one row per level, total
    area evenly divided, elevation stacked at 3.0 m intervals. When
    a real DWG pass lands, call `TruthDB.upsert_level` directly with
    the measured polygons / areas / head counts.
    """
    if levels < 1:
        raise ValueError(f"levels must be >= 1, got {levels}")
    if total_sqft <= 0:
        raise ValueError(f"total_sqft must be > 0, got {total_sqft}")

    # 1 sqft = 0.092903 sqm
    total_sqm = total_sqft * 0.092903
    per_level_sqm = total_sqm / levels

    rec = TruthRecord(
        project_id=project_id,
        project_name=project_name or project_id,
        architect_pdf_path=architect_pdf_path,
        as_built_pdf_path=as_built_pdf_path,
        permit_reviewed=False,
        total_bid_usd=float(expected_bid_usd),
        head_count=int(expected_heads),
        pipe_count=None,
        pipe_total_ft=None,
        system_count=int(expected_systems),
        level_count=int(levels),
        hydraulic_gpm=None,
        hydraulic_psi=None,
        signed_off_at=None,
        notes=(
            notes
            or f"Parametric truth seed. hazard={hazard}, "
               f"total_sqft={total_sqft:.0f}. Per-level rows are "
               f"evenly-divided placeholders until a DWG pass lands."
        ),
    )

    db = TruthDB(out_path) if out_path is not None else TruthDB(
        _HERE / "truth.duckdb",
    )
    try:
        # Idempotent: wipe prior rows before re-inserting. Same
        # guard seed_1881.py added on 2026-04-20.
        db._con.execute(
            "DELETE FROM bids_level_truth WHERE project_id = ?",
            [project_id],
        )
        db._con.execute(
            "DELETE FROM bids_truth WHERE project_id = ?",
            [project_id],
        )
        db.upsert(rec)
        for i in range(levels):
            db.upsert_level(LevelTruth(
                project_id=project_id,
                level_index=i,
                level_name=f"Level {i + 1}",
                elevation_m=i * 3.0,
                outline_polygon_wkt=None,
                area_sqm=per_level_sqm,
                room_count=None,
                head_count=None,
                hazard_class=hazard,
            ))
        print(
            f"seeded {project_id}: levels={levels}, "
            f"heads={expected_heads}, systems={expected_systems}, "
            f"bid=${expected_bid_usd:,.2f}, hazard={hazard}",
        )
    finally:
        db.close()


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--project-id", required=True)
    p.add_argument("--levels", type=int, required=True)
    p.add_argument("--hazard", required=True,
                   help="NFPA hazard class (e.g. light, ordinary_group_1, "
                        "ordinary_group_2, extra_hazard_group_1)")
    p.add_argument("--total-sqft", type=float, required=True)
    p.add_argument("--expected-heads", type=int, required=True)
    p.add_argument("--expected-bid-usd", type=float, required=True)
    p.add_argument("--expected-systems", type=int, required=True)
    p.add_argument("--project-name", default=None)
    p.add_argument("--architect-pdf-path", default=None)
    p.add_argument("--as-built-pdf-path", default=None)
    p.add_argument("--notes", default=None)
    p.add_argument(
        "--out-path", default=None,
        help="Override the target DuckDB file (defaults to "
             "services/halofire-cad/truth/truth.duckdb).",
    )
    return p.parse_args(argv)


def main(argv: list[str] | None = None) -> None:
    args = _parse_args(argv)
    seed_project(
        project_id=args.project_id,
        levels=args.levels,
        hazard=args.hazard,
        total_sqft=args.total_sqft,
        expected_heads=args.expected_heads,
        expected_bid_usd=args.expected_bid_usd,
        expected_systems=args.expected_systems,
        out_path=Path(args.out_path) if args.out_path else None,
        project_name=args.project_name,
        architect_pdf_path=args.architect_pdf_path,
        as_built_pdf_path=args.as_built_pdf_path,
        notes=args.notes,
    )


if __name__ == "__main__":
    main()
