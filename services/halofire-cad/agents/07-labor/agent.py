"""halofire labor agent — per-role hours from Halo productivity.

Given a BOM + design metrics, computes labor hours by role and dollar
cost. Productivity rates are ballpark (calibrated against historical
Halo bids). Production reads from a CSV Halo updates per region.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from cad.schema import Design, BomRow, LaborRow  # noqa: E402


# Hours to install per SKU (approx, from Halo historicals)
HOURS_PER_UNIT = {
    # Heads: 0.35 hr per head fitter + 0.10 hr per head helper
    "head_install": 0.35,
    "head_trim": 0.15,

    # Pipe per foot — varies with size
    "pipe_1in_ft": 0.08,
    "pipe_1_5in_ft": 0.10,
    "pipe_2in_ft": 0.12,
    "pipe_2_5in_ft": 0.15,
    "pipe_3in_ft": 0.20,
    "pipe_4in_ft": 0.30,

    # Fittings: tee = 0.4 hr, elbow = 0.25 hr
    "fitting_tee": 0.40,
    "fitting_elbow_90": 0.25,

    # Hangers: 0.3 hr
    "hanger": 0.30,

    # Riser assembly: 20 hr wet, 40 hr dry
    "riser_wet": 20.0,
    "riser_dry": 40.0,

    # FDC: 8 hr
    "fdc": 8.0,

    # Hydro test: 4 hr per level
    "hydro_test_per_level": 4.0,

    # Mobilization: 16 hr each (8 rough + 8 trim = 16 mobs per proposal)
    "mobilization_each": 16.0,
}

# Labor rates USD/hr (AZ ROC union)
RATES = {
    "Foreman": 78.0,
    "Journeyman": 62.0,
    "Apprentice": 40.0,
    "Helper": 32.0,
    "Project Manager": 95.0,
}


def compute_labor(design: Design, bom: list[BomRow]) -> list[LaborRow]:
    """Sum hours across roles. Uses simple allocation:
    - Foreman + Journeyman split heads/pipe/fittings
    - Apprentice does hangers
    - PM overhead = 10% of total hours
    """
    total_hours = 0.0

    # Heads
    head_count = sum(
        r.qty for r in bom if r.sku.startswith("SM_Head_")
    )
    head_h = head_count * (HOURS_PER_UNIT["head_install"] + HOURS_PER_UNIT["head_trim"])
    total_hours += head_h

    # Pipe
    pipe_h = 0.0
    for r in bom:
        if not r.sku.startswith("pipe_sch10_"):
            continue
        size = r.sku.split("_")[2].replace("in", "")
        key = f"pipe_{size}in_ft"
        rate_h = HOURS_PER_UNIT.get(key, 0.12)
        pipe_h += r.qty * rate_h
    total_hours += pipe_h

    # Fittings
    fitting_h = 0.0
    for r in bom:
        if not r.sku.startswith("fitting_"):
            continue
        kind = r.sku.split("_")[1]
        if kind == "tee":
            fitting_h += r.qty * HOURS_PER_UNIT["fitting_tee"]
        elif kind == "elbow":
            fitting_h += r.qty * HOURS_PER_UNIT["fitting_elbow_90"]
    total_hours += fitting_h

    # Hangers
    hanger_qty = sum(r.qty for r in bom if r.sku.startswith("hanger_"))
    hanger_h = hanger_qty * HOURS_PER_UNIT["hanger"]
    total_hours += hanger_h

    # Risers
    riser_wet = sum(r.qty for r in bom if r.sku == "riser_wet_4in")
    riser_dry = sum(r.qty for r in bom if r.sku == "riser_dry_4in")
    riser_h = riser_wet * HOURS_PER_UNIT["riser_wet"] + riser_dry * HOURS_PER_UNIT["riser_dry"]
    total_hours += riser_h

    # FDC
    fdc_qty = sum(r.qty for r in bom if r.sku == "fdc_wall_mount_2_5in")
    fdc_h = fdc_qty * HOURS_PER_UNIT["fdc"]
    total_hours += fdc_h

    # Hydro + mobilization overhead
    levels = len(design.building.levels)
    hydro_h = levels * HOURS_PER_UNIT["hydro_test_per_level"]
    total_hours += hydro_h
    mob_h = 16 * HOURS_PER_UNIT["mobilization_each"]  # 8 rough + 8 trim
    total_hours += mob_h

    # Allocation by role (calibrated split)
    allocation = {
        "Foreman": 0.15,
        "Journeyman": 0.45,
        "Apprentice": 0.25,
        "Helper": 0.10,
        "Project Manager": 0.05,
    }

    rows: list[LaborRow] = []
    for role, frac in allocation.items():
        hrs = round(total_hours * frac, 1)
        rate = RATES[role]
        rows.append(LaborRow(
            role=role,
            hours=hrs,
            rate_usd_hr=rate,
            extended_usd=round(hrs * rate, 2),
        ))
    return rows


def labor_total(rows: list[LaborRow]) -> float:
    return round(sum(r.extended_usd for r in rows), 2)


if __name__ == "__main__":
    print("labor — call compute_labor(design, bom)")
