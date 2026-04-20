"""Seed the truth DB with the 1881 Cooperative reference bid.

Numbers pulled from Halo's submitted-and-approved bid package
(Brain decision `halo-fire-v2-rebuild-shipped-end-to-end-to-vps`
cites real 1881 Cooperative total: $538,792.35 and 1303 heads).

This is a MINIMAL seed. Full per-level outlines + BOM comparison
come later as Phase 1b (needs DWG parsing of the as-built sheet
set). For now we ingest the numbers every cruel test references.

Run:
    python services/halofire-cad/truth/seed_1881.py
"""
from __future__ import annotations

import sys
from pathlib import Path

_HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(_HERE.parent))

from truth.db import LevelTruth, TruthRecord, open_db  # noqa: E402


def main() -> None:
    rec = TruthRecord(
        project_id="1881-cooperative",
        project_name="The Cooperative 1881 — Phase I",
        architect_pdf_path=(
            "E:/ClaudeBot/HaloFireBidDocs/1-Bid Documents/"
            "GC - Bid Plans/1881 - Architecturals.pdf"
        ),
        as_built_pdf_path=None,  # Phase 1b: trace Halo's as-built
        permit_reviewed=True,
        # Halo's final submitted numbers (Brain: halo-fire-v2 decision,
        # 2026-04-17). These are the numbers cruel tests compare to.
        total_bid_usd=538_792.35,
        head_count=1303,
        pipe_count=None,            # needs as-built parse
        pipe_total_ft=None,         # needs as-built parse
        system_count=7,
        level_count=12,
        hydraulic_gpm=None,         # needs as-built parse
        hydraulic_psi=None,         # needs as-built parse
        signed_off_at="2025-12-01", # placeholder — correct later
        notes=(
            "Reference bid for HaloFire CAD Studio self-training. "
            "Loop-1..loop-5 pipeline output is compared against "
            "these numbers via tests/golden/test_cruel_vs_truth.py. "
            "pipe_*/hydraulic_* fields pending as-built parse in "
            "Phase 1b of SELF_TRAIN_PLAN.md."
        ),
    )
    with open_db() as db:
        db.upsert(rec)
        # No per-level truth yet — Phase 4a traces the real outline.
        # We register 12 levels as placeholders so loop counts match.
        for i in range(12):
            db.upsert_level(LevelTruth(
                project_id=rec.project_id,
                level_index=i,
                level_name=(
                    f"Garage P{i + 1}" if i < 2
                    else f"Level {i - 1}"
                ),
                elevation_m=None,
                outline_polygon_wkt=None,
                area_sqm=None,
                room_count=None,
                head_count=None,
            ))
        print(
            f"seeded {rec.project_id}: heads={rec.head_count}, "
            f"systems={rec.system_count}, "
            f"bid=${rec.total_bid_usd:,.2f}",
        )


if __name__ == "__main__":
    main()
