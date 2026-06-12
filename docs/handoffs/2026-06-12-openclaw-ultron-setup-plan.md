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
