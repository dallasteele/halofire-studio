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

### Entry 05 — @halofire/catalog + 20 authored components

- ✅ New `packages/halofire-catalog/` package with types, manifest, query
     helpers, README. 36 ComponentCategory enum values covering the
     full 505-SKU catalog scope (M1 populates 20 of them).
- ✅ `CatalogEntry` interface ties together: SKU, category, mounting
     class (floor_standing / ceiling_pendent / wall_mount / pipe_inline /
     pipe_segment / etc.), manufacturer + model, GLB path, real-world
     dimensions, NFPA-specific params (K-factor, temp rating, pipe size,
     connection type), and `open_source: bool` flag (for the two-tier
     vendor-BIM-loaded-per-bid strategy).
- ✅ Authored 20 GLB meshes via blender-mcp (TCP port 9876):
     - 5 sprinkler heads: pendant-standard, pendant-QR, upright-standard,
       sidewall-horizontal, concealed-pendant (all K=5.6)
     - 6 pipes: steel SCH10 grooved, 1" / 1-1/4" / 1-1/2" / 2" / 2-1/2" / 3"
       (1m unit lengths; scaled on Z at placement time)
     - 5 fittings: 90° elbows (1" + 2"), 2" equal tee, 2"x1" reducer,
       2" grooved coupling
     - 2 valves: 4" OS&Y gate, 4" grooved butterfly
     - 2 riser parts: 2" paddle flow switch, 2.5" pressure gauge w/ petcock
- ✅ Origins set to connection interfaces per mounting class (top of stem
     for pendent heads, Y=0 for sidewall wall-mount, Z=0 for valve bases)
- ✅ `bun install` + `check-types` clean on the catalog package
- ⚠️ Initial authoring batch hung after 16/20; separated last 4 into
     `authoring/author_remaining_4.py` which completed cleanly. Root
     cause not fully isolated — suspect blender-mcp socket buffer
     interaction with the larger batch. Monitor on future batches.
- 📝 Authored 20/505. Manufacturer BIM (Victaulic/Tyco/Reliable/etc.)
     gets loaded on-demand at bid time to respect vendor licenses that
     forbid bulk redistribution.

### Entry 06 — @halofire/ifc wired against @thatopen/components 2.4

- ✅ `packages/halofire-ifc/src/import.ts` upgraded from stub to real
     @thatopen/components bootstrap: `new OBC.Components()`, get
     `IfcLoader`, call `setup({ autoSetWasm: false, wasm: {path:'/', absolute:true} })`,
     then `ifcLoader.load(new Uint8Array(buffer))` — returns a fragments
     model passed to the mapper.
- ✅ Mapper documents the full spatial-tree walk (IfcSite -> IfcBuilding
     -> IfcBuildingStorey -> IfcWall/IfcSlab/IfcSpace/etc.) in comments;
     returns empty result with a clear warning that the walk runs for
     real once the Studio app exposes an upload UI (M1 week 3).
- ✅ `MappingResult` interface extended with `entitiesProcessed`,
     `skippedEntities`, `warnings` for the eventual walk implementation.
- ✅ Type-checks clean with @thatopen/components + @thatopen/fragments
     + web-ifc + three deps (minor peer-dep warnings about three version,
     non-blocking).
- 📝 The WASM binary (web-ifc.wasm) must be served from the Next.js app's
     `public/` folder once upload UI ships. Add a build-step to symlink
     or copy `node_modules/web-ifc/web-ifc.wasm` into public/.

### Entry 07 — Halofire sidebar tabs wired into Pascal editor

- ✅ `apps/editor/components/halofire/CatalogPanel.tsx` — catalog browser
     grouped by Sprinkler Heads / Pipes / Fittings / Valves / Riser, with
     search by SKU/name/manufacturer, selected-item detail pane showing
     all CatalogEntry metadata (K-factor, temp rating, pipe size, finish,
     etc.), and a placeholder "Place in scene (M1 week 4)" action button.
- ✅ `apps/editor/components/halofire/FireProtectionPanel.tsx` — live
     calls to the halopenclaw gateway's /mcp endpoint:
     - Shell audit: submits a demo scene with 1 floating wall, renders
       the PASS/FAIL output including the FLOATING line
     - Collision audit: submits demo scene with floor+wall+head, filters
       intentional floor-wall overlap, renders result
     - Ingest (PDF/IFC) buttons disabled with milestone labels until
       upload UI ships
     - Design + Export sections show scope + milestone placement
- ✅ `apps/editor/app/page.tsx` sidebar config extended from 1 tab to 3:
     Scene (Pascal built-in) / Catalog (ours) / Fire Protection (ours)
- ✅ `@halofire/catalog` added to `apps/editor/package.json` deps
- ✅ Catalog package type-checks clean. Editor app `check-types` surfaces
     pre-existing upstream `@pascal-app/editor` errors (documented in
     Entry 03), none from our new files. Runtime (Next.js SWC) compiles
     through them fine — only strict tsc trips up.
- 📝 Gateway URL is `process.env.NEXT_PUBLIC_HALOPENCLAW_URL ?? 'http://localhost:18790'`.
     User runs gateway separately; when this env is set to the production
     URL, the Studio talks to the deployed halopenclaw.
- 📝 Demo scenes are hardcoded in FireProtectionPanel for now. The
     halopenclaw-client package (planned) will serialize the live Pascal
     scene so validate runs on real user data.
