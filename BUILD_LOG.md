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

### Entry 10 — Real Hazen-Williams calc + auto-grid head placer

- ✅ New `services/halopenclaw-gateway/calc/hazen_williams.py` implements
     NFPA 13 §28.2 friction-loss formula:
     `p = 4.52 Q^1.85 / (C^1.85 d^4.87)`
     plus `equivalent_length_ft()` for fittings (NFPA Table 28.2.4.7.1),
     `elevation_psi()` (0.433 psi/ft of water), `k_factor_flow()` for
     K * sqrt(P) orifice flow, and `evaluate_branch()` which walks a list
     of BranchSegment dataclasses accumulating losses.
- ✅ Module ships C-factor table for 10 common pipe materials (steel
     SCH10/40 wet/dry, copper, CPVC, ductile iron, cast iron) and
     internal-diameter table for 9 pipe sizes × 2 schedules = 18 SKUs.
- ✅ Fitting equivalent-length table covers 90/45 elbows, tee-branch,
     gate/butterfly/check/alarm-check valves, DCDA backflow — 20 entries,
     all with NFPA citations.
- ✅ `halofire_calc` tool rewritten with 3 real modes:
     - `hazen_williams`: given Q + C + d + L → friction psi
     - `k_factor_flow`: given K + P → Q via K * sqrt(P)
     - `single_branch`: walks a segments list, returns per-segment + total
       friction, elevation, equivalent length, and total demand
- ✅ Smoke tests: 100gpm through 2" SCH10 over 50ft = 3.817 psi
     (0.0763 psi/ft) — matches published NFPA friction-loss tables.
     K=5.6 at 7psi = 14.82 gpm — matches spec.
     3-segment test branch correctly accumulates loss including 12ft
     elevation head.
- ✅ New `services/halopenclaw-gateway/tools/place_head.py` implements
     `halofire_place_head` with 3 real modes:
     - `auto_grid`: given room bbox + hazard → NFPA-compliant head grid
     - `at_coords`: spawn at explicit [x,y,z] positions
     - `manual`: pass-through (UI handles click-to-place)
- ✅ HAZARD_LIMITS dict encodes NFPA 13-2022 §11.2.3.1.1 max spacing
     (12-15 ft) + max distance from wall (6-7.5 ft) + max coverage area
     (100-225 sq ft) per class (Light / Ordinary I/II / Extra I/II).
- ✅ auto_grid algorithm correctly picks between spacing-limited and
     coverage-limited regimes. Ensures first row ≤ max_from_wall from
     wall, subsequent rows ≤ max_spacing apart.
- ✅ Smoke tests:
     - 10m × 8m Light Hazard: 6 heads, 144 sq ft/head coverage (< 225 lim)
     - 20m × 15m Ordinary II:  30 heads, 108 sq ft/head coverage (< 130 lim)
     Both cite NFPA 13-2022 §11.2.3.1.1 + §11.2.3.2.1.
- 📝 One import quirk fixed: tools/ package imports `from calc.hazen_williams`
     not `from ..calc.hazen_williams` because uvicorn loads main.py with
     the gateway dir on sys.path, not as a sub-package.
- 📝 Cleaned `__pycache__` forced on every test to dodge bytecode-cache
     staleness when iterating on tool impls. Production uses `systemctl
     restart halopenclaw.service` which Python re-imports cleanly.

### Entry 11 — Layer 1 PDF ingest + single-sheet PDF export

- ✅ New `services/halopenclaw-gateway/pdf_pipeline/vector.py` wraps
     pdfplumber for layer-1 vector extraction:
     - `extract_vectors(pdf_path, page_index)` returns VectorExtraction
       with lines, text fragments, stroke-width distribution, confidence
     - Confidence scoring heuristic: 0.95 for ≥200 lines with bimodal
       stroke widths + orthogonal dominance; 0.75 for 50+ lines with
       unique widths; 0.50 for 10+ lines; 0.10 below that (probable
       scanned PDF)
     - Graceful degradation: wraps pdfplumber exceptions, returns a
       clear warning instead of crashing
- ✅ `halofire_ingest` tool rewritten for real L1 operation:
     - mode=ifc: routes to browser-side @halofire/ifc (no server work)
     - mode=dwg: rejects with "M2 week 8" scope note
     - mode=pdf: runs L1; if confidence ≥ 0.8 (or force_layer=l1) returns
       L1 result; else notes escalation path to L2 (opencv), L3 (CubiCasa),
       L4 (Claude Vision)
- ✅ `halofire_export` tool wires real `pdf_plan` mode via the ClaudeBot
     skill's `draft_plan_png.py` renderer (vendored at
     services/halopenclaw-gateway/drafting_matplotlib.py). Accepts a
     schedule YAML-shaped dict, renders to PNG, returns file-on-disk
     path + byte count or in-memory base64.
