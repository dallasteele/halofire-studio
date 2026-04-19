# Halofire Studio — Full Requirements + Honest Scope

Research compiled 2026-04-18 from the competitive landscape + NFPA 13 + BIM
library investigation. Supersedes the first-cut `HALOFIRE_ROADMAP.md`
in terms of scope accuracy.

## Vision (what the user stated)

When a client bid comes in:

1. AI reads the site plans (architect's PDF / DWG / IFC)
2. Turns them into an accurate 3D model of the client's building
3. Overlays an NFPA-13-compliant fire sprinkler system with real components
4. Outputs technical drawings the contractor submits to the AHJ

Plus: **the asset library must cover the full fire-supplies catalog** so
every head, pipe, fitting, valve, riser, bracket, and sign appears
in the 3D model with accurate geometry and metadata.

This is a "pro design tool" not a "demo app." It competes with AutoSPRINK,
SprinkCAD, HydraCAD. Those have 10-20 years of engineering behind them
and full-time teams. Honest assessment below.

---

## The competitive landscape (what we're up against)

| Product | Owner | Differentiator | Workflow |
|---|---|---|---|
| **AutoSPRINK** | M.E.P. CAD | Standalone 3D, no AutoCAD required, design + calcs + stock all in one | Large commercial |
| **AutoSPRINK RVT** | M.E.P. CAD | Revit plugin variant | Revit shops |
| **SprinkCAD 3D v6.0** | Johnson Controls (Tyco) | Uses Tyco BIM library natively | Tyco-favored shops |
| **SprinkCAD for Revit** | Johnson Controls | Revit plugin | Revit shops |
| **HydraCAD** | HydraTec | AutoCAD plug-in, lower cost, strong BIM/Navisworks | AutoCAD shops |
| **FireAcad** | FireAcad | Auto-pipe-connect, rapid calcs | Cost-sensitive |
| **FHC** | Canute | Hydraulic-calc focused, tree/loop/grid | Pure calc tool |
| **HYENA+** | Acadsbsg | Hydraulic analysis w/ node numbering | Pure calc tool |
| **Togal.AI** | Togal | AI space takeoff, 98% accuracy, PDF→measured spaces | Estimator upstream |
| **BIMIT Plan (IPX)** | Integrated Projects | Point-cloud → CAD floor plan, 1GB/hour, 5600+ building dataset | Scan-to-BIM |

**Key observations:**
- None of the incumbents are web-delivered — all are desktop Windows
- None integrate AI takeoff with design + calcs + output in a single tool
- AutoSPRINK is the 3D leader but not AI-assisted
- BIMIT Plan + Togal.AI prove the site-plan-to-BIM automation
  piece is feasible but NOT fully autonomous yet (2025 state of the art
  is "semi-automated")

**Our market thesis:** The opening is an integrated, AI-first, web-delivered
tool specifically for fire sprinkler contractors. Not a generic
BIM+calc+takeoff; a focused vertical product.

---

## Full capability matrix

Ranked by must-have (M) / should-have (S) / nice-to-have (N).

### 1. Site plan ingestion (input)

| Capability | Priority | Effort | Our plan |
|---|---|---|---|
| PDF drawing upload (vector or raster) | M | High | Phase 2a |
| DWG/DXF import | M | Med | Phase 2b via `web-dwg-viewer` or server-side `ezdxf` |
| IFC import (full hierarchy) | M | Med | Phase 2c via `@thatopen/components` — this is the fast win |
| Revit (.rvt) import | S | Very High | Defer — Revit format is proprietary; require user to export IFC first |
| Scanned PDF (raster) + OCR | S | High | Phase 2d — Google Vision or Claude Vision API |
| Point cloud (.e57, .las) → BIM | N | Very High | Partner with IPX/BIMIT or defer 18 mo |
| Multi-sheet assembly (plan + elevations) | M | Med | Phase 2e |
| Scale detection from title block | M | Med | Phase 2f — OCR + regex |
| North arrow detection | S | Low | Phase 2g |

**Key AI work:** PDF → structured walls/doors/windows/rooms.
Techniques needed: vector-PDF parsing (easy), raster OCR + CV (moderate),
semantic labeling via Claude Vision or fine-tuned model (moderate).

### 2. 3D building generation

| Capability | Priority | Effort | Our plan |
|---|---|---|---|
| Walls with thickness + height from plan | M | Low | Pascal already does this |
| Doors + windows with CSG cutouts | M | Low | Pascal already does this |
| Slabs + ceilings per floor level | M | Low | Pascal already does this |
| Columns + structural elements | M | Med | Add to `@halofire/structure` |
| Roof geometry (flat/sloped/parapet) | S | Med | Phase 4 |
| Mezzanines + multi-level atriums | S | Med | Phase 5 |
| Ceiling types (suspended ACT, drywall, exposed structure) | M | Low | Critical for sprinkler logic |
| Room semantic labels (office, corridor, mech, etc.) | M | Low | IFCSpace entities or manual |
| Occupancy classifications (NFPA 13 hazard groups) | M | Med | Derive from room type |

**Pascal provides:** the BIM node hierarchy, wall geometry with mitering,
CSG cutouts. So this is 70% done. We add the fire-protection-specific
semantics.

### 3. Fire-supplies asset library (user's explicit requirement)

| Category | Priority | Item count (realistic) | Source |
|---|---|---|---|
| **Sprinkler heads** | M | ~80 SKUs | Victaulic + Tyco + Reliable + Viking BIM |
| — Pendent (standard, quick-response, ESFR) | | 25 | |
| — Upright (standard, QR, ESFR) | | 15 | |
| — Sidewall (horizontal + vertical) | | 15 | |
| — Concealed pendent | | 10 | |
| — Dry-type (for unheated spaces) | | 8 | |
| — Residential | | 7 | |
| **Pipe** | M | ~100 SKUs | |
| — Steel SCH10 (grooved end, 1"–12") | | 20 | |
| — Steel SCH40 (threaded + grooved) | | 20 | |
| — CPVC BlazeMaster (1/2"–3") | | 10 | |
| — Copper (rare but used) | | 5 | |
| — Pipe w/ factory lengths (20 ft, 21 ft, custom cut) | | — | metadata |
| **Fittings** | M | ~200 SKUs | |
| — Grooved couplings (rigid + flexible) per size | | 40 | |
| — Threaded elbows (90°, 45°, 22.5°, street) per size | | 60 | |
| — Tees (equal + reducing) per size combination | | 60 | |
| — Reducers + bushings | | 20 | |
| — Flanged fittings | | 20 | |
| **Valves** | M | ~30 SKUs | |
| — OS&Y gate valve (main water shutoff) | | 5 | |
| — Butterfly valve (grooved, tamper-switched) | | 5 | |
| — Check valve (swing, silent, backflow) | | 8 | |
| — Ball valve (test + drain, pressure gauge) | | 5 | |
| — Pressure-reducing valve | | 4 | |
| — Backflow preventer (DCDA, RPZ) | | 3 | |
| **Riser components** | M | ~20 SKUs | |
| — Riser manifold assemblies | | 5 | |
| — Flow switch (vane-type) | | 3 | |
| — Tamper switch (OS&Y + butterfly variants) | | 4 | |
| — Pressure gauge + retard chamber | | 4 | |
| — Main drain + inspector's test connection | | 4 | |
| **Hangers + bracing** | M | ~40 SKUs | |
| — Clevis hanger per pipe size | | 15 | |
| — Adjustable ring hanger | | 10 | |
| — Seismic sway bracing (longitudinal + lateral) | | 10 | |
| — Beam clamps + rod couplings | | 5 | |
| **External** | M | ~15 SKUs | |
| — Fire Department Connection (FDC, wall + freestanding) | | 4 | |
| — Alarm bell (electric + water-motor gong) | | 3 | |
| — Post Indicator Valve (PIV) | | 2 | |
| — Hose valves + Class I/III standpipes | | 6 | |
| **Signs + labels** | S | ~20 | |
| — "FDC," "MAIN DRAIN," hydraulic placard templates | | 20 | |

**Total component SKUs: ~505.**

**Source strategy:**
- **Primary:** Victaulic's free BIM library (Revit, STEP, DWG) — covers
  pipe, couplings, fittings, valves, most sprinklers. License permits use in
  designs but NOT sublicensing/redistribution, so we load on-demand per
  project, not bulk-ship with the tool
- **Secondary:** Tyco, Reliable, Viking, Gem, Globe via MEPcontent.com +
  BIMobject.com
- **Convert to glTF/GLB** server-side (Blender headless) for web delivery
- **Custom-author what's missing** via blender-mcp (we already have this
  pipeline working)
