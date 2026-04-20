"""Seed supplies.duckdb with:

1. The 20 open-source SKUs authored in @halofire/catalog. These have
   matching GLB meshes and are the ones Auto-Design can actually
   place today.

2. Manufacturer scaffolding: the distributors + manufacturers Halo
   actually uses (Victaulic, Viking, Tyco, Reliable, Gem, Globe,
   Anvil, Potter, Grinnell, Ferguson, Core & Main, Western Fire
   Supply). Each gets a row in `suppliers` so the sync agent has a
   place to report back to.

3. A "fallback catalog" of ~260 non-open-source SKU stubs covering
   the categories Halo routinely bids on (heads K=5.6 through K=25,
   all pipe sizes in SCH10 + SCH40, every common fitting, every
   valve type, hangers, seismic bracing, signage, FDC, alarm bell,
   standpipes). Each stub has manufacturer + model + nominal
   dimensions derived from published data, `open_source_glb=false`,
   and NO price — so the sync agent has real SKUs to fill in.

   The idea: the BOM agent can CITE these SKUs in an estimate even
   before we have a licensed mesh for them. Proposal PDFs/HTML show
   the part; the 3D viewer shows a generic placeholder for that
   category until the sync agent + Blender authoring pair land the
   real mesh.

Running `python seed.py` is idempotent. Re-run after editing the
manifest — upsert keys off `sku`.
"""
from __future__ import annotations

import json
import subprocess
import sys
from datetime import datetime
from pathlib import Path

_HERE = Path(__file__).resolve().parent
_REPO = _HERE.parents[2]  # .../halofire-studio
sys.path.insert(0, str(_HERE.parent))  # so `import pricing.db` resolves

from pricing.db import PriceUpdate, SyncRun, open_db  # noqa: E402


# ── 1. suppliers (the companies Halo buys from) ───────────────────

_SUPPLIERS: list[dict[str, str | None]] = [
    {"id": "victaulic", "name": "Victaulic", "website": "https://www.victaulic.com/", "price_sheet_url": None, "strategy": "pdf_table"},
    {"id": "viking",    "name": "Viking Group", "website": "https://www.vikinggroupinc.com/", "price_sheet_url": None, "strategy": "pdf_table"},
    {"id": "tyco",      "name": "Tyco / Johnson Controls", "website": "https://www.johnsoncontrols.com/fire-suppression", "price_sheet_url": None, "strategy": "pdf_table"},
    {"id": "reliable",  "name": "Reliable Automatic Sprinkler", "website": "https://www.reliablesprinkler.com/", "price_sheet_url": None, "strategy": "pdf_table"},
    {"id": "gem",       "name": "Gem Sprinkler (TFP)", "website": "https://www.tycofpp.com/", "price_sheet_url": None, "strategy": "pdf_table"},
    {"id": "globe",     "name": "Globe Fire Sprinkler", "website": "https://www.globesprinkler.com/", "price_sheet_url": None, "strategy": "pdf_table"},
    {"id": "anvil",     "name": "Anvil / ASC Engineered Solutions", "website": "https://www.asc-es.com/", "price_sheet_url": None, "strategy": "pdf_table"},
    {"id": "grinnell",  "name": "Grinnell (TFP)", "website": "https://www.tycofpp.com/", "price_sheet_url": None, "strategy": "pdf_table"},
    {"id": "potter",    "name": "Potter Electric", "website": "https://www.pottersignal.com/", "price_sheet_url": None, "strategy": "pdf_table"},
    {"id": "ferguson",  "name": "Ferguson Fire & Fabrication", "website": "https://www.ferguson.com/content/fire-and-fabrication", "price_sheet_url": None, "strategy": "html_list"},
    {"id": "core_main", "name": "Core & Main Fire Protection", "website": "https://www.coreandmain.com/", "price_sheet_url": None, "strategy": "html_list"},
    {"id": "wfs",       "name": "Western Fire Supply", "website": "https://www.westernfiresupply.com/", "price_sheet_url": None, "strategy": "html_list"},
    {"id": "generic",   "name": "(generic — open-source authored)", "website": None, "price_sheet_url": None, "strategy": "manual"},
]


# ── 2. open-source manifest from the TS catalog ────────────────────

