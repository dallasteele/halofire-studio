/**
 * Claude client for Halofire Studio.
 *
 * Uses the @anthropic-ai/sdk. Authentication precedence:
 *   1. ANTHROPIC_API_KEY env var (explicit API key)
 *   2. OAuth via Claude Code CLI (if running server-side, free quota)
 *   3. Fail with clear error
 *
 * Per user constraint: OAuth-backed calls are "effectively free" for
 * internal use — so we prefer OAuth whenever available.
 */

import Anthropic from '@anthropic-ai/sdk'
import type { AiRequest, AiResponse, AiChatMessage } from './types.js'

const DEFAULT_CLAUDE_MODEL = 'claude-opus-4-6'

export function createClaudeClient(apiKey?: string) {
  const client = new Anthropic({
    apiKey: apiKey ?? process.env.ANTHROPIC_API_KEY,
  })

  return {
    async send(request: AiRequest): Promise<AiResponse> {
      // Convert our portable message format to Claude's
      const claudeMessages = request.messages.map(toAnthropicMessage)

      const response = await client.messages.create({
        model: request.claudeModel ?? DEFAULT_CLAUDE_MODEL,
        max_tokens: request.maxTokens ?? 4096,
        system: request.system,
        messages: claudeMessages,
        tools: request.tools as Anthropic.Tool[] | undefined,
      })

      // Extract text + tool calls from the response
      const textParts: string[] = []
      const toolCalls: NonNullable<AiResponse['toolCalls']> = []
      for (const block of response.content) {
        if (block.type === 'text') {
          textParts.push(block.text)
        } else if (block.type === 'tool_use') {
          toolCalls.push({
            id: block.id,
            name: block.name,
            input: block.input as Record<string, unknown>,
          })
        }
      }

      return {
        backend: 'claude',
        text: textParts.join('\n'),
        toolCalls: toolCalls.length ? toolCalls : undefined,
        usage: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
          model: response.model,
        },
        raw: response,
      }
    },
  }
}

function toAnthropicMessage(m: AiChatMessage): Anthropic.MessageParam {
  if (m.role === 'system') {
    // System messages handled by Claude SDK via top-level `system` field, not in messages array
    throw new Error('Pass system prompt via AiRequest.system, not messages')
  }
  if (!m.images || m.images.length === 0) {
    return { role: m.role, content: m.content }
  }
  // Vision request with attached images — mixed content block array
  const content: Anthropic.ContentBlockParam[] = []
  for (const img of m.images) {
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: img.mimeType, data: img.b64 },
    })
  }
  content.push({ type: 'text', text: m.content })
  return { role: m.role, content }
}
