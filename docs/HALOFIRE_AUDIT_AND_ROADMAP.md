# HaloFire Studio — Honest Audit, Design Handoff, and Roadmap to the Goal-Line

> Status date: 2026-06-13. Audited live on `https://halofire.rankempire.io/autosprink.html?hf=r2`
> (logged-in admin, real 2718-solid model from *Generate Layout*) plus source review of
> `apps/autosprink/autosprink.html`, `public/halofire-menubar.js`, `src/engine/hydraulics.js`,
> `src/engine/hydraulic-network.js`, and the existing `HONEST_STATUS.md` / `STATE_OF_UI_AUDIT.md`.
>
> This document is deliberately blunt. The repo has a long trail of "Phase X COMPLETE" reports
> and "12/12 golden tests pass" claims that do not survive contact with the live app. The goal
> here is to state the real state, the real target, and a realistic engineering program — not to
> celebrate scaffolding.

---

## 0. The five truths (read these first)

1. **The menu bar is a 354-item AutoSPRINK costume; ~37 items do anything. The other ~317 render
   as greyed `NEEDS-VERIFICATION` stubs.** The surface looks like parity; the function is
   early-alpha.
2. **There is a reproduced, root-caused camera bug: every draw/edit re-frames the camera and
   throws away the user's view.** `HFEdit.setModel → renderModel → frameCamera()` runs
   unconditionally on every commit (`autosprink.html:1413`). This alone makes the tools feel
   broken even where they technically work.
3. **The CAD layer is real but thin: single-segment-and-commit draw, real 5-type snaps, real
   undo/redo — but NO measure, array, trim, polyline, typed-dimension entry, drag-handles, or
   grip editing.** It is a sketch tool, not a CAD editor.
4. **The hydraulic engine is real-but-shallow: genuine Hazen-Williams + K-factor + density×area +
   iterative tree-walk balance — but explicitly NOT Hardy-Cross loop/grid, no per-fitting
   equivalent-length table, no interactive remote-area polygon, no NFPA 8-report submittal.**
5. **The approved design (`mock-studio.html`) is not in the repo.** It lives only on the live
   site and is reconstructed from `halofire-menubar.js`. The goal-spec UI cannot be diffed in CI
   against the app it governs. That is itself a hygiene defect to fix in P0.

---

## 1. Honest state of the system — works / shallow / broken / stub / missing

Legend: **WORKS** = real and defensible · **SHALLOW** = real but a fraction of the needed depth ·
**BROKEN** = wired but actively wrong · **STUB** = renders, does nothing · **MISSING** = not present.

### 1.1 CAD tools (draw / edit / view)

