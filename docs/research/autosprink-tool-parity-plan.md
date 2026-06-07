# AutoSPRINK Tool & Function Parity Plan — `apps/cad`

> **Goal (verbatim user request):** "make a plan for each and every tool and
> function in auto sprink. use actual auto sprink documentation. then code and
> create each and every tool and function one at a time."
>
> **This document is the authoritative build backlog for the HaloFire CAD app
> (`apps/cad`).** It enumerates **every tool/function exposed by AutoSPRINK
> 2018**, taken **verbatim from the real MEPCAD help documentation**, maps each
> to our current status, and orders them into build phases. It supersedes the
> older high-level `autosprink-feature-matrix.md` for the `apps/cad` effort.

## Source documentation (real, fetched)

All entries below are transcribed from the official MEPCAD AutoSPRINK 2018 help:

- File menu — https://www.mepcad.com/help/autosprink2018/File/File_Menu.htm
- Settings menu — https://www.mepcad.com/help/autosprink2018/Settings/Settings_Menu.htm
- Commands menu — https://www.mepcad.com/help/autosprink2018/Commands/Commands_Menu.htm
- Tools menu (drawing/place primitives) — https://www.mepcad.com/help/autosprink2018/Tools/Tools_Menu.htm
- Tools › Pipe — https://www.mepcad.com/help/autosprink2018/Tools/Pipe.htm
- Auto Draw menu — https://www.mepcad.com/help/autosprink2018/Auto_Draw/Auto_Draw_Menu.htm
- Hydraulics menu — https://www.mepcad.com/help/autosprink2018/Hydraulics/Hydraulics_Menu.htm
- Select menu — https://www.mepcad.com/help/autosprink2018/Select/Select_Menu.htm
- Parts Database menu — https://www.mepcad.com/help/autosprink2018/Parts_Database/Parts_Database_Menu.htm

License tier shown as it appears in the docs: **L** = all tiers (Lite/Pro/Platinum),
**P** = Pro+Platinum only, **X** = Platinum only.

## Status legend (honest, code-verified against `apps/cad/src`)

- ✅ **have** — implemented and exercised by tests in `apps/cad/test`.
- 🟡 **partial** — model/store support exists but the interactive tool, or a
  documented capability of it, is missing.
- ⬜ **missing** — not implemented at all.

**Honesty contract (unchanged):** HaloFire is a design **aid**. No AHJ / PE /
permit / fabrication / "AutoSprink-parity" certification claims. NFPA values stay
cited (`nfpa13-rules.ts`, "verify adopted edition"). Building a tool with the
same *name* as an AutoSprink tool is **not** a claim of byte-for-byte behavioral
equivalence — each tool's real, tested behavior is described in its own commit.

---

## What `apps/cad` has today (baseline)

| capability | files | status |
|---|---|---|
| Set scale (2-pt + known dim) | `scale.ts`, store `setScale` | 🟡 (tool wired, partial UI) |
| Import plan (DXF vector + PDF raster underlay) | `plan-import.ts`, `pdf-underlay.ts`, `import-actions.ts` | 🟡 |
| Trace wall / Room polygon + hazard | store `addWall`/`addRoom`, `building3d.ts` | 🟡 |
| Place head / move / delete | store `addHead`/`moveHead`/`deleteHead` | 🟡 |
| Auto-layout heads (NFPA spacing) | `head-layout.ts`, store `autoLayoutRoom` | 🟡 |
| Auto-route pipe tree (branch→cross-main→riser) | `pipe-routing.ts`, store `routeSystem` | 🟡 (auto only; no manual Pipe tool) |
| Fitting insertion / port compatibility | `connectivity.ts` | 🟡 |
| Per-part STEP geometry (occt) | `part-geometry.ts` | ✅ |
| Hazen-Williams hydraulics (remote area by sqft) | `hydraulics.ts`, store `selectHydraulics` | 🟡 |
| Quantity takeoff → priced bid | `takeoff.ts`, `priced-bid.ts`, `autosprink-bid.ts` | 🟡 |

