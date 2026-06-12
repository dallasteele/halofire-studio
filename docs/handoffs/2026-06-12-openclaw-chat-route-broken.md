# OpenClaw chat surface is BROKEN end-to-end — Codex repair (2026-06-12)

Claude diagnosed this trying to open a visible Claude↔OpenClaw chat / hand HAL
the take-over. The **model lanes are fine** (gemma4 QAT chat verified via direct
ollama); the **chat ROUTE/plumbing is broken**. Fix these so a real chat session
(and talk mode, and "tell hal to take over") actually works in the UI.

## Confirmed failures (exact)
1. **OpenClaw CLI broken** — `/opt/hal9000/apps/openclaw` →
   `Cannot find package '@earendil-works/pi-coding-agent' imported from
   node_modules/openclaw/dist/selection-61FIEezO.js`. The CLI can't start, so
   `openclaw agent --agent hal -m ...` is dead. → reinstall/repair the OpenClaw
   npm deps (the missing `@earendil-works/pi-coding-agent` package), or pin a
   working OpenClaw version. Verify `node_modules/.bin/openclaw agent --agent hal
   -m "ping"` returns a reply as user hal9000 (env TMPDIR + OPENCLAW_HOME set).
2. **HAL V3 hub chat 404** — `POST :9000/runtime/chat/stream` →
   `event: error / chat_stream_http_404: Not Found`; `GET :9000/runtime/catalog`
   → `{"detail":"Not Found"}`. The hub's chat-stream forwards to an OpenClaw
   upstream path that 404s. → find where `hal.api.server` (create_app, :9000)
   proxies `/runtime/chat/stream` to the OpenClaw gateway (:19002) and fix the
   upstream route/path so a posted message reaches the `hal` agent and streams
   back `text_delta`…`done`. Restore `/runtime/catalog` too.
3. **Bridge direct route 401** — `openclaw_tool route=direct` → 401;
   `route=bridge` works. Fix the direct-route token.

## Acceptance (smoke before "done")
- CLI: `openclaw agent --agent hal -m "say hi"` → coherent reply (gemma4 QAT).
- Hub: `POST :9000/runtime/chat/stream {message}` → SSE `text_delta` stream
  ending in one `done`, reply visible in the OpenClaw Control UI (:19002) /
  sentient-glass (:19022) as a session thread.
- Then: a posted "take over" message to `hal` makes it dispatch via its tools
  (hal_codex_dispatch_next / hal_codex_build) — the visible take-over the user
  asked for.

## Note
Two config paths exist: `/home/hal9000/.openclaw/openclaw.json` (Claude set chat
lanes → gemma4 QAT here) and `/opt/hal9000/apps/claudebot/openclaw/` (canonical,
agents hal/hal-thinker/hal-codex/hal-opus). Reconcile which the gateway actually
loads so the QAT chat-lane fix applies to the live agents. Talk-mode voice plan
is in `2026-06-12-openclaw-talk-mode-and-qat.md` and depends on this chat route
working first.