| Capability | State | Evidence | What's actually missing for parity |
|---|---|---|---|
| Menu bar (20 menus / 354 items, real AutoSPRINK names + manual tooltips) | WORKS (as chrome) | `public/halofire-menubar.js` MENU_DATA totals 354; both `mock-studio.html` and `autosprink.html` mount it | Item names are right; the items must *do* something — see next row |
| Menu items wired to handlers | SHALLOW | `mountMenuBar()` passes ~37 handlers; ~317 render greyed `stats.stubbed='NEEDS-VERIFICATION'` | Wire the top-15 daily tools first (Remote Area, Auto Coverage, Auto Branch, Smart Pipe, System Optimizer, Auto Peak, Stock Listing, Hydraulic Report) |
| Draw Wall | SHALLOW | LIVE: `commitWall` (`:3702`) adds one `{kind:'wall',height 9,thickness 0.5}` solid; snaps + blue preview work | Multi-segment chained polyline, live length+angle HUD, typed-coordinate entry, thickness/height as a property not a hardcoded constant, auto-join at corners |
| Draw Pipe | SHALLOW | LIVE: `commitPipe` (`:3697`) adds one branch pipe at `drawElev`, orphan solid `verify:'needs-verification'` | Connect to existing network (snap to pipe ends/heads), auto-insert tee/elbow at bends, elevation/slope, branch/main/cross-main typing so hydraulics can see it |
| Draw Head | SHALLOW | LIVE: `commitHead` (`:3708`) places head at click; instanced render; undo restores | Head-type/K-factor/deflector picker, coverage-circle overlay, auto-snap onto branch line + auto-drop, NFPA-13 §8.6 spacing validation in the ghost |
| Draw Fitting / Door | SHALLOW | `commitFitting`/door add solids via `HFEdit.apply` | Fitting type selection, auto-orient to pipe, door sized by dimension |
| Select / Move / Rotate / Mirror / Copy / Delete | WORKS | `HFEdit.apply('move'/'rotate'/'mirror'/'copy'/'delete')` (`:3506-3523`) mutate selection, undoable | Drag-to-move handles, grip editing, numeric nudge — currently command-only |
| Undo / Redo | WORKS | snapshot command stack, verified restores (`createCommandStack`, `:3457`) | — |
| Snap engine (endpoint/midpoint/intersection/perpendicular/grid) | WORKS | `snapPoint` (`:3671`), unit-tested, live snap indicator | Add tangent/center/node/extension snaps; snap-to-network endpoints |
| ViewCube | WORKS | `HF-VIEWCUBE` overlay (`:1495+`), interactive faces snap camera | Confirm all 6 ortho faces + iso corners on the *live* cube; mock specs 7 view buttons |
| Scale bar | SHALLOW | updates from render loop; but `initScaleBar` is **called at `:732` and never defined** (caught error) | Define `initScaleBar`; tie scale text to live camera zoom |
| **Camera stability on edit** | **BROKEN** | every edit → `setModel → renderModel → frameCamera()` (`:1413`); `frameCamera` (`:1484-1492`) resets `perspCam.position`, `orthoCam.position`, `controls.target`. LIVE: drew a wall, span 405→410, center cx 150→205 | The single highest-impact fix — see §5 |
| Measure tool | MISSING | no measure tool in toolbar | Click-click distance + running dimension, area, angle |
| Array / Trim / Polyline / Grip edit / Typed dimension | MISSING | none present; every draw is single-segment-and-commit | The core of "CAD editor" vs "sketch tool" |

### 1.2 PDF → architectural model

