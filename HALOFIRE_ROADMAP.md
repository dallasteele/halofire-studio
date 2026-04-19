# Halofire Studio — Roadmap (v2, honest)

**Repo:** `dallasteele/halofire-studio`
**Upstream:** `pascalorg/editor` (MIT)
**Full scope:** see [HALOFIRE_REQUIREMENTS.md](./HALOFIRE_REQUIREMENTS.md)
**Last revision:** 2026-04-18

## Target

Ship a commercial-grade fire-sprinkler design tool that:
- Ingests architect plans (IFC + PDF + DWG/DXF)
- AI-assists extraction into a 3D building model
- Places NFPA-13-compliant sprinklers with real manufacturer components
- Auto-routes pipe networks with hydraulic calcs
- Outputs AHJ-submittal-grade shop drawings + schedules + proposals

**Team assumption:** AI-assisted solo author + Halo Fire domain expert
(Wade Steele) + occasional PE review. Scale estimate with that team.

**Timeline to 1.0:** 8 months (32 weeks).

---

## Milestones

### M0 — Fork + Scaffold (DONE 2026-04-18, 1 day)

- [x] Fork `pascalorg/editor` → `dallasteele/halofire-studio`
- [x] `bun install` + CI baseline
- [x] `packages/halofire-sprinkler/` scaffold with NFPA 13 hazard-class
      tables + Head types + placement-validator stub
- [x] HALOFIRE_ROADMAP.md + HALOFIRE_REQUIREMENTS.md

### M1 — Demo-grade (weeks 1-6)

**Goal:** a bid that would have been built manually in 2 weeks can be
built in the tool in 1 day, producing a DEMO 3D model + one PDF sheet.
Not AHJ-ready yet.

- [ ] **IFC import**: `@thatopen/components` dep, IFC file upload,
      map `IfcSite → Site`, `IfcBuilding → Building`, `IfcBuildingStorey → Level`,
      `IfcWall → Wall`, `IfcSlab → Slab`, `IfcSpace → Zone`, `IfcDoor/Window → CSG cutout`
- [ ] **Hazard-class labeler**: room-type → hazard-class lookup table
      (classroom → Light, warehouse → Ordinary II, etc.)
- [ ] **First 50 components** authored or imported:
      - 10 sprinkler heads (2× pendant standard, 2× pendant QR, 2× upright,
        2× sidewall, 2× concealed)
      - 15 pipe sizes (1"–8" grooved steel + 1"–3" CPVC)
      - 15 fittings (elbow 90, elbow 45, tee equal, reducer, coupling)
      - 5 valves (OS&Y gate, butterfly, check, ball, DCDA)
      - 5 riser parts (riser, flow switch, tamper switch, gauge, test & drain)
- [ ] **Manual head placement tool**: click on ceiling, head snaps to grid
- [ ] **Coverage-area visualizer**: translucent circle per head showing
      max coverage per hazard class
- [ ] **Simple linear pipe routing**: user-drawn branch-to-main segments
- [ ] **Hazen-Williams calc stub**: single-head flow demand, friction
      loss per pipe segment
- [ ] **1 PDF output**: floor plan with heads + pipes + title block +
      head schedule

**Verification:** Wade takes a past bid's architectural PDF, manually
imports into Halofire (export IFC from PDF separately for now), places
20 heads in an office floor, runs calc, exports PDF. Looks like a
plausible sprinkler drawing.

### M2 — Alpha (weeks 7-12)

**Goal:** AI reads the architect PDF end-to-end. Head + pipe layout is
auto-suggested. Halo pilots on one real bid.

- [ ] **Togal.AI partnership / API integration**: upload PDF → structured
      spaces + walls + openings
- [ ] **Or build:** vector-PDF wall-extractor fallback for simpler plans
- [ ] **Scale + north-arrow detection** via title-block OCR
- [ ] **Auto-grid head placer**: given a room bbox + hazard class, place
      heads on the NFPA max-spacing grid, fit the non-rectangular rooms,
      align to structural grid if present
- [ ] **Manual pipe routing with snapping** to heads + walls
- [ ] **Automatic hanger placement** every 12 ft on pipe runs
- [ ] **Full head schedule** output per NFPA 13 (mark, type, K-factor,
      temp rating, finish, manufacturer, model, quantity)
- [ ] **Material takeoff**: aggregated BOM from placed components
- [ ] **100 more components**: fill out fittings + valves + hangers
      (150 total)

**Verification:** Halo runs a real $50K-$200K bid through Halofire
start-to-finish. Wade compares the output to what he'd have produced
manually. Time-to-bid reduced ≥50%. Drawings are "almost submittable"
with manual cleanup.

### M3 — Beta (weeks 13-24)

**Goal:** AHJ-submittal-grade output. Halo submits real applications
from Halofire.

- [ ] **Auto-pipe-router (tree system)**: minimum-spanning-tree over
      heads, route through ceiling joists, return to riser
- [ ] **Pipe sizing solver**: hydraulic method, iteratively size pipes to
      meet density × area demand + water supply curve
- [ ] **NFPA 13 rule engine**: all mandatory rules from Ch 8-10:
      max spacing, wall distance, obstruction rules (3×/4×/beam),
      room design method, remote-area identification
- [ ] **Auto-route loop and gridded systems** (optional for M3)
- [ ] **AHJ-compliant sheet set generator**:
      - FP-0.0 cover + index
      - FP-1.0 general notes + legend + schedules
      - FP-2.0 site plan
      - FP-3.x floor plans (per area)
      - FP-4.0 riser diagram
      - FP-5.x details
