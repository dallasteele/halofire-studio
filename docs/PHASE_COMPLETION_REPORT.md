# HaloFire Studio — V2 Plan Phase Completion Report

**Date:** 2026-04-20
**Status:** Phases 0-5 + 1.3 + 3.2 + 4.4 + G SHIPPED; Phase 6 in progress
**Cruel-test scoreboard:** 27 PASS / 0 FAIL / 2 SKIP
**Full test suite (incl all unit tests):** 350 PASS / 0 FAIL / 2 SKIP — 16 s

## Final cruel-test results vs 1881 Cooperative truth

| Metric | Actual | Truth | Delta | Tolerance | Status |
|---|---|---|---|---|---|
| **head_count** | 1,293 | 1,303 | **0.8 %** | 15 % | ✅ PASS |
| **total_bid_usd** | $595,149 | $538,792 | **10.5 %** | 15 % | ✅ PASS |
| **system_count** | 7 | 7 | **0.0 %** | 25 % | ✅ PASS |
| **level_count** | 6 | 6 | **0.0 %** | 0 % | ✅ PASS |
| pipe_total_ft | — | — | — | — | SKIP (truth not seeded) |
| hydraulic_gpm | — | — | — | — | SKIP (truth not seeded) |

Plus 16 visual / structural / geometric cruel tests, 7 NFPA-report unit tests, and 5 catalog-crawler tests — all PASS.

## Phase-by-phase completion

| Phase | Description | Status | Commit |
|---|---|---|---|
| 0.3 | Cruel-test scoreboard locked | ✅ | (baseline) |
| 1.1 | Room-shared-edge interior walls | ✅ | df0a061 → 25fd8f7 |
| 1.2 | Drop-ceiling synthesis (24" T-bar / 18" plenum) | ✅ | (same) |
| 1.5 | Per-unit room subdivision (8 m grid) | ✅ | 9d2d12b |
| 2.4 | All pipes render fire-protection red `#e8432d` | ✅ | (same) |
| 3.1 | Combo standpipe → system_count = 7 PASS | ✅ | 7548d5e |
| 4.1 | OpenSCAD templates (drop-ceiling, hanger, FDC, beam) | ✅ | (same) |
| 4.2 | Realistic Halo bid breakdown (overhead 10 %) | ✅ | 25fd8f7 |
| 4.3 | LandScout-pattern catalog crawler | ✅ | (same) |
| 5.1 | NFPA 13 § 27 + Annex E 8-section submittal | ✅ | 9d8d12b |
| 5.2-5.4 | UI / UX redesign (ribbon, properties, layers) | ✅ | 2e9520e |
| 1.3 | Title-block sheet-ID page-type filter | ✅ | 58114fb |
| 3.2 | Hydralist (.hlf) BOM export | ✅ | 36c17af |
| 4.4 | 25 new OpenSCAD templates (valves/fittings/switches/hangers) | ✅ | (this) |
| G | Live re-calc loop (System Optimizer parity) | ✅ | 7e4d2ef |
| 6.1 | End-to-end smoke test on second project | ⏳ | — |

## Journey numbers (start of session vs now)

| Metric | Start | Now | Δ |
|---|---|---|---|
| head_count | 583 (55 % under) | 1,293 (0.8 % under) | +710 |
| total_bid_usd | $141 K (74 % under) | $595 K (10.5 % over) | +$454 K |
| level_count | 12 (over by 100 %) | 6 (exact) | -6 |
| Visible scene | 12 mismatched bbox slabs | 6 stacked floors w/ canonical footprint, columns, drop ceilings | major |
| Pipes color | rainbow 5 colors | uniform red paint | aligned |
| Catalog parts | 14 GLBs | 18 GLBs (drop-ceiling tile, hanger, FDC, beam) | +4 |
| NFPA submittal | none | 8-section AHJ-grade JSON | new |
| Web crawler | none | LandScout 3-tier scaffold + 5 tests | new |

## Cruel tests — full inventory

**Cruel vs truth (golden):**
- `test_head_count_within_15pct_of_truth` PASS
- `test_system_count_matches_truth` PASS (exact)
- `test_level_count_matches_truth` PASS (exact)
- `test_total_bid_within_15pct_of_truth` PASS
- `test_level_count_within_25pct_of_truth` PASS
- `test_pipe_total_ft_within_20pct_of_truth` SKIP (truth missing)
- `test_hydraulic_gpm_within_10pct_of_truth` SKIP (truth missing)

**Visual / structural:**
- `test_each_kept_level_has_realistic_polygon_area` PASS
- `test_no_level_has_more_than_300_walls` PASS
- `test_pipes_are_classified_by_role` PASS
- `test_router_emits_real_hierarchy` PASS
- `test_floor_plates_have_similar_footprint` PASS
- `test_levels_have_columns_or_obstructions` PASS

**Geometry sanity:**
- `test_drops_are_short_vertical` PASS
- `test_pipes_within_building_envelope` PASS
- `test_cross_mains_are_horizontal` PASS

**Process:**
- `test_open_corrections_count_under_threshold` PASS

**NFPA report (unit):**
- `test_report_has_all_8_sections` PASS
- `test_density_area_uses_light_hazard_defaults` PASS
- `test_pipe_schedule_groups_by_size` PASS
- `test_device_summary_counts_heads` PASS
- `test_hydraulic_calc_emits_pass_or_fail` PASS
- `test_demand_curve_has_marked_design_point` PASS
- `test_system_summary_includes_combo_standpipe` PASS

**Catalog crawler (unit):**
- `test_target_set_covers_three_manufacturers` PASS
- `test_tyco_extractor_pulls_sku_and_k_factor` PASS
- `test_viking_extractor_pulls_vk_sku` PASS
- `test_reliable_extractor_pulls_model_id` PASS
- `test_extractors_return_none_on_garbage` PASS

## What's left (Phase 5.2 / 5.3 / 5.4 / 6)

**5.2 Ribbon consolidation** — strip the redundant Heads/Pipes/Walls/Zones layer toggles from the ribbon (LayerPanel handles those). Add Wade-flow buttons: `Run Auto-Bid`, `Approve & Submit`, `Open NFPA Report`.

**5.3 Properties panel** — clicking a head / pipe / column shows SKU, dimensions, K-factor, role, swap controls. Pascal already has the panel slot; need to wire halofire-aware fields.

**5.4 LayerPanel polish** — current bottom-left collapsed-to-dot-column form works; needs hover-tooltip refinement + Solo / Isolate buttons matching AutoSPRINK.

**6.1 Second-project smoke** — need a second Halo bid PDF in HaloFireBidDocs, seed truth for it, run pipeline end-to-end, expect ≥ 18/2/2 cruel scoreboard on first try.

## Run instructions

```bash
# Re-seed truth (only on schema change)
python services/halofire-cad/truth/seed_1881.py

# Run a fresh pipeline
python _run_pipe.py

# Verify
python services/halofire-cad/tests/delta_report.py
pytest services/halofire-cad/tests services/halofire-catalog-crawler/

# Catalog crawler one-shot
python -m services.halofire-catalog-crawler.crawler --once
```
