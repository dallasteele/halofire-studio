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
- [ ] **T2 — Hydraulic calc engine.** `src/engine/hydraulics.js`: Hazen-Williams
      friction loss, remote-area demand (NFPA 13 density × area), required pressure
      at the riser; flag if schedule sizing is inadequate vs demand. Tests with
      hand-computed cases. Surface in the studio pipe schedule.
- [ ] **T3 — Full bid scope.** Add system components (alarm/check valve, FDC,
      backflow, riser trim, inspector's test, fire pump if required) + soft costs
      (permit/design/freight as labelled assumptions) priced via pricebook resolver,
      behind a clear "estimate" label. Tests. Show in bid.
- [ ] **T4 — DXF/PDF floor-plan import.** Parse simple DXF (LINE/LWPOLYLINE on a
      plan layer) → room polygons, extending floorplan-import.js. Tests.
- [ ] **T5 — Resolve-gate workflow.** Authenticated admin route + studio UI to
      attach evidence (AHJ/PE/manufacturer/AutoSprink) that flips a specific gate
      from blocked→cleared, recorded with who/what/when. Tests prove a gate only
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
