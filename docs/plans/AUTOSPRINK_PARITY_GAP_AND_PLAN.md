# AutoSPRINK Parity — Gap Audit & Build Plan
*Authored 2026-06-14. Status re-assessed against the CURRENT `apps/autosprink` Studio (inline engine + `src/engine/*`), not the stale 2026-04 "HaloFire today" columns. Reference: `docs/AUTOSPRINK_CLONE_PLAN_V2.md §3` (100-tool inventory), `docs/research/autosprink-feature-matrix.md`.*

## 0. Honest headline

**We are roughly 30% of an AutoSPRINK clone by tool count — and closer to ~15% by "does it do the fire-protection engineer's job."**

This session moved the **interaction shell** a long way: real undo/redo, multi-select, clipboard, 2D plan mode, direct grab-drag move, multi-segment draw, typed input, measure, trim/offset/array/mirror/copy/scale/single-grip, 258 wired menu items. That is real and it matters. **But the load-bearing CAD/engineering is still mostly absent**, and that is the 70% that makes AutoSPRINK AutoSPRINK:

- No **real hydraulic network solve** (Hazen-Williams + Hardy-Cross loop/grid, remote-area demand, iterative pipe upsizing). We have point formulas (K√P, hydrant), not a system solver.
- ~~No **Smart Pipe** classification~~ — **DONE (Phase 2, 2026-06-14):** topology classifier (branch/cross-main/main/arm-over/drop/sprig), label-independent, heads-served conservation, live-verified.
- ~~No **arm-over / drop / sprig** routing intelligence~~ — **DONE (Phase 2):** arm-over/easy-drop/sprig connection engine + auto branch-line tie-in-to-mains, live-verified (arm-around obstruction routing still MISS).
- ~~No full O-snap suite~~ — **DONE (Phase 1, 2026-06-14):** all 7 snap types with glyphs/tooltips + per-type settings, polar/ortho tracking, command line, dynamic input, dimension engine, grip-handle drag-reshape + stretch all shipped and live-verified.
- ~~No **object Properties editing**~~ — **DONE (Phase 2):** material/diameter/end-prep/K-factor/cost/labor edits route through one undoable edit and reflect in the live BOM, live-verified.
- No **Remote-Area boundary tool**, **section tool**, **node tags** (pressure/flow/velocity).
- No **NFPA-format hydraulic report** or **submittal sheet set** (FP-0…FP-D).
- No **PDF/DWG → full building model** reconstruction in the critical path.
- Parts: 296 SKUs but ~276 are parametric stubs, not manufacturer-exact.

The honest framing: **a credible CAD *interaction* shell sitting on top of unbuilt sprinkler *engineering*.** The plan below is ordered to close that, hardest-and-most-defining first.

---

## 1. Gap matrix (by domain · current status)

Legend: **HAVE** = real + verified · **PART** = exists but incomplete/shallow · **MISS** = absent · effort S/M/L/XL · priority P0 (blocks "is it AutoSPRINK") … P3.

### A. Drawing & sketching
| AutoSPRINK tool | our status | what's missing | eff | pri |
|---|---|---|---|---|
| Multi-segment polyline draw (pipe/wall) | HAVE | — (built this session) | — | — |
| Typed Location-Input (length / dx,dy) | HAVE | now full grammar: absolute `12,8`, relative `@10,0`, polar `10<45`, bare length — shared by command line + dynamic input (Phase 1, verified). Relative/polar require a base vertex (first point is absolute-only, by design) | — | — |
| Line / Rectangle / Arc / Circle primitives | PART | arc, circle, fillet not real | M | P2 |
| Insert Sprinkler (click-to-place tool) | HAVE | head-place tool + live coverage/spacing-violation overlay shipped (Phase 2, verified): real viewport click places an O-snapped head, undoable, camera-neutral; coverage engine flags NFPA-13 too-close/too-far/gaps live. Placement tool itself predates Phase 2; the coverage engine + overlay are the new code | — | — |
| Insert fitting / riser / valve / device | PART | device library place tools | M | P1 |
| Sketch underlay tracing | MISS | trace over imported plan | M | P2 |

