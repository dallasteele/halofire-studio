# Halofire Studio — Technical Implementation Plan

User-answered constraints (2026-04-18):
1. PDF→spaces must be **FREE** (no Togal.AI subscription)
2. Wade Steele stamps drawings
3. **NFPA 13 only** (no 13R, no 13D)
4. **Internal tool**; user licenses to Halo Fire as finished product
5. Must integrate with **Claude + Codex + a "halopenclaw" gateway**

This plan replaces the budget-dependent parts of `HALOFIRE_ROADMAP.md`
with concrete implementations that fit the constraints.

---

## The free PDF→spaces stack (replaces Togal.AI)

Hybrid, layered. Try cheap+deterministic first, fall back to AI only
when needed.

```
PDF upload
  │
  ▼
┌─────────────────────────────────┐
│ Layer 1: Vector PDF extraction  │   pdfplumber + pypdfium2
│                                 │   FREE. Works on ~50% of modern
│ If vector-native (Revit/ACAD    │   born-digital architect PDFs.
│ export) → extract line segments │   Outputs: line segments, text,
│ directly. Classify walls as     │   layer names, page dimensions.
│ thick parallel lines, doors as  │   Cost: $0 per bid.
│ arcs + rectangle openings.      │
└────────────┬────────────────────┘
             │ if confidence < 0.8
             ▼
┌─────────────────────────────────┐
│ Layer 2: OpenCV preprocessing   │   opencv-python
│                                 │   Rasterize PDF @ 300 DPI, binarize,
│ Rasterize + denoise + Hough     │   detect straight lines (Hough),
│ line detection for walls.       │   extract text regions for OCR.
│ Template-match door arcs.       │   FREE.
└────────────┬────────────────────┘
             │ if confidence < 0.8
             ▼
┌─────────────────────────────────┐
│ Layer 3: CubiCasa5k pretrained  │   github.com/CubiCasa/CubiCasa5k
│                                 │   PyTorch model trained on 5000+
│ ML model specialized for floor  │   annotated floor plans. Outputs
│ plans. Wall + room + door + icon│   walls, doors, windows, icons.
│ segmentation.                   │   MIT license. Self-hosted.
│                                 │   FREE (one-time model download).
└────────────┬────────────────────┘
             │ semantic polish
             ▼
┌─────────────────────────────────┐
│ Layer 4: Claude Vision (semantic)│  Anthropic Messages API
│                                  │  via existing OAuth.
│ Given structured output from L1-3│  Cost: ~$0.02/sheet input +
│ and a PDF snippet image: label   │  ~$0.05/sheet output = ~$0.07
│ rooms (office/corridor/mech),    │  per sheet. Typical bid = 10-30
│ identify hazard class, confirm   │  sheets → $1-5 per bid.
│ ambiguous geometry.              │  Effectively FREE for internal.
└────────────┬────────────────────┘
             │
             ▼
┌─────────────────────────────────┐
│ Structured output:               │
│ {walls: [...], rooms: [...],     │
│  doors: [...], windows: [...],   │
│  scale: 1:50,                    │
│  hazard_per_room: {...}}         │
│ Piped into Pascal's node tree.   │
└─────────────────────────────────┘
```

**Accuracy target:** 90% of bids ingest cleanly with L1-L3. The 10% that
need a human touch get flagged in the UI for Wade to fix.

**Vs Togal.AI at 98%**: we are 8 points lower on the first pass, but free
+ fully owned + fits with the other AI layers. At M2 we're shipping,
not competing on accuracy.

---

## Halopenclaw gateway (new service)

A Halofire-specific tool-calling gateway, modeled on the existing
`openclaw` pattern. Exposes the design primitives as JSON-RPC tools
that any AI agent (Claude, Codex, Gemini, future) can invoke.

### Architecture

