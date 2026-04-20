# HaloFire Test Matrix

Two shippable products depend on this test matrix:

1. **HaloFire CAD Studio** — the AutoSprink-replacement desktop/web
   app at `apps/editor`.
2. **Client bid HTML** — the self-contained proposal delivered to
   Halo's client (embedded 3D model + per-level plan SVGs + BOM +
   pricing + scope).

Every iteration touches one or both. Every iteration must land at
least one new check in **every row** that its change intersects.
Silence in a row = coverage gap.

## Test types (per AGENTIC_RULES.md §5)

| type | what it proves | tool |
|---|---|---|
| **Unit** | Pure-function correctness | `pytest`, `bun test` |
| **Property** | Invariants hold across random inputs | `hypothesis`, fast-check |
| **Stress** | Pipeline handles big inputs without melting | 110-page 1881 PDF run |
| **Golden** | Output matches a known-good snapshot | fixtures under `tests/fixtures` |
| **E2E** | Whole pipeline: intake→proposal.html | `run_pipeline` on 1881 |
| **Smoke** | Shippable artifact still works | bash scripts, `preview_network` |
| **Visual** | Screenshot matches expected layout | `preview_screenshot` |

## Coverage map

### HaloFire CAD Studio (`apps/editor`)

| area | smoke | unit | visual | golden |
|---|---|---|---|---|
| SceneBootstrap spawn / level parenting | `apps/editor/tests/smoke/run-viewport-smoke.sh` | — | `preview_screenshot` | — |
| GLB resolution (CDN override) | same script (checks .env.development) | — | `preview_network filter=failed` | — |
| Catalog (materials + connectors) | — | `packages/halofire-catalog/tests/catalog.test.ts` (54 tests) | — | — |
| Item-renderer applies material tint | — | — | `preview_screenshot` (pipes render NFPA red) | — |
| Auto-Design panel dispatch | — | — | `preview_screenshot` after click | — |

### Client bid HTML (`services/halofire-cad/agents/09-proposal`)

| area | smoke | unit | visual | golden |
|---|---|---|---|---|
| `<model-viewer>` + design.glb present | `grep` in CI | `test_proposal_html.py::test_html_has_model_viewer_tag_with_glb` | — | — |
| Every required section present | — | `test_html_has_every_required_section` | `preview_screenshot` at /bid-demo/... | — |
| Per-level plan SVG (heads + pipes) | — | `test_level_plan_contains_circle_per_head_and_line_per_pipe` | visual check on 1881 | fixture under `tests/fixtures/proposal_html/` |
| NFPA pipe-size color mapping | — | `test_plan_uses_nfpa_size_color_for_2in` | — | — |
| XSS safety | — | `test_html_escapes_user_content` | — | — |

### Pricing + catalog sync (`services/halofire-cad/pricing`)

| area | smoke | unit | integration |
|---|---|---|---|
| Schema bootstrap (idempotent) | `python -m pricing.seed` re-runs cleanly | `test_pricing_db.py::test_bootstrap_idempotent` | — |
| Append-only prices | — | `test_price_append_only` | — |
| `price_for` returns latest | — | `test_price_for_latest_observation` | — |
| `stale` flag correct after 60d | — | `test_stale_flag_crosses_threshold` | — |
| `apply_updates` rejects unknown SKU | — | `test_apply_updates_rejects_unknown_sku` | — |
| CSV sync deterministic path | — | `test_sync_agent_csv_round_trip` | — |
| Ollama path (skipped w/o daemon) | — | `test_sync_agent_llm_stub` (monkeypatch) | — |
| BOM uses live prices | — | `test_bom_uses_live_price` | 1881 E2E run |
| Excel export | — | `test_export_xlsx_has_all_sheets` | — |

### Auto-Design pipeline (`services/halopenclaw-gateway` + `services/halofire-cad`)

| area | smoke | stress | golden | E2E |
|---|---|---|---|---|
| Intake L3 (CubiCasa) | — | 110-page 1881 PDF completes | `tests/fixtures/intake/fire-rfis-page0.json` | `run_pipeline("1881-cooperative")` |
| Placer per-room cap | — | — | golden heads per known fixture room | — |
| Router Steiner budget | `test_hydraulic.py::test_router_respects_budget` | — | — | 1881 router completes < 45s/level |
| Hydraulic pump/tank | — | — | `test_pump_boosts_supply_residual` | — |
| Rule check errors ≥ 0 | — | — | `test_calc_system_explicit_loop_grid_unsupported_issue` | — |

## Running the loop

Per iteration:

```bash
# Smoke (under 30s — runs on every change)
bash apps/editor/tests/smoke/run-viewport-smoke.sh
pytest services/halofire-cad/tests/unit/test_proposal_html.py -q
pytest services/halofire-cad/tests/unit/test_pricing_db.py -q
bun test ./packages/halofire-catalog/tests/catalog.test.ts

# Visual (requires preview server)
preview_screenshot   # after each UI change
preview_network filter=failed   # after each catalog/asset change

# Integration (≤ 5 min)
python -m cad.pipeline --project 1881-cooperative --light
```

## New iteration checklist

For any PR in this scope:

- [ ] Identify the rows touched in the coverage map.
- [ ] Add ≥ 1 new test in every row whose proof wasn't already
      current for this change.
- [ ] Run smoke + unit suite; paste output into the PR.
- [ ] For UI changes: attach a before/after `preview_screenshot`.
- [ ] For pricing changes: show `stale_skus` delta.
- [ ] Update this matrix when new areas ship.
