# Halofire Studio — Fork Roadmap

**Repo:** `dallasteele/halofire-studio`
**Upstream:** `pascalorg/editor` (MIT)
**Fork date:** 2026-04-18
**Purpose:** specialized CAD + visualization tool for fire sprinkler design
+ layout, targeting Halo Fire Protection and similar contractors.

## Why Pascal

See `E:/ClaudeBot/skills/3d-procedural-authoring/HALOFIRE_PLATFORM_DECISION.md`
for the full strategic analysis. Short version: Pascal has the right BIM
foundation (Sites → Buildings → Levels → Walls/Slabs/Zones/Items), MIT
license, modern TS/React/Three-Fiber stack, and web delivery. Forking saves
6-8 weeks of duplicate foundational work vs building from scratch.

## Fork discipline

- **Keep upstream package names** (`@pascal-app/core`, `@pascal-app/viewer`)
  to preserve merge compatibility with future Pascal releases.
- **Add new packages under `@halofire/*` namespace** for sprinkler-specific
  work — keeps the fork surface small.
- **Rebase quarterly** against pascalorg/editor main to pick up upstream
  improvements. Resolve conflicts in Halofire packages only.
- **Contribute back** any general-purpose improvements we make to Pascal core
  (DXF export, IFC import, etc.) via PR to pascalorg/editor.

## Phase plan (16 weeks to MVP)

### Phase 1 — Fork + Infrastructure (DONE 2026-04-18)
- [x] Fork pascalorg/editor → dallasteele/halofire-studio
- [x] Clone + `bun install` verify
- [x] Add HALOFIRE_ROADMAP.md (this file)
- [ ] Verify dev server boots at localhost:3002
- [ ] Create `packages/halofire-sprinkler` scaffold
- [ ] First commit + push

### Phase 2 — IFC import (2 weeks)
- Add `@thatopen/components` dependency
- IFC file upload UI panel
- Map IFC hierarchy → Pascal node tree (IfcSite → Site, IfcBuilding →
  Building, IfcBuildingStorey → Level, IfcWall → Wall, etc.)
- Preserve IFC GUIDs as metadata for round-trip

### Phase 3 — Sprinkler Head Library + Placement (3 weeks)
- Asset library: pendant (VK102), upright (V27), sidewall, concealed
  (real Victaulic / Tyco SKUs from manufacturer BIM)
- Placement tool: click on ceiling surface, head snaps to NFPA 13 grid
- Rules engine (NFPA 13 2022):
  - Max head spacing per hazard class (Light/OrdinaryI/OrdinaryII/ExtraI/ExtraII)
  - Max distance from wall = half spacing
  - Obstruction rules (3×, 4×, 6× beam rules)
- Live validation: place a head that violates NFPA → red outline + tooltip

### Phase 4 — Pipe Network Router + Hydraulic Calc (4 weeks)
- Auto-route branch lines from heads back to a selected main
- Pipe-size solver: demand per head × K-factor → pipe size per segment
- Hydraulic calc: Hazen-Williams friction loss, elevation gain, densities,
  remote area identification
- Riser + FDC placement tool
- Output: hydraulic calc report (PDF)

### Phase 5 — 2D Sheet Output (3 weeks)
- Plan-view renderer (top-down, orthographic, dimensioned)
- Title block templates (ANSI D, E)
- Sheet set builder: FP-0 index, FP-1 notes, FP-2 overall, FP-3+ area plans,
  FP-4 riser diagram, FP-5 details
- Export: DXF (via server-side `ezdxf`) + PDF (via `jsPDF` + `svg2pdf`)
- Dimensioning engine per ANSI Y14.5

### Phase 6 — Equipment Schedule + Proposal (2 weeks)
- Head schedule: mark, type, K-factor, temp rating, finish, manufacturer,
  model, quantity
- Pipe schedule: material, schedule, size, footage
- Material takeoff with unit prices
- Labor hours per role (Installer, Fitter, Foreman)
- Proposal PDF (title, scope, exclusions, pricing, terms)

### Phase 7 — Beauty Render Handoff (1 week)
- Export button: scene.json → Blender (via blender-mcp) or UE (via OCE) for
  photoreal render
- Default: Blender Cycles for still images; UE for VR walkthroughs

## Architecture (Halofire-specific packages)

```
packages/
├── core/                   # @pascal-app/core (UNCHANGED, upstream)
├── viewer/                 # @pascal-app/viewer (UNCHANGED, upstream)
├── editor/                 # @pascal-app/editor (UNCHANGED, upstream)
├── ui/                     # @repo/ui (UNCHANGED, upstream)
│
├── halofire-sprinkler/     # @halofire/sprinkler — NFPA 13 rules, head placer
├── halofire-pipe/          # @halofire/pipe — auto-router + hydraulic calc
├── halofire-ifc/           # @halofire/ifc — IFC import via @thatopen
├── halofire-drafting/      # @halofire/drafting — 2D sheet output
└── halofire-schedule/      # @halofire/schedule — schedules + takeoff + PDF
```

Halofire packages import from `@pascal-app/core` but not vice versa. Upstream
stays ignorant of our existence.

## Integration points with existing ClaudeBot skills

- `skills/3d-procedural-authoring/knowledge/k12-kitchen-layout-standards.md` —
  applies to any multi-zone facility; generalizable
- `skills/3d-procedural-authoring/knowledge/technical-drafting-workflow.md` —
  THE workflow this product enforces
- `skills/3d-procedural-authoring/knowledge/equipment-classes.md` —
  same tabletop/floor/drop-in framework applies to sprinkler equipment
- `skills/3d-procedural-authoring/tools/draft_plan.py` — server-side DXF
  output, called from the Halofire API for sheet export
- Brain queries — `halofire-platform-decision`, `drafting-first-workflow`,
  `k12-cafeteria-workflow` etc. remain the institutional memory

## Deployment target

Production URL: `studio.rankempire.io/halofire` (new subdomain on
OpenClaw VPS). Bid detail page link from `portal.rankempire.io/halofire/{bid-id}`
opens the studio pre-loaded with the architect's IFC and the current bid
state.

Authentication: reuse RankEmpire's SSO (OAuth). Bid state persists in
IndexedDB locally + server-side JSON at POST /api/halofire/bid/{id}/scene.

## Binding commitment

The drafting-first workflow (Research → Program → Options → Selected Plan →
Schedule → Elevations → 3D Build → As-built Check) is enforced by
Halofire Studio's UI. Users cannot export a proposal until all 8 phase
artifacts exist. No shortcut.