```
┌─────────────────────────┐         ┌────────────────────────┐
│ Claude (Agent SDK)      │         │ Codex CLI              │
│  - vision + reasoning   │         │  - code gen            │
│  - tool calls           │         │  - multi-step workflows│
└────────────┬────────────┘         └────────────┬───────────┘
             │                                   │
             │  JSON-RPC tools/call              │
             └───────────────────┬───────────────┘
                                 │
                    ┌────────────▼────────────┐
                    │  Halopenclaw Gateway    │
                    │  FastAPI  :18790        │
                    │                         │
                    │  Tool dispatcher:       │
                    │   - halofire_ingest     │
                    │   - halofire_place_head │
                    │   - halofire_route_pipe │
                    │   - halofire_calc       │
                    │   - halofire_schedule   │
                    │   - halofire_export_pdf │
                    │   - halofire_validate   │
                    │   - halofire_chat_edit  │
                    └────────────┬────────────┘
                                 │  REST + WS
                    ┌────────────▼────────────┐
                    │ Halofire Studio         │
                    │ Next.js :3002 dev       │
                    │ studio.rankempire.io    │
                    │  - Pascal fork          │
                    │  - @halofire/*          │
                    └─────────────────────────┘
```

### Tool catalog (v1, expand per milestone)

| Tool | Modes | Purpose |
|---|---|---|
| `halofire_ingest` | `pdf`, `ifc`, `dwg` | Parse a file, emit structured scene |
| `halofire_place_head` | `manual`, `auto_grid`, `at_coords` | Place sprinkler head(s) |
| `halofire_route_pipe` | `manual_segment`, `auto_tree`, `auto_grid` | Route pipes |
| `halofire_calc` | `hazen_williams`, `density_area`, `remote_area` | Run hydraulic calcs |
| `halofire_schedule` | `heads`, `pipe`, `fittings`, `hangers` | Generate schedule |
| `halofire_export` | `pdf_plan`, `dxf`, `ifc`, `cut_sheets`, `proposal` | Export deliverables |
| `halofire_validate` | `nfpa13`, `shell`, `hydraulic`, `completeness` | Rule-engine audit |
| `halofire_chat_edit` | (free-form) | Natural-language scene edit via Claude tool use |

### Deployment

- **Local dev:** `fastapi dev halopenclaw/main.py --port 18790`
- **Production:** systemd service on VPS, reverse-proxied through nginx
  at `gateway.rankempire.io/halofire/*`
- **Auth:** API key tied to RankEmpire account (same SSO as portal)

### Why a gateway (not inline tool imports in the studio)

Three reasons:
1. **AI-agnostic.** Claude, Codex, future Gemini — all talk JSON-RPC.
   Gateway decouples the studio UI from any one model vendor.
2. **Server-side ops.** Hydraulic calc for a 200-head job needs Python
   + NumPy. Browser can't run that performantly. Gateway runs server-side.
3. **Scalability.** When we move to multi-tenant SaaS, gateway is the
   natural place to enforce per-tenant limits, billing, audit logs.

---

## Package architecture (revised)

