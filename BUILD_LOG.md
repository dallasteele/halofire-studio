# Halofire Studio — Build Log

A continuous running record of implementation work, intended for
**Codex review at the end**. Every significant change gets a timestamped
entry with: what changed, why, how it was verified, open questions.

The goal is to let a reviewer (Codex or human) understand the intent +
execution of the build without reading individual commits. Commits
reference log entries by date; log entries reference commits by short hash.

---

## Legend

- **✅ done + verified** — implementation + test/type-check pass
- **🔨 implemented** — code written, test pending
- **⚠️ incomplete / known issue** — reviewer attention needed
- **📝 note** — rationale or architectural decision

---

## 2026-04-18

### Entry 01 — Fork + Scaffold (commit `2709edb`)

- ✅ Forked `pascalorg/editor` (MIT) → `dallasteele/halofire-studio`
- ✅ Cloned, `bun install` 1087 packages
- ✅ `packages/halofire-sprinkler/` scaffold (NFPA 13 hazard tables +
     Head type + placement validator stub)
- ✅ README prepended Halofire header; upstream Pascal README preserved
- ✅ Next.js `<title>` set to "Halofire Studio" via metadata export
- 📝 Kept `@pascal-app/*` package names to preserve upstream merge
     compatibility. Only new work goes under `@halofire/*` namespace.

### Entry 02 — Requirements + Roadmap v2 (commit `72cbe18`)

- ✅ `HALOFIRE_REQUIREMENTS.md` — 500+ line capability matrix, ~505 SKU
     catalog scope, 14 building archetypes, build-vs-partner decisions
- ✅ `HALOFIRE_ROADMAP.md` v2 — honest 4-milestone 8-month plan with
     verification criteria per milestone
- 📝 Competitive research (AutoSPRINK, SprinkCAD, HydraCAD, FHC, Togal.AI,
     Victaulic BIM) confirmed the opening: web + AI + integrated is empty
- 📝 Decision: web delivery (browser) is the right vertical. Desktop
     incumbents cannot deliver bids over a URL.

### Entry 03 — Technical Plan + M1 Infrastructure (commit `4b2786a`)

- ✅ `HALOFIRE_TECHNICAL_PLAN.md` — 4-layer free PDF pipeline
     (pdfplumber L1 + opencv L2 + CubiCasa5k L3 + Claude Vision L4),
     halopenclaw gateway architecture, Claude+Codex bridge design
- ✅ `services/halopenclaw-gateway/` — FastAPI JSON-RPC 2.0 tool
     dispatcher on port 18790, 6 tool stubs (validate, ingest, place_head,
     route_pipe, calc, export) each with input schema + descriptions
- ✅ `packages/halofire-ifc/` — `@thatopen/components` dep + types +
     mapper stub + NFPA hazard inference from IfcSpace names
- ✅ `packages/halofire-takeoff/` — browser client for halopenclaw
     takeoff endpoints with SSE progress + poll fallback
- ✅ `packages/halofire-ai-bridge/` — Claude + Codex router with model
     selection heuristics (Opus for tools/vision, Haiku for short
     lookups, Codex for multi-step code edits)
- ✅ All 3 TS packages type-check clean
- ⚠️ Two pre-existing TS errors in upstream `@pascal-app/editor` at
     `src/store/use-editor.tsx:344,355` (implicit any parameters) —
     NOT ours, NOT fixing, preserves rebase compatibility
- 📝 User constraint: free PDF→spaces (no Togal.AI budget). Solved
     via Claude Vision on existing OAuth = "effectively free" internal
     ($1-5/bid).

---

## M1 Week 1 — starting now

Tasks in order:
1. Port `validate_shell.py` logic from ClaudeBot skills into
   `services/halopenclaw-gateway/tools/validate_nfpa13.py` shell mode
2. Wire `@thatopen/components` IfcLoader for real IFC parsing
3. Scaffold `@halofire/catalog` for GLB asset loading
4. Author first 10 sprinkler components via Blender MCP
5. Verify halopenclaw-gateway boots + tool-call round-trip works

Every task ends with an Entry here + a commit.

### Entry 04 — halofire_validate ported + gateway smoke test

- ✅ Ported `skills/3d-procedural-authoring/tools/validate_shell.py`
     (the tool that caught the 5-iteration UE floating-walls bug) into
     `services/halopenclaw-gateway/tools/validate_nfpa13.py`. Now operates
     on Halofire scene-graph JSON (Pascal node tree + sprinkler layer)
     instead of UE actor iteration.
- ✅ Added `collisions` mode (pairwise AABB overlap) with filter for
     intentional ceiling-wall / floor-wall / pipe-through-wall pairs
- ✅ Gateway venv created (`.venv` under services/halopenclaw-gateway/),
     `fastapi + uvicorn + pydantic` installed
- ✅ Gateway boots on port 18790, `/health` returns OK with all 6 tools
     listed
- ✅ `tools/list` JSON-RPC returns all 6 tools with their schemas
- ✅ `halofire_validate` shell-audit test with 3 nodes (1 intentionally
     floating at Z=200..600) correctly returns **FAIL — 1 of 3 structural
     nodes do NOT touch the floor. FLOATING: NorthWall_FLOATING
     bottom_z=+200.0 top_z=+600.0**
- 📝 Scene JSON shape for the tool is `{nodes: [{id, type, folder,
     bbox_world: {min:[x,y,z], max:[x,y,z]}, metadata}]}`. This is what
     the halopenclaw-client in Halofire Studio will ship when calling
     the validate tool from the browser.
- 📝 NFPA/hydraulic/completeness modes are stubbed with M3-scope
     messages; they'll ship with the real rule engine later.
- ⚠️ `.venv` is gitignored; CI will need its own install step.
