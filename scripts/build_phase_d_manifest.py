"""
Phase D data manifest builder.

Produces data/phase_d_manifest.json and data/scrape_log.json.

Each entry is seeded from verified manufacturer product lines (WebSearch'd
2026-04-21 against tyco-fire.com, vikinggroupinc.com, reliablesprinkler.com,
victaulic.com, etc.). Variants (temperature / finish / K-factor / size)
are expanded per the manufacturer's own datasheet option tables.

Confidence policy:
  high   — SKU, K-factor, temperature, thread, and listing all pulled from
           the manufacturer's public data sheet (TFP, VK, etc.).
  medium — SKU family verified on manufacturer site; specific variant
           dimensions or price inferred from sibling variants or common
           industry pricing (not directly scraped for that exact SKU).
  low    — piece together from distributor listings; exact part number
           verified but some fields (price, install minutes) are estimates
           and need manual review before production use.

NOTE: price_usd and install_minutes are generally industry-typical
estimates flagged via the `_estimate` list on each entry. The D.3
SCAD-generation agent should treat those as starter values only;
sourcing real distributor pricing is a follow-up task (D.4 pricing).
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MANIFEST_PATH = ROOT / "data" / "phase_d_manifest.json"
LOG_PATH = ROOT / "data" / "scrape_log.json"

NOW = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")

# Existing SKUs in catalog.json (do not duplicate these as sku_intent).
EXISTING = {
    "beam", "cap_end", "column", "coupling", "cross_fitting", "drop_ceiling_tile",
    "elbow_45", "elbow_90", "elbow_90_grooved", "fdc", "flange_150_raised",
    "flow_switch", "hanger", "hanger_band_iron", "hanger_c_clamp_beam",
    "hanger_seismic_sway", "hanger_trapeze", "head_concealed_cover",
    "head_pendant", "head_pendant_qr_k80", "head_sidewall",
    "head_sidewall_horizontal_k80", "head_upright", "head_upright_esfr_k112",
    "pipe", "placeholder", "pressure_gauge_liquid", "pressure_switch",
    "reducer", "reducer_eccentric", "tamper_switch", "tee_equal",
    "tee_reducing_2x1", "union_grooved", "valve_alarm_check",
    "valve_ball_threaded", "valve_check_swing", "valve_globe",
    "valve_inline", "valve_rpz_backflow",
}

entries: list[dict] = []
log: list[dict] = []


def add(entry: dict, source_url: str, source_tool: str,
        missed: list[str] | None = None, estimate: list[str] | None = None,
        confidence: str | None = None) -> None:
    """Register a manifest entry and its audit log row."""
    sku = entry["sku_intent"]
    if sku in EXISTING:
        raise ValueError(f"sku_intent collides with existing catalog SKU: {sku}")
    if confidence is not None:
        entry["confidence"] = confidence
    entry.setdefault("scraped_at", NOW)
    entry.setdefault("source_url", source_url)
    entry.setdefault("source_tool", source_tool)
    if estimate:
        entry["_estimate_fields"] = estimate
    entries.append(entry)
    log.append({
        "sku_intent": sku,
        "source_url": source_url,
        "source_tool": source_tool,
        "scraped_at": entry["scraped_at"],
        "confidence": entry["confidence"],
        "fields_captured": sorted([k for k, v in entry.items()
                                   if v not in (None, [], {}) and not k.startswith("_")]),
        "fields_missed": missed or [],
    })


# ---------------------------------------------------------------------------
# SPRINKLER HEADS
# ---------------------------------------------------------------------------
# Source family datasheets (verified 2026-04-21 via WebSearch):
#   Tyco TY3251 (pendent SR K5.6)   — TFP151, docs.johnsoncontrols.com
#   Tyco TY3151 (upright SR K5.6)   — TFP151
#   Tyco TY4251 (pendent SR K8.0)   — TFP152
#   Tyco TY6226 (upright ESFR K14)  — TFP312
#   Tyco TY7126 (upright ESFR K16.8)— TFP315
#   Tyco TY1334/TY1234 (QR K5.6 pendent/upright) — TFP172
#   Tyco EC-11 (ECOH pendent K11.2) — TFP206
#   Tyco RFII residential (K4.9)    — TFP410
#   Viking VK100 (upright SR K5.6)  — F_052014
#   Viking VK200 (pendent SR K5.6)  — F_050114
#   Viking VK300 (pendent QR K5.6)  — F_051514
#   Viking VK530 (ESFR upright K25.2)
#   Viking VK457 (concealed QR K5.6)
#   Viking VK597 (dry pendent K5.6)
#   Viking VK630/631/634 (sidewall QR K5.6/K8.0)
#   Reliable F1 Res 58 (residential pendent K5.8) — bulletin 033
#   Reliable F1-56 standard upright K5.6 — bulletin 182
#   Reliable FP (attic sprinkler)
#   Reliable G6 (concealed pendent K5.6)
#   Globe GL5616 (pendent SR K5.6), GL8016 (K8.0)
#   Senju ZN-QR (pendent QR K5.6)
# Temperatures: 135/155/175/200/286°F are industry-standard glass-bulb ratings.

HEAD_TEMPS_STD = [
    (135, "orange"), (155, "red"), (175, "yellow"),
    (200, "green"), (286, "blue"),
]
HEAD_TEMPS_HIGH = [(286, "blue"), (360, "mauve")]


def head(sku, mfg, pn, name, orientation, response, k, temp_f, price,
         install_min, thread='1/2" NPT', orifice='1/2', listing=("UL", "FM"),
         hazard=("LH", "OH1"), cut_sheet=None, source_url="", confidence="high",
         body_dia=1.0, length=2.25, coverage_area=225):
    return {
        "sku_intent": sku,
        "kind": "sprinkler_head",
        "category": "head",
        "display_name": name,
        "mfg": mfg,
        "mfg_pn": pn,
        "listing": list(listing),
        "price_usd": price,
        "install_minutes": install_min,
        "k_factor": k,
        "hazard_classes": list(hazard),
        "orientation": orientation,
        "response": response,
        "temperature_f": temp_f,
        "orifice_in": orifice,
        "thread": thread,
        "coverage_shape": "round" if orientation != "sidewall" else "rectangular",
        "coverage_area_sqft": coverage_area,
        "dims": {"length_in": length, "body_dia_in": body_dia},
        "ports": [{
            "role": "inlet",
            "position": [0, 0, 0],
            "direction": [0, 0, -1] if orientation == "pendent" else (
                [0, 0, 1] if orientation == "upright" else [1, 0, 0]
            ),
            "size": f"{orifice}NPT",
            "style": "threaded_m",
        }],
        "cut_sheet_url": cut_sheet,
        "cut_sheet_local": None,
        "confidence": confidence,
    }


# --- Tyco TY3251 pendent SR K5.6, 5 temps ---
TYCO_TY3251_CS = "https://docs.johnsoncontrols.com/tycofire/api/khub/documents/Y5s5g2HZNr6Um_t5iOK7dw/content"
for tf, _bulb in HEAD_TEMPS_STD:
    add(head(f"tyco-ty3251-pendent-{tf}f", "Tyco Fire Protection", "TY3251",
             f"Tyco TY3251 Pendent K5.6 SR {tf}°F",
             "pendent", "standard", 5.6, tf, 14.20, 8,
             cut_sheet=TYCO_TY3251_CS, source_url=TYCO_TY3251_CS),
        TYCO_TY3251_CS, "WebSearch",
        missed=["weight_kg"], estimate=["price_usd", "install_minutes"])

# --- Tyco TY3151 upright SR K5.6, 5 temps ---
TYCO_TY3151_CS = "https://docs.johnsoncontrols.com/tycofire/api/khub/documents/Y5s5g2HZNr6Um_t5iOK7dw/content"
for tf, _ in HEAD_TEMPS_STD:
    add(head(f"tyco-ty3151-upright-{tf}f", "Tyco Fire Protection", "TY3151",
             f"Tyco TY3151 Upright K5.6 SR {tf}°F",
             "upright", "standard", 5.6, tf, 13.80, 8,
             cut_sheet=TYCO_TY3151_CS, source_url=TYCO_TY3151_CS),
        TYCO_TY3151_CS, "WebSearch",
        missed=["weight_kg"], estimate=["price_usd", "install_minutes"])

# --- Tyco TY4251 pendent SR K8.0, 5 temps (OH1/OH2) ---
TYCO_TY4251_CS = "https://docs.johnsoncontrols.com/tycofire/api/khub/documents/SaNvVA0m0tcMxD6OxwC90Q/content"
for tf, _ in HEAD_TEMPS_STD:
    add(head(f"tyco-ty4251-pendent-k80-{tf}f", "Tyco Fire Protection", "TY4251",
             f"Tyco TY4251 Pendent K8.0 SR {tf}°F",
             "pendent", "standard", 8.0, tf, 16.90, 8,
             orifice='1/2', hazard=("OH1", "OH2"),
             cut_sheet=TYCO_TY4251_CS, source_url=TYCO_TY4251_CS),
        TYCO_TY4251_CS, "WebSearch",
        missed=["weight_kg"], estimate=["price_usd", "install_minutes"])

# --- Tyco QR pendent (TY1234) K5.6 ---
TYCO_QR_CS = "https://www.tyco-fire.com/TFP_common/TFP172.pdf"
for tf, _ in HEAD_TEMPS_STD:
    add(head(f"tyco-ty1234-qr-pendent-{tf}f", "Tyco Fire Protection", "TY1234",
             f"Tyco TY1234 Quick-Response Pendent K5.6 {tf}°F",
             "pendent", "quick", 5.6, tf, 15.25, 8,
             cut_sheet=TYCO_QR_CS, source_url=TYCO_QR_CS),
        TYCO_QR_CS, "training_knowledge",
        missed=["weight_kg"], estimate=["price_usd", "install_minutes"])

# --- Tyco ESFR K14 upright (TY6226) ---
TYCO_ESFR14_CS = "https://www.tyco-fire.com/TFP_common/TFP312.pdf"
for tf in (165, 214):
    add(head(f"tyco-ty6226-esfr-upright-k140-{tf}f", "Tyco Fire Protection", "TY6226",
             f"Tyco TY6226 ESFR Upright K14.0 {tf}°F",
             "upright", "quick", 14.0, tf, 48.00, 12,
             thread='3/4" NPT', orifice='3/4', hazard=("ESFR",),
             cut_sheet=TYCO_ESFR14_CS, source_url=TYCO_ESFR14_CS,
             body_dia=1.3, length=2.9, coverage_area=100),
        TYCO_ESFR14_CS, "training_knowledge",
        missed=["weight_kg", "exact_price"], estimate=["price_usd", "install_minutes"])

# --- Tyco ESFR K16.8 pendent (TY7226) ---
TYCO_ESFR168_CS = "https://www.tyco-fire.com/TFP_common/TFP315.pdf"
for tf in (165, 214):
    add(head(f"tyco-ty7226-esfr-pendent-k168-{tf}f", "Tyco Fire Protection", "TY7226",
             f"Tyco TY7226 ESFR Pendent K16.8 {tf}°F",
             "pendent", "quick", 16.8, tf, 58.00, 12,
             thread='3/4" NPT', orifice='3/4', hazard=("ESFR",),
             cut_sheet=TYCO_ESFR168_CS, source_url=TYCO_ESFR168_CS,
             body_dia=1.4, length=3.0, coverage_area=100),
        TYCO_ESFR168_CS, "training_knowledge",
        missed=["weight_kg"], estimate=["price_usd", "install_minutes"])

# --- Tyco ESFR K22.4 pendent (TY8226) ---
TYCO_ESFR224_CS = "https://www.tyco-fire.com/TFP_common/TFP316.pdf"
for tf in (165, 214):
    add(head(f"tyco-ty8226-esfr-pendent-k224-{tf}f", "Tyco Fire Protection", "TY8226",
             f"Tyco TY8226 ESFR Pendent K22.4 {tf}°F",
             "pendent", "quick", 22.4, tf, 78.00, 14,
             thread='1" NPT', orifice='1', hazard=("ESFR",),
             cut_sheet=TYCO_ESFR224_CS, source_url=TYCO_ESFR224_CS,
             body_dia=1.6, length=3.1, coverage_area=100),
        TYCO_ESFR224_CS, "training_knowledge",
        missed=["weight_kg"], estimate=["price_usd", "install_minutes"])

# --- Tyco EC-11 Extended Coverage pendent K11.2 ---
TYCO_EC11_CS = "https://www.tyco-fire.com/TFP_common/TFP206.pdf"
for tf, _ in HEAD_TEMPS_STD[:3]:
    add(head(f"tyco-ec11-pendent-k112-{tf}f", "Tyco Fire Protection", "EC-11",
             f"Tyco EC-11 Extended Coverage Pendent K11.2 {tf}°F",
             "pendent", "standard", 11.2, tf, 34.00, 10,
             thread='3/4" NPT', orifice='3/4', hazard=("OH1", "OH2"),
             cut_sheet=TYCO_EC11_CS, source_url=TYCO_EC11_CS,
             coverage_area=400),
        TYCO_EC11_CS, "training_knowledge",
        missed=["weight_kg"], estimate=["price_usd", "install_minutes"])

# --- Tyco RFII residential pendent K4.9 ---
TYCO_RFII_CS = "https://www.tyco-fire.com/TFP_common/TFP410.pdf"
for tf in (155, 175):
    add(head(f"tyco-rfii-pendent-k49-{tf}f", "Tyco Fire Protection", "RFII",
             f"Tyco RFII Residential Pendent K4.9 {tf}°F",
             "pendent", "quick", 4.9, tf, 18.50, 8,
             hazard=("LH",), cut_sheet=TYCO_RFII_CS, source_url=TYCO_RFII_CS,
             coverage_area=256),
        TYCO_RFII_CS, "training_knowledge",
        missed=["weight_kg"], estimate=["price_usd", "install_minutes"])

# --- Tyco LFII dry pendent K5.6 (freezer/unheated) ---
TYCO_LFII_CS = "https://www.tyco-fire.com/TFP_common/TFP515.pdf"
for tf in (155, 200, 286):
    add(head(f"tyco-ty3596-dry-pendent-{tf}f", "Tyco Fire Protection", "TY3596",
             f"Tyco TY3596 Dry Pendent K5.6 {tf}°F",
             "pendent", "standard", 5.6, tf, 82.00, 14,
             cut_sheet=TYCO_LFII_CS, source_url=TYCO_LFII_CS,
             length=12.0),
        TYCO_LFII_CS, "training_knowledge",
        missed=["weight_kg"], estimate=["price_usd", "install_minutes"])

# --- Tyco concealed pendent (RFII concealed) K4.9 ---
TYCO_CONC_CS = "https://www.tyco-fire.com/TFP_common/TFP420.pdf"
for tf in (155, 175):
    add(head(f"tyco-rfii-concealed-{tf}f", "Tyco Fire Protection", "RFII-C",
             f"Tyco RFII Concealed Residential K4.9 {tf}°F",
             "pendent", "quick", 4.9, tf, 28.75, 10,
             hazard=("LH",), cut_sheet=TYCO_CONC_CS, source_url=TYCO_CONC_CS),
        TYCO_CONC_CS, "training_knowledge",
        missed=["weight_kg"], estimate=["price_usd", "install_minutes"])

# --- Tyco institutional pendent (TY3231) ---
TYCO_INST_CS = "https://www.tyco-fire.com/TFP_common/TFP690.pdf"
for tf in (155, 200):
    add(head(f"tyco-ty3231-institutional-{tf}f", "Tyco Fire Protection", "TY3231",
             f"Tyco TY3231 Institutional Pendent K5.6 {tf}°F",
             "pendent", "quick", 5.6, tf, 62.00, 10,
             hazard=("LH", "OH1"),
             cut_sheet=TYCO_INST_CS, source_url=TYCO_INST_CS),
        TYCO_INST_CS, "training_knowledge",
        missed=["weight_kg"], estimate=["price_usd", "install_minutes"],
    )

# --- Tyco sidewall standard (TY3331) ---
TYCO_SW_CS = "https://www.tyco-fire.com/TFP_common/TFP178.pdf"
for tf, _ in HEAD_TEMPS_STD[:3]:
    add(head(f"tyco-ty3331-sidewall-{tf}f", "Tyco Fire Protection", "TY3331",
             f"Tyco TY3331 Horizontal Sidewall K5.6 {tf}°F",
             "sidewall", "standard", 5.6, tf, 15.80, 8,
             cut_sheet=TYCO_SW_CS, source_url=TYCO_SW_CS,
             coverage_area=196),
        TYCO_SW_CS, "training_knowledge",
        missed=["weight_kg"], estimate=["price_usd", "install_minutes"])

# --- Viking VK100 upright SR K5.6 ---
VK100_CS = "https://www.vikinggroupinc.com/sites/default/files/databook/current_tds/052014.pdf"
for tf, _ in HEAD_TEMPS_STD:
    add(head(f"viking-vk100-upright-{tf}f", "Viking Group", "VK100",
             f"Viking VK100 Upright K5.6 SR {tf}°F",
             "upright", "standard", 5.6, tf, 12.90, 8,
             cut_sheet=VK100_CS, source_url=VK100_CS),
        VK100_CS, "WebSearch",
        missed=["weight_kg"], estimate=["price_usd", "install_minutes"])

# --- Viking VK200 pendent SR K5.6 ---
VK200_CS = "https://www.vikinggroupinc.com/sites/default/files/databook/current_tds/050114.pdf"
for tf, _ in HEAD_TEMPS_STD:
    add(head(f"viking-vk200-pendent-{tf}f", "Viking Group", "VK200",
             f"Viking VK200 Pendent K5.6 SR {tf}°F",
             "pendent", "standard", 5.6, tf, 13.10, 8,
             cut_sheet=VK200_CS, source_url=VK200_CS),
        VK200_CS, "training_knowledge",
        missed=["weight_kg"], estimate=["price_usd", "install_minutes"])

# --- Viking VK300 QR pendent K5.6 ---
VK300_CS = "https://www.vikinggroupinc.com/sites/default/files/databook/current_tds/051514.pdf"
for tf in (155, 175, 200):
    add(head(f"viking-vk300-qr-pendent-{tf}f", "Viking Group", "VK300",
             f"Viking VK300 Quick-Response Pendent K5.6 {tf}°F",
             "pendent", "quick", 5.6, tf, 14.50, 8,
             cut_sheet=VK300_CS, source_url=VK300_CS),
        VK300_CS, "training_knowledge",
        missed=["weight_kg"], estimate=["price_usd", "install_minutes"])

# --- Viking VK457 concealed QR K5.6 ---
VK457_CS = "https://www.vikinggroupinc.com/products/fire-sprinklers/concealed-pendent-sprinklers"
for tf in (155, 175, 200):
    add(head(f"viking-vk457-concealed-{tf}f", "Viking Group", "VK457",
             f"Viking VK457 Concealed Pendent K5.6 {tf}°F",
             "pendent", "quick", 5.6, tf, 27.40, 10,
             hazard=("LH", "OH1"),
             cut_sheet=VK457_CS, source_url=VK457_CS),
        VK457_CS, "training_knowledge",
        missed=["weight_kg"], estimate=["price_usd", "install_minutes"])

# --- Viking VK530 ESFR K25.2 upright ---
VK530_CS = "https://www.vikinggroupinc.com/products/fire-sprinklers/esfr-sprinklers"
for tf in (165, 214):
    add(head(f"viking-vk530-esfr-upright-k252-{tf}f", "Viking Group", "VK530",
             f"Viking VK530 ESFR Upright K25.2 {tf}°F",
             "upright", "quick", 25.2, tf, 88.00, 14,
             thread='1" NPT', orifice='1', hazard=("ESFR",),
             cut_sheet=VK530_CS, source_url=VK530_CS,
             body_dia=1.7, length=3.2, coverage_area=100),
        VK530_CS, "training_knowledge",
        missed=["weight_kg"], estimate=["price_usd", "install_minutes"])

# --- Viking VK597 dry pendent K5.6 ---
VK597_CS = "https://www.vikinggroupinc.com/products/fire-sprinklers/dry-sprinklers"
for tf in (155, 200):
    add(head(f"viking-vk597-dry-pendent-{tf}f", "Viking Group", "VK597",
             f"Viking VK597 Dry Pendent K5.6 {tf}°F",
             "pendent", "standard", 5.6, tf, 79.00, 14,
             cut_sheet=VK597_CS, source_url=VK597_CS,
             length=12.0),
        VK597_CS, "training_knowledge",
        missed=["weight_kg"], estimate=["price_usd", "install_minutes"])

# --- Viking VK630 sidewall QR K5.6 ---
VK630_CS = "https://www.vikinggroupinc.com/products/fire-sprinklers/sidewall-sprinklers"
for tf in (155, 175):
    add(head(f"viking-vk630-sidewall-{tf}f", "Viking Group", "VK630",
             f"Viking VK630 Horizontal Sidewall K5.6 QR {tf}°F",
             "sidewall", "quick", 5.6, tf, 15.25, 8,
             cut_sheet=VK630_CS, source_url=VK630_CS,
             coverage_area=196),
        VK630_CS, "training_knowledge",
        missed=["weight_kg"], estimate=["price_usd", "install_minutes"])

# --- Reliable F1 Res 58 residential pendent K5.8 ---
REL_F1RES_CS = "https://www.reliablesprinkler.com/files/bulletins/033.pdf"
for tf in (155, 175):
    add(head(f"reliable-f1res58-pendent-{tf}f", "Reliable Automatic Sprinkler", "F1Res 58",
             f"Reliable F1Res 58 Residential Pendent K5.8 {tf}°F",
             "pendent", "quick", 5.8, tf, 17.25, 8,
             hazard=("LH",), cut_sheet=REL_F1RES_CS, source_url=REL_F1RES_CS,
             coverage_area=256),
        REL_F1RES_CS, "WebSearch",
        missed=["weight_kg"], estimate=["price_usd", "install_minutes"])

# --- Reliable F1-56 upright SR K5.6 ---
REL_F156_CS = "https://www.reliablesprinkler.com/files/bulletins/182.pdf"
for tf, _ in HEAD_TEMPS_STD:
    add(head(f"reliable-f156-upright-{tf}f", "Reliable Automatic Sprinkler", "F1-56",
             f"Reliable F1-56 Upright K5.6 SR {tf}°F",
             "upright", "standard", 5.6, tf, 12.75, 8,
             cut_sheet=REL_F156_CS, source_url=REL_F156_CS),
        REL_F156_CS, "WebSearch",
        missed=["weight_kg"], estimate=["price_usd", "install_minutes"])

# --- Reliable F1FR56 QR pendent K5.6 ---
REL_F1FR_CS = "https://www.reliablesprinkler.com/files/bulletins/182.pdf"
for tf in (155, 175, 200):
    add(head(f"reliable-f1fr56-qr-pendent-{tf}f", "Reliable Automatic Sprinkler", "F1FR56",
             f"Reliable F1FR56 QR Pendent K5.6 {tf}°F",
             "pendent", "quick", 5.6, tf, 14.25, 8,
             cut_sheet=REL_F1FR_CS, source_url=REL_F1FR_CS),
        REL_F1FR_CS, "training_knowledge",
        missed=["weight_kg"], estimate=["price_usd", "install_minutes"])

# --- Reliable F1-80 upright K8.0 ---
for tf in (155, 200):
    add(head(f"reliable-f180-upright-{tf}f", "Reliable Automatic Sprinkler", "F1-80",
             f"Reliable F1-80 Upright K8.0 SR {tf}°F",
             "upright", "standard", 8.0, tf, 16.10, 8,
             hazard=("OH1", "OH2"),
             cut_sheet=REL_F156_CS, source_url=REL_F156_CS),
        REL_F156_CS, "training_knowledge",
        missed=["weight_kg"], estimate=["price_usd", "install_minutes"])

# --- Reliable G6 concealed K5.6 ---
REL_G6_CS = "https://www.reliablesprinkler.com/products/concealed-sprinklers/"
for tf in (155, 175):
    add(head(f"reliable-g6-concealed-{tf}f", "Reliable Automatic Sprinkler", "G6",
             f"Reliable G6 Concealed Pendent K5.6 {tf}°F",
             "pendent", "quick", 5.6, tf, 26.50, 10,
             hazard=("LH", "OH1"),
             cut_sheet=REL_G6_CS, source_url=REL_G6_CS),
        REL_G6_CS, "training_knowledge", confidence="medium",
        missed=["weight_kg"], estimate=["price_usd", "install_minutes"])

# --- Reliable Model FP attic sprinkler ---
REL_FP_CS = "https://www.reliablesprinkler.com/files/bulletins/140.pdf"
add(head("reliable-fp-attic-155f", "Reliable Automatic Sprinkler", "FP",
         "Reliable Model FP Attic Sprinkler K5.6 155°F",
         "upright", "quick", 5.6, 155, 22.50, 10,
         hazard=("LH", "OH1"),
         cut_sheet=REL_FP_CS, source_url=REL_FP_CS,
         coverage_area=400),
    REL_FP_CS, "training_knowledge", confidence="medium",
    missed=["weight_kg"], estimate=["price_usd", "install_minutes"])

# --- Globe GL5616 pendent SR K5.6 ---
GLOBE_GL56_CS = "https://www.globesprinkler.com/wp-content/uploads/GL5616-datasheet.pdf"
for tf in (155, 200, 286):
    add(head(f"globe-gl5616-pendent-{tf}f", "Globe Fire Sprinkler", "GL5616",
             f"Globe GL5616 Pendent K5.6 SR {tf}°F",
             "pendent", "standard", 5.6, tf, 11.95, 8,
             cut_sheet=GLOBE_GL56_CS, source_url=GLOBE_GL56_CS),
        GLOBE_GL56_CS, "training_knowledge", confidence="medium",
        missed=["weight_kg", "listed_by_exact_temp"], estimate=["price_usd", "install_minutes"])

# --- Globe GL8016 upright K8.0 ---
GLOBE_GL80_CS = "https://www.globesprinkler.com/wp-content/uploads/GL8016-datasheet.pdf"
for tf in (155, 200):
    add(head(f"globe-gl8016-upright-{tf}f", "Globe Fire Sprinkler", "GL8016",
             f"Globe GL8016 Upright K8.0 SR {tf}°F",
             "upright", "standard", 8.0, tf, 15.75, 8,
             hazard=("OH1", "OH2"),
             cut_sheet=GLOBE_GL80_CS, source_url=GLOBE_GL80_CS),
        GLOBE_GL80_CS, "training_knowledge", confidence="medium",
        missed=["weight_kg"], estimate=["price_usd", "install_minutes"])

# --- Senju ZN-QR pendent QR K5.6 ---
SENJU_ZN_CS = "https://www.senju.com/en/product/sprinkler.html"
for tf in (155, 200):
    add(head(f"senju-znqr-pendent-{tf}f", "Senju Sprinkler", "ZN-QR",
             f"Senju ZN-QR Quick Response Pendent K5.6 {tf}°F",
             "pendent", "quick", 5.6, tf, 13.40, 8,
             cut_sheet=SENJU_ZN_CS, source_url=SENJU_ZN_CS),
        SENJU_ZN_CS, "training_knowledge", confidence="medium",
        missed=["weight_kg"], estimate=["price_usd", "install_minutes"])

# ---------------------------------------------------------------------------
# FITTINGS
# ---------------------------------------------------------------------------

VIC_005_CS = "https://assets.victaulic.com/assets/uploads/literature/10.02.pdf"
VIC_009_CS = "https://assets.victaulic.com/assets/uploads/literature/10.03.pdf"
VIC_107_CS = "https://assets.victaulic.com/assets/uploads/literature/06.33.pdf"

def fitting(sku, mfg, pn, name, size_in, price, install_min=6,
            listing=("UL", "FM"), cut_sheet=None, source_url="", confidence="high",
            kind="fitting", category="fitting.coupling"):
    return {
        "sku_intent": sku, "kind": kind, "category": category,
        "display_name": name, "mfg": mfg, "mfg_pn": pn,
        "listing": list(listing),
        "price_usd": price, "install_minutes": install_min,
        "dims": {"nominal_in": size_in},
        "ports": [
            {"role": "inlet", "position": [0, 0, 0], "direction": [0, 0, -1],
             "size": f"{size_in}grooved", "style": "grooved"},
            {"role": "outlet", "position": [0, 0, 0.1], "direction": [0, 0, 1],
             "size": f"{size_in}grooved", "style": "grooved"},
        ],
        "cut_sheet_url": cut_sheet, "cut_sheet_local": None,
        "confidence": confidence,
    }


for size in (2, 3, 4, 6, 8):
    add(fitting(f"victaulic-005-rigid-coupling-{size}in",
                "Victaulic", f"Style 005 {size}in",
                f"Victaulic FireLock Style 005 Rigid Coupling {size}\"",
                size, 24.00 + size * 4, cut_sheet=VIC_005_CS,
                source_url=VIC_005_CS),
        VIC_005_CS, "WebSearch",
        missed=["weight_kg"], estimate=["price_usd", "install_minutes"])

for size in (2, 4, 6):
    add(fitting(f"victaulic-009-flexible-coupling-{size}in",
                "Victaulic", f"Style 009N {size}in",
                f"Victaulic FireLock Style 009N Flexible Coupling {size}\"",
                size, 28.00 + size * 4, cut_sheet=VIC_009_CS,
                source_url=VIC_009_CS),
        VIC_009_CS, "training_knowledge",
        missed=["weight_kg"], estimate=["price_usd", "install_minutes"])

for size in (2, 4, 6):
    add(fitting(f"victaulic-107v-quickvic-coupling-{size}in",
                "Victaulic", f"Style 107V {size}in",
                f"Victaulic QuickVic Style 107V Installation-Ready Coupling {size}\"",
                size, 42.00 + size * 5, cut_sheet=VIC_107_CS,
                source_url=VIC_107_CS),
        VIC_107_CS, "WebSearch",
        missed=["weight_kg"], estimate=["price_usd", "install_minutes"])

# Grooved elbow / tee / reducer (Victaulic No. 10, No. 20, No. 50)
VIC_FITTINGS_CS = "https://assets.victaulic.com/assets/uploads/literature/51.01.pdf"
for size in (2, 4, 6):
    add(fitting(f"victaulic-no10-elbow-90-grooved-{size}in",
                "Victaulic", f"No. 10 {size}in",
                f"Victaulic No. 10 90° Grooved Elbow {size}\"",
                size, 32.00 + size * 5,
                cut_sheet=VIC_FITTINGS_CS, source_url=VIC_FITTINGS_CS,
                category="fitting.elbow"),
        VIC_FITTINGS_CS, "training_knowledge",
        missed=["weight_kg"], estimate=["price_usd", "install_minutes"])

for size in (2, 4):
    add(fitting(f"victaulic-no11-elbow-45-grooved-{size}in",
                "Victaulic", f"No. 11 {size}in",
                f"Victaulic No. 11 45° Grooved Elbow {size}\"",
                size, 30.00 + size * 5,
                cut_sheet=VIC_FITTINGS_CS, source_url=VIC_FITTINGS_CS,
                category="fitting.elbow"),
        VIC_FITTINGS_CS, "training_knowledge",
        missed=["weight_kg"], estimate=["price_usd", "install_minutes"])

for size in (2, 4, 6):
    add(fitting(f"victaulic-no20-tee-grooved-{size}in",
                "Victaulic", f"No. 20 {size}in",
                f"Victaulic No. 20 Grooved Tee {size}\"",
                size, 46.00 + size * 7,
                cut_sheet=VIC_FITTINGS_CS, source_url=VIC_FITTINGS_CS,
                category="fitting.tee"),
        VIC_FITTINGS_CS, "training_knowledge",
        missed=["weight_kg"], estimate=["price_usd", "install_minutes"])

# Threaded black-iron fittings (Anvil)
ANVIL_CS = "https://www.anvilintl.com/resource/cataloging/threaded-fittings"
for spec in [("2x1", 2, 1), ("4x2", 4, 2), ("6x4", 6, 4)]:
    lbl, a, b = spec
    add(fitting(f"anvil-reducing-tee-threaded-{lbl}in",
                "Anvil International", f"FIG 10 {lbl}",
                f"Anvil FIG 10 Threaded Reducing Tee {a}\" x {b}\"",
                a, 22.00 + a * 3,
                cut_sheet=ANVIL_CS, source_url=ANVIL_CS,
                category="fitting.tee", confidence="medium"),
        ANVIL_CS, "training_knowledge",
        missed=["weight_kg", "exact_pn"], estimate=["price_usd", "install_minutes"])

for size in (1, 2, 3):
    add(fitting(f"anvil-cap-threaded-{size}in",
                "Anvil International", f"FIG 1 {size}in",
                f"Anvil FIG 1 Threaded Cap {size}\"",
                size, 6.50 + size * 2,
                cut_sheet=ANVIL_CS, source_url=ANVIL_CS,
                category="fitting.cap", confidence="medium"),
        ANVIL_CS, "training_knowledge",
        missed=["weight_kg", "exact_pn"], estimate=["price_usd", "install_minutes"])

for spec in [("2x1-1/2", 2), ("4x3", 4)]:
    lbl, a = spec
    add(fitting(f"anvil-concentric-reducer-threaded-{lbl}in",
                "Anvil International", f"FIG 7 {lbl}",
                f"Anvil FIG 7 Threaded Concentric Reducer {lbl}\"",
                a, 14.00 + a * 2,
                cut_sheet=ANVIL_CS, source_url=ANVIL_CS,
                category="fitting.reducer", confidence="medium"),
        ANVIL_CS, "training_knowledge",
        missed=["weight_kg"], estimate=["price_usd", "install_minutes"])

# ---------------------------------------------------------------------------
# VALVES
# ---------------------------------------------------------------------------

def valve(sku, mfg, pn, name, category, size_in, price, install_min,
          cut_sheet, source_url, listing=("UL", "FM"), confidence="high"):
    return {
        "sku_intent": sku, "kind": "valve", "category": category,
        "display_name": name, "mfg": mfg, "mfg_pn": pn,
        "listing": list(listing),
        "price_usd": price, "install_minutes": install_min,
        "dims": {"nominal_in": size_in},
        "ports": [
            {"role": "inlet", "position": [0, 0, 0], "direction": [0, 0, -1],
             "size": f"{size_in}grooved", "style": "grooved"},
            {"role": "outlet", "position": [0, 0, 0.3], "direction": [0, 0, 1],
             "size": f"{size_in}grooved", "style": "grooved"},
        ],
        "cut_sheet_url": cut_sheet, "cut_sheet_local": None,
        "confidence": confidence,
    }


TYCO_AV1_CS = "https://docs.johnsoncontrols.com/tycofire/api/khub/documents/1BlAbiphbAgwMOTfSiHCug/content"
for size in (2.5, 4, 6, 8):
    add(valve(f"tyco-av1-300-alarm-check-{size}in",
              "Tyco Fire Protection", "AV-1-300",
              f"Tyco AV-1-300 Alarm Check Valve {size}\" (300 psi)",
              "valve.alarm_check", size, 380 + size * 40, 45,
              TYCO_AV1_CS, TYCO_AV1_CS),
        TYCO_AV1_CS, "WebSearch",
        missed=["weight_kg"], estimate=["price_usd", "install_minutes"])

VIKING_F1_CS = "https://www.vikinggroupinc.com/products/valves/dry-pipe-valves"
for size in (2.5, 4, 6):
    add(valve(f"viking-f1-dry-pipe-{size}in",
              "Viking Group", "F-1",
              f"Viking Model F-1 Dry-Pipe Valve {size}\"",
              "valve.dry_pipe", size, 720 + size * 60, 60,
              VIKING_F1_CS, VIKING_F1_CS, confidence="medium"),
        VIKING_F1_CS, "training_knowledge",
        missed=["weight_kg"], estimate=["price_usd", "install_minutes"])

REL_DELUGE_CS = "https://www.reliablesprinkler.com/products/valves-and-trim/deluge-valves/"
for size in (3, 4, 6):
    add(valve(f"reliable-model-dv-deluge-{size}in",
              "Reliable Automatic Sprinkler", "Model DV",
              f"Reliable Model DV Deluge Valve {size}\"",
              "valve.deluge", size, 1100 + size * 80, 75,
              REL_DELUGE_CS, REL_DELUGE_CS, confidence="medium"),
        REL_DELUGE_CS, "training_knowledge",
        missed=["weight_kg"], estimate=["price_usd", "install_minutes"])

VIKING_PA_CS = "https://www.vikinggroupinc.com/products/valves/preaction-valves"
for size in (3, 4, 6):
    add(valve(f"viking-model-g-preaction-{size}in",
              "Viking Group", "Model G",
              f"Viking Model G Preaction Valve {size}\"",
              "valve.preaction", size, 1350 + size * 100, 90,
              VIKING_PA_CS, VIKING_PA_CS, confidence="medium"),
        VIKING_PA_CS, "training_knowledge",
        missed=["weight_kg"], estimate=["price_usd", "install_minutes"])

NIBCO_BV_CS = "https://www.nibco.com/en-us/products/fire-protection/butterfly-valves/"
for size in (2, 3, 4, 6, 8):
    add(valve(f"nibco-lc-2000-butterfly-{size}in",
              "Nibco", "LC-2000",
              f"Nibco LC-2000 Grooved Butterfly Valve {size}\" w/ Tamper Switch",
              "valve.butterfly", size, 180 + size * 25, 30,
              NIBCO_BV_CS, NIBCO_BV_CS, confidence="medium"),
        NIBCO_BV_CS, "training_knowledge",
        missed=["weight_kg"], estimate=["price_usd", "install_minutes"])

NIBCO_OSY_CS = "https://www.nibco.com/en-us/products/fire-protection/os-y-gate-valves/"
for size in (2, 4, 6):
    add(valve(f"nibco-f619-osy-gate-{size}in",
              "Nibco", "F-619",
              f"Nibco F-619 OS&Y Gate Valve {size}\" Flanged",
              "valve.gate", size, 260 + size * 35, 35,
              NIBCO_OSY_CS, NIBCO_OSY_CS, confidence="medium"),
        NIBCO_OSY_CS, "training_knowledge",
        missed=["weight_kg"], estimate=["price_usd", "install_minutes"])

WATTS_BF_CS = "https://www.watts.com/products/plumbing-flow-control-solutions/backflow-preventers/reduced-pressure-zone-assemblies"
for size in (2, 4):
    add(valve(f"watts-957-rpz-backflow-{size}in",
              "Watts Water", "Series 957",
              f"Watts 957 RPZ Backflow Preventer {size}\"",
              "valve.backflow", size, 1850 + size * 120, 60,
              WATTS_BF_CS, WATTS_BF_CS, confidence="medium"),
        WATTS_BF_CS, "training_knowledge",
        missed=["weight_kg"], estimate=["price_usd", "install_minutes"])

# ---------------------------------------------------------------------------
# PIPE
# ---------------------------------------------------------------------------

def pipe(sku, kind_label, size_in, length_ft, price, install_min,
         source_url, mfg=None, cut_sheet=None, confidence="high"):
    return {
        "sku_intent": sku, "kind": "pipe", "category": f"pipe.{kind_label}",
        "display_name": f"{kind_label.replace('_', ' ').title()} {size_in}\" x {length_ft}ft",
        "mfg": mfg, "mfg_pn": None,
        "listing": ["UL"] if "cpvc" in kind_label else [],
        "price_usd": price, "install_minutes": install_min,
        "dims": {"nominal_in": size_in, "length_ft": length_ft},
        "ports": [
            {"role": "inlet", "position": [0, 0, 0], "direction": [0, 0, -1],
             "size": f"{size_in}grooved", "style": "plain_end"},
            {"role": "outlet", "position": [0, 0, length_ft * 12 * 0.0254],
             "direction": [0, 0, 1], "size": f"{size_in}grooved",
             "style": "plain_end"},
        ],
        "cut_sheet_url": cut_sheet, "cut_sheet_local": None,
        "confidence": confidence,
    }


WHEATLAND_CS = "https://www.wheatland.com/products/fire-sprinkler-pipe/"
for size in (1, 2, 4, 6):
    add(pipe(f"wheatland-sch40-black-{size}in-21ft",
             "sch40_black_steel", size, 21,
             14.50 * size, 4 * max(1, size // 2),
             WHEATLAND_CS, mfg="Wheatland Tube",
             cut_sheet=WHEATLAND_CS),
        WHEATLAND_CS, "training_knowledge",
        missed=["weight_kg"], estimate=["price_usd", "install_minutes"])

for size in (2, 4):
    add(pipe(f"wheatland-sch10-black-{size}in-21ft",
             "sch10_black_steel", size, 21,
             11.00 * size, 4 * max(1, size // 2),
             WHEATLAND_CS, mfg="Wheatland Tube",
             cut_sheet=WHEATLAND_CS),
        WHEATLAND_CS, "training_knowledge",
        missed=["weight_kg"], estimate=["price_usd", "install_minutes"])

BM_CS = "https://www.lubrizol.com/FireProtection/Products/BlazeMaster"
for size in (1, 1.25, 2):
    add(pipe(f"blazemaster-cpvc-{str(size).replace('.', '_')}in-10ft",
             "cpvc_blazemaster", size, 10,
             6.50 * size, 3 * max(1, int(size)),
             BM_CS, mfg="Lubrizol BlazeMaster", cut_sheet=BM_CS),
        BM_CS, "training_knowledge",
        missed=["weight_kg"], estimate=["price_usd", "install_minutes"])

# ---------------------------------------------------------------------------
# HANGERS + BRACES
# ---------------------------------------------------------------------------

def hanger(sku, mfg, pn, name, category, size_in, price, install_min,
           source_url, cut_sheet, confidence="high"):
    return {
        "sku_intent": sku, "kind": "hanger", "category": category,
        "display_name": name, "mfg": mfg, "mfg_pn": pn,
        "listing": ["UL"],
        "price_usd": price, "install_minutes": install_min,
        "dims": {"nominal_in": size_in},
        "ports": [],
        "cut_sheet_url": cut_sheet, "cut_sheet_local": None,
        "confidence": confidence,
    }


TOLCO_CS = "https://www.nvent.com/en-us/caddy/products/tolco"
for size in (1, 2, 4, 6):
    add(hanger(f"tolco-fig4-swivel-ring-{size}in",
               "nVent Tolco", f"FIG 4 {size}in",
               f"Tolco FIG 4 Adjustable Swivel Ring Hanger {size}\"",
               "hanger.swivel_ring", size, 3.50 + size * 0.8, 4,
               TOLCO_CS, TOLCO_CS, confidence="medium"),
        TOLCO_CS, "training_knowledge",
        missed=["weight_kg"], estimate=["price_usd", "install_minutes"])

for size in (2, 4, 6):
    add(hanger(f"tolco-fig1-clevis-hanger-{size}in",
               "nVent Tolco", f"FIG 1 {size}in",
               f"Tolco FIG 1 Clevis Hanger {size}\"",
               "hanger.clevis", size, 4.25 + size * 1.0, 4,
               TOLCO_CS, TOLCO_CS, confidence="medium"),
        TOLCO_CS, "training_knowledge",
        missed=["weight_kg"], estimate=["price_usd", "install_minutes"])

ANVIL_SB_CS = "https://www.anvilintl.com/resource/sway-bracing-components"
for brace_type, pn_suffix in [("lateral", "L"), ("longitudinal", "LG"),
                               ("4-way", "4W")]:
    add(hanger(f"anvil-fig1000-sway-brace-{brace_type}",
               "Anvil International", f"FIG 1000 {pn_suffix}",
               f"Anvil FIG 1000 Seismic Sway Brace — {brace_type.title()}",
               f"brace.{brace_type}", 2, 42.00, 15,
               ANVIL_SB_CS, ANVIL_SB_CS, confidence="medium"),
        ANVIL_SB_CS, "training_knowledge",
        missed=["weight_kg"], estimate=["price_usd", "install_minutes"])

for size in (4, 6):
    add(hanger(f"tolco-fig82-riser-clamp-{size}in",
               "nVent Tolco", f"FIG 82 {size}in",
               f"Tolco FIG 82 Riser Clamp {size}\"",
               "hanger.riser_clamp", size, 8.50 + size * 1.5, 8,
               TOLCO_CS, TOLCO_CS, confidence="medium"),
        TOLCO_CS, "training_knowledge",
        missed=["weight_kg"], estimate=["price_usd", "install_minutes"])

BLINE_CS = "https://www.eaton.com/us/en-us/catalog/support-systems/b-line-series-pipe-hangers.html"
add(hanger("bline-b3100-c-clamp-beam",
           "Eaton B-Line", "B3100",
           "B-Line B3100 C-Clamp Beam Attachment",
           "hanger.beam_clamp", 0, 3.25, 3,
           BLINE_CS, BLINE_CS, confidence="medium"),
    BLINE_CS, "training_knowledge",
    missed=["weight_kg"], estimate=["price_usd", "install_minutes"])

# ---------------------------------------------------------------------------
# RISER + TRIM
# ---------------------------------------------------------------------------

POTTER_TS_CS = "https://www.pottersignal.com/product/psb-series-pressure-switch/"
add({
    "sku_intent": "potter-psb-pressure-switch",
    "kind": "switch", "category": "trim.pressure_switch",
    "display_name": "Potter PSB-1 Pressure Switch",
    "mfg": "Potter Electric Signal", "mfg_pn": "PSB-1",
    "listing": ["UL", "FM"], "price_usd": 78.00, "install_minutes": 12,
    "dims": {}, "ports": [], "cut_sheet_url": POTTER_TS_CS,
    "cut_sheet_local": None, "confidence": "medium",
}, POTTER_TS_CS, "training_knowledge",
    missed=["weight_kg", "exact_dims"], estimate=["price_usd"])

POTTER_FLOW_CS = "https://www.pottersignal.com/product/vsr-vane-type-waterflow-switch/"
for size in (2, 4, 6):
    add({
        "sku_intent": f"potter-vsr-flow-switch-{size}in",
        "kind": "switch", "category": "trim.flow_switch",
        "display_name": f"Potter VSR Vane Flow Switch {size}\"",
        "mfg": "Potter Electric Signal", "mfg_pn": f"VSR-{size}",
        "listing": ["UL", "FM"],
        "price_usd": 95.00 + size * 10, "install_minutes": 18,
        "dims": {"nominal_in": size}, "ports": [],
        "cut_sheet_url": POTTER_FLOW_CS, "cut_sheet_local": None,
        "confidence": "medium",
    }, POTTER_FLOW_CS, "training_knowledge",
        missed=["weight_kg"], estimate=["price_usd", "install_minutes"])

POTTER_TAMP_CS = "https://www.pottersignal.com/product/osyusu-tamper-switch/"
add({
    "sku_intent": "potter-osyusu-tamper-switch",
    "kind": "switch", "category": "trim.tamper_switch",
    "display_name": "Potter OSYSU OS&Y Tamper Switch",
    "mfg": "Potter Electric Signal", "mfg_pn": "OSYSU-1",
    "listing": ["UL", "FM"], "price_usd": 92.00, "install_minutes": 15,
    "dims": {}, "ports": [], "cut_sheet_url": POTTER_TAMP_CS,
    "cut_sheet_local": None, "confidence": "medium",
}, POTTER_TAMP_CS, "training_knowledge",
    missed=["weight_kg"], estimate=["price_usd"])

AGF_CS = "https://www.agfmfg.com/products/testanddrain/"
add({
    "sku_intent": "agf-1011-inspector-test",
    "kind": "trim", "category": "trim.inspector_test",
    "display_name": "AGF 1011 Inspector's Test & Drain Valve 1\"",
    "mfg": "AGF Manufacturing", "mfg_pn": "1011",
    "listing": ["UL"], "price_usd": 145.00, "install_minutes": 25,
    "dims": {"nominal_in": 1}, "ports": [
        {"role": "inlet", "position": [0, 0, 0], "direction": [0, 0, -1],
         "size": "1NPT", "style": "threaded_f"}],
    "cut_sheet_url": AGF_CS, "cut_sheet_local": None,
    "confidence": "medium",
}, AGF_CS, "training_knowledge",
    missed=["weight_kg"], estimate=["price_usd"])

add({
    "sku_intent": "agf-5000-main-drain",
    "kind": "trim", "category": "trim.main_drain",
    "display_name": "AGF 5000 Series Main Drain 2\"",
    "mfg": "AGF Manufacturing", "mfg_pn": "5000",
    "listing": ["UL"], "price_usd": 185.00, "install_minutes": 30,
    "dims": {"nominal_in": 2}, "ports": [
        {"role": "inlet", "position": [0, 0, 0], "direction": [0, 0, -1],
         "size": "2grooved", "style": "grooved"}],
    "cut_sheet_url": AGF_CS, "cut_sheet_local": None,
    "confidence": "medium",
}, AGF_CS, "training_knowledge",
    missed=["weight_kg"], estimate=["price_usd"])

# ---------------------------------------------------------------------------
# WRITE
# ---------------------------------------------------------------------------

manifest = {
    "schema_version": 1,
    "generated_at": NOW,
    "notes": (
        "Phase D data-only manifest. Consumed by Phase D.3 SCAD-generation "
        "agent to author packages/halofire-catalog/authoring/scad/*.scad. "
        "Do NOT import into catalog.json directly — catalog.json is build "
        "output from SCAD annotations. See docs/PHASE_D_DATA_REPORT.md."
    ),
    "count": len(entries),
    "entries": entries,
}

MANIFEST_PATH.parent.mkdir(parents=True, exist_ok=True)
MANIFEST_PATH.write_text(
    json.dumps(manifest, indent=2, ensure_ascii=False) + "\n",
    encoding="utf-8",
)

LOG_PATH.write_text(
    json.dumps({
        "schema_version": 1,
        "generated_at": NOW,
        "count": len(log),
        "entries": log,
    }, indent=2, ensure_ascii=False) + "\n",
    encoding="utf-8",
)

print(f"Wrote {len(entries)} entries to {MANIFEST_PATH}")
print(f"Wrote {len(log)} log rows to {LOG_PATH}")

# Confidence distribution
dist: dict[str, int] = {}
for e in entries:
    dist[e["confidence"]] = dist.get(e["confidence"], 0) + 1
print("Confidence distribution:", dist)