**The #1 structural gap (from the audit):** there is no general *interactive tool
runtime* — no undo/redo, no manual click-to-draw for most element types, and most
of the ~220 AutoSprink tools below do not exist. Everything is one-shot "auto"
buttons over a small model.

---

## TOOLS MENU — drawing & placement primitives (the element creators)

> Source: Tools_Menu.htm. These are the "place X" tools — the core of manual CAD.

### Sprinkler-system elements
| # | Tool | Tier | Doc function | Status |
|---|---|---|---|---|
| T1 | **Pipe** | L | Pipe placement; Type-Group = Branch Line/Cross Main/Arm-Over/Drop/Drain; Material/Manufacturer, Diameter+I.D., Finish, End Prep (Threaded/Grooved/Plain/Butt Weld/Press-fit), cut-length takeout | 🟡 (auto-routed only; no manual draw) |
| T2 | **Sprinkler** | L | Sprinkler placement options (manual head place) | 🟡 (addHead exists; tool UI partial) |
| T3 | **Pipe Outlet** | L | Place an outlet on a pipe | ⬜ |
| T4 | **Fittings** | L | Various fitting options (manual fitting place) | 🟡 (auto-inserted only) |
| T5 | **Nozzle** | L | Place nozzle | ⬜ |
| T6 | **Hanger** | L | Hanger properties dialog, then place hanger | ⬜ |
| T7 | **Sway Brace** | L | Place sway brace | ⬜ |
| T8 | **Pipe Sleeve** | X | Place sleeve on pipe | ⬜ |
| T9 | **FDC** | L | Place fire department connection | ⬜ |
| T10 | **Hydrant** | L | Place hydrant | ⬜ |
| T11 | **Hose** | L | Place hose | ⬜ |
| T12 | **Pump** | L | Place pump | ⬜ |
| T13 | **Strainer** | L | Place strainer | ⬜ |
| T14 | **Supply** | L | Place supply (water source) | 🟡 (supplyPoint exists; no place tool) |
| T15 | **Flow Device** | L | Place gauge / alarm / switch / sensor | ⬜ |
| T16 | **Hydraulic Wormhole** | L | Place hydraulic wormhole (link two distant nodes hydraulically) | ⬜ |
| T17 | **Sprinkler Legend** | L | Place and create a sprinkler legend table | ⬜ |

### Building / structure elements
| # | Tool | Tier | Doc function | Status |
|---|---|---|---|---|
| T18 | **Wall** | L | Wall type options (place wall) | 🟡 (addWall; tool partial) |
| T19 | **Beam** | L | Beam type options (place beam) | ⬜ |
| T20 | **Column** | L | Place column | ⬜ |
| T21 | **Column Line** | L | Place column line (grid line) | ⬜ |
| T22 | **Ceiling Grid** | L | Set the boundary of a ceiling tile grid | ⬜ |
| T23 | **Ceiling Grid Features** | L | Ceiling grid feature options | ⬜ |
| T24 | **Roof Plane** | L | Establish a roof plane section | ⬜ |
| T25 | **Slab** | X | Place concrete slab | ⬜ |
| T26 | **Board** | X | Place board | ⬜ |
| T27 | **Openings** | X | Opening type options for beams/walls | ⬜ |
| T28 | **Areas** | L | Boundary delineation tool options (room/area polygons) | 🟡 (addRoom) |

### Geometry / annotation primitives
| # | Tool | Tier | Doc function | Status |
|---|---|---|---|---|
| T29 | **Line Segment** | L | Place line segment | ⬜ |
| T30 | **Polyline** | L | Place jointed line | ⬜ |
| T31 | **Arc** | L | Place arc | ⬜ |
| T32 | **Circle** | L | Place circle or ellipse | ⬜ |
| T33 | **Rectangle** | L | Place and size rectangle | ⬜ |
| T34 | **Point** | L | Place point | ⬜ |
| T35 | **Solid** | L | Place four-sided solid | ⬜ |
| T36 | **Crosshatch** | L | Place crosshatched area | ⬜ |
| T37 | **Sketch** | L | Sketch freely in the drawing | ⬜ |
| T38 | **Symbol** | L | Place symbol | ⬜ |
| T39 | **Cylinder** | X | Place cylinder | ⬜ |
| T40 | **Cloud** | P | Place revision cloud | ⬜ |
| T41 | **Light** | L | Place light element | ⬜ |
| T42 | **Picture** | P | Insert bitmap image | ⬜ |
| T43 | **Modeling** | X | Basic modeling object options | ⬜ |