### B. Object editing & manipulation
| AutoSPRINK tool | our status | what's missing | eff | pri |
|---|---|---|---|---|
| Select (single / window / crossing / all-like / by-id) | HAVE | fence-select, previous, last-edited | S | P2 |
| Direct grab-drag move | HAVE | snap-to-object-during-move, multi-part drag | M | P1 |
| **Grip-handle editing** (drag endpoints/vertices to reshape) | HAVE | endpoint + midpoint grips drag-reshape/translate a run, O-snapped + undoable (Phase 1, verified). True N-vertex polyline grips deferred until the data model adds a multi-vertex solid | — | — |
| Rotate / Mirror / Array / Offset / Trim-Extend / Scale / Copy | PART | basepoint/reference-angle UX, dynamic preview, multi-select targets | M | P1 |
| Stretch (drag a window edge) | HAVE | crossing-window captures vertices + group-moves them, connected runs stay joined, one undoable edit (Phase 1, verified) | — | — |
| Align / Distribute | MISS | — | S | P2 |
| Undo / Redo | HAVE | — | — | — |
| Cut / Copy / Paste (+ paste-to-point) | PART | paste at picked point, cross-drawing | S | P2 |

### C. Snapping & precision (the CAD backbone)
| AutoSPRINK tool | our status | what's missing | eff | pri |
|---|---|---|---|---|
| **O-snap suite** (endpoint/mid/intersection/perp/node/center/extension) w/ glyphs | HAVE | all 7 types fire against the live model with distinct SVG glyphs + tooltips; extension draws a tracking line (Phase 1, verified). Glyphs are constant screen-size (matches AutoSPRINK); node label surfaces solid.kind only (not port-level) | — | — |
| Polar / Ortho tracking | HAVE | polar increments (90/45/30/22.5/15) with dashed tracking ray + angle/length chip, engine `polarConstrain` + 7 unit tests; ortho H/V lock (Phase 1, verified). Engage-band not yet user-configurable; polar owns the constraint when on (ortho is the degenerate case) | — | — |
| Object snap tracking (acquire + align) | PART | extension/tracking line exists; full multi-point acquire+align not built | M | P2 |
| Dynamic input near cursor | HAVE | floating len<angle field, live during drag, typed override commits the point; shares one coord grammar with the command line (Phase 1, verified) | — | — |
| Snap settings dialog | HAVE | per-type popover bound to live snapState + All On/Off (Phase 1, verified) | — | — |

### D. Views, sections & navigation
| AutoSPRINK tool | our status | what's missing | eff | pri |
|---|---|---|---|---|
| 2D plan / 3D toggle | HAVE | — (true 2D built this session) | — | — |
| Zoom extents / window / pan / orbit / view-cube | HAVE | — | — | — |
| **Section / elevation cut** | MISS | live section plane → 2D section view | **L** | **P1** |
| Named views / saved viewpoints | MISS | — | S | P3 |
| Show/Hide layers · grid · elevation HUD | PART | elevation HUD, per-layer isolate, grid toggle polish | S | P1 |
| Isolate selection (x-ray) | HAVE | — | — | — |
| Visual styles (wireframe/shaded/hidden) | PART | wireframe + hidden-line | M | P2 |

### E. Plan import, scale & layers
| AutoSPRINK tool | our status | what's missing | eff | pri |
|---|---|---|---|---|
| Import PDF (raster) | PART | reliable scale auto-calibration | M | P0 |
| Import DWG / DXF | PART | full DWG (LibreDWG); layer mapping | L | P1 |
| **PDF/DWG → full building model** (walls/openings/columns/levels) | MISS | the reconstruction critical path is heuristic/down | **XL** | **P0** |
| "Clean" import (strip blocks/layers) | MISS | layer-filter wizard | M | P1 |
| Lock source layer (read-only underlay) | MISS | — | S | P1 |
| Drawing scale / units setup | PART | imperial-native, scale picker | S | P1 |
| Drop-ceiling / tile grid synthesis | MISS | center heads on tiles | M | P1 |

