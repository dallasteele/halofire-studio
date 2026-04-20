# AutoSprink Feature Matrix — research vs HaloFire gap

> Sources: autosprink.com, autosprinkrvt.com, enginerio.com (AutoSprink
> design guide + AutoCAD comparison), autosprink.com/help/680 (NFPA
> report help), Scribd: AutoSPRINK Levels and Features, Scribd:
> AutoSPRINK VR 10 New Features, revitaddons.blogspot.com (RVT
> write-up).

Stored in the shared Brain on every save via HAL
`/brain/wiki/remember` (see `docs/research/brain_sync.sh`) so we
never lose context across sessions.

## 1. Product lines

| line | purpose | our equivalent |
|---|---|---|
| **AutoSPRINK VR** | stand-alone Windows CAD, 3D + hydraulics, MEPCAD's flagship | HaloFire CAD Studio (`apps/editor`) |
| **AutoSPRINK RVT** | Revit add-in — draws sprinkler systems inside Revit | *not planned* — we use glTF + IFC instead of going inside Revit |

## 2. Product tiers (VR line)

| tier | adds over previous | our coverage |
|---|---|---|
| **Lite** | basic AutoCAD interop, hydraulics, reports | ✅ DXF export, hydraulic agent, proposal HTML |
| **PRO** | auto-layout, optimization, conversion | ⚠️ auto-layout landed (placer); optimization is a gap |
| **Platinum** | solids modeling, interference checking, automatic arming around obstructions, control-area | ⚠️ solids in GLB ✅; interference checking is a gap; auto-arming around obstructions is a gap; control-area definition is a gap |

## 3. Design capabilities

| AutoSprink | HaloFire today | gap |
|---|---|---|
| Import AutoCAD / Revit plans | PDF/DXF/IFC intake (CubiCasa5k CNN for raster) | need: native DWG reader, RVT reader (or "clean" import wizard) |
| "Clean" imported plans (strip blocks/layers) | — | **GAP** — build a layer-filter tool |
| Lock imported file so it can't be moved | — | **GAP** — read-only source layer |
| Pipe, sprinkler, fitting libraries | 20 authored + 276 stubbed = 296 SKUs | need: OpenSCAD render path for the 276 stubs |
| Auto arm-over connections | router builds heads → branches | ⚠️ quality gap — AutoSprink's arm-over is commercial-grade |
| Auto branchline routing between heads + mains | router (Steiner, time-budgeted) | ⚠️ quality gap — need column/obstruction avoidance |
| Multi-angle riser-nipple connections | single-riser per system | **GAP** — multi-angle nipple |
| Apply pipe schedule to whole system at once | — | **GAP** — schedule cascade tool |
| 3D pipe/fitting/hanger modeling | GLB via SceneBootstrap + Auto-Design | ✅ parity once SCAD render lands |
| Slope + elevation control | pipes placed at level elevations | ⚠️ no per-segment slope input |
| Solid modeling + interference check | — | **GAP** — Platinum-tier feature |
| Auto-arming around obstructions | — | **GAP** — Platinum-tier feature |
| Control-area definition | — | **GAP** — Platinum-tier feature |

## 4. Hydraulic calculation

| AutoSprink | HaloFire today | gap |
|---|---|---|
| Integrated calc (no tool-switch) | `cad/schema.py` → `agents/04-hydraulic` | ✅ |
| One-click calc | Auto-Design panel button | ✅ |
| Remote-Area boundary — draw around flowing heads | agent picks farthest heads by graph distance | ⚠️ no interactive boundary tool |
| Two Remote Areas calculated together | single remote area | **GAP** |
| In-rack sprinkler demand | — | **GAP** — storage-occupancy support |
| Supply element types: Water Supply / Tank / FDC / user-defined | `FlowTestData` single supply, new pump + tank | ⚠️ partial — need named/multiple supplies |
| NFPA hydraulic summary report | proposal JSON has hydraulic block per system | ⚠️ need NFPA-format report page |
| Real-time calc updates in viewer | batch calc on Auto-Design | **GAP** — live recalc on edit |
| Color-code pipes by hydraulic condition | NFPA size colors ✅ | need: stress/velocity overlay mode |
| Hazen-Williams coefficients | `calc/hazen_williams.py` ✅ | ✅ |
| Loop/grid analysis | `LOOP_GRID_UNSUPPORTED` issue — honest §13 | **GAP** — real Hardy Cross solver |
| Fitting equivalent lengths | implicit in segment lengths | **GAP** — per-fitting Le tables |
| Pipe schedule method (NFPA tables) | explicit per Table | ✅ |

## 5. Reporting + deliverables

| AutoSprink | HaloFire today | gap |
|---|---|---|
| Stock listing / BOM | `generate_bom` → xlsx + json | ✅ |
| Hydraulic report PDF | proposal.pdf (reportlab) | ⚠️ not NFPA-format yet |
| Prefab drawings | — | **GAP** |
| Pipes < 3" flagged "DO NOT FAB" | — | **GAP** — add classifier |
| Cut sheets bundle (manufacturer PDFs) | listed in proposal deliverables | **GAP** — actual PDF merge |
| Submittal package (sheet set) | mentioned in deliverables JSON | **GAP** — cover/FP-H/FP-N/FP-R/FP-B/FP-D sheets |
| 2D drawing extract from 3D | plan SVG per level in proposal.html | ⚠️ need multi-sheet PDF |
| DXF export | `design.dxf` ✅ | ✅ |
| IFC export | `design.ifc` (IFC4 FireSuppressionTerminal) ✅ | ✅ |
| Plot/print | — | **GAP** — letter/tabloid sheet plotting |

