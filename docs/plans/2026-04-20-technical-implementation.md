# Technical Implementation Plan — Full Stack Completion

**Date:** 2026-04-20
**Supersedes scope of:** `2026-04-20-path-to-production.md` (research)
**Drives:** executable code in this repo + per-component tests
**Rulebook:** `E:/ClaudeBot/AGENTIC_RULES.md`

## Full-stack architecture

```
                    ┌─────────────────────────────────┐
                    │ Browser                         │
                    │  ┌──────────────────────────┐   │
                    │  │ Next.js apps/editor      │   │
                    │  │  Studio (Pascal viewer)  │   │
                    │  │  /bid/[project]          │   │
                    │  └────────┬─────────────────┘   │
                    └───────────┼─────────────────────┘
                                │ HTTPS
                                ▼
                    ┌─────────────────────────────────┐
                    │ halopenclaw-gateway (FastAPI)   │
                    │  JSON-RPC /mcp                  │
                    │  REST /intake /building /quick… │
                    │  JWT + per-project roles        │
                    │  signed URLs + audit log        │
                    └───────────┬─────────────────────┘
                                │ importlib (in-proc)
                                ▼
                    ┌─────────────────────────────────┐
                    │ halofire-cad (Python)           │
                    │  agents/00…14 typed I/O         │
                    │  cad.schema (pydantic v2)       │
                    │  orchestrator.run_pipeline      │
                    └───────────┬─────────────────────┘
                                │
                 ┌──────────────┼──────────────────┐
                 ▼              ▼                  ▼
       pdfplumber / pymupdf  shapely / nx      trimesh / IfcOpenShell / ezdxf
       (PDF + raster)        (2D + graph)      (3D + BIM + CAD I/O)
```

## Phased execution this session

Each phase ships with: implementation + unit tests + property tests
where numeric + golden fixtures where output-shape + gate-evidence
commit.

### Phase S1 — Fix A5 GLB openings/roof/coloring (VISIBLE FIX)

**Goal:** generated building stops looking like a storage unit.

**Files touched:**
- `services/halofire-cad/cad/schema.py` — `Opening` already exists;
  add `doors_per_wall_estimate` to generator spec
- `services/halofire-cad/agents/14-building-gen/agent.py` — generate
  Opening records per Wall (one door per interior wall, random
  window per exterior wall)
- `services/halofire-cad/agents/14-building-gen/glb.py`:
  - Wall meshes subtract door boxes via `trimesh.boolean.difference`
  - Add roof slab at `max(level.elevation_m + height_m)`
  - Color per use-class (garage=dark, residential=light, roof=slate)
- `services/halofire-cad/tests/unit/test_building_gen.py` — verify
  GLB has doors (count), roof exists, wall bounding-box has holes

**Success:** screenshot of Studio shows a recognizable building with
visible door/window openings + roof.

### Phase S2 — Fix A6 placer coverage-cap (REMOVE XFAIL)

**Goal:** 10×10 m light-hazard room gets ≥ 5 heads (per §11.2.3.1.2
225-sqft cap) not 4.

**Files:**
- `services/halofire-cad/agents/02-placer/agent.py`:
  - Remove `_shrink(poly, spacing_m * 0.5)` pre-step
  - Grid against full polygon with `spacing_m` cell size
  - After gridding, clip any head closer than `min_wall_offset_m=0.102`
    (4 in per §11.2.3.1.3)
- `services/halofire-cad/tests/unit/test_placer.py`:
  - Remove `@pytest.mark.xfail` from
    `test_place_heads_coverage_cap_light`

**Success:** `pytest` reports 122 passed, 0 xfail.

### Phase S3 — Wire B3 pump/tank into calc

**Goal:** if `FlowTestData` carries a pump or tank, the solver uses it.

**Files:**
- `services/halofire-cad/cad/schema.py`:
  - Extend `FlowTestData` with optional `pump: PumpCurve`,
    `tank: GravityTank`
- `services/halofire-cad/agents/04-hydraulic/agent.py` `calc_system`:
  - If `supply.pump`: residual_psi adjusted via `pump.pressure_at(Q)`
  - If `supply.tank`: static_psi adjusted via `tank.static_head_psi()`
  - Duration check: demand_gpm × 60 min ≤ `tank.usable_volume_gal`
- Tests: two-point comparison (with pump vs without) shows
  demand_at_base decreases when pump is present

### Phase S4 — Technical-plan doc itself

This file. Commit with the code.

## Test strategy

| Layer | Tool | Coverage target |
|---|---|---|
| Schema contracts | `pytest` unit + `model_dump_json` round-trip | 100% of pydantic models |
| Agent pure logic | `pytest` unit + `hypothesis` properties | every exported function |
| Cross-agent | `pytest` integration (orchestrator fixture) | happy path + 2 failure modes per phase |
| Export verify | smoke parse DXF/GLB/IFC with native readers | pass each format |
| REST | `httpx.AsyncClient` against FastAPI app | every endpoint + error path |
| E2E | Playwright (Phase C3, not this session) | core user journey |

## Gate evidence template (per commit)

```
Gate 1 lint: ruff + biome → 0 errors
Gate 2 typecheck (halofire strict) → exit 0
Gate 3 build: npm run build → completes
Gate 4 unit+property: pytest -q → N passed, 0 xfail after Phase S2
Gate 5 stress: pytest -q -m stress → passes
Gate 6 E2E: integration pytest → passes
Gate 7 services: gateway /health + studio / → 200
Gate 8 golden: schema drift check → 0 drift
Gate 9 schema: check_schema_drift.py → OK
Gate 10 manifest: honest (xfails documented, limits surfaced)
```

## Ship criteria (for this session)

- [ ] S1 GLB emitter emits doors + roof + colored walls
- [ ] S1 viewport screenshot-verified shows building not honeycomb
- [ ] S2 placer xfail removed, all tests green
- [ ] S3 pump/tank chained into calc with regression test
- [ ] All tests green (0 xfail, ≥ 122 passed)
- [ ] Gateway alive, typecheck clean, commit landed

## Follow-up phases (next sessions)

| Next | Phase | Ref |
|---|---|---|
| Session +1 | A1 CubiCasa5k L3 + A2 page→level | path-to-prod Tier A |
| Session +2 | B1 loop Hardy-Cross wire-up + B2 remote-area refinement | path-to-prod Tier B |
| Session +3 | B4 IFC Blender verification + B5 DXF title block | path-to-prod Tier B |
| Session +4 | B6 PE review UI | path-to-prod Tier B |
| Sessions +5…+8 | C1–C2 UX redesign (4 weeks) | ux-research plan |

Every session ends with: test evidence + screenshot + BUILD_LOG entry
+ brain writeback + CODEX_REVIEW amendment per AGENTIC_RULES §12.