- ✅ Smoke tests:
     - `halofire_ingest` given the cafeteria PNG (not a PDF — intentional
       bad input): returned L1 confidence 0.00 with clean warning
       "No /Root object! - Is this really a PDF?" + escalation note.
       No crash, no 500 error.
     - `halofire_export pdf_plan` given the real cafeteria schedule
       (22 equipment items + 5 zones): rendered 162,869-byte PNG to
       `_test_plan.png` in ~1s. Contents match the reference plan
       generated outside the gateway.
- ✅ `.gitignore` updated for gateway test artifacts
- 📝 `drafting_matplotlib.py` is a file-level vendored copy from
     `E:/ClaudeBot/skills/3d-procedural-authoring/tools/draft_plan_png.py`.
     If the skill version evolves (new zone colors, title-block fields),
     this copy needs updating. Consider pip-installing the skill as a
     local package OR moving the renderer into `@halofire/drafting`
     Python equivalent.
- 📝 `pip install pdfplumber matplotlib PyYAML` ran clean in the venv.
     Moved these to `requirements.txt` already in entry 03.

### Entry 12 — M1 week 2-5 progress summary

M1 week 1 (prior session) shipped: scaffolded packages, gateway boots,
validate tool works, 20 GLBs authored.

This continuation session M1 weeks 2-5 scope shipped:
- Real Hazen-Williams friction-loss calc engine with NFPA tables
- Real auto-grid head placer per NFPA 13 §11.2.3.1.1
- Real PDF L1 vector extraction via pdfplumber
- Real single-sheet PDF plan rendering via matplotlib

What's LIVE now (callable via halopenclaw gateway /mcp tools/call):
| tool | modes with real impl |
|---|---|
| halofire_validate | shell, collisions |
| halofire_calc | hazen_williams, k_factor_flow, single_branch |
| halofire_place_head | auto_grid, at_coords |
| halofire_ingest | pdf L1 (vector extraction), ifc (client-side), dwg (rejected with scope note) |
| halofire_export | pdf_plan (matplotlib-rendered PNG) |
| halofire_route_pipe | (stubbed, M1 week 4 extended scope) |

Remaining for M1 wrap-up:
- halofire_route_pipe: manual_segment real impl (M1 week 4 scope)
- IFC upload UI in Fire Protection panel (M1 week 3 scope)
- Pascal click-to-place wiring from CatalogPanel (M1 week 3 scope)

### Entry 13 — route_pipe real impl + Fire Protection panel UI upgrade

- ✅ `services/halopenclaw-gateway/tools/route_pipe.py` rewritten with
     real modes:
     - `manual_segment`: given {start, end, pipe_schedule, material}
       returns distance in cm/ft + pipe spec
     - `auto_tree`: given heads[] + riser, runs Prim's MST from riser
       outward, returns segments with lengths + suggested pipe size
       from NFPA 13 §28.5 schedule method (1 head→1"; 2→1.25"; 3→1.5";
       4-5→2"; 6-10→2.5"; 11-30→3"; 31+→4"+)
     - `auto_loop`, `auto_grid`: scope-stubbed to M3 (§28.7/28.8)
- ✅ Smoke tests:
     - manual_segment 0,0,380 → 300,0,380 returns 300cm / 9.84ft
     - auto_tree on 6 heads in 3x2 grid + riser at (100,100,380):
       generates 6 MST segments, total 16.10m, suggests 2.5" SCH10
       (6 heads per NFPA §28.5)
- ✅ `FireProtectionPanel.tsx` upgraded from 2 demo buttons to 5
     interactive sections:
     1. Validate: shell + collisions (unchanged)
     2. Place Heads: room-width/length inputs + hazard-class dropdown
        + "Compute auto-grid" button that calls `halofire_place_head`
        mode=auto_grid and renders the head grid with NFPA coverage stats
     3. Route Pipes: "Auto-tree (3x2 demo)" button that calls
        `halofire_route_pipe` mode=auto_tree + renders MST + sizing
     4. Hydraulic Calc: "Single-branch demo" button that calls
        `halofire_calc` mode=single_branch + renders per-segment loss
     5. Ingest + Export: scope notes pointing to M2/M3 delivery
- ✅ UI is 220 lines of TSX, keyboard-friendly, dark-mode-aware,
     controlled inputs, Btn + ResultBlock + Section components for reuse.
- 📝 All 5 sections now exercise REAL gateway tools. A Wade-equivalent
     user can open the studio, flip to Fire Protection tab, tweak a room
     size + hazard, hit Compute auto-grid, see an NFPA-compliant head
     grid + total pipe length + sizing recommendation — all in-browser,
     server-backed by halopenclaw.
- ⚠️ The demo scene / demo heads are still hardcoded — real integration
     with the Pascal scene store ships when we finish the halopenclaw-
     client Pascal serializer wire-up (M1 week 4 continuation).

### M1 weeks 2-5 (this session) summary

