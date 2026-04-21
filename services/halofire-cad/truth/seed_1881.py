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
    # CORRECTED 2026-04-20: real building has 6 levels (2 below-grade
    # parking + 4 above-grade residential), each ~28 443 sf
    # (~2 642 sqm). Elevations from the project's Level Plans:
    #   -12 ft  Ground Floor Parking      (28 443 sf)
    #     0 ft  Second Floor Parking      (28 443 sf)
    #    12 ft  Level 1 — Amenity + Resi  (28 443 sf)
    #    24 ft  Level 2 — Residential     (28 443 sf)
    #    34 ft  Level 3 — Residential     (28 443 sf)
    #    44 ft  Level 4 — Residential     (28 443 sf)
    # Total area 170 658 sf. Previous seed said 12 levels which is
    # what made every cruel test scoreboard "level_count=13 vs 12 ≈
    # PASS" — but truth was actually 6, so we were 117 % over.
    LEVELS = [
        ("Ground Floor Parking",       -3.66,  2_642.0),  # -12 ft
        ("Second Floor Parking",        0.00,  2_642.0),  #   0 ft
        ("Level 1 — Amenity + Resi",    3.66,  2_642.0),  #  12 ft
        ("Level 2 — Residential",       7.32,  2_642.0),  #  24 ft (≈ 10 ft floor-to-floor)
        ("Level 3 — Residential",      10.36,  2_642.0),  #  34 ft
        ("Level 4 — Residential",      13.41,  2_642.0),  #  44 ft
    ]
    rec = TruthRecord(
        project_id="1881-cooperative",
        project_name="The Cooperative 1881 — Phase I",
        architect_pdf_path=(
            "E:/ClaudeBot/HaloFireBidDocs/1-Bid Documents/"
            "GC - Bid Plans/1881 - Architecturals.pdf"
        ),
        as_built_pdf_path=None,
        permit_reviewed=True,
        total_bid_usd=538_792.35,
        head_count=1303,
        pipe_count=None,
        pipe_total_ft=None,
        system_count=7,
        level_count=len(LEVELS),
        hydraulic_gpm=None,
        hydraulic_psi=None,
        signed_off_at="2025-12-01",
        notes=(
            "Reference bid for HaloFire CAD Studio self-training. "
            "Real building: 6 levels (2 below-grade parking + 4 "
            "above-grade residential), each ~28 443 sf. Cruel-test "
            "level_count was incorrectly seeded as 12 until "
            "2026-04-20."
        ),
    )
    with open_db() as db:
        db.upsert(rec)
        # Idempotent: drop any prior per-level rows for this project
        # so re-running the seed doesn't accumulate stale levels.
        # (Caught 2026-04-20: prior seed inserted 12 placeholders;
        # the new seed only added 6 more, total 18, breaking the
        # truth-aligned intake count.)
        db._con.execute(
            "DELETE FROM bids_level_truth WHERE project_id = ?",
            [rec.project_id],
        )
        for i, (name, elev_m, area) in enumerate(LEVELS):
            db.upsert_level(LevelTruth(
                project_id=rec.project_id,
                level_index=i,
                level_name=name,
                elevation_m=elev_m,
                outline_polygon_wkt=None,
                area_sqm=area,
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
