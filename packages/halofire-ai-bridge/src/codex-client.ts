/**
 * Codex CLI client for Halofire Studio.
 *
 * OpenAI Codex CLI is a separate AI agent that specializes in multi-step
 * code + file edits. Halofire uses it for:
 *   - Large refactors across @halofire/* packages
 *   - "Apply this plan to the codebase" workflows
 *   - Background code-generation jobs from Claude's suggestions
 *
 * Codex runs as a local CLI process. We shell out with the structured
 * task description and read stdout/exit-code.
 *
 * See E:/ClaudeBot/CODEX.md for Codex conventions used across this
 * workspace.
 */

import type { AiRequest, AiResponse } from './types.js'

export interface CodexClientOptions {
  /** Path to the codex CLI binary. Default: "codex" (must be on PATH) */
  codexBin?: string
  /** Working directory for codex execution */
  cwd?: string
  /** Maximum execution time in ms */
  timeoutMs?: number
}

export function createCodexClient(options: CodexClientOptions = {}) {
  const _codexBin = options.codexBin ?? 'codex'
  const _cwd = options.cwd ?? process.cwd()
  const _timeoutMs = options.timeoutMs ?? 10 * 60 * 1000

  return {
    async send(request: AiRequest): Promise<AiResponse> {
      // Browser-side: codex CLI cannot run in the browser. In that case
      // this client hits the halopenclaw gateway's /codex endpoint
      // which forwards to the CLI on the server.
      if (typeof window !== 'undefined') {
        return sendViaGateway(request)
      }

      // Node-side: shell out to codex CLI directly.
      // Dynamic import so this doesn't break browser builds.
      const { spawn } = await import('node:child_process')

      const prompt = request.messages
        .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
        .join('\n\n')

      return new Promise<AiResponse>((resolve, reject) => {
        const child = spawn(_codexBin, ['exec', '--cwd', _cwd], {
          stdio: ['pipe', 'pipe', 'pipe'],
        })
        child.stdin.write(prompt)
        child.stdin.end()

        const stdoutChunks: Buffer[] = []
        const stderrChunks: Buffer[] = []
        child.stdout.on('data', (c: Buffer) => stdoutChunks.push(c))
        child.stderr.on('data', (c: Buffer) => stderrChunks.push(c))

        const timeout = setTimeout(() => {
          child.kill('SIGTERM')
          reject(new Error(`Codex timed out after ${_timeoutMs}ms`))
        }, _timeoutMs)

        child.on('close', (code) => {
          clearTimeout(timeout)
          if (code !== 0) {
            reject(new Error(
              `Codex exited ${code}: ${Buffer.concat(stderrChunks).toString()}`,
            ))
            return
          }
          resolve({
            backend: 'codex',
            text: Buffer.concat(stdoutChunks).toString(),
          })
        })
      })
    },
  }
}

async function sendViaGateway(request: AiRequest): Promise<AiResponse> {
  const gatewayUrl = process.env.NEXT_PUBLIC_HALOPENCLAW_URL ?? 'http://localhost:18790'
  const response = await fetch(`${gatewayUrl}/codex/exec`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  })
  if (!response.ok) {
    throw new Error(`halopenclaw codex proxy failed: ${response.status}`)
  }
  return (await response.json()) as AiResponse
}
