# HaloFire CAD Studio — UX Research & Interface Plan

**Companion to:** `2026-04-18-real-ai-gen-design.md`
**Goal:** Pivot the Pascal-derived Studio shell into a purpose-built
fire-sprinkler CAD UI that matches AutoSprink / HydraCAD / SprinkCAD
industry conventions while native-integrating the agentic design loop.

---

## Competitive survey (what fire sprinkler designers expect)

### AutoSprink (MEPcad)
- **Top ribbon** grouped: Home | Draw | Modify | Layout | Pipes |
  Hangers | Seismic | Hydraulics | Schedules | Export | Tools | View
- **Left tool palette** — head / pipe / fitting / valve / hanger /
  riser / FDC stamps, drag or click-place
- **Right properties panel** — select any entity → K-factor, temp
  rating, SKU, manufacturer, finish, orientation, coverage
- **Layer manager** (F2 or side dock) — industry-standard layer names:
  FP-HEADS, FP-PIPE-1, FP-PIPE-1-25, FP-PIPE-1-5, FP-PIPE-2,
  FP-PIPE-2-5, FP-PIPE-3, FP-PIPE-4, FP-RISER, FP-HANGERS, FP-SIGNAGE
- **Command line** at the bottom (AutoCAD heritage) — power users
  type every command
- **Model space / paper space** dual mode, identical to AutoCAD
- **Status bar** with toggles: SNAP, GRID, ORTHO, POLAR, OSNAP, OTRACK,
  LWT, MODEL/PAPER
- **Pipe-size color convention** (critical — this is how designers
  read plans at a glance):
  - 1" = yellow
  - 1-1/4" = magenta
  - 1-1/2" = cyan
  - 2" = blue
  - 2-1/2" = green
  - 3" = red
  - 4" = white/heavy
- **Hydraulic results palette** — node-by-node pressure + flow, critical
  path highlighted, density-area contour overlay
- **Schedule docker** — live BOM updating as entities are placed

### HydraCAD (Hydratec)
- Tighter UI than AutoSprink, more modern
- **Hydraulic-first** workflow — every pipe has flow/pressure displayed
  inline
- Real-time density-area gradient shading
- Dedicated standpipe sizing wizard
- Cut-sheet picker integrated with design (pick a head → sheet opens)

### SprinkCAD (Tyco)
- Oldest UI, most dated, but has the deepest cut-sheet library
- Tyco-specific K-factor + ESFR automation
- Per-state AHJ rule presets

### Revit MEP + sprinkler plugins
- Pure BIM workflow (families, parameters, view templates)
- Sheet set built-in via Revit
- IFC export native
- **Great clash detection** against architect/MEP models

### Industry pain points (from forums + Reddit r/firesprinklers)
1. "Takes 40 minutes to re-route every time the architect issues a
   revision" → our agentic re-run should do this in seconds
2. "AutoSprink's schedule docker loses context after a big edit"
3. "HydraCAD calc engine is great but laying out the pipe manually
   takes forever"
4. "No tool has good multi-system coordination — combo standpipe +
   dry garage + wet residential on the same job"
5. "Cut-sheet integration is always stale"
6. "AHJ sheet set generation means manually printing from layouts"

These are our opportunities.

---

## HaloFire CAD Studio UI — Target

### Layout (inspired by AutoSprink, refined by Linear/Figma aesthetics)

```
┌─────────────────────────────────────────────────────────────────┐
│ Menu [File][Edit][View][Design][Calc][Export][Tools][Help]      │
├─────────────────────────────────────────────────────────────────┤
│ Ribbon — tabs:                                                  │
│ Home | Draw | Layout | Pipes | Hangers | Hydraulics |           │
│   Schedules | Standpipes | Dry System | AI Design | Submit      │
│ (active tab shows icon-and-label buttons, grouped by function)  │
├──┬────────────────────────────────────────────────────┬─────────┤
│  │                                                    │         │
│  │                                                    │ PROPS   │
│T │                                                    │ ────    │
│O │                                                    │ Selected│
│O │                                                    │ entity  │
│L │                                                    │ attrs + │
│  │          Plan / 3D / Hybrid viewport               │ live    │
│P │                                                    │ NFPA 13 │
│A │                                                    │ rule    │
│L │                                                    │ status  │
│E │                                                    │         │
│T │                                                    ├─────────┤
│T │                                                    │ LAYERS  │
│E │                                                    │ FP-HEADS│
│  │                                                    │ FP-PIPE-│
│  │                                                    │ FP-RISE │
│  │                                                    │ ...     │
├──┴────────────────────────────────────────────────────┴─────────┤
│ Command line: _                                                 │
├─────────────────────────────────────────────────────────────────┤
│ [SNAP][GRID][ORTHO][POLAR][OSNAP][LWT] | MODEL | Scale 1:100 Z⟲│
└─────────────────────────────────────────────────────────────────┘

Bottom-left: AHJ Sheet List dock (collapsible)
Bottom-right: Hydraulic Results dock (collapsible)
Left-side    : Tool Palette (stamps: heads, pipes, fittings, valves)
Right-side   : Properties + Layers
Bottom strip : Command line + status bar (AutoCAD heritage, kept)
```