| Capability | State | Evidence | Gap |
|---|---|---|---|
| Pipeline plumbing PDF → `design.json` → deliverables | WORKS | `HONEST_STATUS.md`: every file lands on disk, every agent runs | It's plumbing, not a correct building |
| Floor-plan geometry extraction | SHALLOW | CubiCasa5k returns a few dozen rooms total across a 110-page set; a real 1881 design has hundreds | Wall→room polygonize fails (detected walls don't close cells) |
| Level outlines | SHALLOW | `intake_file` writes a min/max bbox from wall endpoints — passes "≥4 vertices" but is a rectangle, not the building outline | Concave-hull trace of the outer wall loop |
| Title-block / elevation metadata | BROKEN | `elevation_m = i * 3.0` synthetic placeholder; title block never OCR'd | Read real per-level elevations + sheet metadata |
| Columns / stairs / doors / multi-floor registration | MISSING / SHALLOW | columns/doors render if present but extraction is incomplete; registration drifts | Real structural grid, stair/door recognition, multi-floor stacking with shared datum |
| Network → plate registration | SHALLOW | `alignNetworkToExtractedPlate(lastFloorPlan)` re-runs after edits (`:3461`) | Only as good as the plate, which is a bbox today |

### 1.3 Sprinkler design + hydraulics + compliance

| Capability | State | Evidence | Gap |
|---|---|---|---|
| Hazen-Williams friction | WORKS | `hazenWilliamsLossPsiPerFt(gpm,d,C)`, `velocityFps`, elevation 0.433 psi/ft (`src/engine/hydraulics.js`) | — |
| K-factor flow / demand | WORKS | `kFactorFlow` Q=K√P; density×area by hazard (light 0.10/1500, ord 0.18/1500, extra 0.30/2500) | Demand should come from a *user-drawn* remote area, not a static hazard lookup |
| Network balance | SHALLOW | iterative tree-walk `balanceNetwork` accumulates friction branch→main (`hydraulic-network.js`); self-disclaims "NOT a sealed Hardy-Cross" | Hardy-Cross loop/grid solver; gridded/looped systems unsupported |
| Per-fitting equivalent length | MISSING | Le implicit in segment length | NFPA 13 §23.4.3.1.1 Le tables per fitting type/size |
| Remote Area tool (interactive polygon) | MISSING | `remoteAreaDemand(hazard)` returns static density×area only; no draw tool | Click-polygon `RemoteAreaNode`, pick 4 most-demanding heads, NFPA min-area, two-RA-together, in-rack |
| Darcy-Weisbach (antifreeze) | MISSING | not implemented | Needed for antifreeze/glycol systems |
| Auto Peak critical-area finder | MISSING | router is one-shot Steiner, no critical path | Walk the network for the worst-case demand area |
| Pump-curve + tank sizing | MISSING | none | Source sizing from curve + supply analysis |
| Smart Pipe classify / Auto Branch / Arm Around / Easy Drop / Sway Brace / System Optimizer | MISSING | all ❌ in `AUTOSPRINK_TARGET §6`; router has no Drop/Branch/Cross-main/Riser typing or obstruction avoidance | Topology classifier, obstruction-aware routing, seismic brace pass (NFPA 13 Ch.18), live what-if upsizing |
| NFPA-13 rule check | STUB / partial | Le table, two-RA selector, arm-over shift, brace spacing exist as primitives; no rule-check registry surfaced in UI | Registered rule set + UI surfacing + red-line pass |
| PE review of output | MISSING | `HONEST_STATUS.md`: never reviewed by a PE; no ground-truth comparison | Compare to human-drafted Halo bids |

### 1.4 Reporting / BOM / interop

| Capability | State | Evidence | Gap |
|---|---|---|---|
| Auto-Bid + BOM + Submittal `.json` download | SHALLOW | Submittal tab emits these, self-flagged "NOT stamped/sealed/AHJ" | Not a real submittal |
| NFPA 8-report submittal suite | MISSING | none | One-click 8-page stamped output (the AutoSPRINK moat, ~2 hrs/bid) |
| Stock Listing / Hydralist `.hlf` | MISSING | BOM emitted, not Hydralist format | Hydralist-compatible export + cost roll-up |
| FP sheet set (cover/H/N/R/B/D) + cut-sheet PDF bundle | MISSING | none | Full FP plan set + per-SKU cut sheets |
| DXF / IFC / STEP / STL export | SHALLOW | buttons on `#cadBar`, disabled until a model is built | Verify real geometry export, not empty stubs |
| Catalog / Parts Picker | MISSING (UI) | catalog engine + `parts/` exist server-side; no Manufacturer→Category→Sub-type picker UI; 276/296 SKUs are stubs | SCAD-annotated catalog (`@part/@k-factor/@price/@port`) as a filterable picker with cut sheets + Le data |

### 1.5 Approved-UI features absent from the current app

| Mock feature | State | Gap |
|---|---|---|
| Left "This-Job" card (workbench, role, bid $, due date) | MISSING | `autosprink.html` left aside has only Project/Source/Hazard/Markup/Layers/Properties |
| Next-Actions checklist | MISSING | surface actionable next steps from workbench data |
| Bottom command line (`command › type a command…`) | MISSING | AutoCAD-style command dispatch by name; only a `#status` div exists |
| 7-way view cube + presets (3D/Top/Front/Back/Right/Left/Bot)+Orient | SHALLOW | current `#cadBar` has only 3D + Top toggle + cube div + scale bar |
| Live status bar (X/Y/Z + scale 1:96 + Snap/Ortho/units) | SHALLOW | current shows a static legend, not live readout |
| `mock-studio.html` committed to repo | MISSING | exists only on live site (Glob `**/mock-studio.html` → none locally) |

---

## 2. The target

**One sentence:** Ship the user's approved `mock-studio.html` UI/UX, powered by AutoSPRINK-grade
function. Apply the AutoSPRINK bible (tool depth, calc engines, reporting) *to our own approved
UI* — not a reskin of AutoSPRINK, and not the mock as dead chrome.

Three target pillars:

1. **Tool depth = AutoSPRINK.** Each tool gets a real lifecycle (activate → ghost/preview →
   snap-resolve → commit), NFPA-aware ghosts, dimensional Location-Input, and per-node context
   menus. The top-15 daily tools (Remote Area, Automatic Sprinkler Coverage, Auto Branch Lines,
   Smart Pipe, System Optimizer, Auto Peak, Stock Listing, Hydraulic Report, …) are wired first.
2. **Calc engines = AutoSPRINK.** Hazen-Williams + Darcy-Weisbach friction, NFPA-13 density×area
   remote-area method (interactive polygon, two-RA-together, in-rack), per-fitting equivalent
   lengths (NFPA §23.4.3), Hardy-Cross loop/grid balance, Auto Peak, pump-curve + tank sizing, a
   rule-check registry.
3. **Reporting = AutoSPRINK.** Stock Listing (Hydralist `.hlf`), NFPA 8-report submittal suite, FP
   sheet set, cut-sheet PDF bundle, DXF/IFC/STEP/STL.

**UI is the approved mock:** ribbon/menu-bar clone + left This-Job/Next-Actions/Layers panel +
viewport chrome (scale bar, 7-view cube, command line) + right Inspector tabs
(Inspector/Layout/Pipe-Sched/Hydraulics/Compliance/Submittal) + live status bar. Light
apple-glass CAD style.

---

## 3. Design handoff — `mock-studio.html` → functional Studio

Every approved surface, mapped to (a) its real function, (b) the backend it needs, (c) current
state, (d) the AutoSPRINK depth it must reach.

| Mock surface | Real function | Backend it needs | Current state | AutoSPRINK depth |
|---|---|---|---|---|
| **Menu bar** (20 menus / 354 items) | Dispatch every tool + command by name | Per-item handler registry | WORKS as chrome; ~37/354 wired | Every daily item invokes its real tool; greyed only for genuinely future items |
| **Toolbar** (Select/Wall/Pipe/Head/Fitting/Door/Delete) | Activate draw/edit tools | Tool lifecycle (activate/ghost/snap/commit) | SHALLOW; single-segment commit | 12+ tools w/ ghost states, NFPA coverage circles, Location-Input chip |
| **Draw Wall** | Multi-segment building shell | Polyline model w/ editable vertices, corner auto-join | SHALLOW; one segment, hardcoded 0.5/9 | Chained walls, live length/angle HUD, typed dims, thickness/height picker |
| **Draw Pipe** | Network routing element | Network graph; tee/elbow auto-insert; branch/main typing; hydraulic node | SHALLOW; orphan branch solid | Elevation/slope, size-on-the-fly, auto-connect to heads + existing pipe |
| **Draw Head** | NFPA-spaced sprinkler | Head catalog (K/coverage/deflector); branch-line link; drop gen | SHALLOW; bare head solid | Coverage circles, auto-snap to branch + auto-drop, §8.6 spacing validation |
| **Remote Area** | Interactive demand polygon | `RemoteAreaNode`, density auto-fill, 4-head solver | MISSING (static lookup only) | Click-polygon, NFPA §19 min-area, two-RA-together, in-rack |
| **Smart Pipe / Auto Branch / Arm Around / Easy Drop / Sway Brace / System Optimizer** | Auto topology + routing + bracing + upsizing | Topology classifier, obstruction-aware router, seismic pass, what-if loop | MISSING | Full AutoSPRINK auto-design suite |
| **Left: This-Job card** | Bid context (workbench, role, $, due) | Workbench/bid data API | MISSING | Surface live bid context |
| **Left: Next-Actions checklist** | Actionable next steps + warnings | Pipeline/validation state | MISSING | Generate-layout / sq-ft mismatch / Awaiting-AHJ items |
| **Left: Layers list** | Show/hide per layer | Renderer that consumes layer-visibility | PARTIAL; toggles fire events no renderer hides on (legacy editor); `autosprink.html` has `layerGroups` per COLOR so wirable | Per-layer visibility + isolation |
| **Left: Tools & Design (Source/Hazard/Markup)** | Design inputs | Hazard→density map, source psi | WORKS (flat form) | Replace with Parts Picker + hazard wizard |
| **Parts Picker** (Manufacturer→Category→Sub-type) | Filterable catalog browser | SCAD catalog (`@part/@k-factor/@price/@port`) + cut sheets | MISSING (UI) | Per-SKU cut sheets + Le + price/labor |
| **Viewport: scale bar** | Live scale readout | Camera zoom hook | SHALLOW; `initScaleBar` undefined | Tie to live camera |
| **Viewport: 7-view cube + Orient** | Ortho + iso snapping | Camera presets (keys 1-5) | SHALLOW; only 3D/Top + cube div | 6 faces + iso corners + Orient |
| **Bottom command line** | Type-a-command dispatch | Shared command registry (with menu/toolbar) | MISSING | AutoCAD-style; Ctrl+K palette |
| **Status bar** (X/Y/Z + 1:96 + Snap/Ortho/units) | Live cursor + mode readout | Pointer + snap/ortho state | SHALLOW; static legend | Live X/Y/Z, snap/ortho indicators |
| **Right: Inspector tabs** (Inspector/Layout/Pipe-Sched/Hydraulics/Compliance/Submittal) | Per-node props + analysis | `setSolidFields` editing; calc engine; rule registry; submittal | WORKS (tabs); editing SHALLOW; add Pipe-Sched | Editable material/dia/K/cost/labor; dedicated Pipe-Sched; NFPA report |

**Handoff gate:** commit `mock-studio.html` into `apps/autosprink/` so the approved UI is diffable
against `autosprink.html` in CI. The goal-spec must not live only at a URL.

---

## 4. Prioritized roadmap to the goal-line

This is a real engineering program (multiple quarters), not a sprint. Effort: **S** ≤2d ·
**M** ~1wk · **L** ~2–4wk · **XL** multi-month.

### P0 — Make the tools real on the mock UI (the credibility floor)

- **P0.1 Fix the draw-edit camera bug.** (**S**) See §5. Single highest-impact change.
- **P0.2 Define `initScaleBar` + live scale bar tied to camera.** (**S**)
- **P0.3 Commit `mock-studio.html` to the repo + CI diff vs `autosprink.html`.** (**S**)
- **P0.4 Tool lifecycle: multi-segment draw (Wall/Pipe), live dimension+angle HUD, typed
  Location-Input.** (**L**)
- **P0.5 Real snaps extended to network endpoints; ghost shows NFPA-13 §8.6 spacing for heads.** (**M**)
- **P0.6 Inspector editing: per-node material/dia/K/cost/labor via `setSolidFields`; add
  Pipe-Sched tab.** (**M**)
- **P0.7 Bottom command line + shared command registry (menu/toolbar/palette all dispatch one
  map).** (**M**)
- **P0.8 Left panel: This-Job card + Next-Actions checklist from workbench data.** (**M**)
- **P0.9 Layer show/hide consumed by the `autosprink.html` renderer (`layerGroups`).** (**S**)
- **Done = ** a fitter can draw a multi-segment wall, route pipe that connects to heads, place
  NFPA-spaced heads, edit any node's properties, and the camera never jumps. No `NEEDS-VERIFICATION`
  on any of the top-15 daily tools.
- **Depends on:** nothing external. This is the unblock-everything phase.

### P1 — PDF → full building model

- **P1.1 Fix wall→room polygonize so cells close (concave-hull outer loop, not bbox).** (**L**)
- **P1.2 Columns / stairs / doors recognition + real structural grid.** (**L**)
- **P1.3 Title-block OCR → real per-level elevations + sheet metadata.** (**M**)
- **P1.4 Multi-floor stacking on a shared datum + registration that survives edits.** (**L**)
- **P1.5 Ground-truth comparison harness vs human-drafted Halo bids (density/sqft ±10%, not
  "≥N heads").** (**M**)
- **Done = ** a 110-page set produces a building outline that matches the architect's, heads
  uniformly cover the whole floor on the real grid, and quality is measured against a human bid.
- **Depends on:** P0 (so the extracted model is editable/inspectable to verify).

### P2 — Real hydraulic calc engine

- **P2.1 Interactive Remote Area polygon → demand (replace static hazard lookup).** (**M**)
- **P2.2 Per-fitting equivalent-length tables (NFPA §23.4.3).** (**M**)
- **P2.3 Hardy-Cross loop/grid solver (gridded/looped systems).** (**XL**)
- **P2.4 Darcy-Weisbach for antifreeze; Auto Peak critical-area finder; pump-curve + tank
  sizing.** (**L**)
- **P2.5 NFPA-13 rule-check registry surfaced in the Compliance tab.** (**L**)
- **Done = ** demand from a user polygon, fittings carry real Le, looped systems balance, and the
  Compliance tab flags real NFPA violations. PE-reviewable numbers.
- **Depends on:** P0.4–P0.6 (network model with branch/main typing + fitting nodes).

### P3 — Compliance, pipe schedule, BOM, interop

- **P3.1 Pipe schedule (real schedule from the network) in the Pipe-Sched tab.** (**M**)
- **P3.2 Stock Listing / Hydralist `.hlf` export + cost roll-up.** (**M**)
- **P3.3 NFPA 8-report one-click submittal suite.** (**L**)
- **P3.4 DXF / IFC / STEP / STL verified to carry real geometry.** (**M**)
- **P3.5 Parts Picker UI over the SCAD catalog + per-SKU cut sheets; replace the 276 stub SKUs
  with real manufacturer data.** (**L**)
- **Done = ** a bid produces a stamped-format submittal, a Hydralist BOM, real CAD exports, and
  every SKU resolves to a real part.
- **Depends on:** P2 (calc must be real before a submittal is honest).

### P4 — Plot / prefab / coordination

- **P4.1 FP sheet set (cover/H/N/R/B/D) + cut-sheet PDF bundle.** (**L**)
- **P4.2 Prefab cut-list + spool drawings.** (**L**)
- **P4.3 Trade coordination (clash vs structure/MEP) + Arm Around obstruction routing.** (**XL**)
- **Done = ** Halo can hand a sub a prefab package and an AHJ a stamped plan set from the Studio.
- **Depends on:** P1 (real building), P2 (real calc), P3 (real BOM/exports).

---

## 5. The draw-wall / draw-anything camera bug — root cause and fix

**Symptom (reproduced live):** drawing or editing anything re-frames the camera and discards the
user's current view. Drew a wall outside the bbox → span 405→410, camera center cx 150→205. Even
an in-bbox head placement still runs the reframe (only invisible because the bbox happened to match).

**Root cause (definitive):** every edit flows through the command stack:

```
HFEdit.apply(...) → setModel(model)            // autosprink.html:3459
                  → renderModel(model)          // :3460  (full scene rebuild)
                  → frameCamera(minX..ceil)     // :1413  (UNCONDITIONAL inside renderModel)
```

`frameCamera` (`:1484-1492`) recomputes `cx/cz/span` from the new bbox and **overwrites**
`perspCam.position`, `orthoCam.position`, and `controls.target` every call — so any edit resets
the view. `renderModel` is correct to rebuild the scene; it is wrong to *reframe* on every rebuild.

**Fix:** only frame the camera on the *first* model load (or an explicit user "fit view"), never on
an edit-driven re-render. Gate `frameCamera` behind a flag.

```js
// module scope
let __hfFramed = false;

// in renderModel(), replace the unconditional call at :1413 with:
if (!__hfFramed) { frameCamera(minX, maxX, minZ, maxZ, ceil); __hfFramed = true; }
// else: preserve current perspCam/orthoCam position + controls.target across the rebuild.
```

Then expose an explicit *Fit View* action (toolbar / `View ▸ Zoom Extents` / keyboard `F`) that
sets `__hfFramed = false` (or calls `frameCamera` directly) when the user *wants* to recenter —
e.g. the existing ViewCube/2D-3D toggles can legitimately reframe. Initial load and *Generate
Layout* (`renderResults`) should set/reset the flag so the first paint still frames.

**Verify (live loop, not a flag-probe):** load the 2718-solid model, capture `window._frame.cx`,
draw a wall outside the bbox, re-capture — `cx`/`span` must be unchanged; orbit, draw a head,
confirm the view holds; then hit Fit View and confirm it *does* reframe. While there, define the
missing `initScaleBar` (`:732`) so the caught console error clears.
