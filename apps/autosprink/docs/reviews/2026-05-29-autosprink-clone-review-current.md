# HaloFire AutoSprink-clone — Internal-Alpha Review Packet (CURRENT)

- **Date:** 2026-05-29
- **HEAD commit:** `d0c03af` — "P7: studio compliance + full-hydraulics + submittal surface"
- **Status:** Internal alpha, best-effort. **NOT** AutoSprink/AutoCAD parity, **NOT** AHJ-approved,
  **NOT** PE-reviewed/stamped, **NOT** permit-ready, **NOT** fabrication-ready, **NOT** manufacturer-exact.
  All of those remain **fail-closed BLOCKED** via the evidence/claim-gate system (see §3).
- **Supersedes:** `docs/reviews/2026-05-29-autosprink-clone-review.md` (stale: claimed 17 files / 131 tests)
  and `docs/reviews/2026-05-29-internal-alpha-review.md` (stale: claimed 9 files / 41 tests, pinned to `8a6eb3b`).
  Those are retained for history; this packet is the authoritative current status.

> "Satisfied" in this packet means **the capability genuinely exists and works** (cited to file:line /
> test / endpoint). It does **not** mean parity, approval, or permit/fabrication readiness — those stay
> gated and are explicitly NOT claimed.

---

## 1. Verification — one-command verifier & test count