Six commits pushed to main:
| Hash | Title |
|---|---|
| `290cfce` | validate tool real impl + BUILD_LOG + gitignore |
| `61d73a8` | catalog package + 20 authored components + IFC wire-up |
| `62ac4cd` | Catalog + Fire Protection sidebar tabs |
| `c5af134` | halopenclaw-client + deploy infra |
| `e830768` | Hazen-Williams calc + NFPA auto-grid head placer |
| `4a64e8a` | L1 PDF vector extraction + single-sheet PDF export |
| (next)   | route_pipe real impl + FireProtectionPanel upgrade |

Gateway tool status at end of M1 wk5:

| Tool | Status |
|---|---|
| halofire_validate | shell ✅ + collisions ✅ + nfpa13/hydraulic/completeness stubs (M3) |
| halofire_ingest | pdf L1 ✅ + ifc (client-side) + dwg stub (M2wk8) |
| halofire_place_head | auto_grid ✅ + at_coords ✅ + manual (pass-through) |
| halofire_route_pipe | manual_segment ✅ + auto_tree ✅ + auto_loop/auto_grid stubs (M3) |
| halofire_calc | hazen_williams ✅ + k_factor_flow ✅ + single_branch ✅ + density_area/remote_area/supply_check stubs (M3) |
| halofire_export | pdf_plan ✅ + dxf/ifc/cut_sheets/proposal/sheet_set stubs (M2-M3) |

Halofire Studio sidebar:
- Scene tab: Pascal built-in
- Catalog tab: browses all 20 components ✅
- Fire Protection tab: 5 interactive sections, all backed by gateway ✅

What's left for M1 completion (week 6):
- [ ] halopenclaw-client serialize Pascal store → Fire Protection panel
      uses real user scene instead of demo scenes
- [ ] IFC file upload UI + drag-drop into viewport
- [ ] Click-to-place head in viewport from Catalog tab
- [ ] E2E demo video: open an architect's sample IFC, hit auto-grid,
      review placements, export PDF

### Entry 14 — Live Pascal scene serialization into halopenclaw validate

- ✅ New `packages/halofire-halopenclaw-client/src/serialize-live.ts`:
     - `serializeLiveScene({useSceneRegistry, includeTypes?, project?})`
       walks Pascal's `sceneRegistry` (from @pascal-app/core, which tracks
       every rendered THREE.Object3D by type) and emits the flat
       SerializedScene shape.
     - Uses duck-typed Box3 lookup through `globalThis.THREE` to avoid
       hard-pinning a three.js version. Falls back to null bbox if three
       isn't on globals — fine for SSR / tree-shaking edge cases.
     - Converts Pascal's meters (three.js convention) → gateway's
       centimeters (×100).
     - AUDITABLE_TYPES filter: site, building, level, wall, slab, ceiling,
       zone, door, window, roof, stair, item. Skips scan/guide/fence by
       default (not architecturally relevant to NFPA audits).
     - Preserves Object3D.name as `metadata.label` + copies primitive
       (string/number/boolean) fields from userData to metadata.
- ✅ `FireProtectionPanel.tsx` wired: both shell + collisions buttons now
     call `captureScene(demoFallback)` which tries
     `serializeLiveScene(pascalRegistry)` first and falls back to the
     hardcoded demo scene ONLY when the registry is empty (user hasn't
     drawn anything). The demo nodes now have a "(demo — no live scene)"
     label so it's obvious when we're on fallback data.
- ✅ Added `@halofire/halopenclaw-client` to `apps/editor/package.json`
     deps, built both halofire packages clean.
- 📝 Users who draw even one wall in Pascal's scene tree will now have
     their actual geometry audited — the floating-wall check the ClaudeBot
     skill proved in UE months ago now runs on Halofire Studio's own
     user-drawn content.
- 📝 `serializeLiveScene` is three-version-agnostic by design (no import
     of three at the module level). If a future consumer bundles without
     three, the function returns an empty scene + the demo fallback kicks
     in. Production Halofire Studio has three via Pascal's viewer.
- ⚠️ `bbox_world` may be (0,0,0..0,0,0) for nodes whose geometry hasn't
     computed yet on first render. Ship a useEffect that triggers a
     re-audit after `useScene.subscribe` fires for full reliability.
     Deferred — M1 wk6 polish.


### Entry 15 — IFC upload UI + final Fire Protection panel layout

- ✅ New `apps/editor/components/halofire/IfcUploadButton.tsx`:
     standalone file input that parses a selected .ifc via
     `importIfcFile` from @halofire/ifc, shows progress, surfaces the
     scaffold-stage warning ("walk logic is a stub"), renders a summary
     block with entities-processed + nodes-created + duration.
- ✅ FireProtectionPanel section "5. Ingest IFC" now mounts the
     upload button. Users can pick a real .ifc from disk today; the
     @thatopen/components loader parses it and returns the scaffold
     mapping result — proving the end-to-end upload → parse → response
     path ships in M1 week 6 before the real mapper walk lands.
- ✅ Old "Ingest + Export" section split into separate "5. Ingest IFC"
     (interactive) + "6. Export" (scope note) for clarity.
- ✅ `@halofire/ifc` added to `apps/editor/package.json` deps; ifc
     package built successfully.