### F. Pipe routing & system building
| AutoSPRINK tool | our status | what's missing | eff | pri |
|---|---|---|---|---|
| Auto Route Pipe | PART | Steiner only; no role classification | L | P0 |
| **Smart Pipe** (branch/cross-main/main/arm-over/sprig classification) | HAVE | topology classifier shipped + verified (Phase 2): 1314 pipes → riser/cross-main/branch-line/drop sane pyramid, 0 unknown, heads-served conservation 1230/1230, role-derived (label-blinded clone gives identical counts), camera-neutral color toggle. Residual: arm-over/sprig/main classify to 0 LIVE only because the generator emits no offset/sprig/multi-tier geometry — proven correct via unit fixtures; not a classifier gap | — | — |
| Auto Branch Lines + couple to mains | HAVE | connectivity engine shipped + verified (Phase 2): generated model orphanHeads 0 / single sourced tree; REPAIR path proven by orphan injection (5 orphans → geometry-derived tie-in + fitting_tee → orphans 0, re-flooded), idempotent, camera-neutral. Residual: tie-in is shortest-node-to-node, not wall-routed/hydraulically-optimal (flagged repair, not a from-scratch optimal router) | — | — |
| Arm-over on head placement | HAVE | arm-over/easy-drop/sprig connection engine shipped + verified (Phase 2): injected offset/raised heads → engine synthesizes arm-over leg + drop/sprig nipple + elbow/reducer markers, roles assigned by topology (offset→arm-over, upright-above→sprig), idempotent, camera-neutral, menu+undo wired. Residual: NOT yet observed on a from-scratch generated layout (generator emits only in-line pendent drops); build path proven via injected geometry | — | — |
| Arm-around obstructions (beams/ducts) | MISS | obstacle-aware routing (arm-over is a single straight leg, not obstacle-aware; arm-AROUND still a stub) | XL | P2 |
| Easy Drop / Sprig (vertical drops) | HAVE | same drop-connect engine (Phase 2, verified): straight drop + sprig nipple synthesis proven via injected in-line/upright heads, idempotent, camera-neutral. Same generator-coverage residual as arm-over | — | — |
| Sway brace / hanger insertion | MISS | seismic + support pass | L | P2 |
| Per-segment slope / elevation | PART | slope input, multi-elevation | M | P2 |
| Apply pipe schedule to whole system | HAVE | NFPA-13 pipe-schedule cascade shipped + verified (Phase 2): flatten-all-to-1″-then-apply re-sized 84 pipes into a real pyramid (riser 8″ ≥ cross-main 3″ ≥ branch ≥ drop 1″) via cumulative downstream-head count, idempotent, undoable, BOM reflects new sizes, camera-neutral. Residual: head-count table method (not hydraulic solve, not AHJ/PE); extra-hazard flagged hydraulicRequired | — | — |

### G. Sprinkler heads & coverage
| AutoSPRINK tool | our status | what's missing | eff | pri |
|---|---|---|---|---|
| Auto coverage (round/rect, hazard spacing) | PART | coverage engine + overlay shipped + verified (Phase 2): per-head disc = half-spacing corner reach, 100% covered on dense layout, deterministic, camera-neutral. Still GEOMETRY-only (flat smooth ceiling, no obstruction/sloped/storage/in-rack arming) — flagged in-product; auto-arrange from-scratch coverage generation still a PART | L | P0 |
| Coverage/spacing check vs NFPA-13 | HAVE | live spacing-violation overlay shipped + verified (Phase 2): injected 3ft pair → NFPA13_MIN_SPACING (nearestFt 3 < 6), injected 40ft head → NFPA13_MAX_SPACING (nearestFt 56.57 > 15) + 135 gap cells; details cite the hazard rule (not random), recompute on every edit, camera-neutral | — | — |
| Sprinkler definition wizard | PART | dialog chrome, K/temp/response/finish | M | P1 |
| In-rack / storage demand | MISS | — | L | P3 |

