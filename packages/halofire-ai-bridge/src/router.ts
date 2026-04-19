/**
 * Router — picks the right backend for a given request.
 *
 * Heuristics:
 *   - Tools + vision + reasoning → Claude (Opus)
 *   - Multi-step code/file edits with explicit file list → Codex
 *   - Simple summarization or short answers → Claude Haiku
 *
 * If request.backend is set, respect it. Otherwise the router decides.
 */

import { createClaudeClient } from './claude-client.js'
import { createCodexClient } from './codex-client.js'
import type { AiRequest, AiResponse } from './types.js'

export async function routeRequest(request: AiRequest): Promise<AiResponse> {
  const backend = request.backend ?? pickBackend(request)
  if (backend === 'codex') {
    return createCodexClient().send(request)
  }
  // Default: Claude
  const claudeRequest: AiRequest = { ...request }
  if (!claudeRequest.claudeModel) {
    claudeRequest.claudeModel = pickClaudeModel(request)
  }
  return createClaudeClient().send(claudeRequest)
}

function pickBackend(req: AiRequest): 'claude' | 'codex' {
  // Heuristic: if the last user message mentions "apply to codebase" /
  // "refactor files" / "run tests" / "create PR" and there are no tools
  // declared, Codex is a better fit.
  const lastUser = [...req.messages].reverse().find((m) => m.role === 'user')
  if (!lastUser) return 'claude'
  const text = lastUser.content.toLowerCase()
  const codexHints = [
    'apply this plan to the codebase',
    'refactor the ',
    'run the tests and fix',
    'update all files in',
    'commit and push',
  ]
  if (!req.tools?.length && codexHints.some((h) => text.includes(h))) {
    return 'codex'
  }
  return 'claude'
}

function pickClaudeModel(req: AiRequest): string {
  // Cost optimization: tiny lookups go to Haiku; everything else Opus
  const totalUserChars = req.messages
    .filter((m) => m.role === 'user')
    .reduce((s, m) => s + m.content.length, 0)
  if (totalUserChars < 400 && !req.tools?.length) {
    return 'claude-haiku-4-5'
  }
  return 'claude-opus-4-6'
}
