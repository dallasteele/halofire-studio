# HaloFire AutoSprink-Clone Review — 2026-05-29

Author: Claude (Opus 4.8).
Repo: `C:/Users/dalla/OneDrive/Documents/HaloFire` (branch `master`).
Roadmap: `docs/plans/autosprink-clone-roadmap.md`.
Prior packet: `docs/reviews/2026-05-29-internal-alpha-review.md` (superseded by this file).

This is a truthful status of a **best-effort internal-alpha** sprinkler CAD +
auto-bid + evidence workbench for Halo Fire staff. It is **not** AHJ-approved,
PE-reviewed, AutoSprink-parity, AutoCAD-parity, manufacturer-approved, or
fabrication-ready. The fail-closed claim gates enforce that, and the generated
geometry/bid carry their own disclaimer.

---

## What now works (verified by tests + cited files)

- **OpenGeometry CAD kernel rendering (studio).** `autosprink.html` builds an
  `OGSceneManager` from rendered shapes (walls/floor as cuboids, pipes as
  cylinders, heads as points) and renders the 3D building + sprinkler network.
  Geometry is produced by `src/engine/cad-model.js` (`buildCadModel`) and
  `src/engine/geometry.js`.

- **CAD interchange export.** From the same studio scene:
  - **STEP / IFC / STL** via OpenGeometry
    (`exportCurrentSceneToStep` / `…Ifc` / `…Stl` — see `autosprink.html`
    around the export dispatch at lines ~286–288).
  - **DXF** via `src/engine/dxf-export.js` (deterministic Node module; extrudes
    wall posts honoring `baseZ` for multi-floor, emits pipes/heads).

- **NFPA-13 schedule pipe sizing.** `src/engine/cad-model.js` builds an
  independent riser → cross-main → branch → drop → head network per floor and
  applies pipe-schedule sizing by head count. Backward compatible with legacy
  single-room `floorPlan.rooms`.
  Tests: `tests/cad-model.test.js`, `tests/cad-model-multifloor.test.js`.

- **Hydraulic calc engine (single-path estimate).** `src/engine/hydraulics.js`
  (pure/deterministic): Hazen-Williams friction loss (psi/ft), velocity (fps),
  NFPA-13 remote-area demand (density × area: light 0.10/1500, ordinary
  0.18/1500, extra 0.30/2500), single-path `requiredPressureAtRiser`
  (riser + cross-main + remote branch friction + 0.433 psi/ft elevation +
  7 psi min head), and schedule velocity/loss flags. Hand-computed cases in
  `tests/hydraulics.test.js`.

- **Full bid scope estimate.** `src/engine/bid-scope.js`:
  `buildSystemComponents` (alarm/check valve, FDC, backflow, riser trim,
  inspector's test, conditional fire pump), `buildSoftCosts` (permit 2% /
  design 6% / freight 3% as labelled `soft_cost_assumption`), and
  `buildFullScopeBid` (prices via the pricebook resolver with a flagged
  fallback; reports `fullScopeTotal` alongside `bareMaterialsTotal`). Behind a
  clear "estimate" label. Tests: `tests/bid-scope.test.js`.

- **SVG + DXF floor-plan import.** `src/engine/floorplan-import.js`:
  - `floorPlanFromSvg` extracts `<rect>`, `<polygon>`, and simple absolute
    `<path>` geometry, scaled to feet via `opts.unitsPerPx`.
  - `floorPlanFromDxf` parses the DXF ENTITIES section (LWPOLYLINE,
    POLYLINE/VERTEX, best-effort closed-loop assembly from LINE segments),
    with `opts.layer` filter and `opts.unitsPerDrawingUnit` scaling.
  - Both reuse `normalizeFloorPlan` and skip degenerate (<3-vertex) shapes.
  Tests: `tests/floorplan-import.test.js`.

- **Evidence-gated resolve-gate API.** `POST /api/projects/:name/claim-gates/:code/resolve`
  in `src/api/server.js` (admin-only). Only real evidence
  (`ahj_approval`, `professional_review`, `pe_signoff`,
  `manufacturer_approval`, `autosprink_packet`, `employee_signoff` at status
  `present`) may flip a gate `blocked → cleared`, recording who/what/when via
  `resolved_by` / `resolved_at` / `resolved_evidence_ref`. It **rejects (400)**
  `best_effort_ai_layout` evidence and `best_effort` status — AI/best-effort
  output can never clear a regulated gate. Tests: `tests/resolve-gate.test.js`.

- **OpenClaw CAD automation adapter.** `src/cad/openclaw-cad.js`:
  `buildGenerate3dModelPayload` / `buildGenerateDxfPayload` are pure
  cad-model → plain-object args; `invokeOpenClawCad` calls an **injected** async
  invoker and degrades gracefully (`{ok:false, skipped:true}`) when the GX10
  gateway is absent or unreachable — no hardcoded network, no throw. Tests:
  `tests/openclaw-cad.test.js`.

## Current test count

`npx vitest run` (full suite, no file list) from the repo root:

```
 Test Files  17 passed (17)
      Tests  131 passed (131)
```

All files pass, including the live spawned-server smokes in
`tests/evidence-api.test.js` and `tests/resolve-gate.test.js`.

## Still NOT done / NOT claimed (fail-closed)

- **Full network hydraulic balance.** The hydraulic engine is a **single-path
  estimate** only (`src/engine/hydraulics.js`). There is no loop/grid balance,
  no node-by-node demand solve, and no Hardy-Cross iteration. It must not be
  presented as a complete hydraulic calculation.
- **AutoSprink / AutoCAD parity.** No parity is claimed with AutoSprink, HydraCAD,
  AutoCAD, or any commercial sprinkler-CAD package. Geometry is best-effort.
- **AHJ / PE / manufacturer approvals.** All four regulated gates
  (`AUTOSPRINK_EVIDENCE_MISSING`, `AHJ_APPROVAL_MISSING`,
  `PROFESSIONAL_REVIEW_MISSING`, `MANUFACTURER_MODEL_APPROVAL_MISSING`) stay
  blocked until a real artifact is attached and resolved through the
  evidence-gated API. No generated output clears them.
- **Studio UI wiring of hydraulics / multi-floor.** The hydraulic engine,
  full-scope bid, and multi-floor stacking exist and are tested as engine/Node
  modules, but are **not yet surfaced** end-to-end in the `autosprink.html`
  studio UI. (Roadmap T2/T3/T6 note "Studio surfacing deferred/best-effort".)
- **Performance instancing.** No `InstancedMesh` path for heads/drops at high
  counts and no true-scale/exaggerated pipe-radius toggle (roadmap T8, open).
- **Surface consolidation.** The legacy static `app.html` is not retired; the
  live surfaces are `index.html` (login) → `workbench.html` and
  `autosprink.html` (studio). Dead-code removal is roadmap T9 (open).

## How to verify this packet

```
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-internal-alpha.ps1
```

Seeds a temp DB, runs the **full** `npx vitest run` suite (17 files / 131 tests),
and runs the workspace agentic-rules check. See `docs/DEPLOY.md` for the local
run path.