### H. Hydraulic calculation (the engineering core)
| AutoSPRINK tool | our status | what's missing | eff | pri |
|---|---|---|---|---|
| **Hazen-Williams network solve** | PART | point formula only; no system-wide iterative solve | **L** | **P0** |
| **Hardy-Cross loop/grid balance** | MISS | gridded-system solver | **XL** | **P0** |
| **Remote-Area boundary tool** (draw around flowing heads) | MISS | interactive boundary + demand | **L** | **P0** |
| Two remote areas together | MISS | — | M | P2 |
| Fitting equivalent lengths (Le tables) | MISS | per-fitting Le | M | P0 |
| Live re-calc on edit (System Optimizer) | MISS | what-if loop, modify size/material | L | P1 |
| Supplies: Water/Tank/FDC/Pump (named, multiple) | PART | named/multiple supplies, curve | M | P1 |
| Check-point gauge / node tags (P/Q/V) | MISS | pressure-observation + on-drawing labels | M | P1 |
| Flow calculator (K/Q/P) | PART | dialog, validation | S | P1 |
| PRV sizing / antifreeze / Darcy (non-water) | MISS | — | L | P3 |
| Color-code pipes by hydraulic condition | PART | velocity/stress overlay mode | S | P2 |

### I. Parts, properties & fabrication
| AutoSPRINK tool | our status | what's missing | eff | pri |
|---|---|---|---|---|
| Parts database (296 SKU) | PART | 276 are parametric stubs, not mfr-exact GLB | L | P1 |
| Parts picker (mfr/category/sub/datasheet filters) | PART | wire filters to catalog, datasheet view | M | P1 |
| **Object Properties editing** (material/diameter/end-prep/K/cost/labor) | HAVE | editable inspector shipped + verified (Phase 2): material/end-prep/K-factor/cost/labor + diameter edits route through one undoable HFEdit and REFLECT in the live BOM takeoff (byMaterial, editedCost/Labor, bySize); diameter + multi-field round-trips proven, undoable, camera-neutral. Residual: cost/labor are manual overrides (no pricebook auto-fill) | — | — |
| Quick Data Editor (spreadsheet BOM edit) | MISS | inline base-cost/shop/field-labor | M | P1 |
| Smart Pipe fabrication standards | MISS | end-prep rules, cut lengths | M | P1 |
| Prefab drawings / "DO NOT FAB" <3" flag | MISS | classifier + prefab sheets | M | P2 |

### J. BOM, reporting & submittal
| AutoSPRINK tool | our status | what's missing | eff | pri |
|---|---|---|---|---|
| Stock listing / BOM (export) | HAVE | grouped-by-role, Hydralist (.hlf) | M | P1 |
| Material summary | PART | role grouping | S | P1 |
| **NFPA-format hydraulic report** | MISS | the 8-format calc report | **L** | **P0** |
| **Submittal sheet set** (FP-0 cover/FP-H/FP-N/FP-R/FP-B/FP-D) | MISS | multi-sheet PDF plot set | **L** | **P1** |
| Cut-sheet PDF bundle | MISS | merge mfr datasheets per used SKU | M | P2 |
| Plot / print (letter/tabloid) | PART | titleblock, sheet plotting | M | P1 |
| 2D drawing extract from 3D (per level) | PART | multi-sheet, dimensioned | M | P1 |