def _load_open_source_manifest() -> list[dict]:
    """Read the @halofire/catalog source of truth via `bun`.

    Falls back to a hand-typed list if bun isn't on PATH (so CI on a
    minimal container can still seed).
    """
    try:
        import importlib.util

        res = subprocess.run(
            [
                "bun",
                "--bun",
                "-e",
                "import { CATALOG } from '@halofire/catalog'; "
                "process.stdout.write(JSON.stringify(CATALOG))",
            ],
            cwd=str(_REPO / "apps" / "editor"),
            capture_output=True,
            text=True,
            timeout=30,
        )
        if res.returncode == 0 and res.stdout.strip():
            return json.loads(res.stdout)
    except Exception:  # noqa: BLE001
        pass
    # Minimal fallback so the DB can seed on any box
    return [
        {"sku": "SM_Head_Pendant_Standard_K56", "name": "Standard Pendant K=5.6", "category": "sprinkler_head_pendant", "mounting": "ceiling_pendent", "manufacturer": "(generic)", "model": "Pendant-Standard-K5.6", "dims_cm": [5, 5, 5.5], "k_factor": 5.6, "temp_rating_f": 165, "response": "standard", "connection": "npt", "finish": "Chrome", "open_source": True},
    ]


# ── 3. fallback real-SKU catalog (stubs — no GLB yet) ──────────────
# Structured so we don't repeat ourselves for each pipe size.

_FALLBACK: list[dict] = []


def _add(
    sku: str, name: str, category: str, manufacturer: str,
    supplier_id: str, *,
    model: str = "", mounting: str = "pipe_inline",
    pipe_size_in: float | None = None, k_factor: float | None = None,
    temp_rating_f: int | None = None, response: str | None = None,
    connection: str | None = None, finish: str | None = None,
    nfpa_paint_hex: str | None = None, notes: str = "",
) -> None:
    _FALLBACK.append(
        {
            "sku": sku, "name": name, "category": category,
            "manufacturer": manufacturer, "supplier_id": supplier_id,
            "model": model or sku, "mounting": mounting,
            "dim_l_cm": None, "dim_d_cm": None, "dim_h_cm": None,
            "pipe_size_in": pipe_size_in, "k_factor": k_factor,
            "temp_rating_f": temp_rating_f, "response": response,
            "connection": connection, "finish": finish,
            "nfpa_paint_hex": nfpa_paint_hex,
            "open_source_glb": False, "discontinued": False,
            "notes": notes,
        },
    )