- **Store metadata (model, K-factor, temp rating, finish) separate from
  geometry** so we can swap SKUs without re-importing

**Hard caveat:** Victaulic's license is restrictive. We need to pull assets
at runtime per project, not stockpile. For bulk offline use we need a
vendor partnership or a different library. This is a legal item, not
technical.

### 4. Design capabilities

| Capability | Priority | Effort | Our plan |
|---|---|---|---|
| Manual head placement | M | Low | Phase 3 |
| Auto-grid head placement per hazard class | M | Med | Phase 3 |
| Head coverage-area visualizer | M | Low | Phase 3 |
| Obstruction detection (3×, 4×, 6× beam rules) | M | Med | Phase 3 |
| Manual pipe routing | M | Low | Phase 4 |
| Auto-routing (tree, loop, grid) | M | Very High | Phase 4 — the hard problem |
| Pipe sizing: schedule method | M | Low | Phase 4 |
| Pipe sizing: hydraulic method | M | High | Phase 4 |
| Hangers auto-place every 12 ft | M | Low | Phase 4 |
| Seismic bracing (per ASCE 7 zone) | S | High | Phase 5 |
| Multiple zones / floors linked via riser | M | Med | Phase 5 |

### 5. Hydraulic calculations

| Capability | Priority | Effort |
|---|---|---|
| Hazen-Williams friction-loss | M | Med |
| Equivalent length of fittings lookup | M | Low |
| Density/area method | M | Med |
| Room design method | S | Med |
| Remote area auto-identification | M | High |
| K-factor flow calc at each head | M | Low |
| Elevation pressure (static head) | M | Low |
| Water supply curve + demand curve overlay | M | Med |
| Results validation against supply | M | Med |
| Multi-area comparison for worst-case | S | Med |

