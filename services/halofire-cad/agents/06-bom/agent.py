"""halofire BOM agent — aggregate SKU quantities + live pricing.

Walks the Design and emits BomRow objects by SKU with:
  - qty (each, feet, or m depending on category)
  - unit_cost_usd — LIVE from the supplies DuckDB (services/
    halofire-cad/pricing/supplies.duckdb). Falls back to a
    seed-price table only when the DB can't be opened.
  - extended_usd = qty * unit_cost * (1 + Halo markup)
  - `price_stale` / `price_missing` flags propagate into
    violations.json so the proposal can warn the estimator.

The hard-coded LIST_PRICE_USD table below is the SAFETY FALLBACK
only. Real bids must come from `pricing.db.price_for`.
"""
from __future__ import annotations

import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from cad.schema import Design, BomRow  # noqa: E402

# Import the live pricing DB if available.
try:
    _PRICING_DIR = Path(__file__).resolve().parents[2] / "pricing"
    sys.path.insert(0, str(_PRICING_DIR.parent))
    from pricing.db import open_db as _open_pricing_db, STALE_DAYS as _PRICING_STALE_DAYS  # type: ignore
    _LIVE_PRICING = True
except Exception:  # noqa: BLE001
    _open_pricing_db = None  # type: ignore
    _PRICING_STALE_DAYS = 60
    _LIVE_PRICING = False

log = logging.getLogger(__name__)


# LEGACY fallback table — only used if the DuckDB can't be opened.
# All real bids go through `pricing.db`.
LIST_PRICE_USD = {
    # Heads
    "SM_Head_Pendant_Standard_K56": 22.50,
    "SM_Head_Pendant_Concealed_K56": 38.00,
    "SM_Head_Upright_Standard_K56": 23.00,
    "SM_Head_Upright_Standard_K80": 31.00,
    "SM_Head_Pendant_Standard_K80": 31.00,
    "SM_Head_Upright_ESFR_K112": 48.00,
    "SM_Head_Sidewall_K56": 27.00,

    # Pipe per linear foot by SCH10 size
    "pipe_sch10_1in_ft": 2.40,
    "pipe_sch10_1_25in_ft": 3.10,
    "pipe_sch10_1_5in_ft": 3.80,
    "pipe_sch10_2in_ft": 5.60,
    "pipe_sch10_2_5in_ft": 8.00,
    "pipe_sch10_3in_ft": 10.50,
    "pipe_sch10_4in_ft": 15.80,

    # Fittings
    "fitting_tee_1in": 4.50,
    "fitting_tee_1_5in": 7.20,
    "fitting_tee_2in": 11.50,
    "fitting_tee_2_5in": 16.00,
    "fitting_tee_3in": 22.00,
    "fitting_tee_4in": 36.00,
    "fitting_elbow_90_1in": 3.80,
    "fitting_elbow_90_1_5in": 6.10,
    "fitting_elbow_90_2in": 9.20,

    # Valves
    "valve_gate_4in": 220.00,
    "valve_check_4in": 310.00,
    "valve_butterfly_4in": 280.00,
    "valve_standpipe_hose_2_5in": 95.00,

    # Hangers
    "hanger_clevis_1in": 4.00,
    "hanger_clevis_2in": 6.50,
    "hanger_seismic": 18.00,

    # Riser + FDC + signage
    "riser_wet_4in": 3500.00,
    "riser_dry_4in": 8500.00,
    "fdc_wall_mount_2_5in": 850.00,
    "sign_sprinkler_id": 25.00,
}

# Halo markup for list-price-to-bid conversion (ballpark)
HALO_MARKUP = 0.35


def _pipe_ft_key(size_in: float) -> str:
    s = str(size_in).replace(".", "_")
    return f"pipe_sch10_{s}in_ft"