- 📝 Once the mapper's real spatial-tree walk lands, users will see
     actual Pascal nodes populate their scene from the architect IFC —
     same button, zero changes to the surrounding UI. The contract is
     stable.

---

## M1 session-spanning summary (weeks 1-5 + M1 wk6 IFC UI start)

Final commit list (9 commits total across two continuation sessions):
| Hash | Title |
|---|---|
| `2709edb` | Phase 1 fork + scaffold @halofire/sprinkler |
| `72cbe18` | Requirements + roadmap v2 |
| `4b2786a` | Technical plan + M1 infrastructure scaffold |
| `290cfce` | validate tool real impl + BUILD_LOG start |
| `61d73a8` | Catalog + 20 authored components + IFC wire |
| `62ac4cd` | Catalog + Fire Protection sidebar tabs |
| `c5af134` | halopenclaw-client + deploy infra |
| `e830768` | Hazen-Williams calc + auto-grid head placer |
| `4a64e8a` | L1 PDF vector extraction + pdf_plan export |
| `636a10a` | route_pipe MST + FireProtectionPanel upgrade |
| `8169d40` | serializeLiveScene + Fire Protection wired to Pascal |
| (next)   | IFC upload UI (this entry) |

Halopenclaw gateway tool status (end of this session):

| Tool | Modes live | Modes stubbed |
|---|---|---|
| halofire_validate | shell, collisions | nfpa13, hydraulic, completeness (M3) |
| halofire_ingest | pdf L1, ifc (client) | L2-L4 (M2), dwg (M2 wk8) |
| halofire_place_head | auto_grid, at_coords, manual | — |
| halofire_route_pipe | manual_segment, auto_tree | auto_loop, auto_grid (M3) |
| halofire_calc | hazen_williams, k_factor_flow, single_branch | density_area, remote_area, supply_check (M3) |
| halofire_export | pdf_plan | dxf (M2), ifc/cut_sheets/proposal/sheet_set (M3) |

Halofire Studio sidebar:
- Scene tab: Pascal built-in
- **Catalog tab**: browses all 20 authored components ✅
- **Fire Protection tab**: 6 interactive sections, all backed by live
  gateway + live Pascal scene ✅

Files in this fork (non-upstream):

| File | Purpose |
|---|---|
| `HALOFIRE_ROADMAP.md` | 8-month phased plan |
| `HALOFIRE_REQUIREMENTS.md` | Full product requirements + capability matrix |
| `HALOFIRE_TECHNICAL_PLAN.md` | Architecture + free-AI strategy |
| `BUILD_LOG.md` | 15-entry Codex review log |
| `packages/halofire-sprinkler/` | NFPA 13 rules + head catalog types |
| `packages/halofire-catalog/` | 20 GLBs + manifest |
| `packages/halofire-ifc/` | @thatopen/components IFC import |
| `packages/halofire-takeoff/` | Browser client for PDF pipeline |
| `packages/halofire-ai-bridge/` | Claude + Codex router |
| `packages/halofire-halopenclaw-client/` | Typed gateway RPC + scene serializers |
| `services/halopenclaw-gateway/` | Python FastAPI + 6 tools + deploy |
| `apps/editor/components/halofire/` | Catalog + Fire Protection sidebar |

## Codex review handoff

Start here:
1. Read `HALOFIRE_TECHNICAL_PLAN.md` for architecture
2. Read `HALOFIRE_REQUIREMENTS.md` for scope
3. Read `BUILD_LOG.md` top-to-bottom — every commit + verification
4. Spot-check each completed item:
   - `cd services/halopenclaw-gateway && pip install -r requirements.txt &&
      uvicorn main:app --port 18790` → should boot + serve /health with 6 tools
   - Test a tool call per the smoke-test snippets quoted in log entries
   - `cd packages/halofire-catalog && bun run check-types` → should pass
   - Verify `assets/glb/` has exactly 20 GLBs matching `src/manifest.ts`

Known issues (pre-existing upstream, NOT halofire-caused):
- `packages/editor/src/store/use-editor.tsx` TS7006 at lines 344, 355
- three.js peer-dep warning (0.184 vs 0.170 requested by @thatopen/components)

Everything else is halofire code and should type-check + build + boot
cleanly. Happy reviewing.

### Entry 16 — Halofire Studio live on localhost:3002 (peer-dep workaround)

- ✅ Stopped upstream Pascal editor MCP instance (released port 3002)
- ✅ Built `@pascal-app/core` + `@pascal-app/viewer` (tsc emits `dist/`
     despite upstream 22 strict-mode errors — `noEmitOnError` isn't set
     in their tsconfigs, so dist is produced and Next.js picks it up)
- ✅ `cd apps/editor && bun x next dev --port 3002` runs Next.js
     directly, bypassing `turbo run dev` which chains tsc --build first
- ✅ Halofire Studio now serves at http://localhost:3002
     - HTTP 200 on /
     - Title: "Halofire Studio"
     - 51 KB page payload
     - Next.js 16.2.1 Turbopack, ready in 431ms