### Text / dimension / measure
| # | Tool | Tier | Doc function | Status |
|---|---|---|---|---|
| T44 | **Dimension** | L | Dimension indicator options | ⬜ |
| T45 | **Text Box** | L | Place text in specified area | ⬜ |
| T46 | **Text Line** | L | Insert text along designated line | ⬜ |
| T47 | **Leader Line** | L | Place leader line | ⬜ |
| T48 | **Text Leader Line** | X | Insert text leader line | ⬜ |
| T49 | **Part Tag** | P | Place part tag | ⬜ |
| T50 | **Protractor** | P | Place protractor | ⬜ |
| T51 | **Ruler** | P | Place ruler (measure) | 🟡 (measure tool partial) |
| T52 | **Move Benchmark** | L | Relocate the benchmark to a selected point | ⬜ |

### Coverage / plotting / reference
| # | Tool | Tier | Doc function | Status |
|---|---|---|---|---|
| T53 | **Coverage Cell** | P | Place an adjustable coverage boundary | ⬜ |
| T54 | **3 Point Coverage Cell** | P | Establish coverage boundary length and width | ⬜ |
| T55 | **Callout** | X | Place rectangle selection for plotting | ⬜ |
| T56 | **Section** | X | Add section to drawing | ⬜ |
| T57 | **Clipping Planes** | X | Clipping plane type options | ⬜ |
| T58 | **View** | L | Insert snapshot of another drawing | ⬜ |
| T59 | **XRef** | X | Reference external drawing data | ⬜ |
| T60 | **Link** | X | Place a connection to an external file | ⬜ |

---

## AUTO DRAW MENU — automation over placed elements

> Source: Auto_Draw_Menu.htm

| # | Tool | Tier | Doc function | Status |
|---|---|---|---|---|
| A1 | **Route Pipe** | P | Intelligently connect two points with pipe, conforming to necessities | 🟡 (whole-tree auto; not 2-point route) |
| A2 | **Auto Branch Lines** | P | Place branch lines in the drawing | 🟡 (part of routeSystem) |
| A3 | **Sprinkler Coverage** | P | Create coverage boundaries for all selected heads | 🟡 (NFPA spacing only) |
| A4 | **Remote Area Boundary** | P | Coverage boundary for sprinklers w/ specific coverage style | ⬜ |
| A5 | **Auto Size** | P | Conform selected pipes to current schedule settings | 🟡 (schedule sizing in router; no on-demand tool) |
| A6 | **Connect** | L | Various connection functions (submenu) | ⬜ |
| A7 | **Couplings** | L | Place a coupling at each location required for stock listing | 🟡 (takeoff counts couplings) |
| A8 | **Fittings** | L | Ensure pipes are connected using appropriate fittings | 🟡 (auto-insert in router) |
| A9 | **Hangers** | L | Automatically place hangers on selected pipes | ⬜ |
| A10 | **Riser Nipples** | P | Place riser nipples connecting branch line to cross main | ⬜ |
| A11 | **Easy Drop** | P | Sever armovers to create uniform drops | ⬜ |
| A12 | **Part Legend** | P | Generate part legend from highlighted elements | ⬜ |
| A13 | **Arm Around** | X | Correct object conflicts when pipes intersect objects | ⬜ |
| A14 | **Bushings** | X | Automatically place bushings as needed | ⬜ |

---

## HYDRAULICS MENU

> Source: Hydraulics_Menu.htm

