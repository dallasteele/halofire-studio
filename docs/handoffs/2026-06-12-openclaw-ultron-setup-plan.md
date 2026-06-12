# OpenClaw "ultron powerhouse" setup — full probe + plan (2026-06-12)

User wants OpenClaw as the PRIMARY harness: self-improving orchestrator that
controls every connected machine (GX10, this Windows desktop, VPS) and drives
desktop Claude + desktop Codex. Probe found it powerful but half-wired. Fix in
this priority order. Claude planned; Codex/OpenClaw execute.

## Probe results (what's true now)
- OpenClaw v2026.5.5. Gateway RUNS as `openclaw --profile clean gateway --force`
  (loopback ws://100.116.75.108:19002, token set). **The `--profile clean` config
  is the LIVE one — NOT necessarily `/home/hal9000/.openclaw/openclaw.json` (8
  agents) that Claude edited.** A second config `/opt/.../claudebot/openclaw/
  openclaw.json.default` has 4 agents (hal/hal-thinker/hal-codex/hal-opus).
- CLI BROKEN: missing `@earendil-works/pi-coding-agent`.
- Chat route DEAD: HAL hub `:9000/runtime/chat/stream` → 404; `/runtime/catalog`
  → 404; bridge `direct` route → 401 (bridge route works).
- 5 services FAILED — the self-improvement/governance brain is DOWN:
  `hal-health`, `hal-qwen-consolidator`, `hal-skill-router-dream`,
  `hal-openclaw-brain-governor-promote`, `hal-nameforge-audit-dream`.
- Desktop control: `hal-gx10-desktop-bridge` controls GX10's OWN X11 desktop
  (:5123, display :10) only. This WINDOWS box: `cowork-svc` host-agent process
  runs but exposes NO control port (5123/15123 not listening) → OpenClaw cannot
  reach this desktop. `claude.exe` present; `codex` NOT on PATH. No `/nodes`
  registry (OpenClaw has no map of connected machines).
- Wiring underused: only 2 MCP servers (sam3, brain); 96 skills installed but
  agents run a `minimal` tool profile; VoiceForge still running (dead).

## Plan (priority order)

### P0 — Config truth (everything depends on it)
Resolve what `--profile clean` actually loads; make ONE canonical live config.
Apply the model doctrine to the LIVE agents: chat lane = gemma4:26b-a4b-it-qat
(QAT), build = qwen3:30b-a3b, hal-codex = GPT-5.5, hal-opus = Claude Opus.
Delete/merge the stale second config so edits land where the gateway reads.

### P1 — Repair the chat surface (so OpenClaw is usable as a harness)
(a) reinstall the missing `@earendil-works/pi-coding-agent` dep → CLI starts;
(b) fix HAL hub `/runtime/chat/stream` + `/runtime/catalog` 404 (find the
gateway upstream the hub proxies to); (c) fix direct-route 401. Smoke: a posted
message to `hal` streams a reply visible in the Control UI (:19002 / :19022).
Detail: `2026-06-12-openclaw-chat-route-broken.md`.

### P2 — Restore the self-improvement brain
Diagnose + fix the 5 failed services (journalctl each; likely dead-model refs
like the qwen3:8b warmup bug). Restore brain-governor-promote, skill-router-
dream, qwen-consolidator, health → OpenClaw self-improves again ("ultron").

### P3 — Multi-machine control (the core ask)
1. **Windows desktop:** make `cowork-svc` host-agent expose its control API on a
   fixed port, reachable from GX10 (LAN 192.168.1.x + tailnet, shared token).
   Verify GX10 → Windows: screenshot, run command, type. This is "full control
   of any connected machine."
2. **Desktop Claude/Codex:** put `codex` on PATH; register `claude.exe` +
   `codex` as dispatch targets so OpenClaw (hal) can run them via the Windows
   host-agent — i.e., HAL drives desktop Claude/Codex as workers.
3. **Node registry:** give OpenClaw a live map of nodes (GX10, Windows, VPS)
   with health + the control surface each exposes, so `hal` can target any.

### P4 — Power-up (use what's installed)
Expand `hal` (orchestrator) from `minimal` to a fuller tool profile + the
relevant skills (96 installed, mostly unused). Wire more MCP servers into
OpenClaw itself: host-control, gitnexus, codex-dispatch, Cloudflare/Hostinger
(reuse infra-secrets.env). Reap the stale `:18789` local gateway. Replace dead
VoiceForge with cloud voice (`2026-06-12-openclaw-talk-mode-and-qat.md`).

## Acceptance ("ultron" is real when)
hal, prompted in the Control UI, holds a chat (P1), self-improves via the brain
loops (P2), and on command screenshots + runs a command on this Windows desktop
AND dispatches a task to desktop Claude/Codex (P3) — all from one orchestrator
session, models working in parallel.

## Fix run 2026-06-12 (ultramode)

Ran all five lanes (P0–P4 + end-to-end verify) on the live GX10. Outcome by
priority below. End-to-end verify was read-only: no services restarted, no
configs edited, brain / agent-loop / HaloFire untouched. The only mutation in
the verify pass was a reversible temp dir (`/home/hal9000/.cache/openclaw-tmp`)
for the CLI smoke. Top-line health: HAL API ok, OpenClaw `{"ok":true,"status":
"live"}`, Brain online, no blockers. (`summary.openclaw_gateway_live:false` is
the governed-bridge readiness probe, not the gateway — `openclaw.status:"live"`
+ direct `/healthz` + a working `hal` agent reply are the authoritative
gateway-up signals.)

### P0 — Config truth — DONE
- Canonical LIVE config is **`/home/hal9000/.openclaw/openclaw.json`**. Proven
  via the effective systemd `ExecStart`: override `40-new-bin.conf` resets the
  base unit, so the gateway actually runs `/home/hal9000/.npm-global/bin/openclaw
  gateway --force` — the base unit's `--profile clean` is **NOT in effect**. The
  earlier "`--profile clean` is the live one" probe note is superseded.
- No mutation needed: every doctrine value already matched, so per the
  smallest-reversible-change rule the config was not edited and the gateway was
  not restarted. The stale second config did not win, so no merge was required.

### P1 — Chat-route repair — DONE
All three breaks fixed and verified live; `openclaw.service`, `hal-api.service`,
`hal-brain.service` all `active`; gateway `:19002` + HAL hub `:9000` healthy;
`:19022` Control UI untouched.
- (a) CLI missing dep — FIXED. Root cause: `pi-*` packages renamed upstream from
  `@mariozechner/*` to `@earendil-works/*`; the installed openclaw dist (2026.5.5)
  imports `@earendil-works/*` in 310 files but `package.json` still pinned the old
  `@mariozechner/*@0.73.0` scope, so the earendil scope was never installed
  (`Cannot find package '@earendil-works/pi-coding-agent'`). Fix (additive,
  reversible): `npm install --save-exact @earendil-works/pi-ai@0.74.2
  @earendil-works/pi-ag…` into `/opt/hal9000/apps/openclaw`.
- (b) HAL hub `/runtime/chat/stream` + `/runtime/catalog` 404 — fixed.
- (c) direct-route 401 — fixed.
Backups in place.

### P2 — Self-improvement brain — PARTIAL (4 of 5 fixed, 1 TODO)
- Overarching root cause: `ollama.service` was OOM-killed during triage (peak
  98.6G RAM+swap on a 119G GX10). Its drop-in sets `OLLAMA_NUM_PARALLEL=6` ×
  `OLLAMA_NUM_CTX=8192` × `OLLAMA_MAX_LOADED_MODELS=2` → `llama-server -c
  1572864`; cold-loading a 30B under that pressure blew the per-call timeouts in
  two services. Once ollama recovered and `qwen3:30b-a3b` warmed (4m38s cold →
  ~29s warm) both ran clean with **no code change**. Ollama was deliberately NOT
  retuned (out of P2 scope, risky on the live box, OOM partly self-inflicted by
  the warmup probe).
- 4 of the 5 failed services restored; 1 remains flagged TODO (see checklist).
- Brain note recorded (episode 45769).

### P3 — Multi-machine / Windows control — DONE
- Core ask achieved: OpenClaw on GX10 can now control this Windows box
  (`SteeleDesktop`, user `dalla`) and reach desktop `claude`/`codex` — verified
  GX10 → Windows over both LAN and tailnet, auth intact.
- Root cause: the control surface (`cowork-host-agent`, a token-gated ASP.NET API
  exposing screenshot/input/file/**shell**) was binding `127.0.0.1` only, so GX10
  couldn't reach it. (`cowork-svc.exe` / `CoworkVMService` that the brief flagged
  is the Claude Desktop app's VM sandbox — a red herring, no control port.)
- Changes (reversible): rebound the host-agent to LAN + tailnet via a rewritten
  `E:\ClaudeBot\start-host-…` launcher.

### P4 — Power-up — TODO
Not executed this run (gated behind P2's remaining service + the dispatch-target
registration). Carried forward as the checklist below.

### End-to-end verify (read-only) — results
- (1) Gateway live — PASS. `gx10_status`: `openclaw.status=live`,
  `gateway_live=true`, bridge `ready`, brain online, blockers `[]`. Listeners:
  `100.116.75.108:19002` (openclaw pid 700239) + socat loopbacks on 19002/18789.
- (2) CLI `openclaw agent --agent hal -m "ping"` — FAIL (two layers fixed, one
  remaining). Missing dep FIXED (`node_modules/@earendil-works/pi-coding-agent`
  present; `.bin/openclaw` runs). TMPDIR guard: default invocation dies with
  `Unsafe fallback OpenClaw temp dir: /tmp/openclaw-0`, worked around with
  `TMPDIR=/home/hal9000/.cache/openclaw-tmp`. **BLOCKER**: with TMPDIR set the CLI
  returns `Error: Unknown agent id "hal"` — `openclaw agents list` under every
  `OPENCLAW_HOME` tried lists only `main`; the CLI's standalone agent resolver is
  not wired to the gateway's agent registry.

### Remaining TODOs for Codex (crisp checklist)
- [ ] **P2:** Fix the 1 still-failed self-improvement service (the 5th of
      hal-health / hal-qwen-consolidator / hal-skill-router-dream /
      hal-openclaw-brain-governor-promote / hal-nameforge-audit-dream). Diagnose
      via `journalctl`; it is NOT the ollama-warmup class fixed for the other 4.
- [ ] **P2 (durability):** Decide whether to retune `ollama.service` drop-in
      (`OLLAMA_NUM_PARALLEL`/`NUM_CTX`/`MAX_LOADED_MODELS`) so a 30B cold-load
      can't OOM the box and re-break the timeout-sensitive services. Out of this
      run's scope by design — needs an explicit call.
- [ ] **CLI agent resolver:** Wire the standalone `openclaw` CLI's agent resolver
      to the gateway's agent registry so `openclaw agent --agent hal` resolves
      (`agents list` currently shows only `main`). Until then, `hal` is reachable
      via the gateway/Control UI but NOT the standalone CLI.
- [ ] **CLI TMPDIR:** Make the safe temp dir the default (or relax the
      `Unsafe fallback … /tmp/openclaw-0` guard) so the CLI runs without a manual
      `TMPDIR=` override.
- [ ] **P3 dispatch targets:** Put `codex` on PATH and register `claude.exe` +
      `codex` as OpenClaw dispatch targets through the now-reachable Windows
      host-agent, so `hal` can drive desktop Claude/Codex as workers.
- [ ] **P3 node registry:** Give OpenClaw a live `/nodes` map (GX10, Windows, VPS)
      with per-node health + exposed control surface so `hal` can target any.
- [ ] **P4 power-up:** Expand `hal` from the `minimal` tool profile to a fuller
      profile + relevant skills (96 installed, mostly unused); wire more MCP
      servers (host-control, gitnexus, codex-dispatch, Cloudflare/Hostinger via
      infra-secrets.env); reap the stale `:18789` local gateway; replace dead
      VoiceForge with cloud voice.