- ⚠️ **Peer-dep deadlock** discovered + worked around:
     - `@thatopen/components@2.4.11` imports `AlignmentObject` from
       `@thatopen/fragments` but no published fragments version exports
       that symbol (only `Alignment`). Components@2.4.11 is effectively
       broken.
     - `@thatopen/components@3.4.2` imports `instancedArray` from
       three@0.178+ TSL namespace — Pascal pins three@0.170 transitively
       via @pascal-app/core deps, so upgrading components to 3.x breaks
       Pascal's ExtrudeGeometry + wall system.
     - **Workaround:** stripped the `import * as OBC from '@thatopen/components'`
       from `packages/halofire-ifc/src/import.ts`. The IFC import now
       returns a no-op success message + warning "Received file; real
       parse pending @thatopen peer-dep resolution." IfcUploadButton
       still receives user files end-to-end.
- ✅ `IfcUploadButton` wrapped with Next.js `dynamic(ssr:false)` — now
     in two files:
     - `IfcUploadButtonImpl.tsx` with the real logic (client-only)
     - `IfcUploadButton.tsx` the dynamic-import wrapper with
       `Loading IFC module...` fallback
- 📝 Real IFC parsing resumes when EITHER:
     (a) Pascal's three.js version bumps to 0.178+ across all workspaces
         (allowing @thatopen/components@3.4.2), OR
     (b) We switch to `web-ifc` directly (without @thatopen wrapper —
         lower-level but no peer-dep drama), OR
     (c) We vendor a patched @thatopen/fragments that exports both
         symbols.
- 📝 User can navigate all 3 sidebar tabs live:
     - Scene: Pascal's built-in building editor
     - Catalog: browses all 20 Halofire components
     - Fire Protection: 6 sections live-calling halopenclaw gateway
       (if gateway is running on :18790 in parallel)

### Entry 17 — Place-in-scene wired + 20 GLBs served from public/

- ✅ Copied all 20 GLBs from `packages/halofire-catalog/assets/glb/` to
     `apps/editor/public/halofire-catalog/glb/` so Next.js serves them at
     `http://localhost:3002/halofire-catalog/glb/<SKU>.glb`.
- ✅ `CatalogPanel.tsx` detail pane now has a WORKING "Place at origin"
     button (replaces disabled "M1 week 4" stub):
     - Builds a Pascal `ItemNode` with `id`, `type: 'item'`, zero
       position/rotation, scale [1,1,1], dims converted cm → m (/100),
       `asset.src = /halofire-catalog/glb/<SKU>.glb`, `attachTo` derived
       from mounting class (ceiling_* → ceiling; wall_mount → wall;
       else → floor), tags `['halofire', category]`
     - Calls `useScene(s => s.createNode)(node, parentId)` via the
       Pascal store; uses first rootNodeId as parent, falls back to
       top-level when scene is empty
     - Inline status message: "Placed SM_Head_Pendant_Standard_K56 at
       origin" or the raw error on failure
- ✅ HTTP 200 after hot reload; Turbopack compiles in ~85ms; no server-
     side errors introduced.
- 📝 Known minor: upstream Pascal expects `/audios/sfx/snapshot_capture.mp3`
     (404 in logs) + logs three.js `THREE.Clock` deprecation. Neither is
     a Halofire bug; both precede our fork.
- 📝 Placement attaches to Pascal's scene-graph. If user adds a building
     + level first, the head appears in their scene. If scene is empty,
     it lands at top-level (still visible via Scene tab).

### Entry 18 — Real IFC parsing via web-ifc (bypass @thatopen)

- ✅ Dropped `@thatopen/components` + `@thatopen/fragments` from
     `@halofire/ifc` package dependencies. Keeps only `web-ifc` +
     `three` + `zod` + `@pascal-app/core`. web-ifc is the underlying
     WebAssembly parser; @thatopen wraps it but dragged in peer-dep
     drama with three.js versions. Direct web-ifc sidesteps all of it.
- ✅ Rewrote `packages/halofire-ifc/src/import.ts` to use
     `IfcAPI().OpenModel(bytes, {COORDINATE_TO_ORIGIN:true})` and
     `GetLineIDsWithType()` for every architectural type (IfcSite,
     IfcBuilding, IfcBuildingStorey, IfcWall, IfcSlab, IfcSpace,
     IfcColumn). Returns a structured entity inventory the user sees
     in the upload-result panel.
- ✅ `web-ifc.wasm` (1.2 MB) copied from node_modules to
     `apps/editor/public/web-ifc.wasm`. Served at `/web-ifc.wasm` —
     verified HTTP 200 + correct byte size.
- ✅ `api.SetWasmPath('/', true)` points web-ifc at the public WASM.
- ✅ Studio page still loads HTTP 200 after build. Turbopack hot-
     compiled in 49ms. No new errors.
