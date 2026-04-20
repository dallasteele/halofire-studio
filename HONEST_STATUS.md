# What the HaloFire CAD Studio actually is today — and isn't

Written after the user called out that I was celebrating a "12/12
golden tests pass" result while the viewport still showed nothing
that resembles an AutoSprink-class fire-sprinkler design.

Paired with `SELF_TRAIN_PLAN.md`, which lays out the concrete path
to fix this.

## Honest assessment

### What works (real, defensible)

1. **Pipeline plumbing** end-to-end from PDF → `design.json` →
   deliverables bundle (`proposal.html/pdf/xlsx`, `submittal.pdf`,
   `cut_sheets.pdf`, `prefab.pdf`, `cut_list.csv`, `design.glb/
   dxf/ifc`). Every file lands on disk. Every agent runs.
2. **Open-source pricing DB** with 296 parts, live + stale flags,
   Gemma-only sync agent, audit-trail per price observation.
3. **Studio chrome** — Ribbon, CommandPalette, StatusBar,
   LayerPanel, LiveCalc card, RemoteAreaDraw overlay. Events fire.
4. **NFPA 13 primitives** — fitting Le table, two remote areas
   selector, arm-over shift algorithm, seismic brace spacing calc,
   Hazen-Williams.
5. **OpenClaw-HaloFire runtime** — module registry, supervisor,
   scheduler, tier-0/1/2 loop, Gemma-only policy in code.
6. **TypeScript / React / Python test scaffolding** — 408 tests
   that execute; viewport smoke that actually verifies GLB
   delivery.

### What does NOT work (the truth)

1. **Floor-plan geometry extraction is shallow.** CubiCasa5k returns
   a few dozen rooms per building (total) across a 110-page set.
   A real 1881 design has hundreds. The wall→room polygonize step
   fails because detected walls don't form closed cells.
2. **Level outlines are bounding rectangles, not real boundaries.**
   My `intake_file` fix writes a `min/max` bbox from wall endpoints.
   This passes the "≥ 4 vertices" trivial test but the polygon
   looks NOTHING like the architect's building outline. An actual
   outline needs concave-hull tracing of the outer wall loop.
3. **Title-block metadata is fake.** `elevation_m = i * 3.0` is a
   synthetic placeholder. Real architectural plans label each
   level with a specific elevation; we never read the title block
   OCR.
4. **Head placement is grid-scatter inside a few tiny rooms.**
   The placer drops heads at fixed grid points inside whatever
   polygons it gets. Output: hundreds of heads clustered into the
   few rooms that polygonize closed, massive empty space elsewhere.
   AutoSprink produces uniformly-spaced coverage across the entire
   floor, attaching to the real structural grid.
5. **Pipe routing is arbitrary Steiner.** Real fire-sprinkler
   topology is main → cross main → branch line → arm-over, with
   specific fittings at branch points. My router produces the
   shortest tree that connects heads, which is not how a sprinkler
   fitter installs the system.
6. **Studio doesn't accept edits.** Ribbon / palette / layer
   toggles fire DOM events nothing listens to. User can't click a
   head and move it, can't drag a pipe, can't change a size and
   see hydraulics recalc. The "Run Auto-Design" button is the
   only interaction that actually does anything to the scene.
7. **No comparison to ground truth.** I have zero data on what
   Halo's finished bids actually look like. My tests compare the
   output to loose absolute thresholds ("≥ 10 rooms") rather than
   to a human-drafted reference.
8. **Visual output has never been reviewed by a PE.** We don't
   know if any of the 583 heads or 206 pipes would pass an AHJ
   red-line pass.
9. **Golden tests are a floor, not a ceiling.** "≥ 50 heads
   placed" is trivially satisfied by a misfiring placer that
   crams heads into two rooms. A real quality bar is "head
   density per sqft matches NFPA 13 §8.6 ± 10%."
10. **Catalog stubs dominate.** 276 of 296 SKUs have no real GLB
    and no real price. A real bid lands on those stubs and the
    submittal shows "Stub — replace with manufacturer data sheet."

### What I shouldn't have claimed

- "Ready for Codex code review" — it was premature; what's there is
  infrastructure, not a working product.
- "Viewport populated from Auto-Design" — the initial demo used a
  hand-synthesized `design.json`. The real one shows a bounding
  rectangle slab + heads clustered in 2 rooms.
- "AutoSprink-class" — we have the chrome, not the brain.

## The fix

See `SELF_TRAIN_PLAN.md` for the 8-phase plan. Short version:

1. Load Halo's historical bids as ground truth.
2. Replace lax thresholds with ratio / IoU tests that bite.
3. Add a pixel-diff visual regression against Halo's real sheets.
4. Rebuild intake: real outer-boundary tracing + title-block OCR.
5. Rebuild placer: NFPA coverage tables, not grid scatter.
6. Rebuild router: main/cross/branch topology, not pure Steiner.
7. Wire the Studio for real editing (select / move / resize / undo).
8. PE review loop — every Wade red-line becomes a new golden test.

Each phase has explicit exit criteria. No more "all green" while
the output is unusable.