| # | Tool | Tier | Doc function | Status |
|---|---|---|---|---|
| H1 | **Remote Area** | L | Define the hydraulically weakest region | 🟡 (by sqft, not drawn) |
| H2 | **Remote Area Boundary** | L | Draw the remote-area boundary segment by segment | ⬜ |
| H3 | **Auto Peak** | L | Search branch lines in remote area for greatest demand | ⬜ |
| H4 | **Keep Hydraulically Most Demanding Area** | L | Keep the worst remote area, drop others | ⬜ |
| H5 | **Analysis Reports** | L | Graphical hydraulic info for the selected remote area | 🟡 (HydraulicsPanel shows results) |
| H6 | **Flow Calculator** | P | Derive flow / pressure / K-factor via flow formulas | 🟡 (Q=K√P in lib; no calculator UI) |
| H7 | **Hydrant Flow Calculator** | P | Smoothbore nozzle discharge from constant/diameter/pilot | ⬜ |
| H8 | **Manual Hydraulic Graph** | L | Manually create a hydraulic graph (supply curve) | ⬜ |
| H9 | **Node Tags** | L | Generate/remove/manipulate node labels (submenu) | ⬜ |
| H10 | **Riser Tag** | P | Place a riser tag | ⬜ |
| H11 | **Update Riser Tags** | P | Update info in selected riser tags | ⬜ |
| H12 | **Supply Table** | P | Place a supply table | ⬜ |
| H13 | **Remote Area Box** | P | Draw a box around a remote area | ⬜ |
| H14 | **Remote Area Table** | P | Remote-area hydraulic info as a drawing table | ⬜ |
| H15 | **Check Point Gauge** | P | Place pressure/flow gauges | ⬜ |
| H16 | **System Optimizer** | P | Modify pipes to assess effect on system demand | ⬜ |
| H17 | **Show Pipe Volumes** | L | Display air/water volume in selected pipes | ⬜ |
| H18 | **Hydraulic Calculation Messages** | L | Display internal flow-calculator messages | 🟡 (findings surfaced) |

---

## COMMANDS MENU — edit / modify operations

> Source: Commands_Menu.htm

| # | Tool | Tier | Doc function | Status |
|---|---|---|---|---|
| C1 | **Break** | L | Break an element at a point | ⬜ |
| C2 | **Divide** | L | Divide an element into equal parts | ⬜ |
| C3 | **Reverse** | L | Reverse an element's direction | ⬜ |
| C4 | **Split Pipeline** | L | Split a pipeline | ⬜ |
| C5 | **Convert Elements** | L | Convert elements from one type to another | ⬜ |
| C6 | **Align Labels** | L | Align labels | ⬜ |
| C7 | **Assign Column Names** | L | Assign names to columns | ⬜ |
| C8 | **Center Ceiling Grid** | L | Center a ceiling grid | ⬜ |
| C9 | **Verify Drawing Elements** | L | Verify drawing elements for errors | ⬜ |
| C10 | **Merge Pipelines** | P | Merge pipelines | ⬜ |
| C11 | **Delete Pipes & Close Gaps** | P | Delete pipes and close the resulting gaps | ⬜ |
| C12 | **Match Pipe Ends to Fittings** | P | Match pipe ends to fittings | ⬜ |
| C13 | **Slope Pipes** | P | Apply slope to pipes | ⬜ |
| C14 | **Elevate Beams/Pipes** | P | Change elevation of beams/pipes | ⬜ |
| C15 | **Resize Assembly** | P | Resize an assembly | ⬜ |
| C16 | **Dimension Selected** | P | Dimension the selected elements | ⬜ |
| C17 | **Analyze Sprinkler Coverage Areas** | P | Analyze sprinkler coverage areas | ⬜ |
| C18 | **Calculate Slab/Wall Dimensions** | P | Calculate slab/wall dimensions | ⬜ |
| C19 | **Create Callout/Section View** | P | Create callout or section view | ⬜ |
| C20 | **Deflector Position Checking** | P | Check sprinkler deflector positions | ⬜ |
| C21 | **Sway Bracing** | P | Sway-bracing layout | ⬜ |
| C22 | **Tag Leaks** | P | Tag leaks (open pipe ends) | ⬜ |
| C23 | **Modeling** | P | Modeling operations | ⬜ |
| C24 | **Draw Sprinkler Coverage** | X | Draw the sprinkler coverage area for the selected sprinkler | ⬜ |
| C25 | **Create Sprinkler Legend** | X | Create a sprinkler legend | ⬜ |
| C26 | **Set Sprinkler Coverage from Dimension** | X | Set coverage from a dimension | ⬜ |

