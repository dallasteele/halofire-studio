# AutoSPRINK Parity — Gap Audit & Build Plan
*Authored 2026-06-14. Status re-assessed against the CURRENT `apps/autosprink` Studio (inline engine + `src/engine/*`), not the stale 2026-04 "HaloFire today" columns. Reference: `docs/AUTOSPRINK_CLONE_PLAN_V2.md §3` (100-tool inventory), `docs/research/autosprink-feature-matrix.md`.*

## 0. Honest headline

**We are roughly 30% of an AutoSPRINK clone by tool count — and closer to ~15% by "does it do the fire-protection engineer's job."**

This session moved the **interaction shell** a long way: real undo/redo, multi-select, clipboard, 2D plan mode, direct grab-drag move, multi-segment draw, typed input, measure, trim/offset/array/mirror/copy/scale/single-grip, 258 wired menu items. That is real and it matters. **But the load-bearing CAD/engineering is still mostly absent**, and that is the 70% that makes AutoSPRINK AutoSPRINK:

- No **real hydraulic network solve** (Hazen-Williams + Hardy-Cross loop/grid, remote-area demand, iterative pipe upsizing). We have point formulas (K√P, hydrant), not a system solver.
- No **Smart Pipe** classification (branch / cross-main / main / arm-over / sprig) → BOM + hydraulics can't be correct.
- No **arm-over / arm-around / drop / sprig** routing intelligence.
- No **full O-snap suite** (endpoint / midpoint / intersection / perpendicular / node / extension glyphs) — the precision backbone of CAD.
- No **grip-handle editing of geometry** (drag an endpoint to re-shape a run); we move whole parts only.
- No **object Properties editing** (material / diameter / end-prep / K-factor / cost / labor).
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
| Typed Location-Input (length / dx,dy) | HAVE | polar angle entry, relative/absolute coord modes | M | P1 |
| Line / Rectangle / Arc / Circle primitives | PART | arc, circle, fillet not real | M | P2 |
| Insert Sprinkler (click-to-place tool) | PART | dedicated head-place tool w/ live coverage preview | M | P0 |
| Insert fitting / riser / valve / device | PART | device library place tools | M | P1 |
| Sketch underlay tracing | MISS | trace over imported plan | M | P2 |

### B. Object editing & manipulation
| AutoSPRINK tool | our status | what's missing | eff | pri |
|---|---|---|---|---|
| Select (single / window / crossing / all-like / by-id) | HAVE | fence-select, previous, last-edited | S | P2 |
| Direct grab-drag move | HAVE | snap-to-object-during-move, multi-part drag | M | P1 |
| **Grip-handle editing** (drag endpoints/vertices to reshape) | MISS | the core CAD edit gesture; only whole-part move + 1 endpoint exists | **L** | **P0** |
| Rotate / Mirror / Array / Offset / Trim-Extend / Scale / Copy | PART | basepoint/reference-angle UX, dynamic preview, multi-select targets | M | P1 |
| Stretch (drag a window edge) | MISS | window-stretch of vertices | M | P1 |
| Align / Distribute | MISS | — | S | P2 |
| Undo / Redo | HAVE | — | — | — |
| Cut / Copy / Paste (+ paste-to-point) | PART | paste at picked point, cross-drawing | S | P2 |