Existing open-source libraries: `pipedream` (ResearchGate 2017 paper
algorithms), `sprinkpy` (not found — we may need to write this). Canute
FHC proves the math is solvable at small-company scale. This is not
research-level hard.

### 6. Output deliverables (technical drawings + reports)

| Sheet / report | Priority | Source | Effort |
|---|---|---|---|
| **FP-0.0 Cover + Index** | M | Template | Low |
| **FP-1.0 General Notes + Legend + Schedules** | M | Template + schedule data | Low |
| **FP-2.0 Site Plan** | M | IFCSite + FDC/PIV locations | Low |
| **FP-3.x Floor Plans (per area)** | M | Plan view at 1/4"=1' with all heads, pipes, sizes, dims | Med |
| **FP-4.0 Riser Diagram** | M | Schematic of vertical piping + valves | Med |
| **FP-5.x Details** | M | Library of standard NFPA details | Low |
| **Hydraulic Calculation Report** | M | Calc engine output | Med |
| **Head Schedule** | M | Mark/type/K/temp/finish/mfr/model/qty | Low |
| **Pipe Schedule** | M | Size/material/length/qty | Low |
| **Hanger Schedule** | M | Type/size/qty per floor | Low |
| **Fitting Schedule** | M | Model/qty | Low |
| **Material Takeoff / BOM** | M | Aggregated schedules | Low |
| **Cut Sheets PDF** | M | Fetch from manufacturer + assemble | Low |
| **Specifications (CSI 21 13 13)** | S | Template + project overrides | Low |
| **Labor Estimate** | S | PHCC labor units × quantities | Med |
| **Proposal PDF** | S | Cover + scope + inclusions + price + terms | Med |

**Output formats required:**
- PDF (standard ANSI D = 24×36" and ANSI E = 36×48") — use `jsPDF` +
  `svg2pdf` in browser OR `reportlab` server-side
- DWG (via `ezdxf` server-side; DXF is fine, real DWG requires ODA Teigha
  $$$ license or open-source `libdwg`)
- DXF (free — `ezdxf` handles this)
- IFC 4 (via `@thatopen/components` export)

### 7. AHJ submittal compliance (Tennessee + most states)

Required on every sheet (per the TN guidelines):
- Contractor name, address, state sprinkler license ID
- Responsible managing employee name, license ID, signature
- Drawing separate for piping plan vs reflective ceiling plan
- All sheets to scale + numbered
- Hydraulic plate placard (embed directly on drawing)
- All underground details + thrust blocks + bury depth
- Cut sheets with manufacturer listing + friction loss
- Engineer-of-record stamp (PE or NICET IV) **before** AHJ submittal

Most of this is data-driven output. The ONE human thing we cannot
automate: the **PE/NICET stamp**. Halo Fire has credentialed staff
(Wade Steele) who stamps drawings. Our tool generates the sheets;
Wade reviews + stamps + submits.