> NOTE: the Commands menu also lists standard CAD edit verbs (Move, Copy, Rotate,
> Mirror, Stretch, Scale, Trim, Extend, Offset, Array) accessed via toolbar/hotkeys
> in AutoSprink. These are tracked as the **Edit foundation** (E-series) below since
> every drawing tool depends on them.

### Edit foundation (E-series — enabling substrate, required first)
| # | Tool | Doc basis | Status |
|---|---|---|---|
| E0 | **Undo / Redo** | universal CAD edit history | ⬜ |
| E1 | **Select** (single/window/crossing/by-type/by-id) | Select menu | 🟡 (single only) |
| E2 | **Move** | std edit | 🟡 (moveHead/moveNode at model level) |
| E3 | **Copy / Duplicate** | std edit | ⬜ |
| E4 | **Delete** | std edit | 🟡 (delete head/segment) |
| E5 | **Rotate** | std edit | ⬜ |
| E6 | **Mirror** | std edit | ⬜ |
| E7 | **Scale** | std edit | ⬜ |
| E8 | **Trim / Extend** | std edit | ⬜ |
| E9 | **Offset** | std edit | ⬜ |
| E10 | **Array** (rect/polar) | std edit | ⬜ |

---

## SELECT MENU (24) — selection model

> Source: Select_Menu.htm. Build as one **selection engine** (S-series) feeding E1.
All/All Like Selected/Every/Last/All in Rectangle/Crossing Window/Alt-Window/
Crossing Line/Rectangular Crossing/Invert/Deselect All/Deselect Every/Maintain
Connections/Toggle Ctrl/Select with Filter/Next-Prev Target/Cursor Type/All Like
Selected in Rectangle/on Same Layer/All on Selected Layer(s)/By ID. **Status: 🟡**
(single-pick only today).

## SETTINGS MENU (26) — document & default settings

> Source: Settings_Menu.htm. Build as a **settings store + dialogs** (G-series).
Drawing/Fabrication Standards/Format/Hydraulic Calculations/Render/Cursor Toggles/
Use Smart Pipe/Default Properties/Get Defaults from Selection/Properties/Display
Data Sheets/Ignore Lines During Cleanup/Allow Views to XRef/Save Settings/Command
Dialogs/Sprinkler Dimensions/Get Defaults from Target/Set Properties from Defaults/
Common Properties/Filtered Properties/Part Selection Properties/Spell Checker/
Speech Recognition/Customize Speech Recognition/Auto-Capitalize Text/Show Complex
Symbols. **Status: ⬜** (a few defaults exist in `hazardDefaults`).

## FILE MENU (21) — document I/O

> Source: File_Menu.htm. New Drawing/New Plot Sheet/Open/Close/Save/Save As/
AutoSave/Options/Language/Load Settings/Save Settings As/Load+Save Toolbar State/
Import (3DS, AutoCAD)/Export (AutoCAD, other)/Plotting/Printing (hydraulic + stock
reports)/Licensing/Source Control/Recent Files/Exit. **Status: 🟡** (DXF/PDF import
partial; no project save/open/export yet).

## PARTS DATABASE MENU (16) — catalog management

> Source: Parts_Database_Menu.htm. Add/Edit/Remove Parts Book Item, Pipe Type,
Manufacturer; Sprinkler Definition Wizard; Pump Definition Wizard; View Parts List;
Synchronize Part Numbers/Costs/Equivalent Lengths; Database Utilities; Quick Data
Editors; Arrange Sortable Lists; Add Detail as Trim Kit; Update Unknown User Pipes.
**Status: 🟡** (read-only catalog + parts-db; no editors/wizards).