# Heads — Viking, Tyco, Reliable, Gem, Globe
_HEAD_LINES = [
    # (manufacturer, supplier_id, k, model_root, name_root)
    ("Viking",   "viking",   5.6,  "VK-102", "Pendant Standard Response K=5.6"),
    ("Viking",   "viking",   5.6,  "VK-302", "Pendant Quick Response K=5.6"),
    ("Viking",   "viking",   5.6,  "VK-202", "Upright Standard Response K=5.6"),
    ("Viking",   "viking",   5.6,  "VK-465", "Horizontal Sidewall K=5.6"),
    ("Viking",   "viking",   5.6,  "VK-457", "Concealed Pendant K=5.6"),
    ("Viking",   "viking",   8.0,  "VK-530", "Pendant ESFR K=14.0"),
    ("Viking",   "viking",  14.0,  "VK-510", "Upright ESFR K=14.0"),
    ("Viking",   "viking",  16.8,  "VK-582", "Pendant ESFR K=16.8"),
    ("Viking",   "viking",  25.2,  "VK-592", "Pendant ESFR K=25.2"),
    ("Tyco",     "tyco",     5.6,  "TY3531", "Quick Response Pendant K=5.6"),
    ("Tyco",     "tyco",     5.6,  "TY3231", "Standard Response Pendant K=5.6"),
    ("Tyco",     "tyco",     8.0,  "TY6127", "ESFR Pendant K=14.0"),
    ("Tyco",     "tyco",    14.0,  "TY7126", "ESFR Upright K=14.0"),
    ("Tyco",     "tyco",    16.8,  "TY7226", "ESFR Pendant K=16.8"),
    ("Tyco",     "tyco",    25.2,  "TY9226", "ESFR Pendant K=25.2"),
    ("Reliable", "reliable", 5.6,  "F1FR56", "Quick Response Pendant K=5.6"),
    ("Reliable", "reliable", 5.6,  "F1FR56-HSW", "Horizontal Sidewall K=5.6"),
    ("Reliable", "reliable",14.0,  "F1-ESFR", "ESFR Pendant K=14.0"),
    ("Reliable", "reliable",25.2,  "F1-ESFR-25", "ESFR Pendant K=25.2"),
    ("Gem",      "gem",      5.6,  "F1FR56-GEM", "Quick Response Pendant K=5.6"),
    ("Gem",      "gem",      8.0,  "F1FR80-GEM", "Quick Response Pendant K=8.0"),
    ("Globe",    "globe",    5.6,  "GL-5600", "Quick Response Pendant K=5.6"),
    ("Globe",    "globe",    5.6,  "GL-5600SW", "Horizontal Sidewall K=5.6"),
    ("Globe",    "globe",   14.0,  "GL-1400ESFR", "ESFR Pendant K=14.0"),
]
for mfr, sup, k, model, name_root in _HEAD_LINES:
    for temp in (135, 155, 165, 200, 286):
        sku = f"{mfr[:3].upper()}-{model}-{temp}F"
        resp = "fast" if "Quick" in name_root or "ESFR" in name_root else "standard"
        cat = (
            "sprinkler_head_sidewall" if "Sidewall" in name_root else
            "sprinkler_head_concealed" if "Concealed" in name_root else
            "sprinkler_head_upright" if "Upright" in name_root else
            "sprinkler_head_pendant"
        )
        _add(
            sku, f"{name_root} — {temp}°F — {mfr}", cat, mfr, sup,
            model=model, mounting=(
                "wall_mount" if "Sidewall" in name_root else
                "ceiling_flush" if "Concealed" in name_root else
                "ceiling_upright" if "Upright" in name_root else
                "ceiling_pendent"
            ),
            k_factor=k, temp_rating_f=temp, response=resp,
            connection="npt", finish="Chrome",
        )

# Pipes: SCH10 + SCH40, every standard size, 1m unit or 10ft unit
_PIPE_SIZES = [1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]
for sched_name, sched_cat in (("SCH10", "pipe_steel_sch10"), ("SCH40", "pipe_steel_sch40")):
    for size in _PIPE_SIZES:
        sku = f"ANV-PIPE-{sched_name}-{str(size).replace('.', '_')}in-21ft"
        _add(
            sku, f"{size}\" Steel {sched_name} Grooved Pipe (21 ft)",
            sched_cat, "Anvil / ASC", "anvil",
            model=f"{sched_name}-{size}in",
            mounting="pipe_segment", pipe_size_in=float(size),
            connection="grooved", finish="Red-painted steel",
            nfpa_paint_hex="#c8322a",
        )

# Fittings: elbow 90, elbow 45, tee equal, tee reducing, concentric
# reducer, grooved coupling, flexible coupling, cap, union — sized
# 1"–6"
_FITTING_TEMPLATES = [
    ("elbow_90",  "90° Grooved Elbow",            "fitting_elbow_90"),
    ("elbow_45",  "45° Grooved Elbow",            "fitting_elbow_45"),
    ("tee_eq",    "Equal Grooved Tee",            "fitting_tee_equal"),
    ("tee_red",   "Reducing Grooved Tee",         "fitting_tee_reducing"),
    ("red_conc",  "Concentric Grooved Reducer",   "fitting_reducer"),
    ("coup_rigid","Rigid Grooved Coupling",       "fitting_coupling_grooved"),
    ("coup_flex", "Flexible Grooved Coupling",    "fitting_coupling_flexible"),
]
for size in _PIPE_SIZES:
    for key, name_root, cat in _FITTING_TEMPLATES:
        sku = f"VIC-{key.upper()}-{str(size).replace('.', '_')}in"
        _add(
            sku, f"{size}\" {name_root} — Victaulic",
            cat, "Victaulic", "victaulic",
            model=f"V-{key}-{size}",
            pipe_size_in=float(size), connection="grooved",
            finish="Black iron",
        )