### K. Annotation
| AutoSPRINK tool | our status | what's missing | eff | pri |
|---|---|---|---|---|
| Dimension / label engine | HAVE | aligned/linear-H/linear-V/angular dims + leader/callout, O-snapped, true ft-in (1/16"), real selectable/deletable/undoable geometry (Phase 1, verified). Text is a screen-aligned DOM overlay (not in-scene 3D text); retype-text editor + baseline/continued/ordinate chains deferred | — | — |
| Node tags (pressure/flow/velocity) | MISS | — | M | P1 |
| Riser tag + supply table | MISS | — | M | P1 |
| Text / mtext / callouts | PART | — | S | P2 |

### L. Interference / BIM
| AutoSPRINK tool | our status | what's missing | eff | pri |
|---|---|---|---|---|
| Interference check (pipe × column) | HAVE | basic clash exists | — | P2 |
| MEPF clash (full, multi-trade) | MISS | linked arch/struct/MEP | XL | P3 |
| Solids modeling / control-area | PART | control-area definition | L | P3 |

### M. UX shell
| AutoSPRINK tool | our status | what's missing | eff | pri |
|---|---|---|---|---|
| Ribbon / menubar (258 items wired) | HAVE | 128 honest stubs remain | M | P2 |
| Status bar (snap/grid/units/coords) | HAVE | live X/Y/Z cursor coords (true ft) + Snap/Ortho/Polar pills on a passive listener (Phase 1, verified). Snap pill shows aggregate state, not per-type | — | — |
| **Command line** (type a command/coords) | HAVE | AutoCAD-style parser: command names via aliases → menu actions, coordinate tokens (abs/rel/polar/length), verbs (ortho/snap/polar/zoom e), honest "unknown" (Phase 1, verified). No fuzzy/autocomplete; interaction-pick coord path wired but not auto-asserted | — | — |
| Command palette (Ctrl+K) | MISS | — | S | P2 |
| Properties panel (live, editable) | HAVE | inspector editor now writes material/end-prep/K/cost/labor/diameter through one undoable edit and reflects in the live BOM (Phase 2, verified). Residual: no pricebook auto-fill, no spreadsheet-grid Quick Data Editor yet | — | — |
| Quick-access toolbar (user-pinned) | MISS | — | S | P3 |

---

## 2. P0 — the must-build core (what makes it an AutoSPRINK clone)

These are the load-bearing gaps. Nothing reads as "an AutoSPRINK clone" without them:

1. **Full O-snap suite** with on-screen glyphs (endpoint/mid/intersection/perpendicular/node/extension) — precision drafting backbone.
2. **Grip-handle editing** — drag endpoints/vertices of a selected run to reshape it.
3. ~~**Live object Properties editing**~~ — ✅ DONE (Phase 2): material/diameter/end-prep/K/cost/labor, BOM-reflecting, undoable.
4. ~~**Smart Pipe classification**~~ — ✅ DONE (Phase 2): branch/cross-main/main/arm-over/drop/sprig, label-independent, conservation-checked.
5. **Real hydraulic solve** — system-wide Hazen-Williams + **Hardy-Cross** loop/grid + fitting equivalent lengths.
6. **Remote-Area boundary tool** — draw the area, compute the demand.
7. **NFPA-format hydraulic report**.
8. **PDF/DWG → real building model** in the critical path (+ scale calibration).
9. **Insert/place tools** for heads (✅ DONE Phase 2: head-place + live coverage/spacing-violation overlay) + devices with live snap preview (devices still PART).

---

## 3. Phased build plan (hardest-and-most-defining first)

Each phase is a coherent, demoable vertical slice. Every function lands with a live-verified loop (select/draw/edit/calc → real effect → screenshot), never a flag-pass.

**Phase 1 — Precision drafting core** *(makes drawing feel like CAD)* — ✅ **DONE** (live-verified, 2026-06-14)
`osnap-suite (per-type + glyphs)` · `grip-handle drag-edit` · `stretch` · `polar/ortho tracking` · `command line + live cursor coords in status bar` · `dynamic-input coord/angle field` · `dimension engine (aligned/linear/angular + leaders)`.
All seven shipped and were each driven through a logged-in Studio with real gestures + an independent verify pass (every check `works:true`, zero broken, GUARD#1/#3 camera-neutrality held, 0 pageerror); deployed to the VPS (md5 local==remote). Evidence: `E:/ClaudeBot/out/phase1-drafting/{osnap,grip-stretch,cmdline,dimensions,polar-snapcfg}/`. Honest residuals (not blockers, tracked above): true N-vertex polyline grips await a multi-vertex solid type; dimension text is a screen-aligned DOM overlay + no retype-text editor + no baseline/continued/ordinate chains; snap glyphs are constant screen-size; node snap labels surface `solid.kind` only; command line has no fuzzy match and the interaction-pick coord path isn't auto-asserted; polar engage-band isn't user-configurable. Intersection snap was proven via injected crossing pipes (the dense generated model has no naturally-occurring crossings). Next: **Phase 2 — System intelligence**.

**Phase 2 — System intelligence** *(makes the model a real sprinkler system)* — ✅ **DONE** (live-verified, 2026-06-14)
`Smart Pipe classification (branch/cross-main/main/arm-over/sprig)` · `auto branch-lines + tie-in to mains` · `arm-over + easy-drop/sprig` · `head insert tool + live coverage/spacing-violation overlay` · `apply-schedule cascade` · `object Properties editing (material/dia/end-prep/K/cost/labor)`.
All six shipped as pure, deterministic `src/engine/*` engines (`smart-pipe.js`, `branch-connect.js`, `drop-connect.js`, `coverage.js`, `pipe-schedule.js`) with property/golden unit tests, each driven through a logged-in Studio with real gestures + an independent verify pass (every check `works:true`, zero broken, GUARD#1 camera-neutrality held at 0 ft, 0 pageerror); deployed to the VPS Studio app (port 3301, md5 local==remote). Evidence: `E:/ClaudeBot/out/phase2-system/{smart-pipe,branch-tiein,armover-drop,head-place-coverage,schedule-properties}/`. Brain episodes 50087/50101/50116/50156.
Honest residuals (tracked above, none block the chunk): (1) **generator-coverage gap** — arm-over/sprig/main classify to 0 and arm-over/sprig BUILD only fire on the LIVE model when OFFSET/RAISED/multi-tier heads exist; the from-scratch generator emits only in-line pendent drops, so those paths are proven via injected/unit geometry, not a native generated layout. (2) **routing is connectivity-correct, not optimal** — branch tie-in is nearest-node-to-node and arm-over is a single straight leg (no wall-routing, no arm-AROUND obstacle solver). (3) **coverage + schedule are public-standard GEOMETRY/table methods, NOT a hydraulic solve and NOT AHJ/PE approval** — every result carries that honesty note; extra-hazard schedule is flagged `hydraulicRequired`. (4) **PUBLIC ROUTE STALE** — the public `/halo-fire/` nginx route serves a separate older `halofire-platform` copy that lacks all Phase-2 work; the md5-verified deploy targets the studio app on port 3301, which is not exposed through nginx (needs a separate platform-tree sync if the public studio must show Phase 2). (5) cost/labor properties are manual overrides (no pricebook auto-fill). Next: **Phase 3 — Hydraulics that hold up**.

**Phase 3 — Hydraulics that hold up** *(the engineering)*
`Hazen-Williams network solve (iterative upsizing)` · `Hardy-Cross loop/grid` · `fitting equivalent-length tables` · `Remote-Area boundary tool + demand` · `named/multiple supplies + curve` · `node tags (P/Q/V) + check-point gauges` · `live re-calc on edit` · `color-by-condition overlay` · `NFPA-format hydraulic report`.

**Phase 4 — Intake & deliverables** *(real plans in, real submittal out)*
`PDF/DWG → building model + scale calibration` · `clean/strip + lock source layer` · `drop-ceiling tile grid` · `section/elevation cut → 2D views` · `submittal sheet set (FP-0…FP-D) + titleblock plot` · `2D dimensioned extract per level` · `BOM role-grouping + Hydralist export` · `cut-sheet bundle`.

**Phase 5 — Fabrication & polish**
`prefab drawings + DO-NOT-FAB <3" flag` · `manufacturer-exact part GLBs (OpenSCAD forge / catalog crawler)` · `sway brace / hanger pass` · `arm-around obstruction routing` · `quick-data BOM editor` · `command palette` · `wire the remaining 128 menu stubs or retire them` · `help/docs`.

---

## 4. How this gets built (no more slop)

- One phase = one focused effort with a **live verification loop** (drive the logged-in Studio, confirm the real gesture/calc, screenshot) — the lesson from missing the 2D mode + grab-drag is *verify what the user does, not button-counts*.
- Hydraulics + Smart Pipe land as **real engine code with property/golden tests**, never faked. If a solve isn't trustworthy, it's flagged in-product.
- Local harness for live checks: `qa@halofire.local` (see `project_halofire_local_verify_harness`).
