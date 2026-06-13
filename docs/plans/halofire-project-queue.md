# HaloFire — Project Completion Queue (the loop drives this to done)

Operating mode (user 2026-06-13): Claude runs a SELF-PACED LOOP that pipelines the
ultramode waves below in order until ACCEPTANCE is met. HaloFire itself also runs on
loops (OpenClaw email→auto-bid→approval; NFPA-25 recall; GX10 qwen module loop).

## LOOP PROTOCOL (every cycle)
1. If an ultramode/gate workflow is RUNNING → do nothing, re-arm, wait (completion
   notification is the primary wake; ScheduleWakeup ~1800s is the fallback heartbeat).
2. If a workflow just COMPLETED → read result; if its FULL gate is green, commit
   (repo==live) + tick the wave done here; if not green, the wave's own gate loop
   already retried — if still failing after its cap, log the blocker and DO NOT
   advance (fix-forward next cycle, never paper over).
3. If no workflow running and queue not empty → launch the NEXT unchecked wave.
4. SINGLE-WRITER discipline on autosprink.html (one wave touches it at a time).
   Every wave ENDS with the full gate suite (scale BOTH projects + part-alignment +
   selection no-regress + the wave's own behavioral/visual gates).
5. When the queue is empty AND acceptance gates green → report completion, STOP.
6. Guardrail: never fire a new wave while one runs; never re-fire an identical
   failed wave >2x without a changed plan; honest report each cycle (numbers/pics).

## WAVES (in order)
- [x] **W0 finish-stabilize** (DONE, commit d1b5f06): 1881 network re-aligned/re-scaled
      to the extracted plate (361.6x81.9 ft, true scale); part sizing/centering correct;
      two-view both-wings merge (37/37 tests); FULL gate green BOTH projects (HD bbox
      300x405 exact, 1230 drops 0.0000 ft deviation; Coop bbox ±0.03%, true pipe ODs).
- [x] **W1 Drawing/edit tools** (DONE 2026-06-13, commit c33c25a): ported apps/cad edit
      engine into autosprink.html as pure ES modules src/engine/edit-commands.js (snapshot
      undo/redo command stack + move/copy/delete/rotate/mirror) + src/engine/snaps.js
      (endpoint/midpoint/intersection/perpendicular/grid), wired into the live viewer.
      Wired AutoSprink menus: Edit (undo/redo/delete/copy/cut→delete), Commands (reverse→
      mirror), Tools (draw pipe/wall/place head/add fitting/add door + draw-off), Snaps
      (5 toggles + visible indicator). Drag-to-move selection, editable Inspector, live
      draw preview + Shift ortho lock + Esc cancel. Evidence: 29 unit tests green
      (18 edit-commands + 11 snaps); live HTTPS md5-parity on autosprink.html + both
      engine modules; markers HF-W1-CMD=8/DRAW=3/SNAP=3, hotfixes 1/1 preserved.
- [x] **W2 Extraction RECORED** (2026-06-13, supersedes the W2b "97.15% recall" claim):
      CORRECTNESS, not coverage. The prior 97.15% in-envelope / 77.66% whole-sheet
      "recall" numbers were a COVERAGE ARTIFACT measured on an over-inclusive wall set —
      they asked "what fraction of heavy-lineweight ink is covered" and PASSED garbage
      (41,784 segments that swept in dimension/extension/grid lines, match-line dashes,
      door-swing arcs, hatch). They never tested precision: "is this segment actually a
      wall?" That gate is RETIRED. New gate is semantic correctness proven by screenshot.
      DOMAIN CORRECTION: A-101 "OVERALL FIRST FLOOR PLAN" is NOT a parking podium — it is
      a long narrow WOOD-FRAMED multifamily building drawn as two stacked plan views split
      at a match line. Real structure = perimeter + column grid + 2-3 stair/elevator cores
      + a mid-building room cluster = HUNDREDS of elements, not 41,784.
      RECORE RESULTS (honest, all needs-verification — NOT AHJ/PE/mfr-exact/AutoSprink-parity):
        • ELEMENT COUNT: L1 reconstructed to 158 wall RUNS (from 6,858 single-band cut-wall
          segments; 2,692 sub-2ft stubs = dimension ticks/glyphs DROPPED, 6 diagonals =
          door-swing/hatch DROPPED, collinear merged at perpTol 0.25ft / gap 1.0ft / minRun
          2.0ft). All 8 levels land 79–251 runs — hundreds, not tens of thousands. New pure
          module src/engine/plan-wall-runs.js buildWallRuns(). The 41,784 lineweight-union
          set is demoted to an OFF-by-default diagnostic overlay; primary structure is
          wallRuns (wallSource:'wall-runs').
        • PAINT EXCLUDED: y — no parking-stall striping on this sheet; the over-inclusion
          was sheet furniture (dims/grid/swings/hatch), and the run reconstruction with
          stub+diagonal exclusion removes it. 0 paint/furniture segments in the structure field.
        • ORIENTATION FIXED: y — computePlanUnderlayTransform (building-from-plan.js) returned
          rotation.x=+PI/2 → plane back-faced the top-down camera → mirrored/backwards text.
          Changed to -PI/2, NO texture flip (empirically the only upright+forward combo;
          A/B'd 4 states). Sheet text ("FLOOR PLAN GENERAL NOTES", "KEY PLAN", "22 DESIGN+LAB"
          logo, title block, A-101 number) all upright + readable.
        • CLIPPING FIXED: y — underlay material now sets polygonOffset(1,1); lift raised
          0.04→0.5 ft. No z-fight / no plane-through-geometry at top + 6 orbit angles incl
          extreme grazing (~12°).
      VISION MODELS (honest): NONE used. SAM3 @GX10:9003 RUNS but returns 0 wall / 0 column /
      0 door (max "wall" score 0.0204 — trained on natural images, not CAD linework).
      CubiCasa5K ResNet34-UNet RUNS but outputs ~98.9% background on this dense 384ft
      commercial sheet (walls go sub-pixel — trained on simple 512px residential SVGs). Both
      garbage on this sheet; I say so rather than fake output. Structural sheet S-110 route
      tested live: at scale 1"=30' the OVERALL foundation sheet's column markers are
      sub-detectable (the grid parser reads dimension strings as columns → 0 columns), NOT
      viable as-is; columns/beams live on the ENLARGED S-1xx.B/.C sheets (1/8"=1') for W4.
      So the honest structure source = the architectural single-band cut-wall RUNS.
      METHOD: vector-first reconstruction (extractSegmentsFromOpList → single-band cut-wall
      layer → buildWallRuns with non-wall exclusion + collinear merge). Data augmented IN
      PLACE via scripts/augment-wall-runs-recore.mjs (no 173MB PDF re-extraction; all
      W0/W2 footprint/walls/wallsFull/doors/rooms fields intact). Tests: full suite
      1139/1139 green (+11 new: plan-wall-runs ×8, underlay orientation/clipping ×3).
      SCREENSHOTS (proof): out/halofire-recore/r2-orientation-top{,-zoom}.jpg (text upright),
      r2-structure-over-sheet-top.jpg (runs registered on sheet), r2-orbit-{1..6}-*.jpg
      (no clipping at 6 angles). Deployed + live-verified: live==committed==worktree md5
      parity on building-from-plan.js (419bf0b5), pdf-underlay.js (354ca4a8), plan-wall-runs.js
      (6122ee5d), autosprink.html (d671c3ff). Commit ddb5f3b (git cat-file -t = commit) on
      studio/fix-1881-part-scale-align-20260613. Hotfix markers intact.
      FORWARD-WAVE READINESS: the extraction CORE is now correct enough to resume forward
      waves — structure is plausible (158 runs forming the envelope + partitions + cores,
      0 paint/furniture false positives), the plan is readable-from-above (text not
      mirrored), and nothing clips at any view angle, all proven by screenshot. W3 (real
      part models) and W4 (multi-discipline + routing) may proceed on this corrected base.
      W4's structural columns/beams should pull from the ENLARGED S-1xx.B/.C sheets
      (1/8"=1'), NOT the OVERALL S-110 (column markers sub-detectable at 1"=30').
- [~] **W3 Real part models**: every catalog part now DIMENSIONED to its real spec at
      true scale via spec-dimension tables (apps/autosprink/src/components/openscad/
      part-dims.js: ASME B36.10 pipe OD/wall, ASME B16.4 fitting CTE/band, NPT thread OD,
      NFPA head frame+deflector, Victaulic FireLock grooved). Emitters rewritten
      (generators.js) — heads pendent/upright/sidewall/concealed now GENUINELY distinct
      (concealed 3.25" cover plate, sidewall offset deflector); RIGID (Style 005H) vs
      FLEXIBLE (Style 177) grooved couplings visually distinct (flex gasket band); B16.4
      tees/elbows (45≠90) with short threaded end-bands (no star body); concentric reducer;
      new escutcheon + drop-nipple emitters. Loader (part-meshes.js) serves distinct
      grooved_coupling_rigid/flexible + escutcheon/drop_nipple; Inspector shows dims +
      provenance (spec-nominal) + needs-verification. Parts ledger: 26 dimensioned / 12
      flagged / 0 mfr-exact (dimensionLedger on /api/parts). mfr-exact stays flagged
      (no mfr CAD). Tests 1120/1120 green. Deployed + live-verified on
      https://halofire.rankempire.io (hotfix markers intact, all STLs 200, /api/parts
      ledger live). Evidence: out/w3-snapshots/*.png. Remaining: extend dimensioned
      coverage to the full 155-SKU catalog (heads K/finish variants, valves, riser).
- [ ] **W4 Multi-discipline + routing**: structural beams/joists (hangers attach to
      real steel) + columns; MEP obstruction volumes (mech/elec/plumb sheets); RCP-
      driven ceilings per level; levels 2-8; sprinkler ROUTER avoids obstructions +
      coverage/compliance accounts for them; re-run layout on the real plate.
- [ ] **W5 Operations surface (Dentrix model)**: OPS-1 schema+migrations (clients,
      properties, contacts, projects, estimates, appointments, crews, invoices,
      inspection_schedules) + migrate bids→projects; unified shell on every window;
      OPS-3 Client File; OPS-4 Job Book (crew-column calendar, pinboard); OPS-5
      pipeline bind (won→job, Studio opens from project); OPS-6 NFPA-25 recall engine;
      OPS-7 ledger; OPS-8 reports. Server-side RBAC (admin/estimator/office/field).
- [ ] **W6 UE-style UX**: dockable panels + per-user saved layout (user_prefs);
      orientation cube + live scale bar; imperial⇄metric unit toggle.
- [ ] **W7 Calendar + AI lane**: CAL-1 real grid, CAL-3 OpenClaw awaiting-approval
      one-click approve&send (existing human-approval path), CAL-4 external sync
      (Google/Apple/Microsoft), activity/observability feed (OBS audit log).
- [ ] **W8 Menu/toolbar finish**: wire more of the 346 stubbed AutoSprink menu items
      to real functions; build the toolbar component (291 buttons); Settings ledger
      auto-refresh (wired vs stubbed + parts/verification counts live).

## ACCEPTANCE (project "finished")
1. Load Cooperative 1881 → real per-level building (parking L1 + residential 2-8),
   walls/doors at ≥90% recall, structure, ceilings data-driven, all at drawing scale.
2. Auto-layout heads/pipe/parts on the real plate at true scale; parts dimensioned +
   aligned; couplings at 21/24ft joints; hangers on real beams.
3. Full interactive CAD: select/inspect/x-ray, DRAW + EDIT (walls/pipe/heads/doors),
   move/delete/undo, snaps, dockable panels, view cube + scale bar + unit toggle,
   AutoSprink menu system, export.
4. Operations surface live: Client File, Job Book, pipeline (bid→won→job), NFPA-25
   recall, ledger, reports; role-gated server-side; OpenClaw auto-bid + approval lane.
5. Every gate green (scale, alignment, recall, selection, behavioral); honesty flags
   intact; deployed live; repo==live committed.