### 8. AI / ML capabilities (the differentiator)

| Capability | Priority | Effort | Status |
|---|---|---|---|
| **Floor-plan space detection from PDF** | M | High | Buy: Togal.AI API — 98% accuracy |
| Wall extraction from vector PDF | M | Med | Build: parse PDF paths + detect wall patterns |
| Wall extraction from raster PDF | M | High | Buy: Claude Vision or fine-tuned model |
| Door / window detection | M | Med | Build: template matching |
| Room labeling (office, corridor, mech) | M | Med | Buy: LLM vision on plan snippets |
| Hazard class inference from room label | M | Low | Rule-based |
| Auto-place heads per NFPA 13 | M | Med | Build: grid fitter |
| Auto-route pipes (MST + routing heuristics) | M | High | Build: it's a graph algorithm |
| Hydraulic calc | M | Med | Build: it's applied physics |
| Seismic bracing layout | S | Med | Build: rules per ASCE 7 |
| Chat-based design assistant ("add 12 pendant heads in the office zone") | S | Low | Claude tool use with our primitives |
| Code compliance explainer ("why did you fail this?") | S | Low | LLM reads rule violations, explains |

**Crucial decision: buy vs build for PDF→space detection.**
- **Build:** 6-12 months of ML work, needs labeled dataset, uncertain
  accuracy
- **Buy/partner:** Togal.AI has API + 98% accuracy today. Route: sign
  commercial API deal, embed their takeoff, add our design layer on top
- **Recommendation:** **Partner with Togal.AI** for the ingest layer.
  Own the design + calcs + output layer. This is our highest-value
  shortcut.

### 9. Commercial building archetypes (what the tool must handle)

| Archetype | NFPA | Hazard | Complexity | Priority |
|---|---|---|---|---|
| **Apartment/condo** | 13R | Light | Low | M (Halo Fire's bread & butter) |
| **Office building** | 13 | Light | Low | M |
| **Retail strip** | 13 | Ordinary I | Low | M |
| **Restaurant** | 13 | Ordinary I + kitchen hood sep | Med | M |
| **School / K-12** | 13 | Light + gym Ordinary I | Med | M |
| **Warehouse (non-rack)** | 13 | Ordinary II | Med | M |
| **Warehouse (rack storage)** | 13 | ESFR + special rules | High | S |
| **Medical office** | 13 | Light | Low | S |
| **Hospital** | 13 | Multi-zone, varied | Very High | S |
| **Manufacturing** | 13 | Ordinary II – Extra II | High | S |
| **Parking garage (enclosed)** | 13 | Ordinary II + dry system | Med | S |
| **Mixed-use** | 13 + 13R | Combined | Very High | S |
| **Assembly (theater, stadium)** | 13 | Ordinary I | Med | N |
| **Detention / hospital psychiatric** | 13 | Special hazards | Very High | N |

First 7 (M priority) cover ~80% of typical contractor workflow. Ship with
those; add archetypes 8-14 incrementally.

---

## Honest timeline revision

The original 16-week plan was a **Phase 1 MVP** demo, not a shippable
product. Real numbers:

| Phase | Deliverable | Revised estimate |
|---|---|---|
| **MVP (demo-quality)** | Straight-line workflow: IFC in → heads placed → basic pipe → calc → PDF out | **4 months** (16 weeks) |
| **Alpha** | Handles 3 building archetypes (office, retail, school) + PDF→IFC via Togal | **8 months** (32 weeks) |
| **Beta** | All 7 M-priority archetypes + auto-routing + full NFPA compliance | **14 months** (56 weeks) |
| **1.0 (commercial)** | Wade bids a real job + Halo submits to AHJ + work is built | **18 months** (72 weeks) |
| **2.0 (vertical product)** | Parking, hospital, mixed-use, warehouse ESFR | **30 months** |

Team required to hit 1.0 in 18 months: **2 TS devs + 1 PE/NICET + 1
back-end integrations dev + you as product owner**. At AI-assisted pace
with me as primary author: realistic but brutal.

Team required to hit 1.0 in 18 months with just me as author + Wade
consulting: **achievable but compressed** — I'd push MVP to 6 mo (first
3 mo is infrastructure + Togal integration + head placer + basic
calc), then iterate on real bids.

---

## Build vs Buy vs Partner matrix

