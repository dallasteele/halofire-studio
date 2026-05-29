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
- [ ] **T6 — Multi-floor / multi-zone.** ceilingHeightFt per floor, stacked plans,
      per-zone riser. Engine + studio. Tests.
- [ ] **T7 — OpenClaw CAD automation adapter.** `src/cad/openclaw-cad.js` that
      builds generate_3d_model / generate_dxf payloads from the cad-model and
      invokes the OpenClaw bridge when the GX10 gateway is live (graceful skip when
      unreachable). Tests on payload shape.
- [ ] **T8 — Head perf + true-scale toggle.** InstancedMesh path for heads/drops at
      900+ count; UI toggle between true-scale and exaggerated pipe radius.
- [ ] **T9 — Consolidate surfaces.** Retire/replace legacy static app.html; route
      all UI through workbench + studio. Remove dead code.
- [ ] **T10 — Deploy packaging + review packet refresh.** Document/script the
      deployable run path; refresh docs/reviews with current truthful status.

## Log
- 2026-05-29: studio + OpenGeometry CAD + DXF shipped (commits 3764b64, 2b5b7ba). 68 tests green.
- 2026-05-29: T1 STEP/IFC/STL export shipped — verified 79KB STEP from 23 OpenGeometry entities. Next: T2 hydraulics.
- 2026-05-29: T2 hydraulic engine shipped — src/engine/hydraulics.js + tests/hydraulics.test.js (21 hand-computed tests). Full suite 13 files / 89 tests green (was 12/68). Single-path estimate only; NOT a full network balance, NOT PE/AHJ/AutoSprink parity. Next: T3 full bid scope.
- 2026-05-29: T3 full bid scope shipped — src/engine/bid-scope.js + tests/bid-scope.test.js (11 tests). buildSystemComponents (6 core riser-assembly components + conditional fire pump via boolean or required>available pressure), buildSoftCosts (permit 2% / design 6% / freight 3% labelled assumptions, priceSource:soft_cost_assumption), buildFullScopeBid (prices components via priceResolver with flagged fallback, computes fullScopeTotal alongside bareMaterialsTotal). Full suite 14 files / 100 tests green (was 13/89). Best-effort estimate only, fail-closed; NOT a complete priced bid, NOT manufacturer-quoted, NOT AHJ/PE/AutoSprink parity. Next: T4 DXF/PDF floor-plan import.
- 2026-05-29: T4 DXF floor-plan import shipped — floorPlanFromDxf in src/engine/floorplan-import.js + 8 new tests in tests/floorplan-import.test.js. Parses ENTITIES section: LWPOLYLINE, POLYLINE/VERTEX, and best-effort closed-loop assembly from LINE segments; opts.layer filter, opts.unitsPerDrawingUnit scale-to-feet, opts.hazard default; reuses normalizeFloorPlan; skips degenerate <3-vertex shapes. generateSprinklerBid verified to run on imported plan. Full suite 14 files / 108 tests green (was 14/100). PDF import DEFERRED (not a deterministic dependency-free parse). Best-effort geometry only, NOT CAD-grade, claim gates stay fail-closed. Next: T5 resolve-gate workflow.
- 2026-05-29: T5 resolve-gate API shipped — POST /api/projects/:name/claim-gates/:code/resolve (authMiddleware + requireRole('admin')) in src/api/server.js + tests/resolve-gate.test.js (5 spawned-server tests). Added resolved_by/resolved_at/resolved_evidence_ref columns via ensureColumn in BOTH server.js initDatabase and seed.js. Approved gate-clearing evidence set: ahj_approval, professional_review, pe_signoff, manufacturer_approval, autosprink_packet, employee_signoff (status treated as 'present'). REJECTS (400) evidence_type best_effort_ai_layout and status best_effort — AI/best-effort output can NEVER clear a regulated gate. On success: inserts the evidence row (present) + flips gate blocked->cleared with who/what/when provenance; GET claim-gates reflects cleared + resolved_by. Full suite 15 files / 113 tests green (was 14/108). Studio UI DEFERRED; parity (AHJ/PE/AutoSprink/manufacturer) still requires real artifacts — fail-closed preserved. Next: T6 multi-floor / multi-zone.
