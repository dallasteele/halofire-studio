# OpenClaw: talk mode (cloud voice) + QAT model preference — Codex handoff (2026-06-12)

Operating model: Claude plans; Codex + OpenClaw + GX10 qwen loop execute.

## A. Standing model rule (user, 2026-06-12)
For ANY **local** model lane on OpenClaw (chat / brainstem / verifier), **prefer
the QAT-quantized variant when one exists** — it fits VRAM better and runs
faster. Today that means `gemma4:26b-a4b-it-qat` for the chat lanes (already set:
hal + qwen brainstem). Build lane stays `qwen3:30b-a3b` (no better QAT MoE for
coding yet); `qwen-heavy` keeps `qwen3:30b-a3b-instruct-2507-q4_K_M` for max
reasoning. When adding a new local lane: check `ollama list` for a `*-qat`
variant first; only fall back to non-QAT if no QAT exists at the needed size.
(Cloud lanes — Claude/Codex/Grok — are unaffected; QAT is a local-quant concept.)

## B. Talk mode (VOICE) — replace the dead VoiceForge path
**VoiceForge never worked — abandon it** (`vf2.json`/`vf3.json`, any
`voiceforge-*` services: stop/disable, don't debug). Talk mode must ride a
**cloud voice provider** instead. Reuse credentials OpenClaw ALREADY has — the
`codex` agent uses OpenAI and the `grok` agent uses xAI, so both providers are
already authenticated in the gateway; **no new raw API keys to hand-place.**

**Primary: OpenAI voice** (most mature). Two options, pick by latency need:
- Realtime (best "talk" UX, interruptible): `gpt-realtime` / `gpt-4o-realtime`
  over WebSocket — mic audio in, streamed audio out.
- Chained (simpler to wire first): STT `gpt-4o-transcribe` (or `whisper-1`) →
  existing chat agent → TTS `gpt-4o-mini-tts`.
**Alternate: Grok voice** (xAI) behind the same talk-lane interface, selectable.

**Build it as:** a talk-lane in the gateway that does mic→STT→(route to the
selected chat agent, default the now-working `hal`/gemma4-QAT lane)→TTS→speaker,
with a provider switch (openai|grok). Gate with a round-trip smoke: short spoken
phrase → transcript → reply text → audio out, asserted non-empty. Surface
status via the existing `hal_voice_status` / `hal_voice_test` tools (rewire them
off VoiceForge onto the new lane).

**Honesty/safety:** voice creds come from the existing provider config/env,
never committed; talk mode never auto-executes destructive tools without the
same confirmation a typed command needs.

## C. Verify before "done"
- Chat lanes: a `hal` chat round-trip returns a coherent reply on gemma4 QAT
  (already verified via direct ollama). 
- Talk mode: the round-trip smoke above passes on OpenAI; Grok selectable.
- Record the working config + which provider in the brain.