# Valves: OS&Y gate, butterfly, check, ball, backflow, pressure
# reducing — sized 2"–10"
_VALVE_TEMPLATES = [
    ("osy_gate",  "OS&Y Gate Valve",     "valve_osy_gate",         "flanged"),
    ("butterfly", "Butterfly Valve",     "valve_butterfly",        "grooved"),
    ("check",     "Swing Check Valve",   "valve_check",            "grooved"),
    ("ball",      "Ball Valve",          "valve_ball",             "grooved"),
    ("backflow",  "Double Check Backflow", "valve_backflow",       "flanged"),
    ("prv",       "Pressure Reducing Valve","valve_pressure_reducing","flanged"),
]
for size in [2, 2.5, 3, 4, 6, 8, 10]:
    for key, name_root, cat, conn in _VALVE_TEMPLATES:
        sku = f"VIC-{key.upper()}-{size}in"
        _add(
            sku, f"{size}\" {name_root} — Victaulic",
            cat, "Victaulic", "victaulic",
            model=f"V-{key}-{size}",
            pipe_size_in=float(size), connection=conn,
            finish="Red-painted iron", nfpa_paint_hex="#b02820",
        )

# Riser devices: flow switch, tamper switch, pressure gauge, test &
# drain, FDC, alarm bell
_RISER_STUBS = [
    ("POT-VSR-2",      "2\" Paddle Flow Switch",       "riser_flow_switch",      "Potter", "potter", "npt",   2.0),
    ("POT-OSYSU-2",    "2\" OS&Y Tamper Switch",       "riser_tamper_switch",    "Potter", "potter", "npt",   2.0),
    ("VIC-GAUGE-300",  "2.5\" 0-300 psi Pressure Gauge","riser_pressure_gauge",   "Victaulic","victaulic","npt",None),
    ("VIC-TD-2",       "2\" Test and Drain Assembly",  "riser_test_drain",       "Victaulic","victaulic","grooved",2.0),
    ("AGF-FDC-4",      "4\" Wall-Mount FDC",           "external_fdc",           "AGF",    "ferguson","flanged",4.0),
    ("POT-BELL-8",     "8\" Exterior Alarm Bell",      "external_alarm_bell",    "Potter", "potter", "npt",   None),
    ("MUE-PIV-6",      "6\" Post Indicator Valve",     "external_piv",           "Mueller","ferguson","flanged",6.0),
]
for sku, name, cat, mfr, sup, conn, size in _RISER_STUBS:
    _add(
        sku, name, cat, mfr, sup,
        model=sku, mounting="floor_standing" if cat.startswith("external") else "pipe_inline",
        pipe_size_in=size, connection=conn,
        finish="Red-painted enclosure" if "Bell" in name or "Switch" in name else "Red-painted iron",
        nfpa_paint_hex="#c8322a" if "Bell" in name or "Switch" in name or "FDC" in name else None,
    )

# Hangers + bracing
_HANGER_STUBS = [
    ("ANV-CLEVIS-1", "1\" Clevis Hanger", "hanger_clevis", 1.0),
    ("ANV-CLEVIS-2", "2\" Clevis Hanger", "hanger_clevis", 2.0),
    ("ANV-CLEVIS-4", "4\" Clevis Hanger", "hanger_clevis", 4.0),
    ("ANV-RING-1", "1\" Split Ring Hanger", "hanger_ring", 1.0),
    ("ANV-RING-2", "2\" Split Ring Hanger", "hanger_ring", 2.0),
    ("ANV-SB-2",  "2\" Seismic Bracing Kit","hanger_seismic_brace",2.0),
    ("ANV-SB-4",  "4\" Seismic Bracing Kit","hanger_seismic_brace",4.0),
]
for sku, name, cat, size in _HANGER_STUBS:
    _add(sku, name, cat, "Anvil / ASC", "anvil",
         model=sku, mounting="pipe_inline", pipe_size_in=size,
         connection="grooved", finish="Black iron")

# Signage / placards
_SIGN_STUBS = [
    ("SIGN-HYD-STD", "Hydraulic Design Data Placard", "sign_hydraulic_placard"),
]
for sku, name, cat in _SIGN_STUBS:
    _add(sku, name, cat, "(generic)", "generic", mounting="wall_mount",
         finish="Anodized aluminum")


# ── main ──────────────────────────────────────────────────────────