- **One-command verifier:** `scripts/verify-internal-alpha.ps1`. It runs the **entire** suite via bare
  `npx vitest run` (line 32, no file list — comment lines 29–31: "Run the ENTIRE suite … so this can never
  drift from the real test count"), seeds a temp DB (line 24), asserts ≥5 gates/evidence rows (line 27),
  checks `$LASTEXITCODE` (line 33), and runs `verify_agentic_rules.py` (line 39).
- **Actual current result** (ran `npx vitest run` at `C:/Users/dalla/OneDrive/Documents/HaloFire`,
  node v22.14.0):

  ```
  Test Files  34 passed (34)
       Tests  320 passed (320)
    Duration  ~21.4s
  ```

  **34 files / 320 tests, all green.** This replaces the stale 17/131 and 9/41 figures in the prior packets.

---

## 2. What genuinely works (each line cited)

### 2.1 Floor-plan → 3D building shell + sprinkler system (SVG path live; DXF engine-only)

- **SVG floor plan import:** `floorPlanFromSvg` parses `<rect>/<polygon>/<path>`
  (`src/engine/floorplan-import.js:80`).
- **SVG building import:** `buildingFromSvg` parses `data-space/data-wall/data-opening/data-column`
  (`src/engine/floorplan-import.js:408`).
- **Wired into live pipeline:** `runSprinklerPipeline` calls `buildingFromSvg` (`src/api/server.js:595`)
  for `buildingSvg` and `floorPlanFromSvg` (`src/api/server.js:604`) for `svg`; reached via
  `POST /api/projects/:name/sprinkler-bid` (`src/api/server.js:700`), returning `cadModel`.
  UI `planSource` offers `svg` and `building` (`autosprink.html:431-437`).
- **3D CAD model build:** `buildCadModel` (`src/engine/cad-model.js:406`) emits building shell
  (slab/roof, per-edge `kind:'wall'`, columns) plus riser → cross-main → branch → drop → head network
  with NFPA-13 schedule pipe sizing (`src/engine/cad-model.js:42-145, 280-347`).
- **OpenGeometry kernel render (structural solids):** real vendored `opengeometry` v2.0.10
  (Rust/WASM/Three.js, `node_modules/opengeometry/` — `index.js` 378 KB + `opengeometry_bg.wasm` ~1.39 MB)
  served at `/vendor/opengeometry` (`src/api/server.js:281`). Studio imports
  `{OpenGeometry, Vector3, Cuboid, Cylinder, Opening, OGSceneManager}` (`autosprink.html:155`), inits the
  WASM kernel (`autosprink.html:203`), builds wall/column solids with `new Cuboid(...)` and pipe solids
  with `new Cylinder(...)` (`autosprink.html:310-335`), and cuts openings via kernel boolean
  `wallCuboid.subtract(ops)` (`autosprink.html:293`).
- **Tests:** `floorplan-import` (17) + `building-model` (8) + `cad-model` (11) all pass.

> Honest limit: **DXF import is engine-only, not wired.** `floorPlanFromDxf`
> (`src/engine/floorplan-import.js:232`) and `buildingFromDxf` (`:529`) genuinely parse DXF ENTITIES
> and are unit-tested, but `src/api/server.js` line 22 imports only
> `{floorPlanFromSvg, normalizeFloorPlan, buildingFromSvg}` — **no endpoint or UI feeds a `.dxf` into
> `buildCadModel`** (even `/api/projects/:name/cad.dxf` consumes `req.body.svg`, `server.js:752`).
> Also: the **live viewer's heads/drops are plain Three `InstancedMesh`/`SphereGeometry`/`CylinderGeometry`**
> (`autosprink.html:242-269`) — only the structural walls/mains/branches/riser/columns are kernel-backed;
> the full kernel model (incl. heads/drops) is rebuilt only at export time. (See §4 d1.)

### 2.2 NFPA-13 spacing + schedule pipe sizing + hydraulic check

- **NFPA-13 spacing:** `HAZARD_RULES` (light 225 sqft/15 ft, ordinary 130/15, extra 100/12, min 6 ft)
  at `src/engine/sprinkler-layout.js:19-23`; `layoutRoom` (`:100-128`) tightens the grid via `gridCounts`
  (`:77-88`) to keep spacing **and** coverage within hazard limits. Independently re-checked by
  `checkCompliance` (`src/engine/nfpa-compliance.js:213-252`).
- **Schedule pipe sizing:** `sizePipe` + `SCHEDULE` table at `src/engine/cad-model.js:42-46, 26-39`
  (smallest steel pipe serving N sprinklers per hazard); consumed by `buildRoomCad`
  (`cad-model.js:105,123`) and `system-layout.js:113,134,224`.
- **Hydraulic check (two layers):**
  - Single-path estimate: `requiredPressureAtRiser` (`src/engine/hydraulics.js:103-186`) using
    Hazen-Williams (`:29-35`), velocity (`:43-46`), remote-area demand (`:62-70`), plus `flagSchedule`
    warnings (`:200-230`).
  - Full network balance: `balanceNetwork` (`src/engine/hydraulic-network.js:79-215`) doing K-factor head
    discharge `Q=K√P` (`:42-47`) with node-by-node flow/pressure accumulation over the remote branch.
- **Wired into bid response:** `runSprinklerPipeline` (`src/api/server.js:589-696`) calls
  `generateSprinklerBid` (`:622`), `requiredPressureAtRiser`+`flagSchedule` (`:652-656`), `balanceNetwork`
  (`:674`), `checkCompliance` (`:690`), returning `{ bid, scene, cadModel, hydraulics, hydraulicNetwork,
  compliance }` from `POST .../sprinkler-bid` (`:700`) and `/submittal` (`:715`).
- **Tests:** `hydraulic-network` + `hydraulics` (21) + `nfpa-compliance` (11) + `sprinkler-layout` (13)
  + `cad-model` (11) all pass; Hazen-Williams validated to 7 decimals (`tests/hydraulics.test.js:13-26`).

> Honest limit: hydraulic check is a **single representative remote-path estimate**, NOT a sealed
> Hardy-Cross loop solve. On the **building/multi-space input path** `cadModel` exposes no `rooms[].network`,
> so both `hydraulics` and `hydraulicNetwork` return `{ error: ... }` and the check silently degrades
> (`server.js:663-677`). Full check executes only on the floorPlan/legacy path.

### 2.3 NFPA-13 geometric compliance

- `checkCompliance` (`src/engine/nfpa-compliance.js:213-252`) re-derives max-coverage, max/min spacing,
  max-distance-to-wall, and max-heads-per-system findings from actual head positions. A `warn`
  `NFPA13_REVIEW_NOTE` is **always** appended (`:244-246`) plus `NFPA_NOTE` ("NOT AHJ approval, NOT a
  PE/professional review, NOT permit-ready", `:39`). `compliance.passed:true` is a **geometric** pass only.
- Surfaced in studio Compliance panel (`autosprink.html:492-497`). Tests: `nfpa-compliance` (11).

### 2.4 CAD interchange export — DXF (verified) + STEP/IFC/STL (wired, runtime-untested)

- **DXF (first-party, deterministic, tested):** `toDxf(cadModel)` emits AutoCAD R12 ASCII
  (`src/engine/dxf-export.js:44` — HEADER `$ACADVER=AC1009`, TABLES with 12 layers, ENTITIES
  LINE/CIRCLE/TEXT, EOF). Route `POST /api/projects/:name/cad.dxf` (`src/api/server.js:747`) calls
  `toDxf(buildCadModel(floorPlan))` and streams `application/dxf` (`:759-762`). UI `dxfBtn`
  (`autosprink.html:533-541`) downloads `halofire-cad.dxf`. Asserted by `cad-model.test.js:76` and
  `building-cad.test.js:157`.
- **STEP / IFC / STL (real WASM kernel bindings, wired):** `exportCad(format)` (`autosprink.html:383-389`)
  builds an `OGSceneManager` scene (`buildExportScene`, `:357`) and calls
  `exportCurrentSceneToStep()` / `...ToIfc()` / `...ToStl()`; buttons `stepBtn/ifcBtn/stlBtn`
  (`autosprink.html:542-554`) write real bytes/text and report size. These are genuine non-stub bindings
  in the vendored kernel (`node_modules/opengeometry/index.js:4460/4505/4415`, forwarding to WASM),
  symbols present in `opengeometry_bg.wasm.d.ts:356/359/362`.

> Honest limit: **STEP/IFC/STL have ZERO automated test coverage in-repo** and were NOT exercised at
> runtime by this review — only the call chain and library bindings were confirmed real. The lone STL
> test (`openscad-generators.test.js:158`) covers a different path (`renderScadToStl` via an OpenSCAD
> binary). **Treat DXF as verified; STEP/IFC/STL as best-effort / runtime-unverified.** (See §4 d3.)

### 2.5 Bid pricing from ingested real pricebooks (bare materials only)

- **Real vendor pricebooks ingested:** `pricebook-importer.js:188-190` reads ARGCO (>2000 rows),
  Victaulic (>1000), FFF (>1000) from actual `.xlsx` files on disk; `pricebook-importer.test.js` (2)
  passes with source_file/sheet/row provenance and specific SKU assertions (e.g. ARGCO `7010802` @ $3.56).
- **Bare-materials BOM priced from real rows:** `buildResolverFromDb` (`pricebook-pricing.js:49-65`)
  queries the SQLite `pricebook` table, band-filters + medians real rows; `priceBid`
  (`sprinkler-layout.js:195-204`) flags `pricebook` vs fallback. Wired live: `buildResolverFromDb(db)`
  (`server.js:618`) → `generateSprinklerBid` (`:622`) → `POST .../sprinkler-bid` (`:700`). BOM keys
  (sprinkler_head, branch_pipe, fitting, hanger, escutcheon — `sprinkler-layout.js:169-173`) all have
  matching `PRICE_BANDS` (`pricebook-pricing.js:13-19`).
- **Home Depot Rexburg real bid total ingested as a fact:** `home-depot-bid-package.js:68-115` reads the
  actual proposal workbook + bid log (`bidLogAmount $792,543.84`, 858 heads, 121,500 sqft);
  `bid-package.test.js` (2) passes.
- **Tests:** `pricebook-importer` + `pricebook-pricing` (6) + `bid-package` + `bid-scope` (11) pass.

> Honest limit: this is **bare-materials pricing only, NOT a full priced bid** (see §4 d4). System
> components and soft costs are hardcoded/percentage estimates and `buildFullScopeBid` is **not wired**
> into any endpoint.

### 2.6 Studio + Settings + Workbench surfaces; evidence gates; resolve workflow; doc upload; submittal

- **Studio (`autosprink.html`):** single-page generate → render → panels. `genBtn` (`:519`) → `generate()`
  (`:441`) → `POST .../sprinkler-bid` (`:449`) → renders `cadModel` into Three.js + OpenGeometry WASM scene
  (`initStudio` `:186`, `OpenGeometry.create` with `/vendor/opengeometry/opengeometry_bg.wasm` `:203`).
  Panels: Layout (`:454`), Pipe Schedule (`:464`), Hydraulics single-path + network (`:481`), Compliance
  (`:492`), Auto Bid + BOM (`:502-507`), Submittal download (`submitBtn :520`), CAD export DXF/STEP/IFC/STL
  (`:533-554`).
- **Settings / parity / component library (`settings.html`):** `loadParity` (`:82-89`) surfaces the
  **BLOCKED** AutoSprink parity gate; `loadLibrary` (`:116-135`) reports all components "no model".
  Backed by `/api/parity` (`server.js:872-911`) and `/api/settings/{documents,dependencies}`
  (`server.js:798/817/855`).
- **Workbench (`workbench.html`):** banner "NOT AHJ-approved · NOT PE-reviewed · NOT AutoSprink-parity ·
  NOT fabrication-ready" (`:59`).
- **Evidence/claim gates + resolve workflow:** seed creates 5 fail-closed claim gates + 5 evidence rows;
  resolve-gate API rejects `best_effort`/AI evidence (tests `resolve-gate` (5), `evidence-gates` (4),
  `api-security` (6) pass). `best_effort_ai_layout` recorded as **evidence, not a clearance**
  (`server.js:628-638`).
- **Settings document upload:** GET/POST `/api/settings/documents` (`server.js:798/817`); test
  `settings-documents` (varies) passes.
- **Downloadable submittal:** `submittalReady` hardcoded `false` (`submittal.js:175`); `AUTOSPRINK_PARITY`
  pushed as a blocked gate (`submittal.js:151-157`); honesty flags `stamped/ahjApproved/peReviewed/
  permitReady` all false. Studio disclaimer at `autosprink.html:139`. Tests: `submittal` (16),
  `p7-studio-surface` pass.
- **OpenClaw / SAM / OpenSCAD component scaffolding:** tests `openclaw-cad` (13), `sam-reconstruct` (10),
  `openscad-generators` (23), `model-pipeline` (10), `model-resolver` (11), `supports` (13),
  `system-layout` (5) pass — scaffolding exists at the engine level (component models themselves are
  unattached, see §3).

---

## 3. Still NOT done / NOT claimed (fail-closed)

- **AutoSprink / AutoCAD parity — BLOCKED.** `/api/parity` builds inventory from an **empty** model map
  (`buildParityInventory({})`); `registry.js` `COMPONENTS` has `required:true` items (drain_main,
  inspector_test, identification_sign) → `requiredMissing>0` → `parityComplete=false` → gate status
  `blocked` (`registry.js:238`). `AUTOSPRINK_PARITY_INCOMPLETE` stays blocked; `parityAchieved` stays
  false (`parity-matrix.js:240`). Enforced by `parity-matrix.test.js`.
- **AHJ approval — BLOCKED / not claimed.** Gate fail-closed (`server.js:768-783`).
- **PE review / stamp — BLOCKED / not claimed.** No Hardy-Cross / sealed PE calc; explicitly disclaimed
  (`hydraulics.js:13-16`, `hydraulic-network.js:14-19`).
- **Permit-ready — NOT claimed.** `permitReady:false` in submittal header.
- **Fabrication-ready — NOT claimed.** Workbench/studio banners disclaim it.
- **Manufacturer-exact models — NOT claimed.** Component library reports **0/34 real models** — every
  component "no model" (`settings.html:120-134`); models unattached.
- **PDF-drawing import — deferred** (`parity-matrix.js` `drawing_import` note).
- **DXF → 3D through the running system — NOT available** (engine library only; no endpoint/UI wires
  `floorPlanFromDxf`/`buildingFromDxf`).
- **Full-scope priced bid — NOT produced by the live system** (`buildFullScopeBid` unwired; system
  components + soft costs are fallback constants / percentage assumptions).
- **STEP/IFC/STL valid-file output — runtime-unverified** (wired + library-backed, no test, not exercised).
- **Public HTTPS at `halofire.rankempire.io` — pending** user DNS + certbot; DEPLOY.md documents a
  **local** run path only (no production/VPS runbook).
- **No live browser/WebGL render evidence** was produced in this review (per RankEmpire rule:
  build/test passing ≠ UI works). End-to-end confidence rests on source wiring + 320 passing tests
  (incl. a spawned-server integration test), not a visual screenshot.

### 3b. Overclaim-risk flags from DoD verdicts (record for follow-up — code NOT changed here)

- **d1 (3D from plan):** MODERATE risk in *framing only*. Saying "DXF works" or "everything is
  kernel-rendered" would overclaim — DXF is unreachable through the running system, and the live
  viewer's heads/drops are plain Three instancing. The **code itself does not overclaim** (consistent
  disclaimers, fail-closed gates). Follow-up: wire a DXF import endpoint/UI or scope the criterion to SVG.
- **d4 (bid pricebooks):** HIGH risk in the **DoD wording**, LOW in code. "Full bid scope priced from
  real pricebooks (approaching real bid totals)" overstates reality — only bare materials are
  pricebook-priced, `buildFullScopeBid` is unwired, and there is no calibration against the $792,543.84
  Home Depot figure. Code uses explicit `priceSource:'fallback_estimate'` / `FULL_SCOPE_DISCLAIMER`.
  Follow-up: wire full-scope builder + add pricebook bands for system components, or reword the DoD.
- **d3 (CAD export):** LOW. Residual risk only if a reader treats "STEP/IFC/STL works" as
  runtime-verified — it is not. Follow-up: add a headless WASM export test.
- **d6 (verifier/packet):** the prior packets overclaim in the **safe direction** (understate progress:
  list P1–P7 / T8 / T9 as "not done" when committed). This refreshed packet corrects that.
- **Pre-existing honest caveats that remain valid:** hazard class is UNVERIFIED; the Home Depot floor
  plan is a simplified rectangle (`floorplans.js:13,21`); landing-page hero stats (47 projects / $4.2M /
  98%) are hardcoded placeholders. None are regulated overclaims, but none should be presented as real
  client metrics.

---

## 4. Definition-of-Done — 7 criteria → verdict map

| # | Criterion | Verdict | One-line evidence |
|---|-----------|---------|-------------------|
| d1 | 3D from plan (SVG/DXF → shell + sprinklers via OpenGeometry) | **NOT satisfied** | SVG path live end-to-end and kernel-backed for structural solids (`server.js:595/604/700`, `autosprink.html:310-335`), but DXF import is engine-only/unwired (`server.js:22`) and live heads/drops are plain Three instancing (`autosprink.html:242-269`). |
| d2 | Engineering-correct layout (NFPA-13 spacing + schedule sizing + hydraulic check) | **Satisfied (best-effort)** | All three exist, tested, wired into bid response (`sprinkler-layout.js:19-23`, `cad-model.js:42-46`, `hydraulics.js:103-186` + `hydraulic-network.js:79-215`, `server.js:589-696`); single-path estimate, not Hardy-Cross. |
| d3 | CAD export (DXF AND STEP/IFC/STL) | **Satisfied** | All four paths wired (`dxf-export.js:44`+`server.js:747`; `autosprink.html:383-389/542-554` → real WASM bindings). DXF verified by tests; STEP/IFC/STL runtime-unverified. |
| d4 | Full bid scope priced from real pricebooks (approaching real totals) | **NOT satisfied** | Bare materials priced from real pricebooks (`pricebook-pricing.js`+`server.js:618`), but full-scope builder unwired (`bid-scope.js`), system components/soft costs are fallback constants, no calibration to $792,543.84. |
| d5 | Studio usable end-to-end; evidence gates surfaced; nothing faked | **Satisfied** | Studio drives real backend pipeline + panels (`autosprink.html:441-554`, `server.js:589-911`); regulated gates fail-closed BLOCKED and tested (45 tests across studio/parity/submittal/settings/nfpa suites). |
| d6 | One-command verifier green; review packet current | **Satisfied (this packet)** | Verifier `scripts/verify-internal-alpha.ps1` runs full suite green (34 files / 320 tests); prior packets were stale (17/131, 9/41) — this refreshed packet makes it current. |
| d7 | Deployable (documented run/build path) | **Satisfied (local)** | `docs/DEPLOY.md` documents env vars, `npm install`, `node src/db/seed.js`, `node src/api/server.js`, entry points; verified run boots + serves `/`, `/workbench.html`, `/autosprink.html`, `/api/health` → 200. Local run path only; no production/VPS runbook. |

**Score: 4 of 7 satisfied (d2, d3, d5, d7) + d6 satisfied by this refresh; d1 and d4 NOT satisfied.**

---

## 5. Bottom line

The engine is real and honest: SVG → OpenGeometry 3D building + sprinkler network, NFPA-13 geometric
spacing, schedule pipe sizing, single-path + full-network hydraulic estimates, geometric compliance, and
DXF export are all wired and tested (34 files / 320 tests green). Every regulated capability — AutoSprink
parity, AHJ, PE, permit, fabrication, manufacturer-exact — stays **fail-closed BLOCKED** and is correctly
never claimed. The two genuine gaps versus the DoD wording are **d1** (DXF path engine-only, not reachable
through the running system) and **d4** (only bare materials are pricebook-priced; "full scope" and
"approaching real totals" are not produced by the live system). STEP/IFC/STL are wired but
runtime-unverified, and no live-browser render evidence was captured.
