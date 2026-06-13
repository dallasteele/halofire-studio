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
- [~] **W2 Extraction completeness** (W2b honest fix 2026-06-13): doors+openings+
      fixtures extracted, both wings of A-101 merged (complete floor 1). DONE:
      124 doors (swing-arc circle-fit; 24 confident / 100 suspect), 15 openings,
      5 fixtures (1 mech / 1 elec / 3 stair cores), 41,784 recovered partition-
      inclusive walls; live-rendered + selectable + layer toggles; 0 pageerrors.
      WALL RECALL = 77.66% whole-sheet (DEFINITIVE, version-consistent), BELOW the
      ≥90% target — gate item 1 NOT passed and NOT claimed passed. Measured ONE way:
      both the served wallsFull[] AND the A-101 page-8 wall-ink are rasterized from
      vectors by the SAME pdfjs 6.0.227 via the app's own extractSegmentsFromOpList +
      selectWallLayer(partitionInclusive), so there is NO pdfjs version mismatch (that
      mismatch caused the retired 71% artifact; the prior stored 80% was optimistic).
      Independently reproduced 2026-06-13 by recall-definitive.mjs: covered 683,111 /
      ink 879,663 px = 77.66%; per-wing lowerWingA 73.56% / upperWingB 84.67%.
      THE GAP IS AN ARTIFACT, NOT MISSING WALLS: a ±12 ft shift sweep does not improve
      recall (merge registration dx-57.03 dy-111.68 is already optimal), and the heatmap
      misses are sheet furniture (border, grid-bubble diamonds, dimension/extension
      lines, title block, match-line centerlines) irreducibly inside the partition-
      inclusive denominator — NOT building walls. In-envelope building-wall coverage
      (denominator shrunk to the building footprint) = 97.15% (lowerWingA 98.01 /
      upperWingB 95.83), ~99.3% by segment count (42,500/42,784). HONEST CEILING: the
      ≥90% WHOLE-SHEET bar is genuinely unachievable for THIS sheet (~78% ceiling)
      without weakening the metric, because the heavy-lineweight denominator must
      include non-wall sheet furniture. AWAITING USER DECISION on the 90% bar — left
      [~], not auto-accepted. Heatmaps: out/halofire-W2b/recall-definitive.png (whole-
      sheet), out/halofire-W2b/recall-inclip.png (in-envelope). Deployed + live-verified;
      live==committed md5 parity on building-from-plan.js (e28403d2), plan-extract.js
      (4ca2b06e), plan-levels.cooperative-1881.json (4713228f). Commit 04b38ec.
- [ ] **W3 Real part models**: manufacturer cut-sheet dimensions → dimensioned models
      for all 155 catalog parts (rigid+flexible couplings, heads, hangers, tees,
      drops, escutcheons); parts pipeline 155/155 flagged; mfr-exact stays flagged.
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