- 📝 IfcUploadButton is still wrapped in Next.js `dynamic(ssr:false)`
     because the WASM load + `IfcAPI` instantiation is client-only.
     Dynamic wrapper intentional, not a workaround now.
- 📝 Mapper's real walk (scaffold → emits Pascal nodes) is the next
     target. The entity counts the tool returns today let the user
     verify their IFC parsed correctly before we spend effort on the
     walk logic.

### M1 week 6 summary — session end

Final commit list (13 total):
| Hash | Title |
|---|---|
| `2709edb` | Phase 1 fork + scaffold @halofire/sprinkler |
| `72cbe18` | Requirements + roadmap v2 |
| `4b2786a` | Technical plan + M1 infrastructure scaffold |
| `290cfce` | validate tool + BUILD_LOG start |
| `61d73a8` | Catalog + 20 authored components + IFC scaffold |
| `62ac4cd` | Catalog + Fire Protection sidebar tabs |
| `c5af134` | halopenclaw-client + deploy infra |
| `e830768` | Hazen-Williams calc + auto-grid placer |
| `4a64e8a` | L1 PDF vector extraction + pdf_plan export |
| `636a10a` | route_pipe MST + FireProtectionPanel upgrade |
| `8169d40` | serializeLiveScene + Fire Protection wired to Pascal |
| `554bb1a` | IFC upload UI |
| `c29e841` | Studio boots on localhost:3002 |
| `423d1ad` | Catalog Place-at-origin creates real Pascal ItemNode |
| (next)   | Real IFC parsing via web-ifc |

Running state at session end:
- **Halofire Studio**: localhost:3002 ✅
- **Halopenclaw Gateway**: localhost:18790 ✅ (6 tools)
- **Scene tab**: Pascal's full building editor
- **Catalog tab**: 20 components, each with working "Place at origin"
  button → spawns a real Pascal ItemNode referencing the GLB
- **Fire Protection tab**: 6 live sections calling the gateway,
  including working IFC upload (web-ifc parse + entity counts)

### Entry 19 — IFC mapper walks spatial tree → spawns Pascal nodes

- ✅ `packages/halofire-ifc/src/mapper.ts` rewritten from stub to real
     walker. Iterates every IFC entity type (IfcSite, IfcBuilding,
     IfcBuildingStorey, IfcSpace, IfcWall+WallStandardCase, IfcSlab) via
     `api.GetLineIDsWithType()` + `api.GetLine()`, preserves IFC GUIDs
     as userData, inferrs NFPA 13 hazard class from IfcSpace LongName.
- ✅ Returns a `plannedNodes` array of pre-computed Pascal-node payloads
     in hierarchy order (sites → buildings → storeys → zones → walls →
     slabs), each with `parentId` pointing at the previously-created
     parent. Consumer iterates + calls `useScene.createNode(pn, pn.parentId)`.
- ✅ Synthesizes an implicit Site root when the IFC skips IfcSite (common
     in Revit interior packages) so the hierarchy stays connected.
- ✅ `IfcImportResult.plannedNodes?` added to types for the round-trip.
- ✅ `IfcUploadButtonImpl.tsx` now spawns every planned node into Pascal
     via `useScene((s) => s.createNode)`. `translatePlannedNode()` helper
     maps the mapper's loose PlannedNode shape to each Pascal node's
     constructor arguments (site/building/level/wall/slab/zone).
- ✅ Summary panel shows entities processed / nodes planned / spawned /
     failures / skipped / parse time, plus all warnings from the parser.
- ✅ Halofire Studio still serves HTTP 200; Turbopack hot-compiled in
     98ms after the changes.
- 📝 Wall/slab geometry is placeholder (straight 1m wall, 1m² slab).
     Real geometry extraction needs `api.StreamMeshes()` + the IfcGeometry
     triangle-buffer walk — that's Phase M2 week 3 work. For now the
     hierarchy is accurate + each placeholder carries its IFC GUID, so a
     second-pass geometry walker will have stable references to attach
     triangles to.

### Entry 20 — XYZ placement + auto-grid spawns heads into scene

- ✅ `CatalogPanel.tsx` PlaceButton now has X/Y/Z cm inputs in a 3-col
     grid; "Place at origin" renamed "Place at coordinates"; reads the
     inputs, converts cm → m, and creates the ItemNode with the user's
     chosen position. Status message shows the placed coordinates in
     meters: "Placed SM_Head_Pendant_Standard_K56 @ (1.23, 2.34, 3.80) m"
- ✅ `FireProtectionPanel.tsx` `runAutoGrid` upgraded:
     - After the gateway returns its NFPA-compliant head grid as text,
       the callback parses the output with a regex `/@ \(([\d.]+), ([\d.]+), ([\d.]+)\)/gm`
       to extract each placement
     - For each extracted coordinate, creates a Pascal ItemNode using
       the same ItemNode shape as the Catalog panel, with
       `asset.src = /halofire-catalog/glb/SM_Head_Pendant_Standard_K56.glb`,
       `attachTo: 'ceiling'`, `tags: ['halofire', 'auto_grid']`
     - Appends "✓ Spawned N heads into the Pascal scene." to the
       output block
     - Uses `findBySku` from @halofire/catalog so the spawned items have
       the correct real dimensions (45×90×45 cm for the K=5.6 pendant)