```
halofire-studio/
├── apps/
│   └── editor/                      # Next.js (browser, port 3002)
├── packages/
│   ├── core/                        # @pascal-app/core (upstream, unchanged)
│   ├── viewer/                      # @pascal-app/viewer (upstream, unchanged)
│   ├── editor/                      # @pascal-app/editor (upstream, unchanged)
│   ├── ui/                          # @repo/ui (upstream, unchanged)
│   │
│   ├── halofire-sprinkler/          # @halofire/sprinkler — NFPA 13 rules, head catalog (SCAFFOLDED)
│   ├── halofire-ifc/                # @halofire/ifc — IFC import via @thatopen/components
│   ├── halofire-takeoff/            # @halofire/takeoff — PDF→scene (L1-L4 stack)
│   ├── halofire-pipe/               # @halofire/pipe — routing + hydraulic calc
│   ├── halofire-drafting/           # @halofire/drafting — 2D sheet output
│   ├── halofire-schedule/           # @halofire/schedule — schedules, BOM, cut sheets
│   ├── halofire-catalog/            # @halofire/catalog — manufacturer BIM loader
│   ├── halofire-ai-bridge/          # @halofire/ai-bridge — Claude + Codex clients
│   └── halofire-halopenclaw-client/ # @halofire/halopenclaw-client — gateway RPC client
└── services/
    ├── halopenclaw-gateway/         # Python FastAPI (server, port 18790)
    │   ├── main.py                  # FastAPI app + JSON-RPC handler
    │   ├── tools/                   # Tool implementations (one file per tool)
    │   │   ├── ingest_pdf.py        # Layers 1-4 PDF pipeline
    │   │   ├── place_head.py
    │   │   ├── route_pipe.py
    │   │   ├── calc_hydraulic.py
    │   │   ├── export_pdf.py
    │   │   └── validate_nfpa13.py
    │   ├── pdf_pipeline/            # Vendored PDF extraction stack
    │   │   ├── vector.py            # pdfplumber extraction
    │   │   ├── raster.py            # opencv preprocessing
    │   │   ├── cubicasa.py          # CubiCasa5k model wrapper
    │   │   └── claude_vision.py     # Claude Vision fallback
    │   ├── calc/                    # Hydraulic engine
    │   │   ├── hazen_williams.py
    │   │   ├── fittings.py
    │   │   └── remote_area.py
    │   ├── nfpa13/                  # Rule engine
    │   │   ├── rules.py             # Every rule with NFPA cite
    │   │   └── validator.py
    │   ├── requirements.txt         # pdfplumber, opencv-python, torch (for CubiCasa),
    │   │                            # anthropic, fastapi, uvicorn, ezdxf
    │   └── README.md
    └── halofire-ai-router/          # Python — routes AI calls Claude vs Codex vs local
        ├── main.py
        ├── claude_client.py
        └── codex_client.py
```

---

## M1 revised schedule (weeks 1-6, starting now)

| Week | Deliverable | Package touched |
|---|---|---|
| 1 | `@halofire/ifc` + `@thatopen/components` working import of sample IFC | ifc |
| 1 | `halopenclaw-gateway` FastAPI skeleton + JSON-RPC + `halofire_validate` shell tool | services/gateway |
| 2 | First 20 components authored via Blender MCP (existing pipeline) | catalog |
| 2 | `@halofire/catalog` — loads GLBs + metadata from manifest | catalog |
| 3 | Manual head placement tool in Pascal UI (click ceiling → spawn head) | sprinkler + editor |
| 3 | `halofire_place_head` tool in gateway | services/gateway |
| 4 | Linear pipe routing tool (click head → main line → riser) | pipe |
| 4 | Basic Hazen-Williams calc for single branch line | services/gateway/calc |
| 5 | `halofire_export` PDF output — 1 floor plan sheet via `draft_plan.py` + jsPDF | drafting |
| 5 | First 30 more components (50 total) | catalog |
| 6 | `halofire_chat_edit` — Claude tool-use loop + UI sidebar in Halofire Studio | ai-bridge + editor |
| 6 | E2E demo video: Wade walks through a past bid, 1-day turnaround | — |

M1 success criterion: Wade takes an architectural IFC of an old bid,
manually imports to Halofire, places 20 heads, routes one branch,
runs calc, exports a PDF. Looks like a sprinkler drawing. Wade's
feedback video posted to Brain.

---

## M2 revised (weeks 7-12): free PDF→spaces operational