### C. Snapping & precision (the CAD backbone)
| AutoSPRINK tool | our status | what's missing | eff | pri |
|---|---|---|---|---|
| **O-snap suite** (endpoint/mid/intersection/perp/node/center/extension) w/ glyphs | PART | only grid/ortho; no per-type snap with on-screen glyph + tooltip | **L** | **P0** |
| Polar / Ortho tracking | PART | polar angle increments, tracking lines | M | P1 |
| Object snap tracking (acquire + align) | MISS | — | M | P2 |
| Dynamic input near cursor | PART | full coord/length/angle field | S | P1 |
| Snap settings dialog | MISS | per-snap on/off UI | S | P2 |

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
| **Smart Pipe** (branch/cross-main/main/arm-over/sprig classification) | MISS | blocks correct BOM + hydraulics | **L** | **P0** |
| Auto Branch Lines + couple to mains | MISS | branch topology, tie-ins | L | P0 |
| Arm-over on head placement | MISS | — | M | P1 |
| Arm-around obstructions (beams/ducts) | MISS | obstacle-aware routing | XL | P2 |
| Easy Drop / Sprig (vertical drops) | MISS | — | M | P1 |
| Sway brace / hanger insertion | MISS | seismic + support pass | L | P2 |
| Per-segment slope / elevation | PART | slope input, multi-elevation | M | P2 |
| Apply pipe schedule to whole system | PART | schedule cascade | M | P1 |

### G. Sprinkler heads & coverage
| AutoSPRINK tool | our status | what's missing | eff | pri |
|---|---|---|---|---|
| Auto coverage (round/rect, hazard spacing) | PART | under-counts vs truth; obstruction arming | L | P0 |
| Coverage/spacing check vs NFPA-13 | PART | live spacing violations overlay | M | P1 |
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
| **Object Properties editing** (material/diameter/end-prep/K/cost/labor) | MISS | the inspector is largely read-only | **L** | **P0** |
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
| Dimension / label engine | PART | aligned/linear/angular dims, leader text | M | P1 |
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
| Status bar (snap/grid/units/coords) | PART | live cursor coords, snap state | S | P1 |
| **Command line** (type a command/coords) | MISS | AutoCAD-class command parser | M | P1 |
| Command palette (Ctrl+K) | MISS | — | S | P2 |
| Properties panel (live, editable) | PART | wire to selection + BOM | L | P0 |
| Quick-access toolbar (user-pinned) | MISS | — | S | P3 |

---

## 2. P0 — the must-build core (what makes it an AutoSPRINK clone)

These are the load-bearing gaps. Nothing reads as "an AutoSPRINK clone" without them:

1. **Full O-snap suite** with on-screen glyphs (endpoint/mid/intersection/perpendicular/node/extension) — precision drafting backbone.
2. **Grip-handle editing** — drag endpoints/vertices of a selected run to reshape it.
3. **Live object Properties editing** — material, diameter, end-prep, K-factor, cost, labor on the selected part.
4. **Smart Pipe classification** — branch / cross-main / main / arm-over / sprig (unblocks correct BOM + hydraulics).
5. **Real hydraulic solve** — system-wide Hazen-Williams + **Hardy-Cross** loop/grid + fitting equivalent lengths.
6. **Remote-Area boundary tool** — draw the area, compute the demand.
7. **NFPA-format hydraulic report**.
8. **PDF/DWG → real building model** in the critical path (+ scale calibration).
9. **Insert/place tools** for heads + devices with live coverage/snap preview.

---

## 3. Phased build plan (hardest-and-most-defining first)

Each phase is a coherent, demoable vertical slice. Every function lands with a live-verified loop (select/draw/edit/calc → real effect → screenshot), never a flag-pass.

**Phase 1 — Precision drafting core** *(makes drawing feel like CAD)*
`osnap-suite (per-type + glyphs)` · `grip-handle drag-edit` · `stretch` · `polar/ortho tracking` · `command line + live cursor coords in status bar` · `dynamic-input coord/angle field` · `dimension engine (aligned/linear/angular + leaders)`.

**Phase 2 — System intelligence** *(makes the model a real sprinkler system)*
`Smart Pipe classification (branch/cross-main/main/arm-over/sprig)` · `auto branch-lines + tie-in to mains` · `arm-over + easy-drop/sprig` · `head insert tool + live coverage/spacing-violation overlay` · `apply-schedule cascade` · `object Properties editing (material/dia/end-prep/K/cost/labor)`.

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
