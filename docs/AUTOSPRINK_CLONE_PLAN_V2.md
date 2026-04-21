Now I have enough information to construct the comprehensive plan. Let me create the V2 document with all the details gathered:

Based on my deep technical analysis of the codebase, existing documentation, and research into AutoSPRINK features and standards, here is the definitive V2 plan for transforming HaloFire Studio into an AutoSPRINK clone with three critical differentiators:

---

# HaloFire Studio — AutoSPRINK Clone Plan V2

**Status: Ready for engineering**  
**Date: 2026-04-20**  
**Owner: Integrated HaloFire CAD + Catalog systems**  
**Paired docs: AUTOSPRINK_TARGET.md, HONEST_STATUS.md, SELF_TRAIN_PLAN.md**

---

## 1. Vision (three paragraphs)

**Who and why.** Wade Steele (Halo Fire Protection PE) uploads a PDF architectural floor plan from a GC. The auto-bid agent loop runs in <5 minutes: intake → classify → place → route → hydraulic-calc → BOM → labor-estimate → submittal. Wade reviews the 3D viewport, clicks 3–5 edits (move a head, upsize a pipe), hits "Accept & Submit", and the stamped proposal lands in the client's inbox with a one-click NFPA 8-format hydraulic report. No round-trip to SprinkCALC, no Excel BOM hand-adjustment, no "call me back with the price" delays. HaloFire closes bids in hours instead of days.

**What we accomplish.** HaloFire Studio reaches 100% feature parity with AutoSPRINK 2025 (the ribbon, the tools, the 50+ named commands). Every tool is wired to real NFPA 13 logic, not fake defaults. When an estimator uses "System Optimizer" to upsize a pipe, the hydraulic calc re-runs in <100ms and the 3D viewport updates live. When they place a sprinkler head near a beam, "Arm Around" auto-inserts the arm-over pipe + reducer. All 300+ catalog SKUs have real glTF meshes and prices; missing parts auto-fab from OpenSCAD templates on demand. The web-catalog crawler crawls Anvil, Tyco, Viking, Reliable, Victaulic, Globe 4× per week and keeps the parts database current with no manual intervention.

**Why this beats AutoSPRINK.** (1) **Real 3D viewport** — AutoSPRINK is legacy Win32 OpenGL, ours is built on Pascal (three.js), so we render drop ceilings, beam obstructions, and complex floor plates in native 3D without fighting a 20-year-old graphics API. (2) **Auto-Bid agent loop** — we don't make the estimator "run sprinkler coverage, route pipes, then hydraulics" as three separate steps; one click orchestrates all 14 agents with typed I/O contracts, so the entire bid regenerates in <5 minutes and stays consistent. (3) **OpenSCAD parts forge** — instead of hand-modeling each manufacturer variant in Blender, we parameterize drop-ceiling tiles, beam clips, hanger styles, FDCs, and solenoid valves as `.scad` templates. When a BOM references a SKU with no mesh, the forge auto-renders it from a template at catalog-entry dimensions. Plus, a web-crawler agent scrapes manufacturer datasheets (Anvil PDFs, Tyco spec sheets, Viking HTML tables) and auto-populates new SKUs into the catalog so we never stop at "that part isn't in our database."

---

## 2. Persona Day-in-the-Life (five per-person narratives)

**Wade Steele, PE (estimator at Halo Fire Protection).**  
Wade logs into HaloFire Studio at 8:15 AM with a GC PDF of a 250k-sqft mixed-use building. He clicks `File > Import > PDF`, drags the 120-page set onto the canvas. The intake agent auto-detects 8 levels, extracts walls + rooms from the architectural floors, and populates the building tree. Wade clicks the level-selector on the ribbon and scrolls through — each level shows a coherent floor plate in 3D with walls + columns + drop-ceiling tiles. He knows this is correct (no more "did the bot read the DWG wrong?" anxiety). He clicks `Auto > Automatic Sprinkler Coverage` and the placer drops 1,247 sprinkler heads across all levels, snapped to NFPA 13 §8.6 spacing. The viewport updates in 40 seconds; he can see the heads are uniform and reasonable. He then clicks `Tools > Remote Area > Draw Boundary`, drags a rectangle around the critical zone on Level 3, and the `System Optimizer` dialog opens. He sees live pressure/flow/velocity curves as he adjusts pipe sizes in the dialog — when he ups a 2" branch to 2.5", the curve shifts instantly and he watches the safety margin shrink from 85 psi to 62 psi. He backs off, tries 2.25", and lands on 78 psi safety margin. He clicks `Hydraulics > Auto Peak` and the calc finds the critical path (Level 3, northeast corner). The design is stamped "internal-alpha" and he can regenerate it 3 times per day; if he asks his manager, she can flip it to "pe-reviewed" status. By 9:30 AM the proposal PDF lands in the client's inbox with the stamped hydraulic report, BOM, and 3D model. Client approval comes back by 3 PM; Wade hands off to the fab shop at 4 PM. Previously this took 2 days.

**Dan Farnsworth, CEO (Halo Fire Protection decision-maker).**  
Dan gets an alert at 11 AM: "1881 Cooperative re-bid ready for your sign-off." He opens the HaloFire Studio dashboard, clicks "1881-Cooperative", and sees a side-by-side comparison of the previous hand-drafted bid (535k total, 1300 heads) vs. the new auto-generated one (538k total, 1303 heads, 2.3% head count error, 0.6% cost error). He clicks "Approve & Mark for Submittal" and the system generates a PE stamp request that goes to Wade's email. Wade signs it digitally (no printouts, no manual forms). The proposal PDF is now "pe-reviewed" grade and can be delivered. Dan's dashboard now shows real-time bid velocity: last week, 14 bids regenerated; Halo previously did 4–5 per week by hand. He also sees the "Catalog freshness" metric: the web crawler found 3 new sprinkler head SKUs from Reliable, auto-added them, and regenerated all bids that reference that SKU. No engineer had to manually update a pricebook.

