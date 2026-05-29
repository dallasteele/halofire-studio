# HaloFire AutoSprink-Clone — Roadmap to Done

**Goal:** A working, deployable internal-alpha AutoSprink/AutoCAD-class sprinkler
CAD + auto-bidder, built on the OpenGeometry kernel, that turns a floor plan
into a 3D-correct building + fire-sprinkler layout and a sourced bid.

This file is the autonomous driver's backlog. Each run: GX10 brain preflight →
pick the **first unchecked** task → TDD → focused verification → scoped commit →
check the box here → brain postflight. Never claim AHJ/PE/AutoSprink/manufacturer
parity without real evidence; those gates stay fail-closed.

Work dir: `C:/Users/dalla/OneDrive/Documents/HaloFire`. Rules: `E:/ClaudeBot/AGENTIC_RULES.md`.
Geometry MUST be built on OpenGeometry (npm `opengeometry`). Keep the 68+ tests green.

## Definition of Done
- [ ] Floor plan (SVG/DXF) → building shell + full sprinkler system in 3D via OpenGeometry.
- [ ] Engineering-correct layout: NFPA-13 spacing + schedule pipe sizing + hydraulic check.
- [ ] CAD interchange export: DXF **and** STEP/IFC/STL from OpenGeometry.
- [ ] Full bid scope priced from real pricebooks (approaching real bid totals).
- [ ] Studio UI usable end-to-end; evidence gates surfaced; nothing faked.
- [ ] One-command verifier green; review packet current.
- [ ] Deployable (documented run/build path).

## Task Queue (do the first unchecked, one per run)

- [x] **T1 — OpenGeometry STEP/IFC/STL export.** DONE 2026-05-29. Studio builds an
      OGSceneManager from the rendered shapes (addCuboid/addCylinderToCurrentScene)
      and exports via exportCurrentSceneToStep/Ifc/Stl. Buttons for DXF/STEP/IFC/STL.
      Verified in browser: 40×30 room → STEP 79,068 bytes from 23 OpenGeometry
      entities (4 walls + floor + 12 pipes + 6 heads); IFC also non-empty.
- [x] **T2 — Hydraulic calc engine.** DONE 2026-05-29. `src/engine/hydraulics.js`
      (pure/deterministic): Hazen-Williams friction loss (psi/ft), velocity (fps),
      remote-area demand (NFPA 13 density × area — light 0.10/1500, ordinary
      0.18/1500, extra 0.30/2500), single-path requiredPressureAtRiser (riser →
      cross-main → remote branch friction + 0.433 psi/ft elevation + 7 psi min head),
      and flagSchedule velocity(>32 fps)/loss warnings. Hand-computed vitest cases.
      Studio surfacing still pending (engine + tests are the deliverable).