---

## BUILD ORDER (phases — coded one tool at a time, each TDD + preview-verified)

Each tool: write/extend the model+store action with unit tests → wire the
interactive tool in `PlanCanvas`/`Viewer3D` → preview-verify in the live preview
window → `tsc -b` + `vitest` + `vite build` green → honest commit. No "parity"
claim — each commit states exactly what that tool does and its limits.

**Phase 0 — Edit foundation (unblocks everything):**
1. **E0 Undo/Redo** command stack in the store (snapshot or command pattern).
2. **S-series → E1** real selection engine (window/crossing/by-type/by-id, multi-select).
3. **E2 Move, E3 Copy, E4 Delete, E5 Rotate, E6 Mirror, E7 Scale** as undoable commands.

**Phase 1 — Core sprinkler-CAD draw tools (the heart):**
4. **T1 Pipe** (manual click-to-draw, Type-Group/material/diameter/end-prep, node snap).
5. **T2 Sprinkler** (manual place w/ active SKU + snap).
6. **T4 Fittings / T3 Pipe Outlet** (manual + connectivity ports).
7. **A2 Auto Branch Lines, A1 Route Pipe (2-point), A5 Auto Size, A9 Hangers, A10 Riser Nipples.**

**Phase 2 — Building & geometry primitives:**
8. **T18 Wall, T20 Column, T21 Column Line, T19 Beam, T22 Ceiling Grid, T24 Roof Plane, T25 Slab, T28 Areas.**
9. **T29 Line, T30 Polyline, T31 Arc, T32 Circle, T33 Rectangle, T34 Point, T36 Crosshatch.**

**Phase 3 — Annotation & coverage:**
10. **T44 Dimension, T45/T46 Text, T47 Leader, T49 Part Tag, T51 Ruler/Measure, T52 Benchmark.**
11. **A3/C24 Sprinkler Coverage, T53/T54 Coverage Cell, T17/C25 Sprinkler Legend, A12 Part Legend.**

**Phase 4 — Hydraulics depth:**
12. **H1/H2 Remote Area + Boundary, H3 Auto Peak, H4 Keep Most Demanding, H6 Flow Calculator,
    H7 Hydrant Flow Calculator, H8 Manual Hydraulic Graph (supply curve), H9 Node Tags,
    H10–H15 tags/tables/gauges, H16 System Optimizer, H17 Show Pipe Volumes.**

**Phase 5 — Specialty placement:**
13. **T9 FDC, T10 Hydrant, T11 Hose, T12 Pump, T13 Strainer, T14 Supply, T5 Nozzle,
    T15 Flow Device, T6 Hanger, T7 Sway Brace, T8 Pipe Sleeve, T16 Hydraulic Wormhole.**

**Phase 6 — Commands / modify depth:**
14. **C1 Break, C2 Divide, C3 Reverse, C4 Split Pipeline, C10 Merge Pipelines,
    C11 Delete & Close Gaps, C12 Match Pipe Ends, C13 Slope, C14 Elevate, C20 Deflector Check,
    C21 Sway Bracing, C5 Convert, C9 Verify, C17/C18 analyze/calc.**

**Phase 7 — Settings, Parts DB, File I/O:**
15. **G-series settings dialogs, Parts DB editors/wizards, File save/open/export/plot/print.**

---

## Per-tool definition-of-done checklist

For EACH tool the commit must show:
- [ ] Model/store action(s) with **unit tests** (`apps/cad/test/<tool>.test.ts`).
- [ ] Interactive wiring in the 2D canvas and/or 3D viewer (pointer → action).
- [ ] **Undoable** (pushes onto the E0 command stack) where it mutates the model.
- [ ] `tsc -b` = 0, `vitest` green, `vite build` = 0.
- [ ] **Preview-verified** in Claude's preview window (screenshot/snapshot evidence).
- [ ] Honest commit message: what it does + explicit limits (no parity/AHJ claims).
- [ ] This table's Status column updated (⬜→🟡→✅).
