# HaloFire Studio — AutoSPRINK Clone Target

This is the north-star feature/UX surface our Pascal-fork-based clone must reach. Sourced from public training material, MEPCAD docs cache, scribd workbooks, and forum discussion (full citations at end).

We do NOT need to ship every AutoSPRINK feature — but every iteration should reduce the gap to this list. When a sprint ends, run `python services/halofire-cad/tests/cruel_vs_target.py` to see which AutoSPRINK feature equivalents we still owe.

## 1. Top-level UX layout

AutoSPRINK is a **ribbon-tab desktop CAD app** (Windows-native). Layout:

| Region | What lives there |
|---|---|
| Title bar | Project name, version, license tier |
| Ribbon tabs | File, Edit, View, **Tools**, **Commands**, **Auto Draw**, **Hydraulics**, Settings, Parts Database |
| Quick Access toolbar | User-pinned commands (top-left) |
| **Parts Picker pane** (left) | Cloud-connected parts browser. Dropdowns: Manufacturer → Category → Sub-Category → Sub-Type. Cut sheets + hydraulic loss data per item. |
| **3D Viewport** (center) | Drawing canvas. Grid + elevation HUD. 2D plan / 3D model toggle. |
| **Properties panel** (right) | Selected-object config: pipe material, diameter, end-prep, K-factor, cost, labor hours. |
| **Command line + status bar** (bottom) | Feedback, node tags, hydraulic warnings. |

Three license tiers, each unlocks more of the ribbon:
- **Lite** — Core design + basic reporting
- **Pro** — + Auto Branch, Route Pipe, System Optimizer, Remote Area Box
- **Platinum** — + Arm Around, Sway Brace, Bushings, advanced interference

## 2. End-to-end workflow (PDF → stamped bid)

### Phase 1 — Backplate prep + scale calibration
- `File ▸ Import` → `.dwg`, `.3ds`, PDF (rasterized backplate)
- `Scale ▸ Pick Desired / Pick Actual` — measure two known points on the backplate, AutoSPRINK derives the scale factor
- `Settings ▸ Drawing Settings` — units (decimal/fractional), background layer freeze

### Phase 2 — Hazard classification + system layout
- `Settings ▸ Default Properties` — pick system type (Wet / Dry / Pre-Action / Deluge) and occupancy class (Light / Ord-1 / Ord-2 / Extra)
- `Remote Area tool` — define hydraulic demand footprint: round/rect, density curve auto-loaded from NFPA 13 occupancy table
- `Parts Database ▸ Sprinkler Definition Wizard` — import head SKUs (K-factor, orifice, temp rating locked per model)

### Phase 3 — Head placement
- **Auto** — `Auto Draw ▸ Automatic Sprinkler Coverage` — analyzes ceiling, places heads on a grid honoring NFPA spacing + obstruction setbacks. 15 ft default throw. Configurable round/rect coverage shape.
- **Manual** — `Tools ▸ Sprinkler` — snap to grid / ceiling tiles / wall offset
- `Commands ▸ Center Sprinklers on Ceiling Tiles` — common cleanup pass

### Phase 4 — Pipe routing
- `Auto Draw ▸ Route Pipe` (Pro) — auto-routes to placed heads
- `Auto Draw ▸ Auto Branch Lines` — branch ↔ cross-main connection
- `Auto Draw ▸ Connect` — couples branches to mains
- **Smart Pipe** — auto-classifies each pipe segment as Drop / Spring / Branch / Riser Nipple / Cross-Main from size + orientation + topology
- **Arm Around** (Platinum) — auto-routes around beams / ducts (the one feature competitors lack)
- **Easy Drop** (Pro) — vertical drop placement with takeout deduction
- **Sway Brace** (Platinum) — auto-attaches structural bracing per NFPA 13 §18

### Phase 5 — Hydraulic calc
- `Hydraulics ▸ Auto Peak` — finds the critical remote area on branch lines
- `Hydraulics ▸ System Optimizer` — iteratively upsize pipes; live pressure / flow / velocity feedback
- Methods: Hazen-Williams (default) and Darcy-Weisbach (antifreeze / non-water)
- Node tags placed on drawing showing pressure / flow per node
- `Check Point Gauge` — drop pressure / flow observation points
- `Riser Tag + Supply Table` — header info on the design
- `Flow Calculator` — derive K-factor or flow from pressure + orifice + demand curve

### Phase 6 — BOM + cut-list
- `File ▸ Print ▸ Stock Listing` — Hydraulic / Purchase Order / Prefab formats
- `Quick Data Editor` — inline edit Base Cost, Shop Labor, Field Labor; propagates through BOM
- `Export ▸ Hydralist (.hlf)` — supplier system handoff
- Material Summary auto-tabulates from `.hlf`

### Phase 7 — Submittal package
- `File ▸ Plotting` — hard-copy preview, 2D plan or 3D model export
- `File ▸ Printing ▸ Hydraulic Reports` — three formats: Standard, Simplified, **NFPA** (8-report suite: density/area, pipe schedule, device summary, riser diagram, …)
- `Export ▸ AutoCAD .dwg` — stamped PDF source
- Manual hydraulic graph plot for documentation

## 3. Top-15 daily-use tools

