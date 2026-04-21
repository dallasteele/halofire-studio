# HaloFire Studio — End-to-End Plan to Reach AutoSPRINK Parity

**Status: planning — not started**
**Owner: HaloFire CAD agent loop**
**Paired doc: `docs/AUTOSPRINK_TARGET.md` (the feature surface we're matching)**
**Last update: 2026-04-20**

This document replaces the ad-hoc iteration we've been doing. Every section below has a clear scope, a verification gate (code + function + visual), and an exit criterion. No section ships until its gates pass.

---

## 1. Vision (one paragraph)

**HaloFire Studio is an AutoSPRINK-class fire-protection CAD with three things AutoSPRINK doesn't have:** (1) a real 3D BIM viewport built on Pascal / three.js, not legacy Win32 OpenGL; (2) an Auto-Bid agent loop that turns an architect PDF into a stamped proposal in <5 minutes; (3) an OpenSCAD-driven parts forge that can fabricate any building material or fire-sprink part on demand, fed by a web-catalog agent that crawls manufacturer sites for new SKUs (LandScout pattern). The estimator uploads a PDF, the agent loop runs intake → classify → place → route → calc → BOM → labor → submittal, and the estimator reviews + corrects in 3D before signing the proposal.

---

## 2. Brutally honest current state (2026-04-20)

| Section | Status | Evidence |
|---|---|---|
| Intake (CubiCasa + pdfplumber) | ⚠️ partial | 6 levels truth-aligned, but interior walls are noise |
| Classifier (NFPA hazard) | ⚠️ partial | 12 rooms tagged; not aware of drop ceilings, uses, or remote-area splits |
| Placer (head spacing) | ⚠️ partial | 939 heads vs 1303 truth (28% under) |
| Router (Smart Pipe) | ❌ wrong | Pipes scattered, no drop-ceiling awareness, role-color used 5 colors instead of "all red paint" |
| Hydraulic calc | ❌ stub | Defaults applied, no real Hazen-Williams or Darcy-Weisbach |
| BOM + labor | ⚠️ partial | Numbers emitted but not Hydralist-format and bid 44% under truth |
| Proposal / submittal | ⚠️ partial | HTML + PDF emitted; no NFPA 8-format report |
| 3D viewport | ⚠️ partial | Slabs + walls + columns + heads + pipes render; drop ceilings missing; pipe routing visually incoherent |
| OpenSCAD parts forge | ⚠️ partial | column.scad + 14 catalog parts; no drop-ceiling tile, soffit, beam, pillar variants, no auto-fab on missing SKU |
| Web-catalog agent | ❌ missing | No LandScout-style crawler |
| UI / UX | ❌ inconsistent | LayerPanel placement, sidebar tab structure, ribbon redundancy, no AutoSPRINK-parity tools |
| Cruel-test scoreboard | 12 PASS / 3 FAIL / 2 SKIP | scoreboard above |

---

## 3. Architecture (sections, ownership, contracts)

```
                                ┌─────────────────────────────────────┐
                                │     HaloFire Studio (Next 16)       │
                                │     apps/editor/...                 │
                                └─────────────────────────────────────┘
                                                │
          ┌─────────────────────┐      ┌────────┴────────┐      ┌───────────────────┐
          │  Pascal viewer       │      │  AutoDesign     │      │ Catalog UI         │
          │  packages/viewer     │◀────▶│  panel          │◀────▶│ (parts picker)     │
          │  packages/core       │      │  components/... │      │ packages/halofire- │
          └─────────────────────┘      └────────┬────────┘      │ catalog            │
                                                │               └───────┬────────────┘
                                                ▼                       │
                                  ┌─────────────────────────────┐       │
                                  │  halopenclaw-gateway (FastAPI)│      │
                                  │  services/halopenclaw-gateway │      │
                                  │   /intake/dispatch  /intake/status   │
                                  │   /projects/<id>/...  /catalog/...   │
                                  └────────────────┬────────────────┬────┘
                                                   │                │
                              ┌────────────────────▼─────┐  ┌───────▼─────────────────────┐
                              │ halofire-cad orchestrator │  │ halofire-catalog/authoring   │
                              │ services/halofire-cad     │  │  /scad  +  /web-crawler      │
                              │  intake → classify → place │  │  OpenSCAD parts forge        │
                              │  → route → hydraulic →     │  │  + LandScout-pattern web     │
                              │  rulecheck → bom → labor   │  │  agent for catalog updates   │
                              │  → proposal → submittal    │  │                              │
                              └────────────┬───────────────┘  └─────┬────────────────────────┘
                                           │                        │
                                           ▼                        ▼
                                  ┌──────────────────┐    ┌────────────────────┐
                                  │ truth.duckdb      │    │ glb assets         │
                                  │ services/halofire │    │ apps/editor/public │
                                  │ -cad/truth        │    │ /halofire-catalog  │
                                  └──────────────────┘    └────────────────────┘
```

### Section ownership

| Section | Owner | Source dir | Verification gates |
|---|---|---|---|
| **A.** Intake — vector PDF parser | `agents/00-intake/agent.py` | services/halofire-cad/agents/00-intake | A.code + A.func + A.visual |
| **B.** Intake — CubiCasa raster fallback | `agents/00-intake/l3_cubicasa.py` | same | B.code + B.func + B.visual |
| **C.** Classifier (NFPA hazard) | `agents/01-classifier/agent.py` | same | C.code + C.func + C.visual |
| **D.** Drop-ceiling synthesis | NEW `agents/00-intake/drop_ceiling.py` | NEW | D.code + D.func + D.visual |
| **E.** Placer (head spacing) | `agents/02-placer/agent.py` | same | E.code + E.func + E.visual |
| **F.** Router (Smart Pipe + drop-ceiling-aware) | `agents/03-router/agent.py` | same | F.code + F.func + F.visual |
| **G.** Hydraulic calc | `agents/04-hydraulic/agent.py` | same | G.code + G.func + G.visual |
| **H.** Rule check (NFPA 13 §) | `agents/05-rulecheck/agent.py` | same | H.code + H.func + H.visual |
| **I.** BOM + labor | `agents/06-bom/agent.py` + `07-labor/agent.py` | same | I.code + I.func + I.visual |
| **J.** Proposal + submittal | `agents/09-proposal/agent.py` + `10-submittal/agent.py` | same | J.code + J.func + J.visual |
| **K.** OpenSCAD parts forge | `packages/halofire-catalog/authoring/scad` | NEW templates per category | K.code + K.func + K.visual |
| **L.** Web-catalog crawler agent | NEW `services/halofire-catalog-crawler` | NEW | L.code + L.func + L.visual |
| **M.** Pascal viewer integration | `apps/editor/components/halofire/AutoDesignPanel.tsx` | same | M.code + M.func + M.visual |
| **N.** UI / UX (panels, ribbon, layers, properties) | `apps/editor/...` + `packages/editor` | same | N.code + N.func + N.visual |

### Verification gates (every section, no exceptions)

- **`<X>.code`** — pytest unit tests in `services/halofire-cad/tests/unit/test_<x>.py` cover the contract (input → output), including edge cases.
- **`<X>.func`** — cruel test in `services/halofire-cad/tests/golden/test_cruel_vs_truth.py` validates against the 1881 truth seed.
- **`<X>.visual`** — Chrome MCP snapshot of the canvas after Render last bid, with measurable assertion (e.g. "scene has ≥ 6 slabs at distinct elevations", "heads visible at ceiling height", "pipes coherent on each floor").

A section is **DONE** when all three gates pass. No commit touching that section ships without all three green.

---

## 4. Roadmap (ordered, with exit criteria)

Each iteration takes ~30 min cycle (one pipeline run + visual confirm). Order chosen so each step unblocks the next.

### Phase 0 — Foundation (this doc + truth + scoreboard)

- **0.1** Write this plan ✓ (you're reading it)
- **0.2** Audit truth seed → reseed if wrong (done 2026-04-20: 12 → 6 levels)
- **0.3** Lock in cruel-test scoreboard format. **Exit: 12 PASS minimum, the 3 FAILs documented as known-tracking gaps**

### Phase 1 — Intake quality (Section A + B + D)

Goal: produce a clean, truth-aligned `Building` with real interior walls + drop ceilings.

- **1.1** Replace CubiCasa wall extrusion with **room-shared-edge derivation**. CubiCasa rooms are reliable; CubiCasa walls aren't. Walls = room boundaries that two rooms share = interior partitions; walls on only one room boundary = exterior. Visual gate: 1881 produces 50-150 walls per floor in coherent room outlines, not 100-500 noise sticks.
- **1.2** **Drop-ceiling synthesis** — for each level with use ∈ {residential, amenity, office}, generate a `DropCeiling` zone covering the floor area, with `tile_size_m=0.6` (24" T-bar) and `cavity_depth_m=0.45` (18" plenum). Visual gate: 4 residential floors show a ceiling tile pattern + a separate cavity above where pipes route.
- **1.3** Better **page-type filter** — read the title-block sheet ID from a known location (bottom-right corner of every sheet) and reject any sheet not in the `A-1XX` floor-plan series. Visual gate: pipeline keeps pages 8-14 and rejects 1-7 in 1881.
- **1.4** **Per-tier canonical polygons** — podium (parking) and tower (residential) get separate canonical outlines (parking deck is wider than the tower above). Visual gate: 1881 tower sits on a wider podium.

### Phase 2 — Placer + Router (Section E + F)

Goal: heads at NFPA-correct spacing, pipes routed in the drop-ceiling cavity.

- **2.1** Fix per-floor head density to hit 1303 ± 15% on 1881. Probably means dropping `_skip_room` for parking and using residential head spacing differently.
- **2.2** **Drop-ceiling-aware router** — pipes live at `level.elevation_m + ceiling.height_m + 0.15` (in the plenum), not at slab level. Heads drop down through ceiling tiles via `drop` pipes (1" sched 40, 0.45 m long).
- **2.3** **Branch-cross-main hierarchy** — already 70% there from iter-7; need to actually compute the cross-main route along structural grid lines (vs random Y-coord), and have branches perpendicular to cross-mains.
- **2.4** **All pipes red.** Strip the 5-color role coding; everything renders in `#e8432d` (fire-protection red paint per NFPA 13 §6.7). Role data still in `metadata.role` for BOM grouping but visual = uniform red.

### Phase 3 — Hydraulic + BOM (Section G + I)

- **3.1** Real Hazen-Williams calc with iterative pipe-upsizing (System Optimizer parity).
- **3.2** Hydralist-format BOM export. Cost roll-up that hits 1303 heads × $200 + pipe + valves + labor ≈ $539K (matching truth bid).

### Phase 4 — OpenSCAD parts forge + Web-catalog crawler (Section K + L)

Goal: the moat — fab any part on demand, keep catalog auto-current.

- **4.1** Templates for the missing parts: drop-ceiling tile, T-bar grid, soffit, beam, pillar variants, hangers (3 styles), couplings, end caps, pressure switch, wall hydrant.
- **4.2** **Auto-fab on missing SKU.** When the BOM references a SKU that has no GLB, the catalog bridge picks the matching `.scad` template, parameterizes it from `CatalogEntry.dim_*`, runs OpenSCAD (or Trimesh fallback), and saves the GLB. Pipeline doesn't block on missing meshes ever again.
- **4.3** **Web-catalog crawler agent** (LandScout pattern): a scheduled agent that crawls Anvil, Tyco, Viking, Reliable, Victaulic, Globe, etc. for new sprinkler heads + pipe SKUs. Adds new entries to `packages/halofire-catalog/specs` and triggers `render_from_catalog.py` for each.

### Phase 5 — Submittal + UI / UX polish (Section J + N)

- **5.1** NFPA 8-format hydraulic report (one-click).
- **5.2** Ribbon consolidation (Design / Analyze / Report) and panel hierarchy (Auto-Design → Project → Layers → Catalog → Manual).
- **5.3** Properties panel for selected items (head SKU swap, pipe upsize, etc.).
- **5.4** Layer panel: docked bottom-left, default-collapsed dot column with hover tooltips (proper CAD-app pattern, not floating top-right).

### Phase 6 — Field-test + first-client deploy

- **6.1** End-to-end smoke run on 1881 + 2 other Halo bids — cruel scoreboard ≥ 14 PASS.
- **6.2** Wade Steele review session — collect feedback, re-iterate.

---

## 5. Standards we adhere to

| Standard | Why it matters |
|---|---|
| **NFPA 13** 2022 | Sprinkler design (head spacing, density, pipe sizing, hangers) |
| **NFPA 14** | Standpipes |
| **NFPA 20** | Fire pumps |
| **NFPA 25** | Inspection / testing / maintenance markings |
| **ICC IFC** | Local code overlays |
| **AutoCAD .dxf** | Drawing interchange |
| **IFC 4.x** | BIM interchange |
| **glTF 2.0** | 3D mesh format (Pascal viewer native) |

Plus the in-house gates: **AGENTIC_RULES §1 typed I/O, §5 tested, §13 honesty.**

---

## 6. Brutally honest commitments going forward

1. **No commits without all three gates green for the section being touched.** I broke this rule multiple times this session — won't again.
2. **Every commit message includes verification numbers.** What pytest output, what scoreboard delta, what visual-snapshot byte size + key counts.
3. **Stop reaching for hacks (SlabNode-as-column, building_shell-empty-src, etc).** Use the right Pascal node + the right OpenSCAD template. If the right template doesn't exist, write it.
4. **All pipes red, period.** Strip the rainbow.
5. **No new feature without a cruel test that catches its failure mode.** Test-first is the only way the loop converges.
6. **When the user says something is wrong, audit the truth seed before engineering harder.** Wrong seed = wrong target = wasted iteration.

---

## 7. Decision log

- **2026-04-20** Truth seed corrected from 12 levels to 6. Cruel-test scoreboard reset; level_count now PASSes.
- **2026-04-20** All pipes will render in `#e8432d` (fire-protection red paint). Role color-coding moves from visual to BOM-only metadata.
- **2026-04-20** Drop ceilings become a first-class part of intake, not a postprocess. Affects router + viewer + BOM.
- **2026-04-20** OpenSCAD parts forge becomes a hard dependency for the BOM step (no missing meshes allowed past Phase 4).
- **2026-04-20** LandScout-pattern web-catalog crawler added to roadmap (Phase 4.3).

---

## 8. Open questions for the user (please answer before Phase 1.1 starts)

- Q1. **Drop-ceiling defaults** — confirm 24" T-bar, 18" plenum, residential + amenity + office floors only? Garage levels exposed deck (no drop ceiling)?
- Q2. **Pipe color** — `#e8432d` (Halo Fire accent red) OR true NFPA-13 §6.7 fire-protection red `#cc0000`? The latter is what painted-in-place pipes look like in real buildings.
- Q3. **Web-catalog crawler scope** — start with just sprinkler heads (highest churn) or include pipes + fittings + valves from day 1?
- Q4. **First-client deploy target** — back to Halo Fire Protection or something different?

---

## 9. Until you sign off on this plan, no more code changes.

Reading + commenting on this doc is the next step. I'll wait.