### The "AI Design" ribbon tab — the killer feature

```
AI Design tab:
  [Intake PDF]  [Intake IFC]  [Intake DWG]      Ingest
  [Classify Hazards]                            Classifier
  [Place Heads]  [Place Selected Room Only]     Placer
  [Route Pipes]  [Route This System Only]       Router
  [Calc Hydraulics]  [Calc + Upsize Loop]       Hydraulic
  [Rule Check]                                  Rulecheck
  [Generate Sheet Set]  [Generate Proposal]     Drafter/Proposal
  [Run Full Pipeline]                           Orchestrator
  [Quick Bid (60 s)]                            Quickbid
```

Each button dispatches the corresponding agent. A **"Run Full
Pipeline"** button kicks off the orchestrator and streams progress via
SSE into a dedicated panel — designer watches the agents work.

### Command line — direct agent invocation

Typed commands map to agents:
- `INTAKE <file>` → intake agent
- `CLASSIFY` → classifier agent on loaded Building
- `PLACE [room_id]` → placer agent (all rooms or one)
- `ROUTE [system_id]` → router agent
- `CALC` → hydraulic agent
- `RULECHECK` → rulecheck agent
- `DESIGN` → orchestrator (full pipeline)
- `BID` → quick-bid agent

Power users drive everything from the command line — Wade included,
after a week.

### Pipe-size color convention — WE ADOPT INDUSTRY STANDARD

```
1"     yellow       #FFFF00
1-1/4" magenta      #FF00FF
1-1/2" cyan         #00FFFF
2"     blue         #0066FF
2-1/2" green        #00C040
3"     red          #E8432D
4"     white bold   #FFFFFF (2.5x linewidth)
```

Designers who have used AutoSprink for 20 years read plans at a glance
by color. We honor this in both 2D plan and 3D pipe-cylinder tints.

### Layer naming

Match AutoSprink layer conventions exactly:
```
FP-HEADS          all sprinkler heads
FP-HEADS-SIDEWALL sidewall heads only
FP-PIPE-1         1" pipe
FP-PIPE-1-25      1-1/4" pipe
FP-PIPE-1-5       1-1/2" pipe
FP-PIPE-2         2" pipe
FP-PIPE-2-5       2-1/2" pipe
FP-PIPE-3         3" pipe
FP-PIPE-4         4" pipe
FP-PIPE-6         6" pipe (riser)
FP-RISER          risers
FP-HANGERS        hangers
FP-FITTINGS       fittings
FP-VALVES         valves + check + gate + butterfly
FP-SIGNAGE        signs + labels
FP-FDC            FDC assembly
FP-CALC-CRITICAL  critical hydraulic path overlay
```

Exported DXF uses these verbatim — AutoSprink users can open the file
and feel at home.

### Keyboard shortcuts (AutoCAD dialect kept, plus sprinkler-specific)

```
L        line
C        circle
M        move
CO       copy
RO       rotate
SC       scale
E        erase
TR       trim
EX       extend
DIM      dimension
Z        zoom
P        pan
OFF      offset

# Sprinkler-specific overlays:
H        place head (AutoSprink convention)
HP       auto-place heads (whole room)
RP       run pipe
TR       tee route (branch pipe)
RI       riser insert
FD       FDC insert
CA       calc hydraulic
SZ       auto-size pipes
VP       verify placement (rulecheck)
AI       invoke AI design loop (our addition)
```

### 3D viewport

Three modes, one-click toggle:
1. **Plan 2D** (default) — industry-standard CAD look, black-on-white
2. **3D Iso** — @react-three/fiber @pascal-app/viewer repurposed
3. **Hybrid** — 2D plan overlay on 3D model, useful for coordination

### Dark/light theme