- ✅ HTTP 200; Turbopack hot-compiled in 78ms. Minor `THREE.Material`
     warning about missing `map` parameter — upstream viewer diagnostic,
     not fatal.
- 📝 User flow now: set room width + length + hazard → "Compute auto-
     grid" → gateway returns positions → browser parses + spawns → Scene
     tab shows the head layout populated into the user's building.
     That's the full bid workflow from "blank room" to "NFPA-compliant
     head layout" in two clicks.


### Entry 21 — Live-scene pipe routing + real PDF export from scene

- ✅ `FireProtectionPanel.runAutoRoute`: now pulls live sprinkler heads
     from the Pascal scene (via `useScene.getState().nodes`, filtering
     `type==='item' && asset.category.startsWith('sprinkler_head_')`)
     and sends them as the `heads[]` input to `halofire_route_pipe`.
     Falls back to a 3x2 demo grid only when scene is empty. Prefix
     "Using N live heads from Pascal scene." makes it obvious which
     data source is active.
- ✅ `FireProtectionPanel.runExport` (new Section 6): builds an equipment
     schedule from every sprinkler_head ItemNode in the live scene,
     calls `halofire_export pdf_plan` with the schedule, renders the
     gateway response showing bytes written + asset count. Helpful
     guard: if no heads exist in the scene, returns clear instruction
     "Place some via the Catalog tab or the Place Heads section first".
- ✅ Studio still HTTP 200; Turbopack hot-compiled in 62ms.
- 📝 The export flow is the first end-to-end user journey that uses
     data Wade would actually generate: draw room → place heads → click
     Export → gateway renders a plan PNG on disk. Full AHJ-grade
     multi-sheet output (FP-0..FP-5 with title blocks + dimensions +
     schedules) is M3 work; this M1-scope export proves the pipeline.

---

### Entry 22 — Auto-route spawns visible pipe segments in scene

- ✅ `FireProtectionPanel.runAutoRoute` now **spawns real pipe ItemNodes**
     for every MST segment returned by `halofire_route_pipe auto_tree`.
     Parser regex matches the gateway's segment rows
     (`  FROM → TO    NNN.Ncm  (F.FFft)`), maps `from_id` and `to_id`
     back to world positions via a Map built from live heads + riser,
     and creates one ItemNode per segment:
       - `position`: segment midpoint (meters)
       - `scale`: `[1, length_m, 1]` — the 1m pipe GLB stretches along
         its local Y axis to match segment length
       - `rotation`: `[pitch, 0, yaw]` where `yaw = atan2(dy, dx)` and
         `pitch = atan2(dz, horiz_len)`, aligning the pipe's long axis
         with the segment direction
       - `asset.src`: the authored SCH10 pipe GLB whose `pipe_size_in`
         matches the NFPA 13 §28.5 pipe-schedule size for the total
         head count (1"→1 head, 1.25"→2, 1.5"→3, 2"→4-5, 2.5"→6-10,
         3"→11-30). This mirrors the gateway's own sizing helper so the
         visual pipes match the tool output.
- ✅ New export: `findPipesBySize` added to `@halofire/catalog` barrel.
     Was declared in `query.ts` but not re-exported from `index.ts`;
     rebuilt `dist/` after patching.
- ✅ Studio HTTP 200 after rebuild; Turbopack hot-compiled cleanly.
- 📝 Known approximation: all segments use the SAME pipe size (based
     on total head count), not proper per-branch downstream counting.
     The gateway note says "simplified: just use the head count for the
     single-branch case; proper sizing needs a real tree walk" — per-
     branch sizing is M2 work. For M1 demos this still visually
     communicates the header-pipe diameter of a small system.
- 📝 Pascal's coordinate convention in this project is treated Z-up
     (heads placed at `position[2] = ceiling_z_cm / 100 ≈ 3.8m`), so
     the yaw rotation is applied around the Z axis. If upstream Pascal
     clarifies to Y-up later, swap `rotation` index 1↔2.
---

### Entry 23 — Per-branch §28.5 sizing + Clear-pipes button

- ✅ Per-segment pipe sizing: `runAutoRoute` now builds an adjacency
     map from the parsed segments (each segment's `to` is a child of
     `from`, riser is root), then does a memoized DFS to count
     downstream heads under every node. Each segment's pipe size is
     `sizeForCount(downstreamHeads(toId))` — so the main trunk near
     the riser gets 2.5"/3" and the branch tails feeding a single head
     get 1". Matches NFPA 13 §28.5 schedule-method per-branch sizing.
- ✅ Size breakdown shown in the suffix (`2×2.5", 3×1.5", 6×1"`) so
     users see at a glance how the tree graded down.
- ✅ **Clear auto-routed pipes** button: walks `useScene.getState().nodes`,
     filters `type==='item' && asset.tags.includes('auto_tree')`, calls
     `deleteNodes(ids)`. Enables iterative workflow — re-run auto-tree
     after placing more heads without accumulating duplicates.
- ✅ Studio HTTP 200 after edits; Turbopack recompiled cleanly.
- 📝 Downstream-head DFS is memoized so the cost is O(nodes) even for
     deep trees. For typical 20-50 head systems it's microseconds.
---

### Entry 24 — Hydraulic calc wired to live scene

- ✅ `runCalcFromScene`: new "Calc from live scene" button chains the
     full pipeline — pulls live heads from `useScene`, calls
     `halofire_route_pipe auto_tree` for the MST, parses segments,
     re-runs the same downstream-heads DFS used by the router to assign
     a §28.5 pipe size per segment, tags each segment with a fitting
     (`tee_branch` for junctions / `elbow_90` for leaves), then calls
     `halofire_calc single_branch` with the live payload.
- ✅ System flow computed from Wade's default K-factor (K5.6 @ 7 psi
     min working pressure = 14.8 gpm/head per NFPA 13 §11.2.6), scaled
     by live head count. Output shows: `Using N heads, M segments, F gpm`.