## 6. BIM + coordination

| AutoSprink | HaloFire today | gap |
|---|---|---|
| MEPF clash detection | — | **GAP** — need BIM clash engine |
| Revit integration | — | *by design, we don't* |
| Export to other trades | IFC ✅ | ✅ |
| Linked files (arch + struct + MEP) | one-at-a-time intake | **GAP** |

## 7. UX (AutoSprink's actual on-screen feel)

| AutoSprink | HaloFire today | gap |
|---|---|---|
| Ribbon across the top (AutoCAD-style) | ✅ `Ribbon.tsx` (DESIGN/ANALYZE/REPORT tabs) | ✅ just landed |
| Status bar at bottom (snap/grid/units) | ✅ `StatusBar.tsx` | ✅ just landed |
| Tool palettes (heads/pipes/fittings) | sidebar `CatalogPanel` | ✅ |
| Property inspector | Pascal's node inspector | ⚠️ not HaloFire-skinned |
| Command palette (Ctrl+P) | — | **GAP** — command palette is an AutoCAD convention |
| Snap to pipe/grid/node | Pascal default | ✅ |
| Measure tool | button on ribbon, no handler | **GAP** — wire up |
| Section tool | button on ribbon, no handler | **GAP** |

## 8. Differentiators we should keep ("our twist")

AutoSprink is proprietary, licensed per-seat, Windows-only, and lives
inside one desktop app. Our twist:

1. **Open source top to bottom** — DuckDB pricing, OpenSCAD authoring,
   Blender/Three.js rendering, FastAPI pipeline, Next.js UI, Gemma
   LLM, IFC/glTF/DXF as the interop layer.
2. **Autonomous loop** — `openclaw-halofire` runs the bid from
   intake to submittal without a designer clicking through 60
   screens.
3. **Live pricing with audit trail** — every BOM line traces back
   to the exact price sheet (sha256) and the LLM confidence that
   extracted it. AutoSprink has no live-pricing layer at all;
   stocklist pricing is manually entered per project.
4. **Client-facing deliverable** — `proposal.html` with embedded
   3D + plan SVGs + NFPA-colored pipes is something AutoSprink
   doesn't generate.
5. **Agent-driven** — AutoSprink requires a human to run each
   command; we orchestrate the whole pipeline via OpenClaw-
   HaloFire's module scheduler.

## 9. Prioritized roadmap (next iterations)

In order of bid-quality impact:

1. **Fitting equivalent lengths** in hydraulics — currently ignored;
   calc precision will visibly improve
2. **Auto-arming around obstructions** — Platinum-tier feature; big
   visual + code win
3. **Live calc on edit** (real-time NFPA demand update) — UX win
4. **Two Remote Areas calculated together** — NFPA-13 code
   compliance for in-rack + ceiling together
5. **Prefab classification + "DO NOT FAB" flag** — directly saves
   the estimator money on the shop floor
6. **Submittal sheet set** (FP-0 cover / FP-H placard / FP-N levels /
   FP-R riser / FP-B BOM / FP-D details) — what Halo delivers to
   the AHJ
7. **Cut-sheet PDF bundle** — collate manufacturer data sheets per
   used SKU
8. **Command palette** (Ctrl+K / Ctrl+Shift+P) — AutoCAD-class UX
9. **Measure + Section tools** — already on the ribbon, need wiring
10. **OpenSCAD render path** for 276 stubbed SKUs — the gap I was
    mid-way through when this research pass started

## 10. Source hash

| source | fetched | summary |
|---|---|---|
| autosprink.com | 2026-04-19 | title only; detailed features behind client login |
| autosprinkrvt.com | 2026-04-19 | Revit add-in; real-time calc + auto arm-over + branchline routing + pipe-schedule cascade + color-coded hydraulic condition |
| enginerio.com/blog/designing-fire-protection-system-with-autosprink | 2026-04-19 | intake → clean → lock → place → size → fab-categorize → output stocklist + calc + prefab |
| enginerio.com/blog/software-to-design-fire-sprinkler-systems | 2026-04-19 | one-click hydraulics + BOM; superior 3D; template/symbol mgmt; MEPF clash |
| autosprink.com/help/680 | 2026-04-19 | NFPA hydraulic summary report supports named supplies + two remote areas (only help text visible; details gated) |
| Scribd AutoSPRINK Levels and Features | 2026-04-19 | tiers: Lite / PRO / Platinum; Platinum adds solids, interference check, auto arming, control area |
| revitaddons RVT write-up | 2026-04-17 | auto arm-over, branchline routing, riser-nipple, pipe schedule cascade, real-time calc + color-coded hydraulic visualization |
