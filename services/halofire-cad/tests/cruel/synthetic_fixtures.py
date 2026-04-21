"""Synthetic pipeline fixtures for the R11.2 second-project cruel tests.

The 1881-Cooperative cruel scoreboard runs the full pipeline against
a real customer PDF — intake → classifier → placer → router →
hydraulic → proposal — and then compares the produced deliverables
to seeded truth. The second project (`gomez-warehouse-az`) does
NOT have a real intake PDF yet; we still want to prove the
scaffolding generalizes end-to-end. So we:

  1. Seed synthetic-but-realistic truth rows (via
     `truth.gomez_warehouse_seed`).
  2. Skip the intake stage and generate the downstream deliverables
     directly — `design.json`, `proposal.json`, `building_raw.json`
     — with numbers that fall INSIDE the cruel tolerances against
     the seeded truth.

This proves:
  * The seed scaffolding works for an arbitrary project id.
  * The cruel scoreboard reads per-project deliverables from the
    canonical path (`services/halopenclaw-gateway/data/<id>/
    deliverables/`).
  * The assertion shape is correct and passes when fed coherent data.

When a real second bid PDF arrives, swap `run_synthetic_pipeline`
for a call into the real pipeline (same entry point the 1881 tests
drive) and the assertions stay unchanged.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any


_HERE = Path(__file__).resolve().parent
_CAD = _HERE.parents[1]               # services/halofire-cad
_REPO = _CAD.parents[1]               # repo root


def _deliverables_dir(project_id: str) -> Path:
    return (
        _REPO / "services" / "halopenclaw-gateway" / "data"
        / project_id / "deliverables"
    )


def _synthetic_building_raw(
    project_id: str,
    level_count: int,
    total_sqft: float,
) -> dict[str, Any]:
    """One polygon per level, evenly divided area, stacked elevation.

    The cruel `test_level_count_exact` just counts `levels[]`. No
    rooms / walls required for this fixture.
    """
    total_sqm = total_sqft * 0.092903
    per_level_sqm = total_sqm / level_count
    # Square polygon with side = sqrt(per_level_sqm)
    side = per_level_sqm ** 0.5
    levels = []
    for i in range(level_count):
        levels.append({
            "id": f"l{i + 1}",
            "name": f"Level {i + 1}",
            "elevation_m": i * 4.0,
            "height_m": 4.0,
            "use": "warehouse" if i > 0 else "parking",
            "polygon_m": [
                [0.0, 0.0],
                [side, 0.0],
                [side, side],
                [0.0, side],
            ],
            "rooms": [],
            "walls": [],
            "openings": [],
            "obstructions": [],
            "ceiling": {"height_m": 4.0, "kind": "flat"},
            "stair_shafts": [],
            "elevator_shafts": [],
            "mech_rooms": [],
            "metadata": {"synthetic": True},
        })
    return {
        "project_id": project_id,
        "levels": levels,
        "construction_type": "type_ii_b",
        "total_sqft": total_sqft,
        "metadata": {
            "synthetic": True,
            "note": (
                "R11.2 synthetic second-project fixture; no real PDF "
                "intake was run to produce this."
            ),
        },
    }


def _synthetic_design(
    project_id: str,
    building_raw: dict[str, Any],
    head_count: int,
    system_count: int,
) -> dict[str, Any]:
    """Build a minimal design.json with distributed heads across systems.

    The cruel tests read:
      * `design["systems"][*]["heads"]` length → total head_count
      * `len(design["systems"])`                → system_count

    Distribute heads roughly evenly across systems. System types:
    wet_main, wet_mezzanine, combo_standpipe — matching the truth
    notes for gomez-warehouse-az. The combo_standpipe carries no
    heads (it's a logical riser zone), so put all heads on the two
    wet systems.
    """
    system_specs = [
        {"id": "sys_wet_main", "type": "wet", "heads_share": 0.55},
        {"id": "sys_wet_mezz", "type": "wet", "heads_share": 0.45},
        {"id": "sys_combo_standpipe", "type": "combo_standpipe", "heads_share": 0.0},
    ]
    # Safety: if caller asks for a different system_count, truncate
    # or pad evenly — but for this fixture it's always 3.
    system_specs = system_specs[:system_count]
    total_share = sum(s["heads_share"] for s in system_specs) or 1.0

    systems = []
    heads_assigned = 0
    for i, spec in enumerate(system_specs):
        share = spec["heads_share"] / total_share
        if i == len(system_specs) - 1 and share > 0:
            n_heads = head_count - heads_assigned
        else:
            n_heads = int(round(head_count * share))
        heads_assigned += n_heads
        heads = [
            {
                "id": f"{spec['id']}_h{j}",
                "position_m": [float(j % 20), float(j // 20), 3.5],
                "k_factor": 5.6,
                "orientation": "pendent",
            }
            for j in range(n_heads)
        ]
        systems.append({
            "id": spec["id"],
            "type": spec["type"],
            "supplies": [],
            "riser": None,
            "branches": [],
            "heads": heads,
            "pipes": [],
            "fittings": [],
            "hangers": [],
            "hydraulic": None,
        })

    return {
        "project": {"id": project_id, "name": project_id},
        "building": {"levels": building_raw["levels"]},
        "systems": systems,
        "sources": {"synthetic": True},
        "confidence": 0.0,
        "issues": [],
        "calculation": {},
        "deliverables": {},
        "metadata": {
            "synthetic": True,
            "note": "R11.2 synthetic second-project design fixture.",
        },
    }


def _synthetic_proposal(
    project_id: str,
    design: dict[str, Any],
    total_bid_usd: float,
) -> dict[str, Any]:
    materials = round(total_bid_usd * 0.40, 2)
    labor = round(total_bid_usd * 0.42, 2)
    permit = round(total_bid_usd * 0.015, 2)
    taxes = round(total_bid_usd - materials - labor - permit, 2)
    subtotal = round(materials + labor + permit, 2)
    return {
        "version": "synthetic-r11.2",
        "generated_at": "2026-04-21T00:00:00Z",
        "project": {"id": project_id},
        "building_summary": {},
        "levels": design["building"]["levels"],
        "systems": [{"id": s["id"], "type": s["type"]} for s in design["systems"]],
        "scope_of_work": [],
        "acknowledgements": [],
        "inclusions": [],
        "exclusions": [],
        "bom": [],
        "labor": {},
        "violations": [],
        "pricing": {
            "materials_usd": materials,
            "labor_usd": labor,
            "permit_allowance_usd": permit,
            "taxes_usd": taxes,
            "subtotal_usd": subtotal,
            "total_usd": round(total_bid_usd, 2),
        },
        "deliverables": {},
    }


def run_synthetic_pipeline(
    project_id: str,
    level_count: int,
    total_sqft: float,
    head_count: int,
    system_count: int,
    total_bid_usd: float,
) -> Path:
    """Generate design.json / proposal.json / building_raw.json for
    `project_id`, skipping the real pipeline stages that need a PDF.

    Stages run:        (none of the pipeline — pure fixture synthesis)
    Stages skipped:    intake, classifier, placer, router, hydraulic,
                       proposal (all replaced by deterministic JSON).

    Writes to the canonical deliverables dir and returns it.
    """
    out_dir = _deliverables_dir(project_id)
    out_dir.mkdir(parents=True, exist_ok=True)

    building_raw = _synthetic_building_raw(project_id, level_count, total_sqft)
    design = _synthetic_design(project_id, building_raw, head_count, system_count)
    proposal = _synthetic_proposal(project_id, design, total_bid_usd)

    (out_dir / "building_raw.json").write_text(
        json.dumps(building_raw, indent=2), encoding="utf-8",
    )
    (out_dir / "design.json").write_text(
        json.dumps(design, indent=2), encoding="utf-8",
    )
    (out_dir / "proposal.json").write_text(
        json.dumps(proposal, indent=2), encoding="utf-8",
    )
    return out_dir


def ensure_gomez_synthetic_seeded_and_built() -> Path:
    """Session-scope helper: seed truth + write synthetic deliverables."""
    from truth.gomez_warehouse_seed import (
        PROJECT_ID, LEVELS, TOTAL_SQFT, EXPECTED_HEADS,
        EXPECTED_SYSTEMS, EXPECTED_BID_USD, seed,
    )

    seed()  # idempotent
    return run_synthetic_pipeline(
        project_id=PROJECT_ID,
        level_count=LEVELS,
        total_sqft=TOTAL_SQFT,
        head_count=EXPECTED_HEADS,
        system_count=EXPECTED_SYSTEMS,
        total_bid_usd=EXPECTED_BID_USD,
    )
