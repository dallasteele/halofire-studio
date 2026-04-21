"""Gomez-Warehouse-AZ truth seed (R11.2 synthetic fixture).

Convenience wrapper around `seed_generic_project.seed_project` that
hard-codes the synthetic truth numbers for `gomez-warehouse-az` —
the SECOND project used to prove the pipeline scaffolding generalizes
beyond the 1881-Cooperative real-customer case.

These numbers are SYNTHETIC-BUT-REALISTIC for an OH2-hazard warehouse
(parking + light storage) of ~85,000 sqft with a mezzanine:

  * 3 levels  (mezzanine + main + storage)
  * ~85,000 sqft total
  * OH2 hazard (ordinary_group_2)
  * ~480 heads (heavy-storage density)
  * ~$295,000 bid (smaller than 1881)
  * 3 systems (wet main + wet mezzanine + combo standpipe)

Real customer validation still waits on a real Halo Fire second bid
PDF. Once that lands, either re-point this wrapper at the real
numbers or add a new per-project seed next to it.
"""
from __future__ import annotations

from pathlib import Path

from truth.seed_generic_project import seed_project


PROJECT_ID = "gomez-warehouse-az"
PROJECT_NAME = "Gomez Warehouse (Phoenix, AZ) — SYNTHETIC"
LEVELS = 3
HAZARD = "ordinary_group_2"
TOTAL_SQFT = 85_000.0
EXPECTED_HEADS = 480
EXPECTED_BID_USD = 295_000.0
EXPECTED_SYSTEMS = 3


def seed(out_path: Path | None = None) -> None:
    """Seed (or re-seed) gomez-warehouse-az truth rows."""
    seed_project(
        project_id=PROJECT_ID,
        levels=LEVELS,
        hazard=HAZARD,
        total_sqft=TOTAL_SQFT,
        expected_heads=EXPECTED_HEADS,
        expected_bid_usd=EXPECTED_BID_USD,
        expected_systems=EXPECTED_SYSTEMS,
        out_path=out_path,
        project_name=PROJECT_NAME,
        notes=(
            "SYNTHETIC second-project fixture for R11.2. Mezzanine + "
            "main + storage, OH2 hazard. Replace with real numbers "
            "when a real Halo Fire second bid PDF is available."
        ),
    )


if __name__ == "__main__":
    seed()
    print(f"seeded (synthetic): {PROJECT_ID}")
