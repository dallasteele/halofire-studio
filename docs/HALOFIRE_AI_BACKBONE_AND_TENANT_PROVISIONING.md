# HaloFire — AI Backbone Wiring & Tenant Provisioning (Readiness + Anti-Stub Register)

**Date:** 2026-06-13 · **Status:** Canonical companion to `HALOFIRE_SYSTEM_DESIGN_SPEC.md`
**Question answered:** "Do we have everything to build the fully functional system? Is OpenClaw properly connected? Can the software set up OpenClaw + a brain + a local LLM + loops on a *customer's own* GX10 — modular and out-of-the-box? And review the spec so we aren't stubbing anything."
**Method:** grounded file:line audit of the AI-backbone wiring + the deployment/provisioning tooling (GX10 was reachable during the audit).

---

## 1. The honest answer (TL;DR)

| Question | Answer |
|---|---|
| Do we have everything for the fully functional system? | **No.** The AI backbone is mostly *not wired*; the client-provisioning runtime is an unadopted prototype. The CAD engine is real-but-shallow (separate track). |
| Is OpenClaw properly connected? | **Plumbing is real, env-driven, and fail-soft — but it defaults to a localhost shim, and the one live AI-3D path is DOWN.** So OpenClaw delivers no real AI to the app today. |
| Can it set up a customer's own GX10 OOTB (OpenClaw + brain + LLM + loops, modular)? | **Architecture is the right shape; not finished.** A clean module runtime exists (`openclaw-halofire/`) but has 1 commit, points at the wrong app, has no Brain, an inconsistent model policy, and no tenant layer or runbook. |
| Are we stubbing things? | **Yes — but honestly.** SAM "vision" is a deterministic geometry shim, the local LLM is never called, the brain is never called, the autobid classifier is pure heuristic. All are *labeled and claim-gated* — nothing is passed off as real. They must become real for "fully functional." |

**The one reassuring finding:** the codebase has strong honesty discipline — every AI artifact carries `blocked_claims` / `claim_gate_effect:'no_claims_cleared'` / `use_for_claims:false` and explicit `limitations`. We are not lying to ourselves about what's real. The job is to convert honest stubs into real services.

---

## 2. Current AI-backbone wiring (grounded)

| Component | Wired? | Reality | Evidence |
|---|---|---|---|
| **OpenClaw (CAD)** | ✅ env-driven, fail-soft | POSTs `{base}/codex-bridge/invoke`; returns `{skipped:true}` if unconfigured (never fabricates). **Default base = `127.0.0.1:15000` (a local shim), not a real OpenClaw.** | `src/cad/openclaw-invoker.js:22-66`, `openclaw-cad.js:127-143`, `.env.example:8` |
| **OpenClaw (SAM31 perception)** | ✅ real HTTP proxy if env set | 503s if no endpoint; **sends no auth header** | `server.js:16182-16213`, `7193-7211` |
| **Brain (:8790 recall/remember)** | 🔴 **not used at runtime** | zero HTTP calls in `apps/`; only in Codex *session* docs | (no runtime refs) |
| **Local LLM (ollama/qwen)** | 🔴 **never called** | `config/default.json` `ai` block is dead config (and wrong model `qwen2.5:7b`) | `config/default.json:18-24` (never imported) |
| **Autobid classifier** | 🟡 heuristic only | additive regex weights, threshold 0.5; qwen judgment "intentionally out of this slice" | `src/autobid/bid-classifier.js:1-97` |
| **SAM3.1 floorplan vision** | 🔴 **deterministic shim** | fixed `rectPolygon` boxes, 1-triangle STL; `mode:'temporary_best_effort_shim'`, `confidence:0.35`, claim-gated off | `src/sam31/bridge.js:206-280` |
| **Studio image→3D** | 🔴 **wired but DOWN** | OpenClaw `generate_3d_model` errors server-side (`[Errno 21] Is a directory`); gateway :19002 unreachable; `aiPlaceholderCount MUST be 0` | `apps/studio/src/lib/ai-3d-invoker.ts:21-26` |