| Week | Deliverable |
|---|---|
| 7 | `services/halopenclaw-gateway/pdf_pipeline/vector.py` — pdfplumber layer 1 |
| 7 | `services/halopenclaw-gateway/pdf_pipeline/raster.py` — opencv layer 2 |
| 8 | CubiCasa5k model download + Python wrapper — layer 3 |
| 8 | `services/halopenclaw-gateway/pdf_pipeline/claude_vision.py` — layer 4 |
| 9 | `halofire_ingest` tool wiring all 4 layers with confidence scoring |
| 9 | Halofire Studio PDF upload UI + progress tracker |
| 10 | Auto-grid head placer (rectangular rooms first, irregular rooms via BSP) |
| 10 | Hazard-class auto-labeler (room name → NFPA class lookup) |
| 11 | 50 more components (100 total) + hanger schedule |
| 12 | Real-bid pilot with Wade — measure time reduction |

---

## M3 (weeks 13-24): AHJ-submittal grade

Per-week breakdown in `HALOFIRE_ROADMAP.md` v2. Key additions:

- Auto pipe router (tree system) — MST over heads, Steiner points for
  joists, return paths to riser
- Pipe sizing solver (iterative hydraulic method)
- Full NFPA 13 rule engine (every Ch 8-10 rule with cite)
- AHJ-compliant sheet set generator (FP-0 through FP-5)
- Wade's PE/NICET stamp integration (upload + auto-apply to every sheet)
- Cut sheet assembly (fetch manufacturer PDFs, concatenate)

---

## M4 (weeks 25-32): 1.0 commercial

- Seismic bracing (ASCE 7 zone)
- Multi-floor systems linked via riser
- Labor hours (PHCC units × quantities)
- Material pricing × markup
- Proposal PDF
- Production deploy to studio.rankempire.io

---

## Integration points with existing ClaudeBot infrastructure

| Existing system | Halofire connection |
|---|---|
| HAL API :9000 | Halopenclaw registers as a "module" HAL can start/stop/query |
| OpenClaw Gateway :18789 | Separate service; Halofire uses its OWN gateway at :18790 |
| Brain (LightRAG) :8790 | Halofire writes bid outcomes + lessons here; Claude recalls |
| LLM Gateway :8787 | Halofire's AI bridge can route through this for model switching |
| Claude Agent SDK | Halofire's ai-bridge wraps this for tool-use loops |
| Codex CLI | Halofire's ai-bridge shells out to codex for multi-step code edits |
| RankEmpire portal :3000 | Bid detail page links to studio.rankempire.io/halofire/{bid} |
| skills/3d-procedural-authoring | Platform-agnostic; Halofire inherits equipment-classes, drafting-workflow, etc. |
| ezdxf draft_plan.py | Running inside halopenclaw-gateway for DXF/SVG sheet output |
| Blender MCP :9876 | Asset factory; halopenclaw calls it to author missing components |

---

## Binding technical commitments

1. **Every NFPA 13 rule in `@halofire/sprinkler` cites a code section**
   — `code_cite: "NFPA 13-2022 §11.2.3.1.1"`. Tests verify every rule
   has a cite.
2. **No Togal.AI dependency.** Every layer of PDF→spaces is free or
   OAuth-covered.
3. **Halopenclaw gateway is the only backend.** Studio never calls
   manufacturer APIs or ML models directly — always through gateway
   tools for auditability + rate limiting.
4. **Claude + Codex + Gemini interchangeable** via `@halofire/ai-bridge`.
   No model lock-in.
5. **Pascal upstream untouched.** Every Halofire feature lives under
   `@halofire/*` or `services/`. Quarterly rebase against pascalorg/editor
   stays clean.

---

## Execution: starting M1 week 1 now

Next commits (this session):
1. `@halofire/ifc` package scaffold + `@thatopen/components` dependency
2. `@halofire/takeoff` package scaffold + Claude Vision client stub
3. `@halofire/ai-bridge` package scaffold + Claude Agent SDK wrapper
4. `services/halopenclaw-gateway/` — Python FastAPI skeleton + first tool
   (`halofire_validate`) + requirements.txt + systemd service file
5. All checked in + pushed to `main`

After this session user has a real, commit-able foundation to iterate on.