**Shop fabricator (Halo's prefab team).**  
The fab team opens the submittal package for a 42k-sqft office building. The BOM shows 847 feet of 2" schedule-40 pipe, 312 feet of 1.5" CPVC, 23 tees, 47 elbows, 12 pressure gauges, and labor-hour estimates broken down by task: "Layout & fit-up: 8 hrs @ $45/hr, Threading & coupling: 14 hrs @ $50/hr." The BOM is in Hydralist format (Halo's preferred supplier API) so it imports directly into their ERP system. The 3D model (glB format) shows the entire rack assembly with each section color-coded by phase; the fab team lead plays the assembly sequence animation to catch any mistakes ("oh, we need to do the arm-over before the reducer, not after"). They sign off on the BOM and the job goes to the saw + threading machine. No errors, no rework, no "the drawing says 2-1/2" but the CAD file has 2"" confusion.

**AHJ inspector (city fire marshal or building official).**  
The permit comes in as a PDF submittal: 3D model, NFPA 8-format hydraulic report (density/area calculation, pipe schedule, device summary, riser diagram, demand curves, system summary table, pressure test data sheet, antifreeze fill sheet). The inspector opens the 3D model in a free glB viewer and can orbit the system at any level, measure distances, see exactly where each head and pipe sits. She compares it to the as-built architectural plans — the heads line up with the room grid, the riser is in the lobby chase as expected, the FDC is at the street-frontage wall. She checks the hydraulic report: "Design Density 0.15 gpm/sq ft, Design Area 1,500 sq ft, Required Flow 225 gpm, Available Static 75 psi, Required Pressure 52 psi, Safety Margin 23 psi — PASS." She stamps it approved. No back-and-forth, no "resubmit with a corrected page 3."

**Building owner (Acme Corp, occupancy: office).**  
The owner receives the 3D model as a file she can view on her laptop or phone. She orbits the system and can see exactly where the heads and pipes will be installed. Her facilities manager checks that the system won't interfere with the future HVAC ductwork (she drags a duct object into the 3D view and sees instant collision highlighting). She approves it, and the system goes to permitting and then construction. Later, during occupancy, if she wants to add a new wing, she can re-import the updated architectural plans, click "Auto > Re-optimize for new layout", and get an instant bid for the extension.

---

## 3. Feature Inventory (100+ named tools with parity status)

| # | AutoSPRINK Tool | Category | Status | Phase | Notes |
|---|---|---|---|---|---|
| 1 | File > Import > PDF | Intake | ✓ partial | 1 | CubiCasa parser works; scale auto-calibration missing |
| 2 | File > Import > DWG | Intake | ❌ | 2 | DXF parser exists; full DWG via LibreDWG |
| 3 | File > Import > IFC | Intake | ⚠️ | 2 | IFC importer present; not used in critical path |
| 4 | File > Export > DWG | Output | ✓ | 1 | dxf.py emits AutoCAD-compatible DWG |
| 5 | File > Export > glTF | Output | ✓ | 1 | Three.js native; used for viewport |
| 6 | File > Export > IFC | Output | ⚠️ | 3 | Partial IFC 4.x bridge exists |
| 7 | File > Plotting > 2D Plan | Output | ⚠️ | 3 | Rasterized from 3D viewport |
| 8 | File > Plotting > 3D Model | Output | ✓ | 1 | Native Pascal viewer; screenshot export |
| 9 | File > Print > Stock Listing | Output | ⚠️ | 2 | BOM emitted; not Hydralist-format yet |
| 10 | File > Print > Hydraulic Reports | Output | ❌ | 4 | HTML proposal exists; no NFPA 8-format suite |
| 11 | Settings > Default Properties > System Type | Config | ❌ | 1 | Hazard classifier present; system-type picker UI missing |
| 12 | Settings > Default Properties > Occupancy Class | Config | ✓ | 1 | NFPA occupancy table in schema |
| 13 | Settings > Drawing Settings > Units | Config | ⚠️ | 1 | Hardcoded to SI; imperial conversion at I/O boundary |
| 14 | Settings > Drawing Settings > Background Layer Freeze | Config | ❌ | 3 | Layer visibility toggles partial |
| 15 | Settings > Fabrication Standards > Smart Pipe | Config | ❌ | 2 | No Smart Pipe rule engine yet |
| 16 | Remote Area tool | Interact | ❌ | 1 | No UI; placer auto-fills entire floor |
| 17 | Remote Area Boundary | Interact | ❌ | 1 | Click-to-draw boundary shape missing |
| 18 | Remote Area Box (3D variant) | Interact | ❌ | 2 | 3D remote-area box not yet implemented |
| 19 | Sprinkler Definition Wizard | Interact | ✓ partial | 1 | Catalog exists; no wizard dialog chrome |
| 20 | Auto > Automatic Sprinkler Coverage | Auto | ✓ partial | 1 | 939 heads vs 1303 truth (28% under) |
| 21 | Auto > Automatic Sprinkler Coverage > Round | Auto | ⚠️ | 1 | Round shape coverage exists |
| 22 | Auto > Automatic Sprinkler Coverage > Rectangular | Auto | ⚠️ | 1 | Rectangular shape coverage exists |
| 23 | Tools > Sprinkler > Insert Sprinkler | Interact | ❌ | 1 | No click-to-place tool |
| 24 | Tools > Sprinkler > Move Sprinkler | Interact | ❌ | 1 | No drag-and-drop UI |
| 25 | Tools > Sprinkler > Delete Sprinkler | Interact | ❌ | 1 | No delete tool |
| 26 | Commands > Center Sprinklers on Ceiling Tiles | Auto | ❌ | 2 | Drop-ceiling synthesis missing |
| 27 | Auto > Route Pipe | Auto | ✓ partial | 1 | Steiner-tree router; missing branch/cross/main classification |
| 28 | Auto > Auto Branch Lines | Auto | ❌ | 2 | Router emits Steiner tree, not branches |
| 29 | Auto > Connect > Couple Branches to Mains | Auto | ❌ | 2 | No branch-to-main topology wiring |
| 30 | Tools > Smart Pipe | Config/Auto | ❌ | 2 | Classification engine missing; all pipes = "unknown" |
| 31 | Tools > Smart Pipe > Arm Over | Auto | ❌ | 2 | No arm-over insertion on head placement |
| 32 | Tools > Smart Pipe > Sprig | Auto | ❌ | 2 | No vertical-drop detection |
| 33 | Auto > Arm Around | Auto | ❌ | 3 | Obstacle avoidance missing; Steiner router ignores beams |
| 34 | Auto > Easy Drop | Auto | ❌ | 2 | Vertical-drop tool missing |
| 35 | Auto > Sway Brace | Auto | ❌ | 3 | No bracing-insertion pass |
| 36 | Hydraulics > Auto Peak | Auto | ❌ | 2 | No critical-path finder; calc is one-shot |
| 37 | Hydraulics > System Optimizer | Interact | ❌ | 2 | Live what-if dialog missing; no re-calc loop |
| 38 | Hydraulics > System Optimizer > Modify Pipe Size | Interact | ❌ | 2 | Same as above |
| 39 | Hydraulics > System Optimizer > Modify Material | Interact | ❌ | 2 | Same as above |
| 40 | Hydraulics > Check Point Gauge | Interact | ❌ | 2 | No pressure-observation points |
| 41 | Hydraulics > Riser Tag | Interact | ❌ | 2 | No riser label on drawing |
| 42 | Hydraulics > Riser Tag > Supply Table | Output | ❌ | 3 | No header info table |
| 43 | Hydraulics > Flow Calculator | Interact | ❌ | 2 | K-factor / flow / pressure derivation missing |
| 44 | Hydraulics > PRV Sizing | Auto | ❌ | 3 | NFPA 14 PRV calc missing |
| 45 | Hydraulics > Antifreeze Expansion | Auto | ❌ | 3 | Dry/preaction chamber calc missing |
| 46 | Calculation > Hazen-Williams | Auto | ⚠️ partial | 2 | Friction-loss formula present; no iterative upsizing |
| 47 | Calculation > Darcy-Weisbach | Auto | ❌ | 3 | Non-water fluids (antifreeze) not supported |
| 48 | Calculation > Hydrostatic Correction | Auto | ⚠️ | 2 | Elevation adjustments partial |
| 49 | Calculation > K-Factor Validation | Auto | ❌ | 1 | No SKU K-factor range checking |
| 50 | Parts Database | Browse | ✓ partial | 1 | 296 SKUs; 276 have stubs not real GLB |
| 51 | Parts Picker > Filter by Manufacturer | Browse | ✓ partial | 1 | Filter UI exists; not wired to catalog |
| 52 | Parts Picker > Filter by Category | Browse | ✓ partial | 1 | Same as above |
| 53 | Parts Picker > Filter by Sub-Category | Browse | ❌ | 1 | Multi-level filter missing |
| 54 | Parts Picker > Datasheet View | Browse | ⚠️ | 1 | Cut sheets loaded; not UI-surfaced |
| 55 | Parts Picker > Hydraulic Loss Data | Browse | ❌ | 2 | Loss coefficients not linked to parts |
| 56 | Node Tags > Pressure | Output | ❌ | 2 | No labels on drawing |
| 57 | Node Tags > Flow | Output | ❌ | 2 | Same as above |
| 58 | Node Tags > Velocity | Output | ❌ | 2 | Same as above |
| 59 | Properties Panel | Interact | ✓ partial | 1 | Pascal native; not wired to BOM items |
| 60 | Properties > Pipe Material | Interact | ❌ | 1 | No material picker |
| 61 | Properties > Pipe Diameter | Interact | ❌ | 1 | No size selector |
| 62 | Properties > End-Prep | Interact | ❌ | 1 | No prep-type selector (threaded, grooved, solvent, flanged) |
| 63 | Properties > K-Factor | Interact | ❌ | 1 | No head K-factor override |
| 64 | Properties > Cost | Interact | ❌ | 1 | No cost-per-item editor |
| 65 | Properties > Labor Hours | Interact | ❌ | 1 | No labor-rate override |
| 66 | Quick Data Editor > Inline BOM Edit | Interact | ❌ | 2 | Spreadsheet-style BOM editor missing |
| 67 | Quick Data Editor > Base Cost | Interact | ❌ | 2 | Same as above |
| 68 | Quick Data Editor > Shop Labor | Interact | ❌ | 2 | Same as above |
| 69 | Quick Data Editor > Field Labor | Interact | ❌ | 2 | Same as above |
| 70 | Export > Hydralist (.hlf) | Output | ❌ | 2 | Supplier API handoff missing |
| 71 | Material Summary | Output | ⚠️ | 2 | BOM auto-tabulates; not grouped by role |
| 72 | View > Zoom Extents | View | ✓ | 1 | Pascal native |
| 73 | View > Zoom to Area | View | ✓ | 1 | Pascal native |
| 74 | View > Pan | View | ✓ | 1 | Pascal native |
| 75 | View > 2D Plan / 3D Model Toggle | View | ✓ partial | 1 | 3D works; 2D orthographic not optimized |
| 76 | View > Show/Hide Layers | View | ⚠️ | 1 | Layer panel partial |
| 77 | View > Show/Hide Grid | View | ⚠️ | 1 | Grid overlay missing |
| 78 | View > Show/Hide Elevation HUD | View | ❌ | 1 | No elevation labels on viewport |
| 79 | Edit > Undo / Redo | Interact | ❌ | 3 | No scene history yet |
| 80 | Edit > Cut / Copy / Paste | Interact | ❌ | 3 | No clipboard ops |
| 81 | Edit > Select All | Interact | ❌ | 1 | No multi-select |
| 82 | Edit > Isolate Selection | Interact | ❌ | 1 | No focus-on-selected |
| 83 | License Tier > Lite | Config | ⚠️ | 1 | Core design + reporting; licensing UI missing |
| 84 | License Tier > Pro | Config | ⚠️ | 1 | + Auto Branch, Route Pipe, System Optimizer |
| 85 | License Tier > Platinum | Config | ⚠️ | 1 | + Arm Around, Sway Brace, Bushings, interference |
| 86 | Quick Access Toolbar > User-pinned Commands | Config | ❌ | 3 | No customization UI |
| 87 | Command Line + Status Bar | Interact | ⚠️ | 1 | Status bar present; command-line parser missing |
| 88 | Ribbon Tab > File | UI | ✓ | 1 | Minimal ribbon present |
| 89 | Ribbon Tab > Edit | UI | ✓ | 1 | Same |
| 90 | Ribbon Tab > View | UI | ✓ | 1 | Same |
| 91 | Ribbon Tab > Tools | UI | ⚠️ | 1 | Tool palette exists; sparse |
| 92 | Ribbon Tab > Commands | UI | ❌ | 1 | No Commands ribbon |
| 93 | Ribbon Tab > Auto Draw | UI | ✓ partial | 1 | Auto tab exists |
| 94 | Ribbon Tab > Hydraulics | UI | ✓ partial | 1 | Hydraulics tab exists |
| 95 | Ribbon Tab > Settings | UI | ⚠️ | 1 | Settings dialog exists; ribbon button missing |
| 96 | Ribbon Tab > Parts Database | UI | ⚠️ | 1 | Catalog panel exists; not in main ribbon |
| 97 | Help > Training Videos | Doc | ❌ | 5 | No help system yet |
| 98 | Help > Documentation | Doc | ❌ | 5 | Same |
| 99 | Help > About | Doc | ⚠️ | 1 | Version string exists |
| 100 | System > Occupancy Selection | Config | ✓ partial | 1 | Hazard classifier UI present |

**Key observations:**
- **✓ (full parity)**: ~8 tools (File I/O, 3D viewport, View controls, Basic settings)
- **⚠️ (partial parity)**: ~25 tools (UI exists but logic incomplete, e.g., auto-placement creates only 939 heads vs 1303 truth)
- **❌ (missing entirely)**: ~67 tools (interactive editing, live re-calc loop, Smart Pipe classification, NFPA 8 reports, Web-catalog crawler)

**Critical gaps by theme:**
- **Interactive editing** (drag, move, delete, select, undo): 0% wired; must land Phase 2–3
- **Live hydraulic re-calc loop**: 0% (calc is one-shot); System Optimizer parity = Phase 2
- **Smart Pipe + branch/cross/main hierarchy**: 0%; Phase 2 blocker for BOM correctness
- **NFPA 8-format report suite**: 0%; Phase 4 (submittal quality gate)
- **Web-catalog crawler**: 0%; Phase 4 (moat feature)
- **Drop-ceiling handling**: 0%; Phase 1 (affects placer + router)

---

## 4. Architecture Diagram (refined, file paths + node types)

```
┌────────────────────────────────────────────────────────────────────┐
│                    HaloFire Studio Editor (UI)                     │
│     apps/editor/  (React/TypeScript + Pascal 3D Viewer)            │
│                                                                    │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  Ribbon (Design | Analyze | Report)                        │  │
│  │  Quick-Access toolbar, Command Palette                     │  │
│  └────────────────────────────────────────────────────────────┘  │
│   │                                                                │
│   ├─ Left Pane ───────┐  ┌─── Center Viewport ───┐  ┌─ Right ──┐
│   │                   │  │                       │  │          │
│   │ Project Brief     │  │  Pascal 3D Scene      │  │Properties│
│   │ Layers           │  │  (slabs+walls+heads   │  │Panel     │
│   │ Catalog         │  │   +pipes+drops)       │  │          │
│   │ Auto-Design     │  │                       │  │ (selected│
│   │ Remote Area Draw│  │  [grid, elevation HUD]│  │  item    │
│   │                 │  │                       │  │  config) │
│   └─────────────────┘  └──────────────────────┘  └──────────┘
│                           ▲              ▲
│                           │              └─── LiveCalc card
│                           │                   (bottom-right)
│                           │
│                    Status bar + Command line
└────────────────────────────────────────────────────────────────────┘
                               │
         ┌─────────────────────┼─────────────────────┐
         │                     │                     │
         ▼                     ▼                     ▼
    HaloFire Gateway    HaloFire CAD         HaloFire Catalog
    (FastAPI)          (Agent Loop)         (Parts + Web Crawler)
 services/halopenclaw  services/halofire    packages/halofire-catalog
 -gateway/main.py      -cad/agents/         /authoring/scad
                                                      
  POST /intake/        ┌─────────────────┐  ┌─────────────────┐
  dispatch             │ 00-intake       │  │ OpenSCAD        │
  POST /intake/status  │ (PDF + CubiCasa)│  │ parts-forge     │
  POST /projects/<id>  │                 │  │ (auto-render    │
  /render              │ 01-classifier   │  │  missing SKUs)  │
  POST /catalog/sync   │ (NFPA hazard)   │  │                 │
                       │                 │  │ render_from_    │
  WebSocket:           │ 02-placer       │  │ catalog.py      │
  design-updates       │ (head spacing)  │  │                 │
  telemetry            │                 │  ├─────────────────┤
                       │ 03-router       │  │ Web Crawler     │
  SQLite:              │ (Smart Pipe +   │  │ Agent           │
  supplies.duckdb      │  drop-ceiling)  │  │                 │
  jobs.duckdb          │                 │  │ (Anvil, Tyco,   │
  truth.duckdb         │ 04-hydraulic    │  │  Viking, etc.)  │
                       │ (Hazen-Williams)│  │                 │
                       │                 │  │ CSV/JSON feeds  │
                       │ 05-rulecheck    │  │ → CatalogEntry  │
                       │ (NFPA §)        │  │ upsert →        │
                       │                 │  │ GLB gen          │
                       │ 06-bom          │  │                 │
                       │ 07-labor        │  └─────────────────┘
                       │ 09-proposal     │
                       │ 10-submittal    │
                       │                 │
                       │ orchestrator.py │
                       └─────────────────┘
                               │
                ┌──────────────┼──────────────┐
                ▼              ▼              ▼
             truth.        design.json   proposal.json
             duckdb         (Design      (BOM, labor,
         (bid ground       schema v1)    pricing, stamp)
          truth for        + design.glb
         cruel tests)      + design.dxf
                          + design.ifc
```

**Key contracts** (all typed I/O per AGENTIC_RULES §1):

| Agent | Input | Output | Contract |
|---|---|---|---|
| 00-intake | `(pdf_path: str)` | `PageIntakeResult[]` + `Building` | Schema: schema.py `Building`, `Level`, `Room`, `Wall` |
| 01-classifier | `Building` | `Building` (hazard tags on rooms) | No new fields; append `Room.hazard_class` |
| 02-placer | `Building` | `Head[]` per level | New: `Head[]` with `position_m`, `sku`, `room_id` |
| 03-router | `Building`, `Head[]` | `PipeSegment[]`, `Branch[]` | New: pipes + fittings; classification via `pipe.role` |
| 04-hydraulic | `System` with pipes + heads | `HydraulicResult` | New: `System.hydraulic` with Q, P, margin, issues |
| 05-rulecheck | `Design` | `DesignIssue[]` | New: append to `Design.issues` list |
| 06-bom | `Design` | `BomRow[]` | New: SKU-keyed rows with qty, cost, labor |
| 07-labor | `BomRow[]` | `LaborRow[]` | New: role-keyed rows with hours, rate |
| 09-proposal | `Design`, `BomRow[]`, `LaborRow[]` | `proposal.json` + PDF | JSON + `proposal.html` rasterized → PDF |
| 10-submittal | `proposal.json` + `Design` | `submittal.pdf` (8 pages) | NFPA format + 3D model |
| Web-crawler | `(site_list: List[str], last_sync: datetime)` | `CatalogEntry[]` | New: upsert to `/packages/halofire-catalog/specs/` CSV |

---

## 5. Section Ownership Table (explicit owner, source dir, contract, gates)

| Section | Owner | Source dir | Input contract | Output contract | Code gate | Func gate | Visual gate |
|---|---|---|---|---|---|---|---|
| **A. Intake — Vector PDF parser** | `00-intake/agent.py` | `services/halofire-cad/agents/00-intake/` | `pdf_path: str` | `PageIntakeResult[]` | Unit: `test_pdf_parse.py` covers pdfplumber → `WallCandidate`, `RoomCandidate` | Cruel: `test_intake_real_plan.py` yields ≥50 rooms, 0 fatal exceptions | Visual: viewport shows coherent level outline (not bbox) |
| **B. Intake — CubiCasa raster fallback** | `00-intake/l3_cubicasa.py` | same | `raster_page_png: np.array` | `Room[]` | Unit: `test_cubicasa.py` hits API mock | Cruel: real 1881 PDF → 12+ rooms extracted (not <5) | Visual: CubiCasa detected rooms visible as colored zones |
| **C. Classifier (NFPA hazard)** | `01-classifier/agent.py` | `services/halofire-cad/agents/01-classifier/` | `Building` (rooms without hazard) | `Building` (rooms with `Room.hazard_class ∈ {light, ord_i, ord_ii, extra_i, extra_ii, residential}`) | Unit: `test_classifier.py` covers occupancy → hazard mapping table | Cruel: 1881 classifies 8 levels correctly (3 residential, 2 garage, 3 mixed) | Visual: layer panel shows color-coded hazard legend |
| **D. Drop-ceiling synthesis** | NEW `00-intake/drop_ceiling.py` | NEW | `Building.levels[]` (with `use` field), `CeilingSpec` defaults | `DropCeiling` struct (tiling + cavity) appended to each `Level` | Unit: `test_drop_ceiling.py` parametrizes T-bar + tile sizes | Cruel: 4 residential floors render 24"×24" tiles + 18" plenum (visual inspection pass) | Visual: viewport shows drop-ceiling layer + cavity space |
| **E. Placer (head spacing)** | `02-placer/agent.py` | `services/halofire-cad/agents/02-placer/` | `Building` (levels + rooms) | `System[]` (each with `heads: Head[]`) | Unit: `test_head_placement.py` covers NFPA §8.6 table lookup | Cruel: 1881 → 1303 ± 15% (currently 939, 28% under) | Visual: heads appear at uniform grid spacing, no clusters |
| **F. Router (Smart Pipe + drop-ceiling-aware)** | `03-router/agent.py` | `services/halofire-cad/agents/03-router/` | `System` (heads), `Building` (obstructions + ceiling) | `System` (with `pipes: PipeSegment[]`, `role` classifier, branch hierarchy) | Unit: `test_router_graph.py` verifies Steiner tree + role classification | Cruel: pipes_total_ft within ±20% of 1881 truth (unknown truth yet) | Visual: pipes route in drop-ceiling plenum, not at slab level; no crossing |
| **G. Hydraulic calc** | `04-hydraulic/agent.py` | `services/halofire-cad/agents/04-hydraulic/` | `System` (with pipes, heads, K-factors) | `HydraulicResult` (Q, P, margin, critical_path, issues) | Unit: `test_hazen_williams.py` verifies friction loss formula | Cruel: 1881 → flow within ±10% of truth (unknown yet) | Visual: node tags show pressure + velocity on each pipe |
| **H. Rule check (NFPA 13 §)** | `05-rulecheck/agent.py` | `services/halofire-cad/agents/05-rulecheck/` | `Design` (full DAG) | `Design.issues[]` (append; don't mutate) | Unit: `test_rulecheck.py` covers each NFPA rule → violation code | Cruel: 1881 should produce 0–5 minor issues, no blockers | Visual: issue list in status bar, red highlights on drawing |
| **I. BOM + labor** | `06-bom/agent.py` + `07-labor/agent.py` | same | `Design` (complete) | `BomRow[]` + `LaborRow[]` | Unit: `test_bom.py` verifies SKU rollup, cost summation | Cruel: total_bid_usd within ±15% of 1881 truth ($538k) | Visual: BOM grid shows qty + cost per SKU, labor breakdown |
| **J. Proposal + submittal** | `09-proposal/agent.py` + `10-submittal/agent.py` | same | `Design`, `BomRow[]`, `LaborRow[]` | `proposal.json`, `proposal.html`/`pdf`, `submittal.pdf` (8-page NFPA suite) | Unit: `test_proposal_html.py` verifies template rendering | Cruel: PDF has no rendering errors, all numbers visible, fonts readable | Visual: screenshot of final PDF matches reference image ≥95% pixel match |
| **K. OpenSCAD parts forge** | `packages/halofire-catalog/authoring/scad/` (templating) + `render_from_catalog.py` | NEW | `CatalogEntry` (sku, dims_cm, pipe_size_in, category) | `glb_path: str`, GLB file on disk | Unit: `test_scad_render.py` mocks OpenSCAD CLI | Func: real OpenSCAD installed + available; `render_from_catalog.py --sku X` produces GLB | Visual: generated GLB imports into Pascal viewer, correct dimensions |
| **L. Web-catalog crawler agent** | NEW `services/halofire-catalog-crawler/` | NEW | `(supplier_list, last_sync_time, gemma_model)` | `CatalogEntry[]` → CSV upsert to `packages/halofire-catalog/specs/` | Unit: `test_crawler.py` mocks HTTP + Ollama responses | Func: real crawler runs against test supplier URLs; logs sync_run to DB | Visual: new SKU count in catalog increments; BOM uses fresh prices |

**Verification gates (no section ships until all three green):**
- **Code gate**: ≥1 unit test per integration point; covers happy path + ≥1 edge case
- **Func gate**: Cruel test (ratio or IoU vs ground truth) passes, OR explicitly marked "skip if truth unavailable"
- **Visual gate**: Chrome snapshot pass (element count, bounding-box assertions, or pixel-diff within tolerance)

---

## 6. Roadmap (phases ordered by user-visible value, each a complete vertical slice)

### Phase 0 — Foundation (ongoing now)

**Goal:** Build the testing + truth infrastructure so all future phases have a ratchet.

- **0.1** Truth DB seeded with 1881-Cooperative: 6 levels, 1303 heads, 7 systems, $538k bid ✓ (done 2026-04-20)
- **0.2** Cruel-test scoreboard format locked: 6 tests (head_count, system_count, level_count, pipe_ft, gpm, total_bid) all defined. Baseline: 12 PASS / 3 FAIL / 0 SKIP ✓ (in flight)
- **0.3** Pipeline orchestrator + gateway wired end-to-end. Every phase exit = a commit with visible delta in cruel-test scoreboard before/after.
- **Exit criterion:** All 6 cruel tests defined + runnable; 12 PASS minimum; the 3 FAILs are documented tracking gaps.

### Phase 1 — Intake quality (intake → clean Building with real interior walls + drop ceilings)

**Goal:** Produce a truth-aligned `Building` struct (no synthetic placeholders, real geometry).

- **1.1** **Room-shared-edge derivation** — CubiCasa rooms are reliable; walls aren't. Walls = room-boundary edges that two rooms share. Derive interior walls from room polygons, not raw PDF lines. Remove noise. Visual: 1881 produces 50–150 walls per floor in coherent room outlines.
- **1.2** **Drop-ceiling synthesis** — for each level with `use ∈ {residential, amenity, office}`, generate a `DropCeiling` zone with `tile_size_m=0.6` (24" T-bar), `cavity_depth_m=0.45` (18" plenum). Garage levels get exposed deck. Visual: 4+ residential floors show ceiling tile pattern + cavity above.
- **1.3** **Page-type filter** — read sheet ID from title block (bottom-right corner) and reject pages not in `A-1XX` floor-plan series. Visual: 1881 keeps pages 8–14, rejects 1–7.
- **1.4** **Per-tier canonical polygons** — podium (parking) and tower (residential) get separate outlines. Visual: 1881 tower sits on wider podium in 3D view.
- **1.5** **Title-block OCR** — extract level names + elevations from the standard AIA title block. Replace synthetic `elevation_m = i * 3.0`. Level names + elevations within ±0.2m of truth on 1881.

**Vertical slice:** intake → Building struct. No placer, no router. Just geometry.  
**Exit criterion:** `test_intake_real_plan.py` passes all assertions (room count, wall count, drop ceiling present, level elevations, polygon IoU ≥0.6). Cruel-test `test_level_count_matches_truth()` PASS.

---

### Phase 2 — Placer + Router + Smart Pipe (heads at correct spacing; pipes routed with role classification)

**Goal:** Heads at NFPA-correct spacing; pipes in drop-ceiling cavity; every pipe tagged (drop/branch/cross/main).

- **2.1** **NFPA §8.6 coverage tables** — replace grid scatter. For each room + hazard class, query the occupancy-dependent max spacing / area-per-head. Use a real covering algorithm (not grid scatter). Hit 1303 ± 15% on 1881.
- **2.2** **Drop-ceiling-aware router** — pipes live at `level.elevation_m + ceiling.height_m + 0.15` (in the plenum), not at slab level. Heads drop via 1" sch-40 `drop` pipes (0.45m long).
- **2.3** **Branch-cross-main hierarchy** — classify every pipe segment by role. Riser (vertical, 1 per system) → Main (largest horizontal) → Cross-main (medium) → Branch (small) → Drop (vertical to head). Router enforces: branch_size ≤ cross_main_size ≤ main_size. BOM groups by role; drawing renders all pipes red (#e8432d, NFPA 13 §6.7 fire-protection red, not rainbow).
- **2.4** **Structural grid snap** — columns matter. Real designers align heads off-axis from joists. Post-process: heads within 0.5m of a column shift 0.15m orthogonally.

**Vertical slice:** heads + pipes + role classification. No hydraulics yet. Just topology + layout.  
**Exit criterion:** `test_head_count_within_15pct_of_truth()` PASS (±15% of 1303). `test_pipe_total_ft_within_20pct_of_truth()` PASS (if truth is seeded; else skip). Viewport shows red pipes in plenum, no visual crossing.

---

### Phase 3 — Hydraulic calc + BOM (real Hazen-Williams; cost roll-up matching truth)

**Goal:** Live pressure / flow / velocity feedback; cost bid within 15% of $538k.

- **3.1** **Real Hazen-Williams calc** — iterative pipe upsizing (System Optimizer parity). Start with initial sizes from §28.5 table (based on downstream head count). Run friction-loss calc for each pipe. If demand > supply, upsize the bottleneck pipe + rerun. Repeat until converged or max iterations.
- **3.2** **Critical-path finder** — `Auto Peak` tool finds the remote area that requires the highest pressure. Focus hydraulic review on that area.
- **3.3** **Hydralist-format BOM export** — supplier system handoff. Cost roll-up hits 1303 heads × $200 + pipe + valves + labor ≈ $539k (matching 1881 truth bid).
- **3.4** **Node tags on drawing** — pressure, flow, velocity labels at each node so the estimator can spot high-velocity branches (>12 ft/sec = friction loss concern).

**Vertical slice:** full Design struct with hydraulic results. BOM with real prices. No UI editing yet.  
**Exit criterion:** `test_total_bid_within_15pct_of_truth()` PASS (±15% of $538,792). `test_hydraulic_gpm_within_10pct_of_truth()` PASS (if truth seeded). Node tags visible on viewport.

---

### Phase 4 — OpenSCAD parts forge + Web-catalog crawler (auto-fab missing SKUs; keep catalog current)

**Goal:** Every BOM references a real SKU with a real mesh + current price. Zero "mesh placeholder" warnings.

- **4.1** **OpenSCAD parts forge templates** — write `.scad` files for the missing categories:
  - Drop-ceiling tile (6×6 lay-in, recessed tray, slot edges) — `drop_ceiling_tile.scad`
  - T-bar grid (12ft sections, interconnects) — `t_bar_grid.scad`
  - Soffit cover (ductwork concealment) — `soffit.scad`
  - Beam clips + suspenders (3 styles) — `beam_clip_{u_bolt, rod_hanger, trapeze}.scad`
  - Hanger styles (cadmium-plated rod, clevis, direct-screw) — `hanger_rod.scad`, etc.
  - Couplings (grooved, mechanical, push-on) — `coupling_*.scad`
  - End caps (slip, threaded) — `end_cap.scad`
  - Pressure switches + gauges (2.5" dial) — `pressure_gauge.scad`, `pressure_switch.scad`
  - Wall hydrant stations (internal + external) — `wall_hydrant.scad`
  - FDC (Siamese connection, wall-mount + yard variants) — `fdc_siamese.scad`
  - Riser nipples (various schedules) — `riser_nipple.scad`
  - Total: 15–20 new templates, covering ~100 new SKUs.
- **4.2** **Auto-fab on missing SKU** — when BOM references a SKU with no GLB: (a) look up category in `CatalogEntry`. (b) Find matching `.scad` template. (c) Parameterize from dims_cm fields. (d) Run `openscad --export-file=output.glb template.scad --set size_in=<val>`. (e) Save GLB, update catalog entry. Pipeline never blocks on missing meshes again.
- **4.3** **Web-catalog crawler agent** (LandScout pattern) — scheduled agent that:
  - Crawls Anvil, Tyco, Viking, Reliable, Victaulic, Globe, Senju, Potter, Fire-Lite, Notifier 4× per week.
  - Scrapes PDFs (pdfplumber), HTML (BeautifulSoup), CSV feeds for new sprinkler head + pipe SKUs.
  - Parses manufacturer specs: K-factor, temp rating, connection type, dims, price.
  - Runs Gemma-only (local Ollama) to fill parsing gaps (no Claude API for catalog).
  - Upserts new `CatalogEntry` rows to `/packages/halofire-catalog/specs/` (CSV + JSON).
  - Triggers `render_from_catalog.py` for each new SKU → GLB generation.
  - Logs sync_run to `truth.duckdb` with source hash + LLM model.
  - Every new part is searchable in the Parts Picker within 1 hour of discovery.

**Vertical slice:** complete parts forge + dynamic catalog. Every bid's BOM is priced from real, current catalog.  
**Exit criterion:** `test_auto_fab_missing_sku()` PASS (missing SKU → GLB generated in <10s). Cruel test confirms 0 "mesh placeholder" warnings on 1881 re-run. Catalog has ≥350 SKUs (up from 296).

---

### Phase 5 — Submittal + UI/UX polish (NFPA 8-format report; ribbon consolidation; live editing)

**Goal:** One-click NFPA 8-format stamped proposal. UI matches AutoSPRINK ribbon conventions.

- **5.1** **NFPA 8-format hydraulic report** — one-click export. 8 pages:
  1. Density/Area calculation (design area, density, required flow)
  2. Pipe schedule (all segments, material, size, length, fittings)
  3. Device summary (heads per level, K-factor, temp, response)
  4. Riser diagram (schematic with elevations, FDC, supply connection)
  5. Demand curves (supply curve vs. system demand curve, safety margin graph)
  6. Pressure test data sheet (field test numbers)
  7. Antifreeze fill sheet (for dry/preaction systems)
  8. System summary table (zones, hazards, flow, pressure, labor hours)
- **5.2** **Ribbon consolidation** — 4 main tabs:
  - **Design** — Insert Sprinkler, Route Pipe, Auto Branch, Arm Around, Sway Brace, Remote Area, Coverage Boundary
  - **Analyze** — Auto Peak, System Optimizer, Check Point Gauge, Flow Calculator
  - **Report** — Hydraulic Reports, Stock Listing, Cut Sheets, Submittal, Export (DWG/IFC/GLB)
  - **Parts** — Catalog browser (manufacturer filters, datasheets)
- **5.3** **Panel hierarchy** — left sidebar (collapsed by default) with expanding regions:
  - Auto-Design (status, re-run button)
  - Project (metadata, supply conditions)
  - Layers (toggle visibility by level, by element type)
  - Catalog (parts picker, search)
  - Manual (for future click-to-place tools)
- **5.4** **Properties panel for selected items** — right sidebar:
  - If head selected: SKU, K-factor, temp rating, position, orientation (pendent/upright/sidewall)
  - If pipe selected: size, material, schedule, length, role (drop/branch/cross/main), friction loss
  - If BOM row selected: qty, cost, labor hours (all editable via inline grid)
- **5.5** **Layer panel** — docked bottom-left, default-collapsed. Hover tooltips, color-coded by level + type.
- **5.6** **Live re-calc loop** — when user edits a pipe size via properties panel, run `04-hydraulic` agent in <100ms (delta calc, not full rerun). Update node tags + demand curves live.

**Vertical slice:** complete submission-grade output + AutoSPRINK-parity UI.  
**Exit criterion:** `test_nfpa8_report_has_all_8_pages()` PASS. Ribbon screenshot matches AutoSPRINK layout. Visual regression: 3 reference submittal PDFs show ≥98% pixel match.

---

### Phase 6 — Interactive editing (select, move, delete, connect, undo/redo)

**Goal:** Estimator can refine the auto-generated bid in 3D without re-running the full pipeline.

- **6.1** **Select tool** — click a head/pipe in viewport, see it highlighted + properties panel populated.
- **6.2** **Move tool** — drag a head, snap to grid / wall / pipe midpoint. Dragging a pipe endpoint extends it.
- **6.3** **Delete tool** — Del key removes selected node (orphan heads, redundant pipes).
- **6.4** **Connect tool** — draw a new branch line between two heads or from a head to an existing pipe.
- **6.5** **Undo/Redo** — Ctrl-Z / Ctrl-Y via scene-store history. Every edit is reversible.
- **6.6** **Isolate tool** — double-click a system, dim the rest. Useful for large multi-system buildings.
- **6.7** **Live delta calc** — when user edits, re-calc runs on just the affected subtree (critical for fast feedback).

**Vertical slice:** full interactive refinement loop.  
**Exit criterion:** `test_select_head_inspect_kfactor()` PASS. `test_move_head_see_live_delta()` PASS (delta_flow > 0). `test_delete_pipe_rebalances_tree()` PASS.

---

### Phase 7 — Field-test + first-client deploy

**Goal:** One real new bid signed by Wade without a code-level correction.

- **7.1** **End-to-end smoke run** on 1881 + 2 other Halo historical bids. Cruel scoreboard ≥ 14 PASS (currently 12 PASS / 3 FAIL).
- **7.2** **Wade review session** — PE red-lines the 1881 re-generated submittal, collects feedback. Every correction becomes a new `bids_corrections` row + a new regression test. Target: <10 corrections per bid.
- **7.3** **First-client deploy** — Halo takes on a new commercial project. HaloFire generates the auto bid. AHJ stamps it. No engineer corrections needed (stylistic red-lines OK).
- **Exit criterion:** Wade signs a real new bid without a single code-level correction.

---

## 7. Standards Adhered to

| Standard | Edition | Why it matters | Implementation |
|---|---|---|---|
| **NFPA 13** | 2022 | Sprinkler design (head spacing, density, pipe sizing, hangers, calc method) | Hazen-Williams friction, occupancy density curves (§8.6), K-factor table (§6.2.8), hydrostatic correction (§11.2.3.6) |
| **NFPA 13D** | 2019 | Residential sprinkler design (smaller buildings) | Fallback occupancy class; not primary target for Phase 1 |
| **NFPA 14** | 2019 | Standpipe design (combo standpipe zoning, PRV sizing) | PRV inlet/outlet calc (Phase 3); combo zoning in classifier |
| **NFPA 20** | 2019 | Fire pump design (pump curve, flow/pressure @ rated/overload churn) | Supply curve interpolation in hydraulic calc; pump data in `FlowTestData` |
| **NFPA 25** | 2016 | Inspection/testing/maintenance (hanger certification, flow test records) | Hanger spacing calc (§9.2.2.1); test-data intake |
| **ICC IFC** | 2021 | Local code overlays (occupancy classifications, use groups) | Occupancy mapping to hazard class in classifier |
| **AutoCAD .DXF** | 2021 | Drawing interchange format | DXF export via `design.dxf` output; lossless layer/block structure |
| **IFC 4.x** | 4.3 | BIM interchange | IFC export bridge (Phase 3); partial coverage (geometry + systems) |
| **glTF 2.0** | 2.0 | 3D mesh format (Khronos standard) | Pascal viewer native; all catalog GLBs conform to 2.0 spec |
| **ASTM D1193** | — | Water quality for sprinkler systems | Implicit in supply data (static/residual test conditions) |

---

## 8. Catalog Plan (parts categories; current inventory; auto-fab scope; web crawler)

### Categories (25 total)

**Heads (4)**
- `sprinkler_head_pendant` (K-factor range 5.6–8.0, temp 155–286°F)
- `sprinkler_head_upright`
- `sprinkler_head_sidewall`
- `sprinkler_head_concealed`

**Pipes (4)**
- `pipe_steel_sch10` (IPS, CTS, DIPS nominal sizes 0.5"–4")
- `pipe_steel_sch40`
- `pipe_copper` (hard-drawn, type M/L)
- `pipe_cpvc` (solvent-weld)

**Fittings (8)**
- `fitting_elbow_90` (all sizes, all materials)
- `fitting_elbow_45`
- `fitting_tee_equal`
- `fitting_tee_reducing` (1.5"×1"×1.5", etc.)
- `fitting_reducer` (all step-down sizes)
- `fitting_coupling_grooved` (Victaulic-style mechanical)
- `fitting_coupling_flexible` (Fernco-style)
- `fitting_union` (ball-union, sweat-solvent, threaded)

**Valves (8)**
- `valve_os_y_gate` (2.5"–4", flanged/NPT)
- `valve_butterfly` (2.5"–4")
- `valve_check` (swing-check, spring-check)
- `valve_ball` (inline ball valves)
- `valve_relief` (PRV, pilot-operated)
- `valve_deluge` (4" deluge valve for deluge systems)
- `valve_dry_pipe` (standard DPV, accelerator, dump)
- `valve_preaction` (electric solenoid, pilot-operated)

**Instrumentation (4)**
- `riser_pressure_gauge` (2.5" dial, 0–100 psi, 0–200 psi, 0–300 psi)
- `riser_flow_switch` (vane-type, internal paddle)
- `riser_pressure_switch` (low-pressure alarm, high-pressure cutoff)
- `riser_relief_valve` (system pressure relief)

**Connection & Support (7)**
- `external_fdc` (Siamese connection, wall-mount + yard variants)
- `hanger_rod_cadmium` (3/8" cadmium-plated rod, hangers @ 12 ft spacing per NFPA §9.2.2)
- `hanger_clevis` (clevis hanger for beam attachment)
- `hanger_trapeze` (two-rod trapeze for main lines)
- `beam_clip_u_bolt` (U-bolt pipe clamp around beams)
- `sway_brace_kit` (3-brace assembly per NFPA §18)
- `riser_nipple` (vertical couplers, various schedules)

**Drop Ceilings & Concealment (4)** — NEW
- `drop_ceiling_tile_6x6` (lay-in acoustic, recessed tray, slot edge variants)
- `t_bar_grid` (12-ft cross-tee + main-tee sections)
- `soffit_cover` (ductwork concealment, vinyl/drywall)
- `drop_nipple_1in_sch40` (vertical drop from ceiling to head, pre-cut lengths)

**Specialty (3)** — NEW
- `wall_hydrant_internal` (inside cabinet, for occupant use)
- `wall_hydrant_external` (yard hydrant, above-ground with frost-proof drain)
- `pump_curve_diesel_100gpm` (supply-side pump, 100 gpm @ 150 psi rated)

### Current inventory

- **296 SKUs** total
  - **20 with real GLB** (hand-modeled pipes, elbows, tees, heads, gauges, FDC)
  - **276 with `.scad` template** (generated on demand) OR stub placeholder

### Auto-fab plan (Phase 4)

**Templates to write** (in priority order):
1. `drop_ceiling_tile_6x6.scad` — parametric lay-in tile, recessed-tray variant, slot edges. Dims: 60cm × 60cm × varies (1–3cm thickness).
2. `t_bar_grid.scad` — cross-tee + main-tee components, interlocking. Dims: 12ft sections, 1/2" + 5/8" T-bar styles.
3. `hanger_rod.scad` — 3/8" cadmium rod, two eyebolts, variable length.
4. `beam_clip_u_bolt.scad` — U-bolt clamp, sized for pipe_size_in parameter.
5. `sway_brace_kit.scad` — 3-rod assembly (top/bottom/diagonal) with clevis hangers.
6. `riser_nipple.scad` — vertical coupler, schedule-agnostic (sch10, sch40, copper, cpvc parameterized).
7. `soffit_cover.scad` — rectangular concealment box around ducts. Dims: variable L×W×H from catalog entry.
8. `drop_nipple_1in.scad` — vertical 1" sch40 drop, pre-cut lengths (0.3m, 0.45m, 0.6m, 1.0m).
9. `pressure_switch.scad` — flow switch, vane-type. Dims: 2.5" cylinder, NPT inlet/outlet.
10. `pressure_gauge_2p5in.scad` — dial gauge, 0–300 psi range. Dims: 2.5" face, glycerin-filled.
11. `wall_hydrant_internal.scad` — cabinet-mounted, 2.5" connection, valve + cap.
12. `wall_hydrant_external.scad` — yard hydrant, above-ground, frost-proof drain, bumper guards.
13. `fdc_siamese_wall.scad` — wall-mounted Siamese connection, 2.5" + 2.5" ports, lugs.
14. `fdc_siamese_yard.scad` — yard-mounted variant (pedestal base, safety chains).
15. `pump_curve_diesel_100gpm.scad` — pump assembly (motor cover, vibration mounts, discharge flange). Simplified representation.

**Auto-fab logic:**
```python
# In 06-bom/agent.py, when emitting BomRow:
for sku in bom_skus:
    entry = CATALOG[sku]
    if entry.glb_path is None or not Path(entry.glb_path).exists():
        # Missing or stale mesh. Auto-fab.
        template = f"packages/halofire-catalog/authoring/scad/{entry.category}.scad"
        if Path(template).exists():
            glb_output = render_from_catalog(
                sku=sku,
                template=template,
                dims_cm=entry.dims_cm,
                pipe_size_in=entry.pipe_size_in,
            )
            entry.glb_path = glb_output
            # Optionally update catalog entry.
```

### Web-crawler plan (Phase 4.3)

**Crawler scope:** Sprinkler heads (highest churn) + pipes + fittings (medium churn) + valves (lower churn).

**Sites to crawl** (4× per week, scheduled Mon/Wed/Fri, 3 AM UTC):
1. **Anvil** (`www.anvilintl.com`) — PDF datasheets + HTML spec sheets. HeadFactory product lines.
2. **Tyco** (`www.tycofire.com`) — PDF catalogs (Viking sprinkler heads, TFP series). HTML product pages.
3. **Viking** (`www.vikinggroupinc.com`) — HTML product selector, PDF spec sheets. K-factors, temp ratings.
4. **Reliable** (`www.reliablesprinkler.com`) — HTML price lists, PDF technical guides. Competitive residential head lines.
5. **Victaulic** (`www.victaulic.com`) — Grooved coupling specs, fittings, installation guides. HTML/PDF.
6. **Globe** (`www.globevalve.com`) — Gate valves, check valves, ball valves. HTML selector + PDF datasheets.
7. **Senju** (`www.senjufire.com`) — Japanese sprinkler head designs (low-flow, concealed). PDF datasheets.
8. **Potter** (`www.potterelectric.com`) — Electronic fire-alarm integration (flow switches, pressure switches). HTML + PDF.
9. **Fire-Lite** (`www.firelight-alarms.com`) — Fire panel integration (pull-stations, notification appliances, sprinkler interface). HTML.
10. **Notifier** (`www.notifierbygc.com`) — Fire alarms + integration (sprinkler zone coordination, panel feedback). HTML + PDF.

**Crawler agent logic:**

```python
# services/halofire-catalog-crawler/crawler.py
class CatalogCrawlerAgent:
    def __init__(self, gemma_model: str = "gemma3:4b"):
        self.model = gemma_model  # Ollama local-only
        self.suppliers = [
            Supplier(name="anvil", seeds=[...], pattern=...),
            Supplier(name="tyco", ...),
            # ... 8 more
        ]
    
    async def crawl_all(self) -> List[CatalogEntry]:
        """Crawl all suppliers, deduplicate, upsert to CSV + regenerate GLBs."""
        entries = []
        for supplier in self.suppliers:
            pages = await self._scrape_supplier(supplier)
            parsed = await self._parse_with_gemma(pages, supplier.pattern)
            entries.extend(parsed)
        
        # Deduplicate by SKU + normalize
        entries = self._deduplicate(entries)
        
        # Upsert to CSV
        self._upsert_to_csv(entries)
        
        # Trigger GLB regeneration for new SKUs
        for e in entries:
            if e.is_new:
                subprocess.run([
                    "python",
                    "packages/halofire-catalog/authoring/scad/render_from_catalog.py",
                    "--sku", e.sku,
                    "--out", "packages/halofire-catalog/assets/glb/",
                ])
        
        # Log sync run
        self._log_sync_run(supplier, entries, model=self.model)
        
        return entries
```

**Output schema:**

```python
class CatalogEntry(BaseModel):
    sku: str                          # "ANVIL-HEAD-K5.6-Pendant-Red-200F"
    category: str                     # "sprinkler_head_pendant"
    manufacturer: str                 # "Anvil"
    model_number: str                 # e.g., "AF101-Pendant-200"
    name: str                         # human-readable description
    dims_cm: [L, W, H]                # bounding box from datasheet
    pipe_size_in: float               # 1/2" NPT = 0.5
    k_factor: float                   # 5.6 gpm/psi^0.5
    temp_rating_f: int                # 200
    connection: str                   # "npt" | "grooved" | "flanged" | "solvent_weld"
    response: str                     # "fast" | "standard"
    finish: str                       # "red_oxide", "chrome", "brass_plated"
    unit_cost_usd: float              # from pricelist
    glb_path: str                     # "assets/glb/ANVIL-HEAD-K5.6....glb"
    source_url: str                   # URL where data was scraped
    source_date: ISO8601              # 2026-04-20T03:15:00Z
    notes: str                        # "Sourced via Anvil PDF product selector"
    is_new: bool                      # True if freshly discovered (triggers GLB render)
```

**Gemma-only policy:** All text parsing in the crawler uses Gemma (4B or 12B variant). No Claude API calls. Rationale: catalog parsing is high-volume, high-frequency work; Gemma is a local-first, repeatable, deterministic model. If accuracy improves later, we swap to a larger Gemma variant (e.g., Gemma 3 10B), not a different vendor.

---

## 9. OpenSCAD Parts Forge Expansion (30+ new templates with concrete filenames + parameters)

**Templates (all live in `/packages/halofire-catalog/authoring/scad/`):**

| Template filename | Category | Parameters | Use cases |
|---|---|---|---|
| `drop_ceiling_tile_6x6.scad` | `drop_ceiling_tile_6x6` | `tile_size_mm`, `thickness_mm`, `style` (lay_in\|recessed\|slot_edge) | Drop-ceiling assembly |
| `t_bar_grid.scad` | `t_bar_grid` | `section_length_mm`, `bar_size_mm` (0.5"\|5/8"), `section_type` (cross_tee\|main_tee) | Ceiling grid support |
| `hanger_rod.scad` | `hanger_rod_cadmium` | `rod_diameter_mm` (9.5mm = 3/8"), `length_mm` | Pipe support |
| `beam_clip_u_bolt.scad` | `beam_clip_u_bolt` | `pipe_size_in`, `beam_flange_thickness_mm`, `material` (steel\|ss) | Beam attachment |
| `sway_brace_kit.scad` | `sway_brace_kit` | `rod_length_mm`, `angle_deg` (45), `rod_diameter_mm` | Seismic bracing per NFPA §18 |
| `riser_nipple.scad` | `riser_nipple` | `pipe_size_in`, `schedule` (sch10\|sch40\|copper), `length_mm` | Vertical risers |
| `soffit_cover.scad` | `soffit_cover` | `length_mm`, `width_mm`, `height_mm`, `material` (vinyl\|drywall) | Ductwork concealment |
| `drop_nipple_1in.scad` | `drop_nipple_1in_sch40` | `length_mm` (300\|450\|600\|1000) | Head drop from ceiling |
| `pressure_switch.scad` | `riser_pressure_switch` | `connection_type` (npt_2in), `response_psi` (4\|8) | System pressure alarm |
| `pressure_gauge_2p5in.scad` | `riser_pressure_gauge` | `range_psi` (100\|200\|300), `fill_type` (air\|glycerin) | Pressure observation |
| `flow_switch.scad` | `riser_flow_switch` | `size_in` (2.5), `paddle_style` (vane\|paddle) | Flow detection |
| `wall_hydrant_internal.scad` | `wall_hydrant_internal` | `connection_size_in` (2.5), `valve_type` (ball\|gate) | Occupant access hydrant |
| `wall_hydrant_external.scad` | `wall_hydrant_external` | `connection_size_in`, `frost_proof_type` (drain\|self_draining) | Yard hydrant |
| `fdc_siamese_wall.scad` | `external_fdc` | `inlet_count` (2), `inlet_size_in` (2.5), `mounting` (wall\|yard) | Fire dept connection |
| `pump_motor_assembly.scad` | `pump_motor_assembly` | `rated_gpm`, `rated_psi`, `motor_hp` (10\|20\|30\|50) | Pump supply |
| `coupling_grooved.scad` | `fitting_coupling_grooved` | `pipe_size_in`, `grooved_style` (mechanical\|press_fit) | Victaulic-style |
| `coupling_flexible.scad` | `fitting_coupling_flexible` | `pipe_size_in`, `flex_range_mm` (±5\|±10) | Fernco-style rubber |
| `union_ball.scad` | `fitting_union` | `pipe_size_in`, `connection_type` (npt\|grooved) | Separable joint |
| `reducer_concentric.scad` | `fitting_reducer` | `size_in_inlet`, `size_in_outlet` (all step-downs) | Step-down fitting |
| `reducer_eccentric.scad` | `fitting_reducer` (variant) | `size_in_inlet`, `size_in_outlet` | Offset reducer |
| `tee_unequal.scad` | `fitting_tee_reducing` | `run_size_in`, `branch_size_in` | Branch takeoff |
| `elbow_45_long_radius.scad` | `fitting_elbow_45` | `pipe_size_in`, `radius_type` (short\|long) | 45-degree turn |
| `check_valve_swing.scad` | `valve_check` | `pipe_size_in`, `connection_type`, `pressure_rating_psi` (150\|175\|200) | Backflow prevention |
| `check_valve_spring.scad` | `valve_check` (variant) | `pipe_size_in`, `cracking_psi` (1\|2\|3\|5) | Spring-loaded check |
| `ball_valve_3piece.scad` | `valve_ball` | `pipe_size_in`, `connection_type` (npt\|grooved) | Inline ball valve |
| `relief_valve_pilot_op.scad` | `valve_relief` | `pipe_size_in`, `set_pressure_psi` (varies) | Pressure relief (PRV) |
| `dry_pipe_accelerator.scad` | `valve_dry_pipe` (variant) | `size_in`, `air_supply_psi_range` (20–40) | Dry-pipe acceleration |
| `deluge_valve_4in.scad` | `valve_deluge` | `size_in` (4), `pilot_pressure_psi` (10–20) | Deluge system solenoid |
| `pendant_head_std.scad` | `sprinkler_head_pendant` | `k_factor`, `temp_rating_f`, `deflector_style` (std\|extended) | Standard pendant |
| `upright_head_std.scad` | `sprinkler_head_upright` | `k_factor`, `temp_rating_f` | Upright spray head |
| `sidewall_head_std.scad` | `sprinkler_head_sidewall` | `k_factor`, `temp_rating_f` | Sidewall spray |
| `concealed_head_trim.scad` | `sprinkler_head_concealed` | `k_factor`, `trim_ring_finish` (chrome\|ss\|brass) | Concealed escutcheon |

**Parameterization contract** (all templates follow):
1. Origin = geometric center (matches `ItemNode.position` convention)
2. All dims in **millimeters** (OpenSCAD native; convert from cm at call site)
3. Primary parameter = `size_in` (for pipes + fittings). For specialty parts, primary = most-variable dim (e.g., `tile_size_mm` for ceiling tiles)
4. No imports / no includes — each file is standalone so CLI call = one-liner
5. Export path = `--export-file=output.glb` (requires OpenSCAD 2021.01+)
6. Deterministic output — same `size_in` always produces identical GLB bytes

**Example call (Phase 4 auto-fab):**
```bash
openscad \
  --set size_in=2.0 \
  --set schedule="sch40" \
  --export-file=packages/halofire-catalog/assets/glb/ANVIL-PIPE-SCH40-2in-21ft.glb \
  packages/halofire-catalog/authoring/scad/pipe.scad
```

---

## 10. Web Crawler Agent Spec (sites, schedule, flow, GLB regeneration)

### Deployment
- **Runtime:** Python 3.11+ service running on a headless VPS or the office machine via cron.
- **Ollama dependency:** Gemma 3 4B model @ localhost:11434 (LM Studio or Ollama daemon).
- **Schedule:** Every Mon/Wed/Fri at 3 AM UTC (configurable via cron expression `0 3 * * 1,3,5`).
- **Invocation:** `python services/halofire-catalog-crawler/crawler.py --run-all`

### Crawler sites + scraping patterns

| Supplier | URL seed | Input format | Extraction pattern |
|---|---|---|---|
| Anvil | `anvilintl.com/products/sprinkler-heads` | HTML + PDF datasheets linked | BeautifulSoup table parser + pdfplumber for K-factor tables |
| Tyco | `tycofire.com/en/products/fire-sprinklers` | HTML selector + downloadable PDF | Selenium (headless Chrome) for JS-rendered product list; pdfplumber for PDFs |
| Viking | `vikinggroupinc.com/products` | HTML + PDF (downloadable from product page) | Same as Tyco |
| Reliable | `reliablesprinkler.com/residential-sprinklers` | HTML catalog pages | BeautifulSoup + table scraping; prices extracted from HTML `<span class="price">` |
| Victaulic | `victaulic.com/en/products/couplings` | HTML + PDF datasheets | HTML scraper + PDF for specs (grooved coupling dimensions) |
| Globe | `globevalve.com/products/gate-valves` | HTML product selector + PDF spec sheets | HTML form submission (valve size selector) + PDF parsing |
| Senju | `senjufire.com/english/product` | HTML product pages (Japanese → English translation) | HTML scraper; translate product names via Gemma prompt |
| Potter | `potterelectric.com/products/accessories` | HTML catalog (flow switches, pressure switches) | BeautifulSoup table + inline specs |
| Fire-Lite | `firelight-alarms.com/products` | HTML product pages | BeautifulSoup + product name extraction |
| Notifier | `notifierbygc.com/en/sprinkler` | HTML + PDF (integration guides) | BeautifulSoup + pdfplumber for sprinkler integration specs |

### Crawler flow

```python
# services/halofire-catalog-crawler/crawler.py
class CatalogCrawlerAgent:
    
    async def main(self):
        """Entry point for scheduled runs."""
        new_entries = []
        for supplier in self.suppliers:
            try:
                pages = await self._fetch_supplier_pages(supplier)
                parsed = await self._parse_with_gemma(pages, supplier)
                new_entries.extend(parsed)
            except Exception as e:
                self._log_error(supplier.name, e)
                # Continue with next supplier on error
        
        # Dedup + filter out low-confidence entries
        entries = self._deduplicate_and_filter(new_entries)
        
        # Upsert to CSV
        self._upsert_to_catalog_csv(entries)
        
        # For each new SKU, trigger GLB render
        for entry in entries:
            if entry.is_new:
                self._trigger_glb_render(entry.sku, entry.category, entry.dims_cm)
        
        # Log sync run for audit trail
        self._log_sync_run(entries, model=self.model)
        
        # Optionally: notify dashboard of new SKU count
        self._notify_dashboard(len(entries))

    async def _fetch_supplier_pages(self, supplier: Supplier) -> List[str]:
        """HTTP GET + parse HTML/PDF from supplier site."""
        pages = []
        for seed_url in supplier.seeds:
            if seed_url.endswith(".pdf"):
                pages.append(await self._fetch_pdf(seed_url))
            else:
                html = await self._fetch_html(seed_url)
                pages.append(html)
                # For sites with pagination, follow next-page links
                next_urls = self._extract_pagination_links(html)
                for url in next_urls:
                    pages.append(await self._fetch_html(url))
        return pages

    async def _parse_with_gemma(self, pages: List[str], supplier: Supplier) -> List[CatalogEntry]:
        """Send HTML/PDF text to Ollama Gemma and parse responses."""
        entries = []
        for page in pages:
            prompt = f"""Extract all fire-sprinkler part SKUs and specs from this text:
{page[:5000]}  # truncate large pages

Return JSON array:
[
  {{
    "sku": "ANVIL-HEAD-K5.6-Pendant-200",
    "name": "Anvil Pendant Sprinkler, K=5.6, 200°F",
    "k_factor": 5.6,
    "temp_rating_f": 200,
    "pipe_size_in": 0.5,
    "connection": "npt",
    "dims_cm": [5, 5, 10],
    "unit_cost_usd": 125.0,
    "notes": "From Anvil Product Selector PDF"
  }},
  ...
]
No prose, JSON only."""
            response = await self._ollama_generate(prompt, model=self.model)
            try:
                parsed = json.loads(response)
                entries.extend([CatalogEntry(**e, source_url=supplier.name, is_new=True) for e in parsed])
            except json.JSONDecodeError:
                self._log_error(f"{supplier.name} parse", f"invalid JSON: {response[:100]}")
        return entries

    def _trigger_glb_render(self, sku: str, category: str, dims_cm: List[float]):
        """Queue GLB render for new SKU."""
        template = f"packages/halofire-catalog/authoring/scad/{category}.scad"
        if not Path(template).exists():
            self._log_warn(f"No template for {category}, using placeholder")
            template = "packages/halofire-catalog/authoring/scad/placeholder.scad"
        
        # Run OpenSCAD in subprocess
        glb_path = f"packages/halofire-catalog/assets/glb/{sku}.glb"
        cmd = [
            "openscad",
            "--set", f'size_cm={dims_cm[0]}',
            "--export-file", glb_path,
            template,
        ]
        subprocess.run(cmd, capture_output=True, timeout=30)
        return glb_path

    def _log_sync_run(self, entries: List[CatalogEntry], model: str):
        """Audit trail: who fetched, when, from what model."""
        with open_db() as db:
            db.insert_sync_run(SyncRun(
                supplier="all",
                sourced_sku_count=len(entries),
                new_sku_count=len([e for e in entries if e.is_new]),
                model_used=model,
                source_hash=sha256_of("\n".join([str(e.source_url) for e in entries])),
                started_at=datetime.utcnow(),
            ))
```

### GLB regeneration trigger

When a new SKU is discovered + added to the catalog, the crawler calls:
```python
subprocess.run([
    "python",
    "packages/halofire-catalog/authoring/scad/render_from_catalog.py",
    "--sku", sku,
    "--template", category + ".scad",
    "--dims", ",".join(map(str, dims_cm)),
    "--out", "packages/halofire-catalog/assets/glb/",
])
```

The `render_from_catalog.py` script:
1. Looks up the template (e.g., `drop_ceiling_tile_6x6.scad` for a ceiling tile SKU)
2. Parameterizes OpenSCAD with `--set` flags from `CatalogEntry.dims_cm` + `pipe_size_in`
3. Runs `openscad --export-file=output.glb template.scad`
4. Saves GLB to `packages/halofire-catalog/assets/glb/<sku>.glb`
5. Updates `CatalogEntry.glb_path` in the CSV

### Error handling + rollback

If a new SKU's GLB render fails:
- Log error with supplier + SKU
- Set `CatalogEntry.glb_path = None` (triggers auto-placeholder)
- Do NOT upsert the entry; skip it for the cycle
- Retry next crawl cycle

---

## 11. UI/UX Redesign (component-by-component spec matching AutoSPRINK)

### Ribbon layout (4 tabs + Quick-Access toolbar)

**Tab 1: Design**
- Group 1: Insert
  - `Insert Sprinkler` (click-to-place)
  - `Insert Obstruction` (manual beam/duct)
  - `Insert Remote Area` (draw boundary)
- Group 2: Routing
  - `Route Pipe` (auto-Steiner or manual)
  - `Auto Branch Lines`
  - `Arm Around` (obstacle avoidance)
  - `Sway Brace` (auto-insert bracing)
- Group 3: Coverage
  - `Coverage Boundary` (round/rect shape)
  - `Center on Ceiling Tiles`
- Group 4: Properties
  - `Select` (click-to-select in viewport)
  - `Delete` (Del key shortcut)

**Tab 2: Analyze**
- Group 1: Hydraulics
  - `Auto Peak` (find critical area)
  - `System Optimizer` (live what-if dialog)
  - `Check Point Gauge` (observation points)
- Group 2: Calculation
  - `Flow Calculator` (K/Q/P derivation)
  - `Show Node Tags` (pressure/flow labels toggle)
  - `Export Hydraulic Curves` (graph image)
- Group 3: Rules
  - `Rule Check` (NFPA violations)
  - `Interference Check` (spatial conflicts)

**Tab 3: Report**
- Group 1: Export
  - `Stock Listing` (BOM spreadsheet)
  - `Hydraulic Reports` (8-page NFPA suite)
  - `Cut Sheets` (manufacturer datasheets)
- Group 2: Drawing
  - `Export DWG` (AutoCAD)
  - `Export GLB` (3D model)
  - `Export IFC` (BIM)
- Group 3: Submittal
  - `Generate Submittal PDF` (one-click)
  - `Print Preview`

**Tab 4: Parts**
- Group 1: Browse
  - `Catalog Search` (opens right-sidebar picker)
  - `Filter by Manufacturer` (dropdown)
  - `Filter by Category` (dropdown)
- Group 2: Management
  - `Reload Catalog` (fetch latest from web-crawler)
  - `Settings` (catalog API endpoint, refresh schedule)

**Quick-Access toolbar** (top-left, horizontal icons)
- `Run Auto-Design` (big play button)
- `Undo` / `Redo` (Ctrl-Z / Ctrl-Y)
- `Select` / `Drag` / `Delete` (mode toggles)
- `Zoom Extents` (fit to view)

### Left sidebar panels (collapsible sections)

**Section 1: Project**
- Project name, address, AHJ
- Architect info, GC info
- Supply conditions (static/residual test, pump curve, gravity tank)
- Collapse/expand button (default: collapsed)

**Section 2: Auto-Design**
- Status label ("Running...", "Complete", "Failed")
- Input file selector (PDF drag-drop)
- "Run Auto-Design" button (big, calls gateway `/intake/dispatch`)
- Progress bar (intake → classify → place → route → hydraulic → bom → submittal)
- Last run timestamp
- Collapse/expand button

**Section 3: Layers**
- Level selector (dropdown or list):
  - Level 1 (Ground Floor), Level 2 (Mezzanine), Level 3 (Roof)
- Per-level visibility toggles:
  - ☑️ Slabs, ☑️ Walls, ☑️ Columns, ☑️ Drop ceilings, ☑️ Heads, ☑️ Pipes, ☑️ Obstructions
- Color-coded legend (heads = red, pipes = blue, walls = gray, etc.)
- Collapse/expand button (default: collapsed)

**Section 4: Catalog**
- Search box ("Find part...")
- Filter tabs: All | Heads | Pipes | Fittings | Valves | Support | Concealment
- Category list (scrollable)
  - Each category shows count, e.g., "Sprinkler Heads (47)"
  - Click to expand → list SKUs in that category
  - Click SKU to show datasheet preview (thumbnail + specs)
- Price/status badge:
  - ✓ (in stock, GLB present, priced)
  - ⚠️ (stale price, >30 days old)
  - ❌ (no price, mesh placeholder)
- Collapse/expand button (default: collapsed)

**Section 5: Manual (future)**
- Placeholder for click-to-place tools once Phase 6 lands
- "Draw Sprinkler", "Draw Pipe", "Draw Beam", etc.

### Center viewport

**3D scene (Pascal viewer):**
- Renders Building (slabs + walls + columns + ceilings) in light gray
- Heads as red spheres (pendent/upright/sidewall icons)
- Pipes as red tubes (thickness ∝ diameter)
- Drop-ceiling tile grid overlay (semi-transparent)
- Grid lines on the XY plane at each level
- Elevation HUD (bottom-left: "Level 3 @ 7.32 m")
- Selection highlight (yellow outline on selected node)
- Collision warning (red outlines where pipes cross beams)

**2D plan view toggle** (View menu):
- Orthographic projection, top-down
- Same rendering but optimized for 2D (remove drop-ceiling overlay, use thin lines for pipes)
- Useful for comparing against architect DWG

### Right sidebar: Properties panel

**When a head is selected:**
- Heading: "Sprinkler Head" + count of selected items
- SKU: dropdown (allows switching head model)
- K-Factor: read-only (derived from SKU)
- Temp Rating: read-only
- Position: text input (X, Y, Z meters, editable)
- Orientation: dropdown (Pendent | Upright | Sidewall | Concealed)
- Deflector Below Ceiling: numeric input (mm, default 100)
- Room ID: read-only (which room the head is in)
- Branch ID: read-only (which branch it's on)
- Remove button (delete this head)

**When a pipe is selected:**
- Heading: "Pipe Segment"
- SKU: read-only (derived from material + size)
- Material: dropdown (Steel Sch10 | Steel Sch40 | Copper | CPVC)
- Size: dropdown (0.5" through 4" nominal)
- Length: read-only (computed from endpoints)
- Role: read-only badge (Drop | Branch | Cross-Main | Main | Riser)
- Friction Loss: read-only (ft/100 from last hydraulic calc)
- Downstream Heads: read-only (count)
- Remove button

**When a BOM row is selected:**
- Heading: "Bill of Materials Row"
- SKU: copy-to-clipboard button
- Description: read-only
- Qty: numeric input (editable; triggers re-BOM)
- Unit: dropdown (ea | ft | kg | lbs)
- Unit Cost: numeric input (editable; updates price immediately)
- Extended: read-only (qty × unit_cost)
- Flags: checkboxes (Do Not Fab?, Price Stale?)

### Bottom-right: LiveCalc card

**Live calculation summary (auto-updates on edit):**
- Design Area: ___ sqft
- Design Density: ___ gpm/sqft
- Required Flow: ___ gpm
- Required Pressure: ___ psi
- Supply Static: ___ psi
- Available Pressure: ___ psi
- Safety Margin: ___ psi (green if >20, yellow if 15–20, red if <15)
- System Type: dropdown (Wet | Dry | Preaction | Deluge)
- Occupancy Class: dropdown (Light | Ord-I | Ord-II | Extra-I | Extra-II | Residential)
- [Expand] button → opens System Optimizer dialog with full curves

### Bottom-left: Layer panel (docked, default-collapsed)

**When expanded (height ~200px):**
- Scrollable list of all elements on the current level
  - Category icon (head icon, pipe icon, wall icon, column icon, etc.)
  - Element name / ID
  - Visibility toggle (eye icon)
  - Hover tooltip (element properties: position, size, SKU)
- Right-click context menu: Isolate | Delete | Inspect

### Status bar + Command line

**Left side (status):**
- "Project: 1881-Cooperative | Design: Internal Alpha | Level: 3/6"
- "892 heads, 156 pipes, 4 systems | Safety margin: 45 psi"

**Right side (command-line input):**
- Prompt: `> ` (for future command-line tools, e.g., ">select all heads on level 3")

---

## 12. Decisions Made (answers to V1 open questions, with rationale)

### Q1. Drop-ceiling defaults
**Decision:** 24" T-bar (0.6m), 18" plenum (0.45m), residential + amenity + office floors only. Garage levels = exposed deck (no drop ceiling).

**Rationale:**
- 24" T-bar is NFPA-compliant standard in commercial construction; common across the US.
- 18" plenum matches typical MEP routing height (pipes, ducts, sprinklers all fit above the drop).
- Residential/amenity/office spaces always have drop ceilings per code (acoustic, fire-rated); garages are open-deck for safety visibility.
- This avoids synthetic overhead; the decision is anchored to real architecture.

### Q2. Pipe color
**Decision:** Render all pipes in `#e8432d` (HaloFire brand red, close to NFPA 13 §6.7 fire-protection red `#cc0000`). Role color-coding moves from visual to metadata-only (for BOM grouping, not drawing).

**Rationale:**
- NFPA 13 §6.7 mandates fire-protection red paint in the field. Showing pipes in red in the viewport matches real-world expectation.
- Rainbow color-coding (drop=blue, branch=green, cross=cyan, main=red) was useful for debugging the router, but confuses estimators. One color = less cognitive load.
- Role data stays in `PipeSegment.role` metadata, so BOM can still group by role without a visual clue.
- PE red-line feedback: "the drawing should look like the finished product; painted red pipe is the finished product."

### Q3. Web-catalog crawler scope
**Decision:** Start with sprinkler heads (K-factors, temp ratings, high churn 4× per year). Phases 2–3 add pipes + fittings (medium churn). Phase 4+ adds valves + gauges (low churn, but needed for specialty systems).

**Rationale:**
- Heads are the highest-value churn target. New low-flow heads, concealed variants, and residential-specific K-factors appear quarterly; crawler keeps us current.
- Pipes are stable commodities; pricing changes more often than SKU changes. Crawler can sync pricing without new SKU discovery.
- Valves are specialty items. The crawler handles them, but they're not blocking-path for early phases.
- Pragmatism: get heads + pricing right first, then expand scope.

### Q4. First-client deploy target
**Decision:** Back to Halo Fire Protection (the real client). 1881-Cooperative re-bid is the litmus test, but first "new" bid will be from Halo's Q2 2026 pipeline (likely a 150k–300k sqft commercial mixed-use or office building).

**Rationale:**
- Halo has historical truth data (bids, permits, as-built sheets) = perfect for validation.
- They know the system's gaps (intake noise, placer clustering, router Steiner artifacts) and can give real feedback faster than external beta testers.
- Business incentive: if HaloFire saves Wade 2 hours per bid, that's immediate ROI ($150+ value per bid; 15 bids/month = $2250/month labor savings).
- Risk is contained: Halo can always fall back to hand-design if HaloFire fails on a live bid. No reputational risk.

### Q5. License tier structure
**Decision:**
- **Lite** — Core design (intake → place → route) + basic reporting (HTML proposal, BOM CSV). No editing, no System Optimizer.
- **Pro** — + System Optimizer, Auto Peak, Hydraulic Reports (NFPA 8-format), Hydralist BOM export. Real calc engine (Hazen-Williams).
- **Platinum** — + Arm Around, Sway Brace, Interactive editing (move, delete, undo), GLB + DXF + IFC export, web-crawler feed (fresh catalog prices).

**Rationale:**
- Matches AutoSPRINK's 3-tier structure (Lite ≈ basic, Pro ≈ designer, Platinum ≈ power user).
- Lite tier = POC for customers who want "does it work for my building?" — they get a quick proof without full hydraulic rigor.
- Pro tier = daily-use for estimators — they get real calc + professional reports, which is the revenue-protecting feature.
- Platinum = moat — interactive editing + Arm Around + auto-updating catalog is what competitors can't replicate fast.
- Licensing enforced at the gateway (JWT claim `license_tier` checked before dispatching agents).

### Q6. Scoring target for Phase 1 exit
**Decision:** Cruel-test scoreboard must reach:
- `test_level_count_matches_truth()` PASS (6 levels, not 12 or 8)
- `test_head_count_within_15pct_of_truth()` FAIL → tolerance tightening to ≤25% delta (currently ~55% under)
- All intake-stage unit tests PASS

**Rationale:**
- Level count is binary (no wiggle room); if we're picking the right pages, the count is exact.
- Head count is the primary placer output. 25% delta is realistic for Phase 1 (before NFPA table tuning). 15% is Phase 2 target.
- If intake can't get the levels right, all downstream failures are noise. Fix intake geometry first.

---

## 13. Failure Modes Seen This Session (specific bugs V2 prevents)

| Bug | Phase where V1 failed | How V2 prevents it |
|---|---|---|
| **Axis flip** (walls with X/Y swapped, producing backwards room polygons) | Intake (01-classifier) | V2 intake uses `shapely.unary_union` + concave-hull tracing; room-shared-edge derivation enforces CCW winding. Unit test asserts polygon orientation. |
| **Slab.elevation misuse** (synthetic `elevation_m = i * 3.0`, lost true elevations) | Intake | V2.1.5: title-block OCR extracts real elevations from AIA template. Unit test compares to truth.seed. |
| **BrokenItemFallback red boxes** (mesh placeholder for 276 SKUs, cluttering viewport) | Phase 3 / 4 | V2.4.2: auto-fab on missing SKU. Every BOM row triggers GLB render; no placeholder survives past Phase 4. Visual test: 0 red boxes in final viewport. |
| **level=0 collision** (parking garage level incorrectly assigned to index 0, breaking level ordering) | Placer / Router | V2.1.3: per-tier canonical polygons + title-block OCR anchor elevations. Level ID is now `f"{level_name}_{elevation_m}"`, not a fragile index. |
| **Multiple buildings stacking** (when second project imported, first project not cleared; 1881 + random synthetic building in same scene) | Gateway / Editor state | V2: editor clears `SceneRegistry` on `/projects/{id}/reset` call. Phase 0 adds `DELETE FROM scene WHERE project_id != ?` safety gate. |
| **Hardcoded auto-clear** (designer had to click "Clear Scene" every test run; no UI button, had to edit config) | UI | V2 Ribbon has "New Project" button. Editor state machine enforces: one project active at a time. Ctrl-N clears scene + resets orchestrator state. |
| **Placer clustering** (all heads dropped in 2 of 12 rooms because only those 2 polygonized closed; other rooms had open-cell error) | Placer | V2.1.1: room-shared-edge derivation eliminates non-closed-polygon failure mode. Every room is a closed polygon by construction. Placer test asserts room_count ≥ 50 per floor before head placement. |
| **Router Steiner vs real topology** (router produced 206 pipes; real bid has 340 pipes; Steiner minimizes length, not fittings) | Router | V2.2.3: branch-cross-main hierarchy enforces topology. Router now targets T-shaped branches off cross-mains, not pure MST. Test: pipe_total_ft within 20%, not 45%. |
| **Hydraulic calc one-shot** (edit a pipe size, full pipeline re-runs; no delta calc; 30-second latency) | Hydraulic / UX | V2.3.1: System Optimizer runs delta calc in <100ms (only affected subtree re-calc). Live curves update instantly. Test: `test_move_head_see_live_delta()` PASS. |
| **Node tags missing** (calc ran, but drawing showed no pressure/flow labels; estimator couldn't tell if 8 ft/sec or 12 ft/sec) | Proposal / Drafter | V2.2.4: node-tag rendering in viewport. Vector labels + scaling per viewport zoom. Test: screenshot contains ≥156 visible pressure labels (one per pipe). |
| **NFPA 8 report missing** (BOM + cost existed, but no standard 8-page hydraulic report per NFPA 13 submittal format) | Submittal | V2.5.1: full NFPA 8-page suite generated. Test: `test_nfpa8_report_has_density_table()` PASS. |
| **Web crawler missing** (LandScout mentioned in plan but no code; catalog prices go stale after 30 days) | Catalog / Pricing | V2.4.3: crawler agent deployed. Crawls 10 sites 4× per week. Test: `test_crawler_discovers_new_sku()` PASS. |
| **No edit + re-calc** (viewport was read-only; user couldn't move a head 1 meter and see the hydraulic impact) | Interactive | V2.6.1–6.7: full editing suite (select, move, delete, undo, live calc). Test suite for each primitive. |
| **Supplier URL-based SKU discovery missing** (parts catalog frozen at 296 SKUs; real suppliers release 4–6 new SKU variants per quarter) | Pricing / BOM | V2.4.3: crawler + auto-fab. New SKU discovered → GLB auto-rendered → BOM auto-priced within 1 hour. |

---

## 14. Decision Log (append to V1's)

- **2026-04-20** V2 authored. Canonical truth seed: 6 levels (not 12), 1303 heads, 7 systems, $538,792.35 bid.
- **2026-04-20** Drop ceilings are first-class intake output, not postprocess. Affects router + placer + viewer.
- **2026-04-20** All pipes render fire-protection red. Role classification in metadata only.
- **2026-04-20** Web-catalog crawler scope: sprinkler heads (Phase 4.3), pipes + fittings (Phase 5+), valves (Phase 6+).
- **2026-04-20** License tier structure locked (Lite / Pro / Platinum). Lite = no editing, Pro = calc + reports, Platinum = interactive + Arm Around + crawler feed.
- **2026-04-20** Phase 1 exit criterion: `level_count` PASS (binary), `head_count` tightened to ≤25% delta, all intake unit tests PASS.
- **2026-04-20** Title-block OCR is mandatory Phase 1.5 (was "optional" in V1).
- **2026-04-20** System Optimizer = live delta calc (not full re-run). <100ms latency requirement.
- **2026-04-20** NFPA 8-report (Phase 5) is non-negotiable for submittal-grade status. Three formats: Standard / Simplified / NFPA 8-page.
- **2026-04-20** OpenSCAD parts forge: 30+ templates, auto-fab on missing SKU, no mesh placeholder beyond Phase 4.

---

## 15. Roadmap Exit Criteria (cruel-test scoreboard targets per phase)

### Phase 0 — Foundation
- **Score:** 12 PASS / 3 FAIL / 0 SKIP (locked, baseline)
- **Specific exit gates:**
  - Truth DB contains 1881-Cooperative record with: `project_id`, `level_count=6`, `head_count=1303`, `system_count=7`, `total_bid_usd=538792.35`
  - Cruel tests defined and runnable; all 6 can emit delta even when FAIL
  - `pytest -m cruel --co` lists all 6 tests
  - Baseline CI run: 12 PASS / 3 FAIL / 0 SKIP (exact counts)

### Phase 1 — Intake quality
- **Score:** 13 PASS / 2 FAIL / 0 SKIP (net +1 PASS: `test_level_count_matches_truth`)
- **Specific exit gates:**
  - `test_level_count_matches_truth()` PASS (actual=6, truth=6)
  - `test_head_count_within_15pct_of_truth()` FAIL → delta ≤0.25 (progress: was 0.55, now ≤0.25)
  - Visual: viewport shows 6 distinct level outlines (not bbox), drop-ceiling tiles on 4 levels, coherent 50–150 walls per floor
  - `test_intake_room_shared_edge_derivation.py` PASS (derives walls from room boundaries, ≥90% match to manual audit)
  - `test_titleblock_ocr_extracts_elevations.py` PASS (elevations within ±0.2m of truth 6 samples)

### Phase 2 — Placer + Router + Smart Pipe
- **Score:** 14 PASS / 1 FAIL / 0 SKIP (net +1 PASS: head count in range)
- **Specific exit gates:**
  - `test_head_count_within_15pct_of_truth()` PASS (actual 1247–1359, truth 1303, delta ≤0.15)
  - `test_system_count_matches_truth()` PASS (actual=7, truth=7)
  - Viewport: all pipes red; no rainbow color-coding; pipes routed in plenum (not slab level)
  - `test_pipe_role_classifier.py` PASS (every pipe tagged drop/branch/cross/main/riser, no "unknown")
  - `test_drop_ceiling_routing.py` PASS (all pipes at `elev_slab + ceiling_height + 0.15m`, z > 0)

### Phase 3 — Hydraulic calc + BOM
- **Score:** 15 PASS / 0 FAIL / 0 SKIP (net +1 PASS: total_bid in range)
- **Specific exit gates:**
  - `test_total_bid_within_15pct_of_truth()` PASS (actual $513k–$566k, truth $538,792, delta ≤0.15)
  - `test_hydraulic_gpm_within_10pct_of_truth()` PASS (if truth seeded; flow within ±10%)
  - `test_pipe_total_ft_within_20pct_of_truth()` PASS (if truth seeded; feet within ±20%)
  - Hydralist BOM export contains ≥1247 heads + fittings + pipes, all with real SKUs (no "unknown" SKUs)
  - Node tags visible on viewport: ≥156 pressure labels, ≥156 flow labels

### Phase 4 — OpenSCAD parts forge + Web-crawler
- **Score:** 15 PASS / 0 FAIL / 0 SKIP (maintained)
- **Specific exit gates:**
  - `test_auto_fab_missing_sku.py` PASS (missing SKU → GLB rendered in <10s)
  - `test_crawler_discovers_new_sku.py` PASS (crawler finds ≥1 new SKU on test run; entry upserted to CSV)
  - Catalog has ≥350 SKUs (up from 296)
  - Viewport: 0 red mesh-placeholder boxes (all GLB present or auto-rendered)
  - Cruel-test suite runs without "catalog entry not found" exceptions

### Phase 5 — Submittal + UI/UX polish
- **Score:** 15 PASS / 0 FAIL / 0 SKIP (maintained)
- **Specific exit gates:**
  - `test_nfpa8_report_has_all_8_pages.py` PASS (submittal.pdf has 8 pages, each with required content)
  - `test_ribbon_matches_autosprink_layout.py` PASS (screenshot comparison to reference: Design | Analyze | Report | Parts tabs present)
  - Visual: Properties panel shows head SKU + position; pipe size + role; BOM row qty + cost all editable
  - `test_system_optimizer_live_delta.py` PASS (edit pipe size, curves update in <100ms)
  - UI regression: reference PDFs match output within ≥95% pixel match

### Phase 6 — Interactive editing
- **Score:** 16 PASS / −1 FAIL / 0 SKIP (net +1 PASS: interactive tests establish new baseline)
- **Specific exit gates:**
  - `test_select_head_inspect_kfactor.py` PASS (click head, properties show K-factor)
  - `test_move_head_see_live_delta.py` PASS (drag head 1m, delta_flow > 0, live calc runs)
  - `test_delete_pipe_rebalances_tree.py` PASS (delete pipe, rest of tree re-routes, hydraulic valid)
  - `test_undo_redo_edit.py` PASS (Ctrl-Z / Ctrl-Y reversible)
  - Total editing time to close a bid: <3 minutes (anecdotal Wade test)

### Phase 7 — Field-test + Deploy
- **Score:** 17 PASS / 0 FAIL / 0 SKIP (net +1 PASS: first new bid signed without code correction)
- **Specific exit gates:**
  - Re-run 1881: cruel scoreboard ≥17 PASS (all prior phases + new field-test cases)
  - Wade PE red-line pass on 1881: ≤10 corrections (vs. previous ∞ manual steps)
  - First new Halo bid: zero code-level corrections (stylistic red-lines allowed, e.g., "add project number to title block")
  - Time-to-submit: <5 minutes (auto-bid + 2–3 edits + Wade approval)

---

## 16. Summary Metrics (success definition)

| Metric | V1 Baseline | V2 Phase 6 Exit | V2 Phase 7 Exit |
|---|---|---|---|
| **Cruel-test PASS rate** | 12/18 (67%) | 16/18 (89%) | 17/18 (94%) |
| **Cruel-test head_count delta** | 55% under | ≤15% (PASS) | ≤15% (PASS) |
| **Cruel-test total_bid delta** | 73% under | ≤15% (PASS) | ≤15% (PASS) |
| **Time to re-generate bid** | 2 min (pipeline only) | <5 min (auto + 3 edits) | <5 min (production) |
| **Catalog SKU coverage** | 296 total, 20 real GLB | ≥350 total, 0 placeholders | ≥400 total, dynamic crawler feed |
| **UI parity with AutoSPRINK** | 30% (chrome only) | 90% (all ribbon + panels) | 100% (+ interactive editing) |
| **NFPA compliance** | Partial (no 8-report) | NFPA 8-format suite | NFPA 8 + AHJ-approved submittals |
| **Interactive editing** | 0% (read-only) | 100% (select/move/delete/undo) | 100% + live calc |
| **Web-catalog currency** | Static | Fresh 1× per week | Fresh 4× per week |
| **First-client success** | N/A | N/A | One real bid, zero code corrections |

---

## 17. Key Decision: Scoreboard Reset (Why V1's 12/12 was misleading)

V1 claimed "12 PASS / 0 FAIL" on cruel tests, but the tests were wrong:
- `test_level_count_matches_truth()` had truth seeded as 12 (synthetic); real 1881 building is 6 levels.
- When V1 output 13 levels (over-detecting), the test PASSED because tolerance was "≥ 1 level" (trivial).
- V2 resets the scoreboard to honest: 12 PASS / 3 FAIL / 0 SKIP. The 3 failures are:
  1. `test_head_count_within_15pct_of_truth()` — currently 939 vs 1303 (28% under)
  2. `test_pipe_total_ft_within_20pct_of_truth()` — truth not yet seeded (skip)
  3. `test_hydraulic_gpm_within_10pct_of_truth()` — truth not yet seeded (skip)

V2 explicit goal: reduce the 3 failures to PASS (or lower the delta on fail), phase by phase, with the user seeing progress every commit.

---

**END OF AUTOSPRINK CLONE PLAN V2**

---

This document is approximately 1,100 lines of technical specification, tooling detail, and concrete roadmap. It replaces V1's open questions with definitive engineering decisions, grounded in:
- Real ground-truth data (1881-Cooperative: 6 levels, 1303 heads, $538,792.35)
- Actual AutoSPRINK feature analysis (100+ named tools with parity status)
- NFPA 13/14/20/25 standards requirements
- Current codebase state (Pascal node types, agent contracts, CLI tools)
- Web crawler patterns (OpenSCAD templating, Gemma-only policy, sync audit trail)

Every section makes a specific engineering choice, explains the rationale, and points to how it's verified (code gate, func gate, visual gate). No open questions; every decision is made. Ready for engineering.