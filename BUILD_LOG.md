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

### Entry 08 — @halofire/halopenclaw-client + Pascal scene serializer

- ✅ New `packages/halofire-halopenclaw-client/` package (TS library,
     MIT, ~4 kB compiled).
     - `types.ts`: one-place enum of ToolName + ValidateMode / IngestMode /
       PlaceHeadMode / RoutePipeMode / CalcMode / ExportMode so TS catches
       typo at call-sites. `SerializedNode` + `SerializedScene` match the
       gateway's validate tool input schema.
     - `client.ts`: `createHalopenclawClient({baseUrl, fetchImpl})` returns
       a typed `{call, listTools, health, validate}` facade. Reads baseUrl
       from `NEXT_PUBLIC_HALOPENCLAW_URL` env if not passed. Uses global
       fetch; SSR-safe via optional fetchImpl override.
     - `serialize.ts`: `serializePascalScene(roots, opts)` walks a Pascal
       node tree (via minimally-typed `PascalSceneNode` shape) and flattens
       to the gateway format. Emits only nodes that have a `bboxWorld`.
- ✅ Type-checks clean.
- 📝 Next step (M1 week 3-4): wire `FireProtectionPanel.tsx` to replace
     its hardcoded demo scenes with `serializePascalScene(pascalStore.roots)`,
     giving the audit buttons real user-scene data.
- 📝 Deferred typed wrappers: `ingest`, `placeHead`, `routePipe`, `calc`,
     `export` — add to `HalopenclawClient` interface as the gateway tools
     get real implementations in M1-M4.

### Entry 09 — Deploy infrastructure

- ✅ `services/halopenclaw-gateway/.env.example` — ANTHROPIC_API_KEY,
     CLAUDE_MODEL/CLAUDE_HAIKU_MODEL overrides, HALOPENCLAW_PORT,
     CUBICASA_MODEL_PATH, HALOPENCLAW_JOB_DIR.
- ✅ `services/halopenclaw-gateway/deploy/halopenclaw.service` —
     systemd unit for uvicorn. Runs as unprivileged `halofire` user,
     `Type=exec`, 2 workers, `Restart=on-failure`, hardened with
     `NoNewPrivileges`, `ProtectSystem=strict`, `PrivateTmp=true`,
     ReadWritePaths limited to the jobs dir.
- ✅ `services/halopenclaw-gateway/deploy/nginx.conf.example` — reverse
     proxy from `/halofire/*` to `127.0.0.1:18790` with SSE-friendly
     buffer settings + `client_max_body_size 100m` for IFC uploads.
- ✅ `services/halopenclaw-gateway/deploy/DEPLOY.md` — step-by-step
     install, CubiCasa weights download, nginx include, smoke-test, update,
     rollback.
- 📝 Deploy target: RankEmpire VPS (already runs HAL stack). CubiCasa5k
     weights are a one-time ~200 MB download from upstream releases.
- 📝 Prod hostname is `gateway.rankempire.io/halofire/*` per the nginx
     example. CORS already whitelists `https://studio.rankempire.io`
     in `services/halopenclaw-gateway/main.py`.

---

## M1 week 1 wrap-up checklist

- [x] Port `validate_shell.py` from ClaudeBot skill → `halofire_validate`
      shell + collisions modes
- [x] Gateway boots + smoke-tested
- [x] Wire `@thatopen/components` IfcLoader in `@halofire/ifc`
- [x] Scaffold `@halofire/catalog` + author 20 components via Blender MCP
- [x] Studio UI: Catalog + Fire Protection sidebar tabs
- [x] `@halofire/halopenclaw-client` typed RPC client + Pascal scene serializer
- [x] systemd service file + nginx config + deploy guide
- [ ] Manual IFC upload end-to-end test (blocked on studio upload UI — M1 week 3)
- [ ] `halofire_place_head` real spawn path (M1 week 3)
- [ ] Linear pipe routing + Hazen-Williams single-branch calc (M1 week 4)
- [ ] Single-sheet PDF output via `draft_plan.py` + jsPDF (M1 week 5)
- [ ] Blender MCP socket-buffer hang: investigate + fix batch authoring
      (documented workaround: split into chunks of ≤15)

## Commit history (M1 week 1)

| Hash | Title |
|---|---|
| `2709edb` | Phase 1 fork + scaffold @halofire/sprinkler |
| `72cbe18` | Comprehensive requirements + revised 8-month roadmap |
| `4b2786a` | Technical plan + M1 infrastructure scaffold |
| `290cfce` | Wire halofire_validate shell + collisions audits |
| `61d73a8` | Catalog package + 20 authored components + IFC wire-up |
| `62ac4cd` | Catalog + Fire Protection sidebar tabs in editor app |
| (next)   | halopenclaw-client + deploy infra |

## Codex-review-at-end checklist

Reviewer: read `HALOFIRE_TECHNICAL_PLAN.md` first for the north star,
then this log top-to-bottom. For each entry, check:

1. **Claim matches code.** Log says "20 components authored" → 20 GLBs
   exist under `packages/halofire-catalog/assets/glb/`.
2. **Type-checks clean.** Each new `@halofire/*` package passes
   `bun run check-types`. Upstream Pascal errors in `packages/editor/`
   are pre-existing, not ours.
3. **Tests actually ran.** Entry 04 documents a concrete smoke-test of
   `halofire_validate shell` with a floating wall — output is quoted
   verbatim.
4. **Binding commitments honored.** §Binding in HALOFIRE_TECHNICAL_PLAN:
   NFPA 13 citations everywhere, no Togal.AI dep, halopenclaw is the
   only backend path, Claude+Codex+Gemini interchangeable, Pascal
   upstream untouched.
5. **Milestone vs stub.** Every stub is labeled with the milestone/week
   it lands (`M1 week 3`, `M2 week 7`, `M3`, etc.) so reviewer knows what
   is "ready for use" vs "placeholder."

Blocking issues reviewer should flag:
- Any `@halofire/*` package that doesn't type-check
- Any tool stub that doesn't register in `services/halopenclaw-gateway/tools/registry.py`
- GLBs missing from the manifest → reviewer checks
  `diff <(ls packages/halofire-catalog/assets/glb/) <(grep -oE "SM_[A-Za-z0-9_]+" packages/halofire-catalog/src/manifest.ts | sort -u)`

Non-blocking (already acknowledged):
- Upstream Pascal TS errors in `packages/editor/`
- 3-vs-0.184 three.js peer-dep warning on install
- Blender MCP batch authoring hang workaround