- [x] **T3 — Full bid scope.** DONE 2026-05-29. Add system components (alarm/check valve, FDC,
      backflow, riser trim, inspector's test, fire pump if required) + soft costs
      (permit/design/freight as labelled assumptions) priced via pricebook resolver,
      behind a clear "estimate" label. Tests. Show in bid.
- [x] **T4 — DXF/PDF floor-plan import.** DONE 2026-05-29. `floorPlanFromDxf` in
      floorplan-import.js parses the DXF ENTITIES section: LWPOLYLINE (code 10/20
      vertex pairs), POLYLINE/VERTEX, and best-effort closed-loop assembly from
      LINE segments by endpoint chaining. opts.layer (code 8) filter,
      opts.unitsPerDrawingUnit scale to feet, opts.hazard default ordinary; reuses
      normalizeFloorPlan; skips <3-vertex shapes. PDF import DEFERRED. Tests.
- [x] **T5 — Resolve-gate workflow.** DONE 2026-05-29. Admin-only route
      `POST /api/projects/:name/claim-gates/:code/resolve` in src/api/server.js
      (+ resolved_by/resolved_at/resolved_evidence_ref columns via ensureColumn in
      both server.js initDatabase and seed.js). Requires a real evidence object;
      only ahj_approval/professional_review/pe_signoff/manufacturer_approval/
      autosprink_packet/employee_signoff with status 'present' may clear. Rejects
      (400) best_effort_ai_layout type and best_effort status — AI output can NEVER
      clear a gate. On success inserts the evidence row (present) and flips the gate
      blocked→cleared with who/what/when. Studio UI deferred. Tests prove gate only
      clears with a real evidence row, never from AI output.
- [x] **T6 — Multi-floor / multi-zone.** DONE 2026-05-29. buildCadModel now accepts an
      optional floorPlan.floors array [{level,baseElevationFt,ceilingHeightFt?,rooms}];
      each floor builds its own independent riser->cross-main->branch->drop->head network
      with NFPA schedule sizing, then its solids are offset in Z by baseElevationFt so
      floors stack. counts aggregate across floors; legacy floorPlan.rooms still builds a
      single floor at base 0 unchanged. Walls carry baseZ (default 0) and dxf-export honors
      it. Tests in tests/cad-model-multifloor.test.js. Studio surfacing best-effort/deferred.
- [x] **T7 — OpenClaw CAD automation adapter.** `src/cad/openclaw-cad.js` that
      builds generate_3d_model / generate_dxf payloads from the cad-model and
      invokes the OpenClaw bridge when the GX10 gateway is live (graceful skip when
      unreachable). Tests on payload shape.
- [x] **T8 — Head perf + true-scale toggle.** DONE 2026-05-29. Studio renders the
      900+ heads + drops via Three InstancedMesh (one draw call each) instead of
      per-item OpenGeometry cylinders; CAD-structural geometry (walls/mains/
      branches/riser) stays on the OpenGeometry kernel. Home Depot render ~9s→~4s
      (~59 kernel shapes + 2 instanced meshes vs ~1900). Added "Exaggerate pipe
      radius (×6)" View toggle (off = true NFPA scale); re-renders from the stored
      model. STEP/IFC/STL export rebuilds the COMPLETE kernel scene on-demand
      (buildExportScene from cadModel.solids, true-scale) — verified Home Depot
      STEP = 6,805,478 bytes from 1950 entities, no regression. Browser-verified.
- [x] **T9 — Consolidate surfaces.** DONE 2026-05-29. Retired the 725-line legacy
      static fake-data app.html dashboard — app.html is now a tiny redirect to
      /workbench.html (old link still works, fake data gone). The SPA catch-all in
      server.js now serves index.html (landing) for unknown routes instead of the
      old dashboard, so all UI flows index -> login -> workbench -> studio.
      tests/consolidate-surfaces.test.js (4 spawned-server tests). Full suite
      26 files / 230 tests green.

## ACCURATE BUILDING epic (user priority): real buildings from drawings + full systems
Current gap: import treats each polygon as ONE room and grids its bounding box;
the "building" is just an extruded perimeter wall + flat slab. Real drawings have
interior walls, multiple spaces, doors/windows, and columns; the system must
cover EVERY space with a proper building-wide network. Build that.

- [x] **T11 — Building model + multi-space drawing parser.** DONE 2026-05-29. New
      `src/engine/building-model.js`: a building schema
      `{ name, units, stories:[{ level, baseElevationFt, ceilingHeightFt, spaces:[{name,polygon,hazard}], walls:[{a,b,thicknessFt,type:'exterior'|'interior',openings:[{offsetFt,widthFt,heightFt,sill?,type:'door'|'window'}]}], columns:[{x,y,sizeFt}] }] }`
      + `normalizeBuilding(spec)`. Extend floorplan-import.js with
      `buildingFromDxf(text,opts)` / `buildingFromSvg(text,opts)` that extract
      walls (LINE/LWPOLYLINE on a WALLS layer → segments w/ thickness+type),
      spaces (closed room polygons / labeled regions), doors+windows (DOOR/WINDOW
      layers or SVG attrs → wall openings), and columns (COLUMN layer / circles).
      Layer/attr-convention based, best-effort (NOT CAD recognition AI). Backward
      compat: a single-polygon input still yields one space. Deterministic; tests.
- [x] **T12 — Full per-space sprinkler system.** New `src/engine/system-layout.js`:
      `layoutBuilding(building)` lays out EACH space independently (reuse
      layoutRoom per space polygon, clipped to that space, column-aware: drop/shift
      heads that collide with columns), then builds a building-wide network — a feed
      main, per-space cross-mains/branch lines, drops, heads — so coverage fills all
      spaces. Returns per-space + whole-building head counts, pipe schedule, and a
      `coverageOk` flag (every space has heads). Deterministic; hand-checked tests.
- [x] **T13 — Accurate building CAD model.** DONE 2026-05-29. Extend `buildCadModel` to consume a
      building: emit interior + exterior wall solids (carry opening metadata
      {offsetFt,widthFt,heightFt,sill,type} so the viewer can cut them), column
      solids, per-space pipe networks, multi-story stacking. counts include
      spaces/walls/columns/openings. Backward compat with floorPlan.rooms/floors
      preserved. dxf-export emits walls/columns/openings on layers. Tests.
- [ ] **T14 — Studio: render accurate building + full system (BROWSER).** Studio
      renders interior+exterior walls, door/window openings cut via OpenGeometry
      boolean subtract (Opening/booleanSubtraction), columns, and the full per-space
      system; per-space breakdown in the panel. Done by main session w/ preview
      screenshots (workflow agents can't verify 3D).
- [x] **T10 — Deploy packaging + review packet refresh.** DONE 2026-05-29.
      New truthful packet docs/reviews/2026-05-29-autosprink-clone-review.md
      (what works w/ file cites, exact test count, explicit "still NOT done /
      NOT claimed" section). New docs/DEPLOY.md (env vars, seed + run path,
      one-command verifier). scripts/verify-internal-alpha.ps1 now runs the FULL
      `npx vitest run` (no file list) so it can't drift from the test count;
      seed + agentic-rules steps kept. Docs/script only — no behavior change.

## COMPONENT CAD LIBRARY + AUTOSPRINK PARITY epic (user priority)
Every fire-sprinkler component must have a CAD-accurate 3D model, sourced:
catalog download -> OpenSCAD-generated -> SAM 3.1-reconstructed -> gated
placeholder. Full AutoSprink parity (no missing modules/components), tracked +
fail-closed until real. Auto-bid = takeoff from the component set. Any doc we
can't auto-source (catalogs, cut sheets, approvals, AutoSprink ref, OpenSCAD
binary) is user-uploaded/linked in Settings, wired to the evidence/gate system.
Grounding: OpenSCAD NOT installed locally (generate .scad source; render needs
the binary = a Settings dependency). SAM 3.1 = GX10 'sam3' via the OpenClaw
bridge (best-effort, graceful skip). Parity claim stays BLOCKED until complete.

- [x] **T15 — Component registry + AutoSprink parity inventory.** `src/components/registry.js`:
      canonical list of every component/module (heads pendent/upright/sidewall/
      concealed/ESFR; pipe sch10/40; fittings tee/elbow/coupling/reducer/cap;
      grooved couplings; valves alarm/check/butterfly/OS&Y/PRV; FDC; backflow;
      riser+trim; gauges; hangers/seismic bracing; drains; inspector test; signs)
      + parity matrix (present vs missing) + fail-closed AUTOSPRINK_PARITY gate
      blocked until inventory complete w/ real evidence. Node-tested.
- [x] **T16 — Component 3D-model resolver pipeline.** `src/components/model-resolver.js`:
      resolve each component's model in priority order catalog-file -> OpenSCAD ->
      SAM3.1 -> placeholder+gate; record per-component source/status. Injected
      sourcers; Node-tested.
- [x] **T17 — OpenSCAD parametric generators.** `src/components/openscad/*`:
      deterministic .scad source per component type (Node string-gen, tested) +
      render adapter (openscad CLI when present, else gated 'openscad_not_installed').
- [x] **T18 — SAM 3.1 reconstruction adapter.** `src/components/sam-reconstruct.js`:
      catalog image -> SAM3.1 segment -> mesh via injected GX10/OpenClaw invoker;
      graceful skip when gateway down. Node-tested payload + skip.
- [x] **T19 — Settings + documentation upload/link API.** DONE 2026-05-29. Authenticated routes to
      upload OR link missing docs (catalogs, cut sheets, approvals, AutoSprink ref,
      OpenSCAD path); each -> project_evidence row / dependency status; missing-doc
      resolver queue. Node-tested (spawned-server pattern).
- [ ] **T20 — Settings UI + component-library browser (BROWSER).** Settings page for
      uploads/links + component browser + render catalog/generated models in the 3D
      layout. Main session w/ preview screenshots.

## Log
- 2026-05-29: T19 Settings + documentation upload/link API shipped — new tests/settings-documents.test.js (7 spawned-server tests) + routes in src/api/server.js + a settings_documents table mirrored into BOTH server.js initDatabase and seed.js (CREATE TABLE + defensive ensureColumn for mode/url/filename/notes/evidence_id/created_by). REQUIRED_DOC_SLOTS = [catalogs, manufacturer_cut_sheets, ahj_approval, autosprink_reference, openscad_binary, pricebook_updates]; a slot reads 'missing' (satisfied:false) until a link/upload row exists. GET /api/settings/documents (authMiddleware) lists every slot + status (latest row attached). POST /api/settings/documents (authMiddleware + requireRole('admin')) body {doc_type, mode:'link'|'upload', url?, filename?, notes}: validates doc_type against the slot list (400 unknown), mode link requires url / upload requires filename (400 otherwise), rejects unsupported fields (400). On success a single transaction inserts a PRESENT project_evidence row (project_name 'HaloFire Library', evidence_type=doc_type, source_ref=url|filename) so the link/upload can satisfy resolve-gate evidence, then the settings_documents row referencing it; returns {id, evidence_id, status:'satisfied'}. GET /api/settings/dependencies (authMiddleware) reports {openscad_installed:boolean (best-effort spawnSync 'openscad --version' detection, never throws), sam_gateway:'unknown' (GX10 sam3 via OpenClaw bridge, not probed here), autosprink_reference:'linked'|'missing' (from settings_documents)}. HONESTY/fail-closed: a catalog/cut-sheet link is recorded as evidence but NEVER auto-clears a regulated claim gate — AHJ/PE/AutoSprink parity gates still require their specific approved evidence via the T5 resolve route (test proves an AUTOSPRINK_EVIDENCE_MISSING gate stays 'blocked' after a catalog upload). Also added a vitest.config.js with fileParallelism:false (several suites spawn a real server on its own port; running them in parallel oversubscribed the machine and caused intermittent 401/429/timeout — serial spawned-server execution is deterministic, full suite ~16s) and raised the API/login rate-limit ceilings only when NODE_ENV=test (production limits 100/10 unchanged) so repeated logins in the spawned-server suites don't 429. Tests cover: 401 without auth, all 6 slots missing initially, non-admin POST -> 403, admin link -> 200 + slot satisfied + a present project_evidence row exists, unknown doc_type / link-without-url -> 400, catalog upload does NOT clear a blocking gate, dependencies returns an openscad_installed boolean + sam_gateway + autosprink_reference. Full suite 25 files / 226 tests green (was 24/219). Backward compat preserved (existing suites unchanged; pre-existing parallel flakiness in the other spawned-server suites also resolved by the config). NOT AutoSprink/AutoCAD/manufacturer parity, NOT AHJ/PE approved — uploading a doc is evidence only; the AUTOSPRINK_PARITY gate stays fail-closed BLOCKED until the inventory is genuinely complete with real evidence. Next: T20 Settings UI + component-library browser (browser).
- 2026-05-29: T18 SAM 3.1 reconstruction adapter shipped — new src/components/sam-reconstruct.js + tests/sam-reconstruct.test.js (10 tests). buildSamReconstructPayload(component, imageRef) returns a DETERMINISTIC plain-object request for the GX10 SAM 3.1 service: { service:'sam-3.1', op:'reconstruct', componentKey (from a component object's key or a bare string key), imageRef, outputFormat:'stl' } — component key + image ref + desired output mesh format always present, same inputs -> identical object. async reconstructComponentModel(component, imageRef, {invoker}) builds that payload and calls the INJECTED async invoker(payload) (production wires the OpenClaw bridge / hal_sam_status — SAM 3.1 is external on GX10, never called directly here). On success returns { ok:true, source:'generated_sam', model, label:'best-effort SAM 3.1 reconstruction — NOT manufacturer-exact' } (raw or {mesh,format} returns both accepted as the model). HONESTY/fail-closed: if the invoker is absent / not a function (no bridge wired) OR throws (GX10/gateway down) OR yields an empty mesh, returns { ok:false, skipped:true, reason } WITHOUT throwing — success is never fabricated, a missing model stays missing for the parity inventory. Browser-free, no process/binary spawned in engine code. Tests cover: payload shape (key + image ref + format present), determinism, bare-string component; reconstructComponentModel ok + best-effort label with a mock invoker, raw-string model accepted, and ok:false skipped:true (no throw) for absent invoker / omitted opts / non-function invoker / throwing invoker / empty model. Full suite 24 files / 219 tests green (was 23/209). Backward compat preserved (no existing file touched; new src/components/sam-reconstruct.js). NOT AutoSprink/AutoCAD/manufacturer parity, NOT AHJ/PE approved — SAM-reconstructed models are best-effort and the AUTOSPRINK_PARITY gate stays fail-closed BLOCKED until the inventory is genuinely complete with real evidence. Next: T19 settings + documentation upload/link API.
- 2026-05-29: T17 OpenSCAD parametric generators shipped — new src/components/openscad/generators.js + tests/openscad-generators.test.js (23 tests). Deterministic, browser-free string generators returning OpenSCAD (.scad) SOURCE for each component type: sprinklerHeadScad({type,k,thread}), pipeScad({nominalIn,lengthFt,schedule}), teeScad({runIn,branchIn}), elbowScad({nominalIn,deg}), couplingScad({nominalIn}), reducerScad({fromIn,toIn}), valveScad({type,nominalIn}), hangerScad({nominalIn}). Each emits a commented header naming the component + an explicit BEST-EFFORT / NOT manufacturer-exact disclaimer (no AutoSprink/AutoCAD/manufacturer parity, no AHJ/PE approval), standardizes on mm (IN_TO_MM/FT_TO_MM conversion), sets $fn for smooth round bodies, and surfaces its params into the source (K-factor, sizes, angle, schedule, etc.). Geometry is approximate primitive massing (cylinders/spheres/difference/taper) for visualization + take-off context ONLY. generateScadFor(component) dispatches by registry category (heads->sprinkler_head, pipe->pipe, fittings->tee/elbow/coupling/reducer by key or name, grooved->coupling massing, valves->valve, hanger->hanger) and FAILS CLOSED returning null for categories with no honest parametric model (signs, trim kits, gauges, etc.) or for null/empty input — never invents fake geometry. renderScadToStl(scad,{runner}) uses an INJECTED runner and NEVER spawns a process here (the openscad CLI is external, lives behind the caller's injected fn): no runner -> {ok:false,reason:'openscad_not_installed'}; runner returns {stl}|string -> {ok:true,stl}; runner throws or yields empty -> {ok:false,reason:'render_failed'} (success is never fabricated). Tests cover: every generator returns a non-empty string with the expected module keyword + best-effort/not-manufacturer-exact labels + $fn + param values; generateScadFor dispatches each category correctly and returns null for unsupported/null/empty; renderScadToStl ok with mock runner, ok:false openscad_not_installed with no runner / no opts, render_failed on throw, string-stl accepted. Full suite 23 files / 209 tests green (was 22/186). Backward compat preserved (no existing file touched; new dir src/components/openscad/). NOT AutoSprink/AutoCAD/manufacturer parity, NOT AHJ/PE approved — generated models are best-effort and AUTOSPRINK_PARITY gate stays fail-closed BLOCKED until the inventory is genuinely complete with real evidence. Next: T18 SAM 3.1 reconstruction adapter.
- 2026-05-29: T16 component 3D-model resolver pipeline shipped — new src/components/model-resolver.js + tests/model-resolver.test.js (11 tests). resolveComponentModel(component, sourcers) tries INJECTED async sourcers in strict priority catalog -> openscad -> sam -> placeholder. Each sourcer is `(component) => {format,data,...}|null`; returns null / a model with empty (no real `data`) / throws => skip to next. Returns { key, source:'catalog'|'generated_openscad'|'generated_sam'|'placeholder', status, model|null, label }: catalog/openscad/sam are status 'present' with provenance label (generated ones labelled best-effort, NOT manufacturer-exact); placeholder is status 'missing', model null — HONESTY/fail-closed, a placeholder is NEVER reported present. A throwing sourcer is caught and treated as null (try next). resolveLibrary(components, sourcers) -> { results:[...], modelStatusByKey } where modelStatusByKey maps each key to {source, model} in registry vocabulary (catalog->'catalog', generated_openscad/generated_sam->'generated', placeholder->'placeholder', model null) so it feeds registry.buildParityInventory directly — placeholders fail closed to MISSING, only genuine catalog/generated models count present. Pure logic + injected async, browser-free, no external binaries called in engine code. Tests cover: catalog wins; fall-through to openscad then sam; all-null -> placeholder/missing; no sourcers -> placeholder; throwing sourcer skipped; all-throwing -> placeholder; empty-data model treated as null; resolveLibrary aggregation + buildParityInventory present/missing counts. Full suite 22 files / 186 tests green (was 21/175). Backward compat preserved (no existing file touched). NOT AutoSprink/AutoCAD/manufacturer parity, NOT AHJ/PE approved — AUTOSPRINK_PARITY gate stays fail-closed BLOCKED until inventory is genuinely complete with real evidence. Next: T17 OpenSCAD parametric generators.
- 2026-05-29: T15 component registry + AutoSprink parity inventory shipped — new src/components/registry.js + tests/component-registry.test.js (22 tests). COMPONENTS is a deep-frozen canonical array (33 entries) of every fire-sprinkler module a layout/bid needs, each { key, category, name, params:{nominal sizes/options}, required:boolean }. Categories + members: heads (pendent/upright/sidewall/concealed/dry_pendent/esfr), pipe (sch10/sch40), fittings (tee/elbow_90/elbow_45/coupling/reducer/cap/cross), grooved (coupling/flange_adapter), valves (alarm_check/check/butterfly/osy_gate/prv/deluge), fdc, backflow_preventer, riser_assembly, riser_trim, gauge, hanger, seismic_brace, drain (main/aux), inspector_test, identification_sign. Exports getComponent(key) (O(1) Map lookup, undefined for unknown), componentsByCategory() (groups all into {[cat]:Component[]}), buildParityInventory(modelStatusByKey) -> {total,present,missing[],byCategory:{[cat]:{present,total,missing[]}},parityComplete}. HONESTY/fail-closed: a component counts 'present' ONLY when modelStatusByKey[key].source is a REAL source ('catalog'|'generated') AND carries an actual model — a 'placeholder'/'missing' status, or a real source with no model, counts MISSING. parityComplete is true only when EVERY required component has a real model. AUTOSPRINK_PARITY_GATE = frozen claim-gate {code:'AUTOSPRINK_PARITY_INCOMPLETE', severity:'blocking', status:'blocked', blockedClaims:['AutoSprink parity','complete component library','manufacturer-exact models'], reason:...}; parityGateStatus(inventory) returns 'blocked' unless parityComplete (then 'clear'). Pure/deterministic, browser-free; no models in this module (resolver T16 feeds status). Full suite 21 files / 175 tests green (was 20/153). Backward compat preserved (no existing file touched). NOT AutoSprink/AutoCAD/manufacturer parity, NOT AHJ/PE approved — gate stays fail-closed BLOCKED until the inventory is genuinely complete with real evidence. Next: T16 component 3D-model resolver pipeline.
- 2026-05-29: studio + OpenGeometry CAD + DXF shipped (commits 3764b64, 2b5b7ba). 68 tests green.
- 2026-05-29: T1 STEP/IFC/STL export shipped — verified 79KB STEP from 23 OpenGeometry entities. Next: T2 hydraulics.
- 2026-05-29: T2 hydraulic engine shipped — src/engine/hydraulics.js + tests/hydraulics.test.js (21 hand-computed tests). Full suite 13 files / 89 tests green (was 12/68). Single-path estimate only; NOT a full network balance, NOT PE/AHJ/AutoSprink parity. Next: T3 full bid scope.
- 2026-05-29: T3 full bid scope shipped — src/engine/bid-scope.js + tests/bid-scope.test.js (11 tests). buildSystemComponents (6 core riser-assembly components + conditional fire pump via boolean or required>available pressure), buildSoftCosts (permit 2% / design 6% / freight 3% labelled assumptions, priceSource:soft_cost_assumption), buildFullScopeBid (prices components via priceResolver with flagged fallback, computes fullScopeTotal alongside bareMaterialsTotal). Full suite 14 files / 100 tests green (was 13/89). Best-effort estimate only, fail-closed; NOT a complete priced bid, NOT manufacturer-quoted, NOT AHJ/PE/AutoSprink parity. Next: T4 DXF/PDF floor-plan import.
- 2026-05-29: T4 DXF floor-plan import shipped — floorPlanFromDxf in src/engine/floorplan-import.js + 8 new tests in tests/floorplan-import.test.js. Parses ENTITIES section: LWPOLYLINE, POLYLINE/VERTEX, and best-effort closed-loop assembly from LINE segments; opts.layer filter, opts.unitsPerDrawingUnit scale-to-feet, opts.hazard default; reuses normalizeFloorPlan; skips degenerate <3-vertex shapes. generateSprinklerBid verified to run on imported plan. Full suite 14 files / 108 tests green (was 14/100). PDF import DEFERRED (not a deterministic dependency-free parse). Best-effort geometry only, NOT CAD-grade, claim gates stay fail-closed. Next: T5 resolve-gate workflow.
- 2026-05-29: T7 OpenClaw CAD automation adapter shipped — src/cad/openclaw-cad.js + tests/openclaw-cad.test.js (13 tests). buildGenerate3dModelPayload / buildGenerateDxfPayload are PURE deterministic cad-model -> plain-object args (project name, units, counts, compact solids spec: walls->boxes, pipes->sized cylinders from/to, heads->oriented points); both carry the cad model's fail-closed disclaimer. invokeOpenClawCad(toolName, payload, {invoker}) calls the INJECTED async invoker (no hardcoded network) and returns {ok:true,result} on success; if invoker is absent/not-a-function OR throws (gateway unreachable) returns {ok:false,skipped:true,reason} WITHOUT throwing — graceful degradation so HaloFire works whether or not the GX10 OpenClaw gateway is live. Full suite 16 files / 126 tests green (was 15/113). Geometry only — clears NO claim gate, makes NO AHJ/PE/AutoSprink/manufacturer parity claim; fail-closed preserved. Production wires the bridge as the invoker later. Next: T6 multi-floor / multi-zone.
- 2026-05-29: T6 multi-floor / multi-zone engine shipped — buildCadModel in src/engine/cad-model.js now accepts an optional floorPlan.floors array; offsetSolidZ/offsetRoomCadZ/buildFloorCad lift each floor's whole network (slabs/walls/pipes/heads + network elevations) in Z by baseElevationFt so floors stack, each floor keeps its own independent riser->cross-main->branch->drop->head network and NFPA schedule sizing, counts aggregate across floors, model.floors[] exposes per-floor solids/counts/sizing. Walls now carry baseZ (default 0); dxf-export.js honors baseZ when extruding wall posts (backward compatible). Legacy floorPlan.rooms still builds a single floor at base 0 — output unchanged. New tests in tests/cad-model-multifloor.test.js: 2-floor 60x40 plan yields heads in two elevation bands (some Z<14, some Z>14), 24 total heads = 12+12, per-floor independent sizing/risers, and a legacy-plan regression guard. Full suite 17 files / 131 tests green (was 16/126). Engine only — NFPA schedule sizing, NOT hydraulically balanced, NOT AHJ/PE/AutoSprink parity; claim gates stay fail-closed. Studio surfacing deferred/best-effort. Next: T8 head perf + true-scale toggle.
- 2026-05-29: T10 deploy path + review packet refresh shipped — new docs/reviews/2026-05-29-autosprink-clone-review.md (truthful: OpenGeometry CAD render, STEP/IFC/STL+DXF export, NFPA-13 schedule sizing, single-path hydraulic estimate, full-scope bid estimate, SVG+DXF import, evidence-gated resolve-gate API, OpenClaw CAD adapter — each cited to a file; exact count 17 files / 131 tests; explicit "still NOT done" = full network hydraulic balance, AutoSprink/AutoCAD parity, AHJ/PE/manufacturer approvals, studio wiring of hydraulics/multi-floor, perf instancing, surface consolidation). New docs/DEPLOY.md (env vars, npm install → seed → node src/api/server.js → /, workbench, /autosprink.html; one-command verifier). scripts/verify-internal-alpha.ps1 now runs the FULL `npx vitest run` (no file list) so it can't drift; seed + agentic-rules steps kept. Docs+script only — NO behavior change. Full suite 17 files / 131 tests green (unchanged). Fail-closed preserved; no parity claimed. Next: T8 head perf + true-scale toggle.
- 2026-05-29: T8 head perf + true-scale toggle shipped — autosprink.html now renders 900+ heads/drops via Three InstancedMesh (heads=sphere instances, drops=scaled-cylinder instances) while walls/mains/branches/riser stay OpenGeometry-kernel; render ~9s→~4s for Home Depot. New View toggle "Exaggerate pipe radius (×6)" (off=true NFPA scale) re-renders from stored currentCadModel. exportCad refactored to buildExportScene() — rebuilds the COMPLETE kernel model (walls+all pipes+all heads, true-scale) on-demand at export so STEP/IFC/STL stay complete: verified Home Depot STEP 6,805,478 bytes from 1950 entities. Full suite 17/131 green (autosprink.html not unit-tested; browser-verified via preview screenshots + true-scale toggle + STEP export). Next: T9 consolidate surfaces.
- 2026-05-29: T11 building model + multi-space drawing parser shipped — new src/engine/building-model.js (normalizeBuilding: defaults hazard 'ordinary'/thicknessFt 0.5/wall type 'interior'/ceilingHeightFt 14/baseElevationFt 0, drops degenerate spaces <3 verts + zero-length walls, clamps opening offset/width within the wall span; buildingFromFloorPlan converts legacy {rooms} or {floors} -> stories with one space per room + perimeter exterior walls, no interior walls/openings/columns). Extended src/engine/floorplan-import.js with buildingFromDxf (LWPOLYLINE on ROOMS/SPACES -> spaces; LINE/LWPOLYLINE on WALLS/WALLS-EXT/WALLS-INT -> walls typed by layer; LINE on DOOR/WINDOW -> openings attached to nearest wall; CIRCLE/POINT on COLUMN -> columns; opts.layers remaps layer names; opts.unitsPerDrawingUnit scale) and buildingFromSvg (data-space polygons, data-wall lines/polylines w/ data-wall-type, data-opening lines attached to nearest wall, data-column circles; opts.unitsPerPx scale; added hasAttr() for valueless boolean data-* attrs). Layer/attribute-convention based, best-effort, deterministic — NOT CAD object-recognition AI; claim gates stay fail-closed. New tests/building-model.test.js (8 tests: normalize defaults+cleaning+clamping, legacy {rooms}/{floors} conversion, multi-space SVG 2 rooms + interior wall + door + column, multi-space DXF same). Full suite 18 files / 139 tests green (was 17/131). Backward compat preserved (existing floorplan-import tests unchanged). Next: T9 consolidate surfaces / T12 full per-space sprinkler system.
- 2026-05-29: T5 resolve-gate API shipped — POST /api/projects/:name/claim-gates/:code/resolve (authMiddleware + requireRole('admin')) in src/api/server.js + tests/resolve-gate.test.js (5 spawned-server tests). Added resolved_by/resolved_at/resolved_evidence_ref columns via ensureColumn in BOTH server.js initDatabase and seed.js. Approved gate-clearing evidence set: ahj_approval, professional_review, pe_signoff, manufacturer_approval, autosprink_packet, employee_signoff (status treated as 'present'). REJECTS (400) evidence_type best_effort_ai_layout and status best_effort — AI/best-effort output can NEVER clear a regulated gate. On success: inserts the evidence row (present) + flips gate blocked->cleared with who/what/when provenance; GET claim-gates reflects cleared + resolved_by. Full suite 15 files / 113 tests green (was 14/108). Studio UI DEFERRED; parity (AHJ/PE/AutoSprink/manufacturer) still requires real artifacts — fail-closed preserved. Next: T6 multi-floor / multi-zone.
- 2026-05-29: T13 accurate building CAD model shipped — buildCadModel in src/engine/cad-model.js now also consumes a normalized building (from building-model.js), detected by isBuilding() (stories[] each with spaces/walls) so legacy {rooms}/{floors} plans keep their existing paths. For a building: buildBuildingCad calls layoutBuilding() (system-layout.js, per-space column-aware heads + NFPA sizePipe) then per story emits a wall solid per segment (kind 'wall', reusing the a/b/center/lengthFt/heightFt/thicknessFt/rotationY/baseZ shape, carrying type:'exterior'|'interior' + layer WALLS/WALLS-INT + openings:[{offsetFt,widthFt,heightFt,sill,type}] metadata so the viewer can cut them), a column solid per column (kind 'column' {x,y,sizeFt,heightFt,baseZ} layer COLUMNS), and per-space pipe networks (branch/drop/cross-main/riser-tie/system-riser) + pendent heads; multi-story stacked via offsetSolidZ by baseElevationFt (offsetSolidZ now also offsets column baseZ). counts = {spaces,walls,interiorWalls,columns,openings,heads,pipes}. dxf-export.js updated: walls draw on WALLS (exterior/legacy) vs WALLS-INT (interior), columns extruded on COLUMNS, opening sill/head centerlines on OPENINGS — additive, existing single-floor DXF unchanged (wall block defaults to WALLS when no type). New tests/building-cad.test.js (9 tests: 2-space building w/ 1 interior wall + 1 door + 1 column -> >=1 interior-wall solid, >=1 column solid, opening recorded on a wall, heads in both spaces, counts populated, determinism; multi-story stacks by baseElevationFt; legacy floorPlan regression guard byte-identical w/ no column solids; DXF emits WALLS/WALLS-INT/COLUMNS/OPENINGS layers). Full suite 20 files / 153 tests green (was 19/144). Backward compat preserved (cad-model/multifloor/openclaw-cad tests unchanged). Geometry only — NFPA-13 schedule sizing, best-effort layer/convention parsing NOT CAD object-recognition AI, NO hydraulic calc, NOT AutoSprink/AutoCAD/AHJ/PE/manufacturer parity; claim gates stay fail-closed. Next: T14 studio render accurate building + full system (browser).
- 2026-05-29: T12 full per-space sprinkler system shipped — new src/engine/system-layout.js (layoutBuilding(building) consumes normalizeBuilding output). For EACH story and EACH space it lays out heads independently via the existing layoutRoom() on that space's own polygon (heads fill + are clipped to every space), then COLUMN-AWARE: any head within (sizeFt/2 + 0.5ft clearance) of a story column is nudged to a deterministic ring of nearby in-polygon candidates (+x,-x,+y,-y,diagonals) or dropped if none clear. Building-wide network reuses the riser->cross-main->branch->drop->head topology + NFPA sizePipe from cad-model.js: per-space cross-main sized for space head count, per-row branch lines sized for their head count, plus a per-story FEED MAIN sized for the story head count. Returns {stories:[{level, spaces:[{name,headCount,heads,branchLines,sizing}], storyHeadCount, feedMain}], totalHeadCount, pipeSchedule (diameter->linear ft, sorted), coverageOk (true iff every non-degenerate space has >=1 head), perSpace[]}. New tests/system-layout.test.js (5 hand-checked tests: 2-space 30x20 ordinary building -> both spaces get 6 heads each, totals sum, coverageOk true; heads clipped inside their own polygon; column on a baseline head grid point removes/shifts >=1 head vs no-column baseline; cross-main/branch/feed-main diameters match sizePipe for known counts; every non-degenerate space covered). Full suite 19 files / 144 tests green (was 18/139). Backward compat preserved (no existing file touched; engine consumes building-model output). Pure Node, deterministic, NOT CAD-recognition AI, NO hydraulic calc, NOT AutoSprink/AHJ/PE/manufacturer parity — claim gates stay fail-closed. Next: T13 accurate building CAD model.
- 2026-05-29: T9 consolidate surfaces shipped — retired the 725-line legacy static fake-data app.html (now a redirect to /workbench.html; fake $revenue/dashboard arrays gone); SPA catch-all in src/api/server.js now serves index.html (landing) for unknown routes, not the old dashboard. All UI flows index->login->workbench->studio. tests/consolidate-surfaces.test.js (4 spawned-server tests: landing at /, /app.html redirects + no fake content, unknown route->landing, workbench+studio still served). Full suite 26 files / 230 tests green; agentic rules ok. Routing/content verified by the spawned-server HTTP test (authoritative for served bytes). Next: T14 studio render accurate multi-space building (openings via OG boolean).