def generate_bom(design: Design) -> list[BomRow]:
    """Walk the design, count SKUs, compute extended pricing."""
    qty_by_sku: dict[str, float] = {}
    desc_by_sku: dict[str, str] = {}

    # Heads
    for system in design.systems:
        for h in system.heads:
            qty_by_sku[h.sku] = qty_by_sku.get(h.sku, 0) + 1
            desc_by_sku[h.sku] = h.sku.replace("_", " ")

    # Pipe by size (lin ft)
    pipe_by_size: dict[float, float] = {}
    for system in design.systems:
        for s in system.pipes:
            pipe_by_size[s.size_in] = pipe_by_size.get(s.size_in, 0) + s.length_m
    for size_in, total_m in pipe_by_size.items():
        key = _pipe_ft_key(size_in)
        qty_by_sku[key] = round(total_m * 3.281, 1)  # m → ft
        desc_by_sku[key] = f'{size_in}" SCH10 pipe, linear feet'

    # Fittings (approx: one tee per branch point, one elbow per corner)
    for system in design.systems:
        for f in system.fittings:
            sku = f"fitting_{f.kind}_{str(f.size_in).replace('.', '_')}in"
            qty_by_sku[sku] = qty_by_sku.get(sku, 0) + 1
            desc_by_sku[sku] = f"{f.size_in}\" {f.kind.replace('_', ' ')}"

    # Hangers
    for system in design.systems:
        for h in system.hangers:
            # Pipe size from segment
            seg = next((s for s in system.pipes if s.id == h.pipe_id), None)
            size = seg.size_in if seg else 1.5
            key = "hanger_clevis_1in" if size <= 1.25 else "hanger_clevis_2in"
            qty_by_sku[key] = qty_by_sku.get(key, 0) + 1
            desc_by_sku[key] = f"Clevis hanger {size}\""

    # Risers + FDC (one per system)
    for system in design.systems:
        if system.type == "wet" or system.type == "combo_standpipe":
            qty_by_sku["riser_wet_4in"] = qty_by_sku.get("riser_wet_4in", 0) + 1
            desc_by_sku["riser_wet_4in"] = "Wet riser assembly 4\""
        elif system.type == "dry":
            qty_by_sku["riser_dry_4in"] = qty_by_sku.get("riser_dry_4in", 0) + 1
            desc_by_sku["riser_dry_4in"] = "Dry riser w/ air compressor 4\""
        if system.riser.fdc_position_m:
            qty_by_sku["fdc_wall_mount_2_5in"] = qty_by_sku.get("fdc_wall_mount_2_5in", 0) + 1
            desc_by_sku["fdc_wall_mount_2_5in"] = "FDC wall-mount 2.5\""

    # Build rows — prefer live DB prices, annotate stale/missing
    rows: list[BomRow] = []
    live_prices: dict[str, tuple[float, bool]] = {}
    if _LIVE_PRICING and _open_pricing_db is not None:
        try:
            with _open_pricing_db() as _db:
                for sku in qty_by_sku.keys():
                    row = _db.price_for(sku)
                    if row is None:
                        continue
                    live_prices[sku] = (row.unit_cost_usd, row.stale)
        except Exception as e:  # noqa: BLE001
            log.warning("pricing DB unreachable (%s); using fallback table", e)

    for sku, qty in sorted(qty_by_sku.items()):
        if sku in live_prices:
            unit, stale = live_prices[sku]
            if stale:
                log.warning(
                    "price_stale %s (older than %d days) — bid risk",
                    sku, _PRICING_STALE_DAYS,
                )
        else:
            unit = LIST_PRICE_USD.get(sku, 0.0)
            if unit == 0.0:
                log.error(
                    "price_missing %s — line priced at $0; fix in pricing DB",
                    sku,
                )
        extended = qty * unit * (1 + HALO_MARKUP)
        rows.append(BomRow(
            sku=sku,
            description=desc_by_sku.get(sku, sku),
            qty=qty,
            unit="ea" if not sku.endswith("_ft") else "ft",
            unit_cost_usd=unit,
            extended_usd=round(extended, 2),
        ))
    return rows


def bom_total(rows: list[BomRow]) -> float:
    return round(sum(r.extended_usd for r in rows), 2)


if __name__ == "__main__":
    print("bom — call generate_bom(design)")
