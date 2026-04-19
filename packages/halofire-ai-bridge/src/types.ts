/**
 * Unified AI request + response + tool types.
 */

export type AiBackend = 'claude' | 'codex' | 'local'

export interface AiChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
  /** Attached images (base64) for vision-capable backends */
  images?: { b64: string; mimeType: 'image/png' | 'image/jpeg' | 'image/webp' }[]
}

export interface AiTool {
  name: string
  description: string
  /** JSON Schema for tool input parameters */
  input_schema: Record<string, unknown>
}

export interface AiRequest {
  backend?: AiBackend
  /** If omitted, router picks based on request shape (tools? vision? long-form?) */
  messages: AiChatMessage[]
  tools?: AiTool[]
  maxTokens?: number
  /** System prompt (optional) */
  system?: string
  /**
   * Claude model string; ignored for codex.
   * Default: "claude-opus-4-6"
   */
  claudeModel?: string
}

export interface AiResponse {
  backend: AiBackend
  /** Final text output */
  text: string
  /** Tool calls requested by the assistant (Claude tool use) */
  toolCalls?: { id: string; name: string; input: Record<string, unknown> }[]
  /** Token usage if backend reports it */
  usage?: {
    inputTokens?: number
    outputTokens?: number
    model?: string
  }
  /** Full raw response from the backend, for debugging */
  raw?: unknown
}