| Component | Decision | Rationale |
|---|---|---|
| Pascal editor core | **Fork (done)** | MIT, 60% of foundation, modern stack |
| PDF → space detection | **Partner (Togal.AI)** | 98% accuracy today, their moat is dataset we'd spend 2 years building |
| IFC parser | **Open source (@thatopen/components)** | Free, MIT, maintained, proven |
| DWG write | **ODA Teigha or DXF-only** | Real DWG = $$$ license; start with DXF-only and DWG later |
| Sprinkler heads + pipe + fittings BIM | **Manufacturer-provided (free)** | Victaulic + others publish; license-per-use |
| Hydraulic calc engine | **Build** | Well-known physics, not a moat to buy |
| Pipe routing | **Build** | Differentiator; hire an algorithms person if needed |
| PE stamp / NICET cert | **Use Halo's existing staff** | Can't automate legally; Wade stamps |
| PDF sheet rendering | **Build (jsPDF + svg2pdf)** | Commodity tech |
| Hosting + auth | **Existing RankEmpire portal** | SSO reuse |

---

## Realistic risks

1. **Togal.AI licensing cost** — probably $500-2000/month API tier. Not a
   blocker but baked into pricing
2. **Victaulic license restricts redistribution** — we load per-project,
   can't ship an offline library. Working around this requires partnership
   conversation
3. **Pipe auto-routing is a research problem** for complex buildings —
   start with manual + "suggest next segment" AI-assist, evolve from
   there
4. **Hydraulic calcs must be defensible for AHJ** — every formula must
   cite the NFPA section. Probably want an NFPA 13 engineer code-review
   pass once a year
5. **Pascal upstream drift** — if Pascal refactors node schemas,
   `@halofire/*` packages break. Mitigation: pin to a release, only
   rebase when there's a clear win
6. **Client hardware constraints** — if Halo's estimators are on older
   laptops, WebGPU may not be available. Fallback to WebGL in Three.js

---

## What Halofire Studio becomes

A **browser-delivered, AI-assisted, web-BIM tool specifically for fire
sprinkler contractors**. Users:

- **Estimator** (Wade Steele + peers): logs in, uploads the architect's
  PDF/DWG/IFC, reviews the auto-generated 3D, places or accepts AI-placed
  sprinkler heads, reviews the auto-routed pipe network, runs hydraulic
  calcs, exports the shop-drawing PDF + BOM + proposal
- **Engineer of record** (Wade or equivalent PE/NICET): reviews the
  generated design, adds their stamp, submits to AHJ
- **Field crew**: views the 3D model + drawings on a tablet on-site to
  verify the install matches the design
- **Halo Fire leadership** (Dan Farnsworth): sees dashboard of active
  bids, win rate, profitability per bid

**It is not:**
- Generic BIM (Revit handles that)
- Generic CAD (AutoCAD handles that)
- A game engine (UE handles PBJWars)
- A Blender replacement (Blender stays in our asset factory)

**It is:**
- A vertical SaaS application where "design a fire sprinkler system" goes
  from 2-weeks to 2-hours for 80% of typical projects

---

## Revised Phase plan (what we'll actually ship)

See `HALOFIRE_ROADMAP.md` (v2, being revised next).

Short version:
- **M1 (6 wk):** IFC import + Pascal customization + first 50 assets +
  manual head place + basic linear pipe + simple hydraulic calc + PDF
  output — demo-grade
- **M2 (6 wk):** Togal.AI partnership + PDF ingest + auto head grid +
  schedule generation — alpha, Wade can try it on a trial bid
- **M3 (12 wk):** Auto-route tree systems + full NFPA 13 rule engine +
  AHJ-compliant drawing output + hydraulic calc report — beta, Halo
  submits real AHJ applications
- **M4 (8 wk):** Seismic bracing + multiple-floor systems + pricing
  engine + proposal PDF — 1.0 commercial

Total: ~32 weeks / 8 months to 1.0. Aggressive but defensible given the
foundation we get from Pascal + the partnerships we leverage.

---

## Questions outstanding

1. Budget for Togal.AI partnership API tier?
2. Who stamps the first 10 drawings (Wade in-house or 3rd-party PE consult)?
3. Do we target NFPA 13 only, or also NFPA 13R (residential) + NFPA 13D
   (1-2 family) from launch?
4. Target pricing model (SaaS per-seat? per-bid? enterprise flat fee?)
5. Is there a "sell the tool to OTHER sprinkler contractors" play, or is
   it internal-to-Halo only?

These shape the next phase of product work, not the next phase of
engineering. Engineering can start M1 with the above answers pending.