**Tenant-readiness of the config:** the architecture is env-driven (good — pointing at a different customer's GX10 needs *no code change*, just env), **but** the shipped defaults hardcode `127.0.0.1`, there is no per-tenant config layer, and the SAM31 proxy has no auth. Hardcoded blockers: `.env.example:8,13-16`, `server.js:15897` (port 15000 literal), `config/default.json:18-24`. GX10 IPs appear only as comments — no GX10 lock-in in code.

---

## 3. The Anti-Stub Register (what must become real for "fully functional")

The user's mandate: *don't stub out the system.* These are the honest stubs, ranked by impact, with what "real" means. **None of these is the AutoSPRINK CAD engine** (that's the separate "must be real, never faked" core in the system-design spec) — this is the AI-orchestration backbone around it.

| # | Honest stub today | What "real" requires | Effort |
|---|---|---|---|
| 1 | **SAM3.1 floorplan = fixed-rectangle shim** | A real vision model on the tenant box (GX10 qwen2.5vl / gemma-vision / SAM) behind the existing `/vision/sam31/extrapolate` proxy. The image-to-cad skill already exists — wire it in. | L |
| 2 | **Image→3D backend DOWN** | Fix OpenClaw `generate_3d_model` ([Errno 21]), bring :19002 up, or route to the tenant OpenClaw. Until then `aiPlaceholderCount=0` (honest). | M |
| 3 | **Brain never called at runtime** | Wire `recall`/`remember` for the telemetry→brain loop (spec §9) — opt-in module on the tenant box. | M |
| 4 | **Local LLM never called** | Wire qwen for: the autobid classifier judgment layer (AB2.1), extraction assist, and the in-app assistant. Remove the dead `config/default.json` ai block. | M |
| 5 | **Autobid classifier heuristic-only** | Add the qwen judgment pass on top of the heuristic pre-filter (cheap, local). | S |
| 6 | **`openclaw-halofire` runtime unadopted** | Finish it + retarget its modules from `apps/editor` → `apps/autosprink`; make it the supervisor the deployed app actually runs under. | L |

Honesty rule going forward: a stub may ship **only** if it is claim-gated + labeled (as today). It may **not** be presented as the real capability. Each register item converts to real before the feature is called "done."

---

## 4. Tenant-OpenClaw provisioning architecture (the design)

**Vision (yours):** every customer gets their *own* box (GX10-class) running their *own* OpenClaw + brain + local LLM + loops; HaloFire provisions it; modular; functional OOTB; and the app integrates the customer's OpenClaw "when ready."

**The good news — the integration boundary already exists.** The app reaches OpenClaw/perception purely through env-configured HTTP endpoints with fail-soft fallback. So *"integrate the customer's OpenClaw when ready"* = point `OPENCLAW_BRIDGE_URL` / `HAL_API_URL` (+ token) at the customer's box. No code change. **This is the single most important thing the audit confirmed: the architecture is tenant-ready by design.** The gaps are packaging, not architecture.

```
   ┌─────────────────────── CUSTOMER'S OWN BOX (GX10-class) ───────────────────────┐
   │  openclaw-halofire RUNTIME (Python supervisor + module.toml ABI)               │
   │   ├─ module: openclaw bridge   → /codex-bridge/invoke, /vision/sam31/...        │
   │   ├─ module: ollama + LLM       (tenant model: qwen3:30b-a3b default)           │
   │   ├─ module: brain (OPT-IN)     :8790 recall/remember (lightweight option)      │
   │   ├─ module: loops/cron         Tier0 auto-fix → Tier1 local-LLM → Tier2 escalate│
   │   └─ module: halofire app       apps/autosprink server :3301                    │
   │  tenant.toml: company, branding, db, admin secrets, MODEL, pricebooks, vendors  │
   └───────────────────────────────────────▲───────────────────────────────────────┘
                                            │ env: OPENCLAW_BRIDGE_URL + token (per tenant)
                                  the HaloFire app points here
```

**Provisioning flow (OOTB target):**
`bare box → bootstrap (OS deps: Python/Node/Bun/Ollama) → install.{sh,ps1} (ollama pull MODEL, pip, seed DuckDB, write systemd/scheduled-task) → drop tenant.toml → openclaw reload → health-gate → live`.

**Modularity:** the `module.toml` ABI is the right primitive — drop a `module.toml`, `openclaw reload`, no runtime code change. The brain, the LLM, each HaloFire surface, the pricing cron = modules. The unused `install/local.toml` override hook is the seed of the tenant config layer.

---

## 5. The build list (to make the above real)

1. **Adopt + finish `openclaw-halofire`** — retarget modules at `apps/autosprink` (not `apps/editor`); make it the supervisor the live app runs under; verify end-to-end.
2. **Unify the local-model policy → per-tenant config.** Today it's three answers (gemma3:4b hard-locked in the package via `require_gemma`, qwen2.5:7b dead config in the app, qwen3:30b-a3b org rule). Make MODEL a `tenant.toml` value; default `qwen3:30b-a3b` on GX10-class hardware, allow a smaller fallback for weaker boxes. Remove the `require_gemma` hard-lock.
3. **Add the Brain back as an OPT-IN module** (the package excludes it as "too heavy" — make it optional, lightweight, off by default, on for GX10-class).
4. **Build the tenant/company config layer** — strip the ~1000 hardcoded "Halo Fire" references behind `tenant.toml` (company name, branding, DB name/path, admin/JWT secrets [already env], pricebooks, vendor/supplier list, domain/service-name in deploy + nginx).
5. **Write the provisioning runbook + bare-box bootstrap** (+ optional Tauri/EXE packaging — `apps/halofire-studio-desktop/` exists as a shell but packages nothing yet).
6. **Wire the AI** (Anti-Stub Register §3): real SAM vision, fix image→3D, brain recall/remember, qwen classifier judgment + assistant.

---

## 6. Process & security risks surfaced (fix alongside)

- **⚠ Repo/VPS drift (important).** The canonical deploy is `scripts/deploy-vps.sh` (`git reset --hard origin/main` + systemd + health + **auto-rollback** — genuinely solid). BUT this session has been **md5 file-syncing uncommitted files + committing to a feature branch** (`studio/fix-1881-...`), not `origin/main`. So the VPS holds scp'd files that a `deploy-vps.sh` run would **wipe** to whatever `origin/main` is. **Reconcile:** merge the branch to `main` and adopt `deploy-vps.sh` as the one pipeline, *or* deliberately keep file-sync and stop treating `deploy-vps.sh` as safe. Pick one — the drift is a live hazard.
- **Local-model inconsistency** across package/app/rule (see build-list #2).
- **SAM31 proxy sends no auth header** (`server.js:16196-16201`) — add a token like the CAD bridge has.
- **nginx is HTTP-only** per `DEPLOY.md` (no SSL on the origin; edge TLS via Cloudflare) — close for a security posture.

---

## 7. Bottom line

The **architecture is right** (env-driven AI endpoints = tenant-ready; the `openclaw-halofire` module runtime = the correct provisioning foundation; honest claim-gating throughout). What's missing is **finish + wire + parameterize + package**: the AI backbone isn't calling real models yet, the provisioning runtime was never adopted, and there's no tenant layer or runbook. None of it is faked — it's honestly stubbed and ready to be made real. Reference this register as the checklist so we don't ship a stub as "done."