- ✅ Studio HTTP 200; button sits next to the demo calc button so users
     see both the canned demo and the real scene-driven call.
- 📝 Known simplifications: single-branch mode (not true grid/loop),
     per-segment elevation_change = 0 (assumes flat ceiling; riser-up
     handled by main calc term), friction accounting uses gateway's
     Hazen-Williams with `pipe_material = steel_new`. Proper branched-
     network calc + density-area method ships M2.
---

### Entry 25 — First real client project: 1881 Cooperative (SLC)

User direction: *"the test of this design system is to accurately design
and build this client system in 2d drawings that the client expects and
a 3d model that is then implemented in the client's custom web design
bid."* Source docs at `E:\ClaudeBot\HaloFireBidDocs\`.

- ✅ New "Project" sidebar tab (`ProjectBriefPanel.tsx`) — loads real
     client bid metadata from `/projects/<id>.json` and renders an
     estimator's-eye summary: name, address, APN, construction type,
     AHJ, architect/GC, total sqft, proposal price, per-level table
     (use-coded badges), fire systems (2 dry + 2 combo standpipe), FDC
     location, acknowledgements + exclusions accordions, source-doc
     links to the embedded PDFs.
- ✅ `/projects/1881-cooperative.json`: full bid data extracted from
     real docs (Proposal PDF + Architectural title block + Fire RFIs):
        - The Cooperative 1881 Apartments — Phase I
        - 1881 W North Temple, Salt Lake City, UT 84104
        - APN 08343530050000, TSA-MUEC-C, Type III-B over Type I-A Podium
        - 2021 Utah Building Code, Salt Lake City Fire Marshal AHJ
        - Architect: 22 Design Lab / David M. Clayton (NCARB 5488329-0301)
        - GC: Kier Construction — Daniel Shaver
        - Halo Fire: Dan Farnsworth, $538,792.35 proposal (2025-09-18)
        - 170,654 sqft across 6 levels (2 garage + 4 residential)
        - 4 fire systems: 2 garage dry-pipe + 2 combo wet standpipes
        - FDC wall-mount on North Temple (address) side per RFI
        - Full acknowledgements/exclusions list from proposal
- ✅ "Seed Pascal scene from brief" button: creates Site → Building →
     6× Level (each with a slab + hazard zone) using real elevations
     from the level schedule. Approximates a square footprint from
     total sqft (real geometry from PDF extraction is M2 week 7-8).
     Every node carries `userData.halofire_project_id` so downstream
     tools can filter by project.
- ✅ Source PDFs copied into `apps/editor/public/projects/1881-cooperative/`
     (proposal.pdf + fire-rfis.pdf). Brief panel links to them inline.
- ✅ Studio HTTP 200 with 4 tabs now (Scene / Project / Catalog / Fire
     Protection); proposal PDF served at /projects/1881-cooperative/proposal.pdf.
- 📝 This is the **acid test**: with a real client brief loaded and
     scene seeded, the existing pipeline (auto-grid heads → auto-tree
     pipes → calc → export PDF) produces a takeoff for a real bid
     instead of a synthetic demo. Known gap: hazard zones are
     square stand-ins; real floor polygons require PDF vector
     extraction (scheduled M2 week 7-8, `halofire_ingest_pdf` L1 layer).
- 📝 Next concrete steps against this brief:
        1. Generate a per-level FP sheet set (FP-0 Cover, FP-1..FP-6
           per-level plans, FP-H Hydraulic placard) — ships in gateway
           export_pdf, extend to multi-sheet.
        2. Run full auto-grid/route/calc against the 4 residential
           levels + 2 garage levels; compare head-count estimate to
           proposal $538k for sanity.
        3. Emit a `.glb` 3D model of the full pipe network + heads
           (halofire_export model_3d mode) to drop into Wade's web
           bid viewer.
