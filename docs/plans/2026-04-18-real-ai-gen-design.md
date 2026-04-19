# HaloFire CAD — Agentic AI AutoSprink Replacement

**Author:** Claude + Dallas
**Date:** 2026-04-18 (revised)
**Status:** Active implementation plan
**Positioning:** Open-source fire-sprinkler CAD built agent-first. Not
Pascal-based. Not a wrapper around AutoSprink / HydraCAD / SprinkCAD.
Target parity and then surpass those tools via a roster of specialized
AI agents that autonomously design, verify, and deliver real
buildable sprinkler systems.

---

## What we are building (and what we are NOT)

**We ARE building** a standalone fire-sprinkler CAD system whose
authoritative model lives in a Python service backed by real
open-source CAD kernels (IfcOpenShell, Open CASCADE, ezdxf, shapely,
trimesh). The system is driven by a roster of specialized agents —
each owns one phase of the sprinkler-design workflow — that collaborate
to take an architect PDF/IFC/DWG and produce a permit-ready submittal
package with no human in the loop beyond final review.

**We are NOT** extending Pascal's general-purpose editor into a fire
sprinkler tool. Pascal's Three.js viewer + React shell remain one
visualization surface (the in-browser preview), but the authoritative
CAD state, geometry, and rule engine all live in the Python backend.
Pascal nodes are generated FROM the authoritative CAD model, not the
other way around.

---

## Reference targets (what we are replacing)

| Tool | What it does | What it costs |
|---|---|---|
| **AutoSprink** (MEP CAD) | Industry standard fire sprinkler CAD | ~$7k/seat/yr |
| **HydraCAD** (Hydratec) | Hydraulic calc + CAD | ~$5k/seat/yr |
| **SprinkCAD** (Tyco) | Design + calc + cut sheets | ~$4k/seat/yr |
| **Revit MEP + plugins** | BIM-centric design | ~$3k/seat/yr + plugins |

All four are proprietary. None are agent-driven. Our thesis: an
agent-driven open-source equivalent — drop the PDF, hit Design, get a
submittal — is a 10× productivity jump for Wade. No competitor
attempted this because they are Windows-desktop CAD products shipped
in 1998-era business models.

---

## Foundation stack (open-source CAD)

```
Python backend (halofire-cad service):
  ┌─────────────────────────────────────────────────────────┐
  │ Model layer                                             │
  │ ├─ IfcOpenShell          IFC 4.x read/write, BIM props  │
  │ ├─ Open CASCADE (OCCT)   B-rep solid kernel             │
  │ │   via pythonocc-core / CadQuery                       │
  │ ├─ ezdxf                 DXF 2018 read/write            │
  │ ├─ shapely               2D polygon ops (Boost.Geometry)│
  │ ├─ networkx              pipe-network graph topology    │
  │ ├─ trimesh + pygltflib   3D meshes + glTF export        │
  │ └─ pydantic v2           strict schemas everywhere      │
  └─────────────────────────────────────────────────────────┘
  ┌─────────────────────────────────────────────────────────┐
  │ Ingest layer                                            │
  │ ├─ pymupdf + pdfplumber  PDF vector + text              │
  │ ├─ opencv                raster line detection          │
  │ ├─ CubiCasa5k (MIT)      floor-plan semantic segm.      │
  │ └─ Claude Vision         annotated plan interpretation  │
  └─────────────────────────────────────────────────────────┘
  ┌─────────────────────────────────────────────────────────┐
  │ Export layer                                            │
  │ ├─ matplotlib PdfPages   AHJ sheet set PDF              │
  │ ├─ reportlab             structured PDF (proposals)     │
  │ ├─ openpyxl              XLSX workbooks (Halo format)   │
  │ ├─ IfcOpenShell          IFC sprinkler subset export    │
  │ ├─ ezdxf                 DXF drafting export            │
  │ └─ trimesh glb export    web-viewable 3D model          │
  └─────────────────────────────────────────────────────────┘
```

Everything above is pip-installable into the existing
`services/halopenclaw-gateway/.venv`. No FreeCAD install burden (though
FreeCAD CAN be embedded later as an Arch-Workbench bridge if parametric
walls/slabs prove valuable). No Revit license. No AutoCAD.

The Studio web app (`apps/editor`) keeps its Three.js viewer as a read
surface for the authoritative CAD model — useful for estimators who
want to rotate the design, but not the source of truth.

---

## Agent roster (the "many specialized agents that build the system")

