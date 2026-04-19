/**
 * @halofire/ai-bridge — unified AI client layer.
 *
 * Halofire Studio must work with multiple AI backends:
 *   - Claude (Agent SDK, tool use, vision) — primary
 *   - Codex CLI (multi-step code + scene edits) — secondary
 *   - Future: Gemini, local models via LLM Gateway :8787
 *
 * All user-facing AI features flow through this bridge so the studio UI
 * never hard-codes a model. Per the user's stated constraint, this app
 * must "have connections to claude, codex and a halopenclaw solution."
 *
 * Model selection:
 *   - Reasoning + tool use + vision → Claude Opus (best-in-class)
 *   - Large multi-step code edits    → Codex CLI (spec-driven workflow)
 *   - Quick lookups + summarization  → Claude Haiku (cost-optimized)
 */

export type { AiBackend, AiRequest, AiResponse, AiTool, AiChatMessage } from './types.js'
export { createClaudeClient } from './claude-client.js'
export { createCodexClient } from './codex-client.js'
export { routeRequest } from './router.js'