Dark default (estimators live in their CAD, eye fatigue matters).
Light mode for AHJ review mode (reviewers want the printed-plan feel).

### Sheet list panel

Bottom-left dock shows the auto-generated sheet set:
```
FP-0 Cover                         [View] [Plot]
FP-H Hydraulic Placard             [View] [Plot]
FP-1 Level 1 — Residential Plan    [View] [Plot]
FP-2 Level 2 — Residential Plan    [View] [Plot]
FP-3 Level 3 — Residential Plan    [View] [Plot]
FP-4 Level 4 — Residential Plan    [View] [Plot]
FP-P1 Parking Level 1 — Dry Plan   [View] [Plot]
FP-P2 Parking Level 2 — Dry Plan   [View] [Plot]
FP-R Riser Detail                  [View] [Plot]
FP-B BOM Schedule                  [View] [Plot]
FP-D Details                       [View] [Plot]

[Plot Set]  [Export PDF]  [Export DXF]  [Export IFC]
```

---

## Implementation plan for the UI pivot

### Phase UX-0 — Strip Pascal editor chrome
- Keep @pascal-app/viewer (Three.js rendering pipeline)
- Replace @pascal-app/editor shell with our own layout
- Keep @pascal-app/core scene store as the client-side mirror of
  authoritative CAD state (not the source of truth)

### Phase UX-1 — Ribbon + command line
- Build `components/ribbon/Ribbon.tsx` with tabs + button groups
- Build `components/command-line/CommandLine.tsx` that dispatches
  agent tools via the gateway

### Phase UX-2 — Tool palette + properties + layers
- Left tool palette with draggable stamps
- Right properties panel driven by scene selection
- Layer manager dock with visibility/lock per-layer

### Phase UX-3 — Pipe-size color convention + layer export
- Update `catalog` package to include industry color per pipe size
- Update Three.js viewer to tint pipe cylinders by size
- Update DXF exporter to use industry layer names

### Phase UX-4 — AI Design ribbon tab
- Each button wires to a gateway agent tool
- Live SSE stream for the full-pipeline run

### Phase UX-5 — Sheet list + hydraulic results docks

### Phase UX-6 — Client bid viewer alignment
- `/bid/[project]` adopts same pipe-size color convention
- Keeps simpler, client-facing chrome (no ribbon)

---

## Typography + visual

- **Sans (body)**: Inter — crisp, professional, industrial
- **Mono (numbers + SKUs)**: JetBrains Mono
- **Display** (sparingly, headers only): Inter tight
- **Iconography**: Lucide (open source, consistent with industry)
- **Spacing**: 4px base unit
- **Borders**: 0 radius on CAD surfaces, 2px radius on dialogs
- **Accent**: Halo Fire red-orange `#e8432d` only for critical path +
  primary CTAs
- **Neutrals**: Slate scale (#0a0a0b to #f8fafc) for dark/light
- **Color-blind considerations**: Pipe-size color convention adds
  linewidth weight (4" always heaviest, regardless of red/green test)

---

## Success metric (UX)

> A designer who has used AutoSprink for 10 years opens HaloFire CAD
> Studio for the first time, hits `HP` to auto-place heads, hits `RP`
> to route pipes, hits `CA` to calc, hits `AI` to run full pipeline,
> and never opens the help menu. Everything is where they expect.

---

## What we keep from Pascal, what we rebuild

**Keep:**
- `@pascal-app/viewer` Three.js rendering (3D viewport internal)
- `@pascal-app/core` scene store (client-side mirror)
- Next.js 16 + React 19 + Turbopack build chain
- Bun monorepo plumbing

**Rebuild (as HaloFire CAD):**
- App shell (`apps/editor/app/page.tsx`) — new layout, no Pascal chrome
- Sidebar tabs → Ribbon + docks
- `@pascal-app/editor` UI primitives → HaloFire UI components
- Catalog panel → Tool palette with industry-accurate stamps
- Site/Scene panel → Sheet list + Layer manager
- Fire Protection panel → AI Design ribbon + hydraulic results docker

**Remove:**
- Generic editor features (walls/floors/levels edit tools from Pascal)
  unless they survive as fire-sprinkler-specific subsystems
- Pascal's marketing copy in landing pages
- `@pascal-app/viewer` demo routes

---

Next commits execute Phase UX-0 and Phase UX-1. The 4-month delivery
target from the design plan shifts +2 weeks for the UX rebuild, which
is a good trade: a working CAD app Wade enjoys using beats a technical
demo he tolerates.