Each agent is a **first-class citizen**: it has a SKILL.md in
`agents/<name>/`, its own Brain memory bucket, pydantic schemas for
inputs/outputs, a gateway tool binding, and a QA loop. Any agent can
be run standalone from the CLI or orchestrated as part of the full
Design pipeline.

```
agents/
  00-intake/            Architect PDF/IFC/DWG → Building JSON
  01-classifier/        Room.use → Room.hazard_class (NFPA §4.3)
  02-placer/            Building + hazards → Head[] with positions
  03-router/            Heads + Building → PipeSegment[] topology
  04-hydraulic/         Segments + supply → HydraulicResult
  05-rulecheck/         Full design → Violation[]
  06-bom/               Design → BOM rows with list pricing
  07-labor/             BOM + Halo productivity → Labor hours
  08-drafter/           Design → AHJ sheet set PDF
  09-proposal/          Design + BOM + labor → Proposal PDF + XLSX
  10-submittal/         Design → AHJ package + cut sheets + IFC export
  11-field/             Install photos → as-built deviation report
  12-quickbid/          Sqft + hazard → ballpark proposal (60 s path)
```

### Shared agent contract

Every agent exports:
- **schema.py** — pydantic input/output models
- **SKILL.md** — how to invoke + examples + error modes
- **agent.py** — stateless `run(input) -> output` entry point
- **qa/** — fixtures + pytest tests
- **gateway_tool.py** — halopenclaw JSON-RPC tool binding

Agents communicate via strict JSON schemas. No implicit state. Any
agent can be replaced by a better model (Opus ↔ Sonnet ↔ local Qwen)
without breaking the chain. This is critical for cost control:
routine rule checks run on Haiku / local Gemma; hazard classification
runs on Sonnet; design decisions under uncertainty run on Opus.

### Agent topology (Design pipeline)

```
            ┌─────────────┐
            │   Intake    │
            └──────┬──────┘
                   ▼
            ┌─────────────┐
            │ Classifier  │
            └──────┬──────┘
                   ▼
         ┌─────────┴─────────┐
         ▼                   ▼
    ┌────────┐           ┌────────┐
    │ Placer │           │ Quick- │
    └────┬───┘           │  bid   │
         ▼               └────────┘
    ┌────────┐
    │ Router │
    └────┬───┘
         ▼
    ┌────────────┐
    │ Hydraulic  │───┐
    └─────┬──────┘   │ (upsize loop)
          │          │
          ▼          │
    ┌────────────┐   │
    │ Rulecheck  │◀──┘
    └─────┬──────┘
          │ (iterate placer/router on violations)
          ▼
    ┌─────┴──────┬────────┐
    ▼            ▼        ▼
  ┌─────┐    ┌─────┐   ┌──────┐
  │ BOM │    │Labor│   │Drafter│
  └──┬──┘    └──┬──┘   └──┬───┘
     └───────┬──┴─────────┘
             ▼
        ┌──────────┐
        │ Proposal │
        └──────────┘
             │
             ▼
        ┌───────────┐
        │ Submittal │
        └───────────┘
```

Each arrow is a pydantic contract. Any step's output can be saved
mid-run for debugging / regression testing.

---

## Data model (authoritative CAD state)

All domain types live in `packages/halofire-schema/` (shared TS + py).
Every agent reads and writes these.

### Core types (abbreviated)

```ts
Project = {
  id, name, address, ahj, code,
  architect: Firm, gc: Firm, halofire: ContactBlock,
  supply: FlowTestData,        // static/residual from AHJ
}

Building = {
  project_id,
  levels: Level[],
  construction_type, total_sqft,
}

Level = {
  id, name, elevation_m, height_m,
  use: "garage" | "residential" | "retail" | "mech" | ...,
  polygon_m,                   // floor outline
  rooms: Room[],
  walls: Wall[],
  openings: Opening[],
  obstructions: Obstruction[], // columns/beams/ducts
  ceiling: Ceiling,
  structural_grid, stair_shafts, elevator_shafts, mech_rooms,
}

Room = {
  id, name, polygon_m, area_sqm,
  use_class: string,
  hazard_class: NfpaHazard,    // set by classifier agent
  ceiling_height_m, soffits,
}

System = {
  id, type: "wet"|"dry"|"combo_standpipe"|"preaction"|"deluge",
  supplies: LevelId[],
  riser: RiserSpec,
  branches: Branch[],
  heads: Head[],
  pipes: PipeSegment[],
  fittings: Fitting[],
  hangers: Hanger[],
  hydraulic: HydraulicResult,
}

Head = {
  id, sku, k_factor, temp_rating_f,
  position_m, orientation: "pendent"|"upright"|"sidewall"|"concealed",
  deflector_below_ceiling_mm,
  room_id, branch_id, system_id,
}

PipeSegment = {
  id, from_node, to_node, size_in, schedule,
  start_m, end_m, length_m, elevation_change_m,
  fittings, downstream_heads,
}
```

All geometry is meters, SI, right-handed Z-up. Agents convert at the
boundaries (imperial for North American AHJ deliverables).

---

## Phase plan

### Phase 0 — Scaffolding (in progress)
- ✅ Studio + gateway run; 20 SKU catalog; auto-grid/route/calc/export
  demo loop; 3D bid viewer; 1881 metadata loaded
- [ ] **P0.1** Create `halofire-cad/` service separate from
  halopenclaw-gateway (gateway becomes the front-door dispatcher)
- [ ] **P0.2** Create `packages/halofire-schema/` with shared types
- [ ] **P0.3** Scaffold all 13 agent directories with SKILL.md +
  schema.py stubs

### Phase 1 — CAD kernel foundation
- [ ] **P1.1** `pip install` IfcOpenShell, pythonocc-core (or CadQuery),
  ezdxf, shapely, networkx, pymupdf, pdfplumber, opencv-python,
  trimesh, pygltflib, matplotlib, reportlab, openpyxl, pydantic
- [ ] **P1.2** `cad/geometry.py` — shapely polygon helpers, level →
  bbox, room subdivision
- [ ] **P1.3** `cad/ifc_io.py` — IfcOpenShell read/write wrappers, map
  our Building ↔ IfcProject/IfcBuilding/IfcBuildingStorey/IfcSpace
- [ ] **P1.4** `cad/dxf_io.py` — ezdxf read/write wrappers with layer
  conventions matching AutoSprink's (FP-HEADS, FP-PIPE-1-1/2, etc.)
- [ ] **P1.5** `cad/mesh_io.py` — trimesh pipe-cylinder + head-sphere
  generators, glTF export

### Phase 2 — Intake agent (`agents/00-intake/`)
- [ ] **P2.1** Layer 1 vector extraction (already stubbed in
  `pdf_pipeline/vector.py`) — extend to cluster parallel thick lines
  into walls
- [ ] **P2.2** Layer 2 opencv — page rasterizer + Hough line detector
  for raster-only PDFs
- [ ] **P2.3** Layer 3 CubiCasa5k wrapper — if local model available,
  else skip
- [ ] **P2.4** Layer 4 Claude Vision annotator — reads the rasterized
  plan + callouts, returns room labels and dimensions
- [ ] **P2.5** Scale detector from title block text
- [ ] **P2.6** Level identifier (reads page title: "LEVEL 1",
  "SECOND FLOOR PARKING")
- [ ] **P2.7** Room polygon detector (walls → closed loops → shapely
  polygons via floodfill)
- [ ] **P2.8** `gateway_tool.py` binding exposed as
  `halofire_intake_pdf`
- [ ] **P2.9** Test on 1881 architecturals; record recovery patterns

### Phase 3 — Classifier agent (`agents/01-classifier/`)
- [ ] **P3.1** `hazard_rules.yaml` — NFPA §4.3 occupancy → hazard
  mapping (~80 rules)
- [ ] **P3.2** Rule-based classifier for obvious cases (90% of rooms)
- [ ] **P3.3** Claude Sonnet fallback for ambiguous — prompts with
  room polygon image + adjacent rooms + text callouts
- [ ] **P3.4** `gateway_tool.py` exposed as `halofire_classify_hazard`

### Phase 4 — Placer agent (`agents/02-placer/`)
- [ ] **P4.1** Per-room spacing solver — `shapely` bounding box +
  grid fit honoring max spacing per NFPA §11.2.3.1.1
- [ ] **P4.2** Obstruction check — §11.2.3.2 beam rule
- [ ] **P4.3** Head type selector (pendent / upright / sidewall /
  concealed / ECX / residential) — rule-based w/ vision fallback
- [ ] **P4.4** Designer loop — Claude Opus gets violations and
  proposes fixes; re-run placer; converge
- [ ] **P4.5** `gateway_tool.py` exposed as `halofire_ai_place`

### Phase 5 — Router agent (`agents/03-router/`)
- [ ] **P5.1** Riser placement — mech rooms / stair shafts
- [ ] **P5.2** Weighted-grid A* obstruction-aware routing
- [ ] **P5.3** Branch-line joist alignment per §9.2.1.2
- [ ] **P5.4** Dry-system trip-time calc §7.2.3.6
- [ ] **P5.5** Combination standpipe sizing per §7.10.3
- [ ] **P5.6** Hanger spacing per §9.2.2.1
- [ ] **P5.7** `gateway_tool.py` exposed as `halofire_ai_route`

### Phase 6 — Hydraulic agent (`agents/04-hydraulic/`)
- [ ] **P6.1** Network graph builder (`networkx`)
- [ ] **P6.2** Hardy-Cross solver
- [ ] **P6.3** §28.6 density-area method
- [ ] **P6.4** Iterative upsize loop
- [ ] **P6.5** Flow-test data ingestion (AHJ-provided)
- [ ] **P6.6** Hydraulic placard data per §28.6
- [ ] **P6.7** `gateway_tool.py` exposed as `halofire_ai_calc`

### Phase 7 — Rulecheck agent (`agents/05-rulecheck/`)
- [ ] **P7.1** `rules/nfpa13_2022.yaml` — every testable rule with
  ref + severity + predicate
- [ ] **P7.2** `rules/ahj/slc_fire.yaml` — Salt Lake City amendments
- [ ] **P7.3** Rule runner → Violation[]
- [ ] **P7.4** Feedback loop into placer/router agents
- [ ] **P7.5** `gateway_tool.py` exposed as `halofire_ruleck`

### Phase 8 — BOM / Labor / Drafter / Proposal / Submittal agents
- [ ] **P8.1** BOM agent with catalog-linked list pricing
- [ ] **P8.2** Labor agent trained on Halo's historical productivity
- [ ] **P8.3** Drafter agent producing full AHJ sheet set
  (FP-0 cover, FP-H placard, FP-N plans, FP-R riser, FP-S sections,
  FP-D details, FP-B schedule)
- [ ] **P8.4** Proposal agent with Halo's XLSX workbook format
- [ ] **P8.5** Submittal agent (cut sheets + IFC export + BCF)

### Phase 9 — Orchestrator + end-to-end 1881 pass
- [ ] **P9.1** Orchestrator agent dispatches the full Design pipeline
  for 1881 architectural PDF → submittal package
- [ ] **P9.2** Brain integration — every decision + rationale stored
  for cross-project learning
- [ ] **P9.3** Cost-aware model routing (Haiku rule checks, Sonnet
  classification, Opus design decisions, local Qwen bulk analysis)
- [ ] **P9.4** Regression test: pipeline runs clean against a fixture
  set of 3-5 past Halo jobs

### Phase 10 — Quickbid mode
- [ ] **P10.1** Fast path using only intake + classifier outputs
- [ ] **P10.2** sqft × hazard × $/sqft lookup table calibrated from
  Halo's historical data
- [ ] **P10.3** Standard add-ons: standpipes ($X/floor), FDC ($Y),
  dry systems ($Z/sqft), permit fees
- [ ] **P10.4** 60-second turn-around proposal with 80% confidence

### Phase 11 — Web-UI integration (halofire-studio stays the UI)
- [ ] **P11.1** "Design" button in the Project tab that kicks off the
  orchestrator
- [ ] **P11.2** Live progress stream — per-agent status + partial
  outputs as they complete
- [ ] **P11.3** Authoritative-model viewer that reads CAD backend
  output (not Pascal scene state) — updates via SSE
- [ ] **P11.4** Agent-inspection drawer: click any element → see
  which agent placed/routed/sized it + rationale

---

## Immediate next actions (this session, starting now)

1. Create the new `halofire-cad/` Python service alongside the gateway
2. Add pydantic schemas in `packages/halofire-schema/`
3. Scaffold the 13 agent directories with SKILL.md + schema stubs
4. Install the CAD stack into the gateway venv
5. Implement `agents/00-intake/` L1 wall clustering → shapely polygons
6. Wire `halofire_intake_pdf` gateway tool
7. Run it on the real 1881 architectural PDF
8. Visualize the extracted geometry in the Studio viewer
9. Record failure modes as the Phase 2 backlog

Every session ends with a commit and a BUILD_LOG entry that updates
this plan's checkboxes.

---

## The litmus test (unchanged)

The system is real when:

> Wade drops `1881 - Architecturals.pdf` on the Studio, waits 20
> minutes, receives an AHJ-ready submittal package priced within ±10%
> of his manual estimate of $538,792, passing a manual NFPA 13 review
> by a licensed FP engineer with <3 corrections.

Everything above drives toward that single moment.