- [ ] **Hydraulic calculation report**: node-by-node, supply curve,
      remote area definition, Hazen-Williams trace
- [ ] **Cut-sheet assembly**: fetch manufacturer PDFs for each SKU used,
      concatenate into a submittal package
- [ ] **Engineering stamp integration**: Wade/PE upload digital stamp,
      applied to every sheet during export
- [ ] **200 more components**: reach 350 SKUs, cover 7 M-priority
      building archetypes

**Verification:** Halo files 3 real AHJ applications generated by
Halofire. All 3 approved with ≤2 rounds of AHJ comments each. Wade
signs a testimonial.

### M4 — 1.0 Commercial (weeks 25-32)

**Goal:** commercial-grade tool. Halo uses it for all bids. Pricing
+ proposal generation. Any other sprinkler contractor could license it.

- [ ] **Seismic bracing** (ASCE 7 zone-based) auto-placement
- [ ] **Multi-floor systems** linked via riser, cross-connection
      validation
- [ ] **Labor-hour estimator** (PHCC/NECA labor units × quantities)
- [ ] **Pricing engine**: material cost × markup + labor × rate + O&P
- [ ] **Proposal PDF** with cover, scope, inclusions, exclusions,
      schedule, price, T&C
- [ ] **Bid comparison tool**: side-by-side of 2 design alternatives
- [ ] **Remaining components**: reach 505 SKUs (the full requirements
      catalog)
- [ ] **Halo Fire deployed in production** for every bid
- [ ] **Docs + onboarding video + support workflow**
- [ ] **Pricing model + commercial licensing**

**Verification:** $1M+ of bids processed through Halofire in a single
quarter with zero manual drafting fallback.

---

## Architecture (Halofire-specific packages)

```
packages/
├── core/                       # @pascal-app/core (UNCHANGED upstream)
├── viewer/                     # @pascal-app/viewer (UNCHANGED upstream)
├── editor/                     # @pascal-app/editor (UNCHANGED upstream)
│
├── halofire-sprinkler/         # @halofire/sprinkler — NFPA 13 rules, head library
├── halofire-pipe/              # @halofire/pipe — routing + hydraulic calc
├── halofire-ifc/               # @halofire/ifc — IFC import via @thatopen/components
├── halofire-takeoff/           # @halofire/takeoff — Togal.AI client + PDF ingest
├── halofire-drafting/          # @halofire/drafting — 2D sheet set output (DXF + PDF)
├── halofire-schedule/          # @halofire/schedule — schedules + BOM + cut sheets
├── halofire-pricing/           # @halofire/pricing — labor + material cost
└── halofire-catalog/           # @halofire/catalog — manufacturer BIM loader
```

---

## Partnerships / licenses needed

| Item | Needed by | Cost estimate |
|---|---|---|
| **Togal.AI API** | M2 | $500-2000/mo |
| **Victaulic BIM license clarification** | M1 | Free tier, talk to their dev relations |
| **Tyco / Johnson Controls BIM** | M2 | Likely free, possibly through SprinkCAD relationship |
| **Reliable + Viking + Gem + Globe BIM** | M3 | Free per their sites |
| **NFPA 13 code access** | M1 (reference) | ~$300/year subscription |
| **PHCC/NECA labor tables** | M4 | ~$500-2000 one-time data purchase |
| **ODA Teigha DWG** (if real DWG needed, not just DXF) | M4 optional | $$$ — defer |

---

## Non-technical gating items

- [ ] **Togal.AI sales conversation** — schedule by start of M2
- [ ] **Victaulic BIM licensing conversation** — during M1 so we
      understand constraints before building the catalog loader
- [ ] **NICET / PE stamp sourcing** — Wade does it in-house for Halo;
      if we sell to other contractors, they use their own PE
- [ ] **Commercial GL + E&O insurance** — before M3 AHJ submittals
      (Halofire the software vendor + Halo Fire the contractor = two
      separate coverage concerns)

---

## What stays in other platforms

- **Unreal Engine** (OCE plugin, PBJWars cafeteria work): PBJWars game
  + occasional VR walkthroughs for hero bids. Not primary Halofire
  surface.
- **Blender** (blender-mcp): the asset factory — we author custom parts
  that aren't in manufacturer catalogs (signs, site-specific brackets,
  custom riser assemblies), export glTF into Halofire's catalog.
- **ClaudeBot skills** (equipment-classes, serving-line-configurations,
  technical-drafting-workflow, draft_plan.py): platform-agnostic
  knowledge that carries across. Skills get new packages: the Halofire
  equivalent is `skills/fire-sprinkler-authoring/`.

---

## Binding discipline (same as iter6 workflow)

Halofire **enforces** the 8-phase drafting-first workflow via the UI:

1. Research (user uploads architect PDF + knows hazard class)
2. Program (tool derives occupancy + hazard class from spaces)
3. Options (tool generates 2+ head layouts for user pick)
4. Selected Plan (user commits to one layout)
5. Equipment Schedule (auto-built from placed components)
6. Elevations + Sections (riser diagram auto-generated)
7. 3D Build (always visible in the viewport)
8. As-built Check (hydraulic calc passes, rule engine passes)

You cannot export a proposal or AHJ submittal until all 8 artifacts
exist. No shortcut. This is the entire product differentiator vs
AutoSPRINK — the workflow enforces compliance, it doesn't just allow
it.