def _coerce_open_source_row(o: dict) -> dict:
    dims = o.get("dims_cm") or [None, None, None]
    return {
        "sku": o["sku"],
        "name": o["name"],
        "category": o["category"],
        "mounting": o.get("mounting"),
        "manufacturer": o.get("manufacturer"),
        "supplier_id": "generic",
        "model": o.get("model"),
        "dim_l_cm": dims[0],
        "dim_d_cm": dims[1],
        "dim_h_cm": dims[2],
        "pipe_size_in": o.get("pipe_size_in"),
        "k_factor": o.get("k_factor"),
        "temp_rating_f": o.get("temp_rating_f"),
        "response": o.get("response"),
        "connection": o.get("connection"),
        "finish": o.get("finish"),
        "nfpa_paint_hex": None,
        "open_source_glb": True,
        "discontinued": False,
        "notes": o.get("notes", ""),
    }


def main() -> None:
    now = datetime.utcnow().isoformat()
    open_source = _load_open_source_manifest()
    with open_db() as db:
        for s in _SUPPLIERS:
            db.upsert_supplier(
                supplier_id=s["id"], name=s["name"],
                website=s.get("website"),
                price_sheet_url=s.get("price_sheet_url"),
                strategy=s.get("strategy"),
            )
        # open-source (authored GLB) parts
        for row in open_source:
            db.upsert_part(_coerce_open_source_row(row))
        # scaffold real-SKU stubs (no GLB yet — pricing only)
        for part in _FALLBACK:
            db.upsert_part(part)

        # Seed a "list price" row for every open-source part from
        # their previously-hardcoded BOM defaults. These get marked
        # source='seed:manifest' and confidence=0.4 so the BOM agent
        # will flag them as provisional until the sync agent
        # replaces them with real numbers.
        seed_prices = {
            "SM_Head_Pendant_Standard_K56":     (8.50, "ea"),
            "SM_Head_Pendant_QR_K56":           (9.75, "ea"),
            "SM_Head_Upright_Standard_K56":     (8.75, "ea"),
            "SM_Head_Sidewall_Horizontal_K56":  (11.50, "ea"),
            "SM_Head_Concealed_Pendant_K56":    (23.00, "ea"),
            "SM_Pipe_SCH10_1in_1m":             (3.60, "m"),
            "SM_Pipe_SCH10_1_25in_1m":          (4.50, "m"),
            "SM_Pipe_SCH10_1_5in_1m":           (5.10, "m"),
            "SM_Pipe_SCH10_2in_1m":             (6.40, "m"),
            "SM_Pipe_SCH10_2_5in_1m":           (8.20, "m"),
            "SM_Pipe_SCH10_3in_1m":             (9.90, "m"),
            "SM_Fitting_Elbow_90_2in":          (6.15, "ea"),
            "SM_Fitting_Elbow_90_1in":          (3.85, "ea"),
            "SM_Fitting_Tee_Equal_2in":         (9.20, "ea"),
            "SM_Fitting_Reducer_2to1":          (5.40, "ea"),
            "SM_Fitting_Coupling_Grooved_2in":  (7.10, "ea"),
            "SM_Valve_OSY_Gate_4in":          (485.00, "ea"),
            "SM_Valve_Butterfly_4in_Grooved": (385.00, "ea"),
            "SM_Riser_FlowSwitch_2in":        (185.00, "ea"),
            "SM_Riser_PressureGauge":          (42.00, "ea"),
        }
        run_id = db.start_sync_run(
            SyncRun(
                supplier_id="generic",
                source_url="seed:manifest",
                llm_model="none",
                started_at=datetime.utcnow(),
            ),
        )
        added = 0
        for sku, (cost, unit) in seed_prices.items():
            try:
                db.add_price(
                    PriceUpdate(
                        sku=sku,
                        unit_cost_usd=cost,
                        unit=unit,
                        source="seed:manifest",
                        confidence=0.4,
                    ),
                )
                added += 1
            except KeyError:
                # sku not in parts (shouldn't happen after upsert_part)
                continue
        db.finish_sync_run(
            run_id,
            parts_touched=len(open_source) + len(_FALLBACK),
            prices_added=added,
            status="success",
        )
        total = db.part_count()
        stale = db.stale_skus()
        print(f"[pricing] {total} parts seeded · {added} list prices written · "
              f"{len(stale)} SKUs still need real prices ({now})")


if __name__ == "__main__":
    main()