| Rank | Tool | One-liner |
|---|---|---|
| 1 | Remote Area | Define hydraulic demand footprint, density auto-fills from occupancy |
| 2 | Automatic Sprinkler Coverage | Auto-place heads at NFPA spacing |
| 3 | Auto Branch Lines | Wire branches to cross-main automatically |
| 4 | System Optimizer | Live "what-if" pipe upsizing with pressure feedback |
| 5 | Smart Pipe | Auto-classify pipe role on draw |
| 6 | Auto Peak | Locate critical remote area for calc focus |
| 7 | Parts Picker | Cloud-sync parts DB; filter by mfr / category |
| 8 | Coverage Boundary | Round / rect coverage shape with obstruction handling |
| 9 | Node Tags | Pressure / flow labels from calc on drawing |
| 10 | Stock Listing | BOM export, Hydralist-compatible, cost roll-up |
| 11 | Hydraulic Report | NFPA 8-page submittal |
| 12 | Arm Around (Platinum) | Auto-route pipe around beams |
| 13 | Sway Brace (Platinum) | Auto-attach bracing |
| 14 | Easy Drop (Pro) | Smart vertical drop placement |
| 15 | Flow Calculator | Derive K or flow from pressure + orifice + demand curve |

## 4. Where AutoSPRINK leaves competitors behind (the moat)

- **Integrated calc engine** — no round-trip to SprinkCALC
- **Smart Pipe + Arm Around** — obstacle-aware auto-routing (Revit fights you, SprinkCAD is manual)
- **System Optimizer** — interactive pre-calc upsizing (HydraCAD only does post-calc)
- **NFPA 8-report one-click submittal** — saves 2 hours per bid
- **Sway Brace automation** — labor-hour line items in the prefab takeoff

## 5. NFPA tooling baked in

- **NFPA 13** 2022: Hazen-Williams + Darcy-Weisbach friction; occupancy-class density curves; hydrostatic correction; K-factor validation
- **NFPA 14**: PRV sizing (inlet / outlet / flow / elevation → PRV pick)
- **NFPA 20** (implied): Flow calculator derives required pump pressure
- **Hose allowance** in remote-area dialog
- **Antifreeze expansion chamber calc** for dry / preaction systems

## 6. Where HaloFire Studio stands today (gap audit, 2026-04-20)

| AutoSPRINK feature | HaloFire status | Notes |
|---|---|---|
| Backplate import (PDF) | ✅ partial | CubiCasa CNN parses walls + rooms; needs scale auto-calibration |
| Scale Pick Desired/Actual | ❌ | Currently regex'd from title block, no manual override UI |
| Default Properties (system type, hazard) | ✅ partial | Hazard classifier present; system-type picker missing |
| Remote Area tool | ❌ | No manual remote-area shape; placer auto-fills entire floor |
| Sprinkler Definition Wizard | ✅ partial | Catalog exists, no wizard UI |
| Automatic Sprinkler Coverage | ✅ | `place_heads_for_room` + `place_heads_for_level_floor` |
| Manual sprinkler placement | ❌ | No click-to-place tool |
| Center Sprinklers on Ceiling Tiles | ❌ | |
| Auto Draw ▸ Route Pipe | ✅ partial | Steiner tree router; needs branch/cross/main classification |
| Auto Branch Lines | ❌ | Router emits Steiner tree, not branches |
| Smart Pipe | ❌ | All pipes are "branch" |
| Arm Around | ❌ | No obstruction avoidance |
| Easy Drop | ❌ | No vertical drop tool |
| Sway Brace | ❌ | No bracing pass |
| System Optimizer | ❌ | One-shot router, no live what-if |
| Auto Peak | ❌ | |
| Parts Picker | ✅ partial | Pascal catalog has heads + pipes; filter UI exists |
| Properties panel | ✅ | Pascal native |
| Node Tags | ❌ | |
| Stock Listing report | ✅ partial | BOM emitted; not Hydralist-format |
| Hydraulic Reports (NFPA 8-format) | ❌ | Only proposal HTML/PDF |
| AutoCAD .dwg export | ✅ | `design.dxf` |
| 3D viewport | ✅ | Pascal viewer (this is our anchor advantage — AutoSPRINK is a CAD app, our 3D viewport is genuinely better) |
| Live edit + re-calc | ❌ | Pipeline is one-shot |

**Per-cruel-test status (1881-cooperative bid):**
- head_count: 30% under truth
- system_count: 14% under truth (PASS at 25% tol)
- level_count: 25% under truth
- total_bid_usd: 71% under truth
- pipe_total_ft / hydraulic_gpm: not yet truthed

## 7. Iteration order (next 5 sprints)

1. **Visual coherence** — page noise reject + wall chaining + auto-scale → cruel-test PASS for `test_no_level_has_more_than_300_walls` and `test_each_kept_level_has_realistic_polygon_area` (in flight)
2. **Manual placement tools** — click-to-place Remote Area + click-to-place sprinkler (matches AutoSPRINK Phase 2/3)
3. **Smart Pipe + branch/cross/main classifier** — labels every routed pipe so the BOM groups correctly and the drawing reads
4. **Live re-calc loop** — edit a pipe, re-run hydraulic calc without re-running intake (System Optimizer parity)
5. **NFPA 8-report submittal** — match AutoSPRINK's one-click stamped output

## Sources

- https://autosprink.com/training/library
- https://www.mepcad.com/help/autosprink2018/
- https://autosprink.com/help/ (auth-walled but title-block visible)
- https://www.mepcad.com/joesletters/Secrets%20of%20Success.pdf
- https://studylib.net/doc/27916131/autosprink---basic-training
- https://www.scribd.com/document/285916977/Auto-Sprink-Vr-10-New-Features
- https://forums.mepcad.com/
- https://enginerio.com/blog/designing-fire-protection-system-with-autosprink/
- https://firetech.com/nicet-prep/
- https://www.nfpa.org/codes-and-standards/nfpa-13-standard-development/13
