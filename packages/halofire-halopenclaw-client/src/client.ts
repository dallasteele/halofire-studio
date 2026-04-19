/**
 * Halopenclaw client factory.
 *
 * Uses `fetch` (browser + node 18+) to hit the gateway's /mcp JSON-RPC
 * endpoint. Throws on non-ok HTTP or if the response payload contains
 * a JSON-RPC error.
 */

import type {
  HalopenclawClient,
  SerializedScene,
  ToolName,
  ValidateMode,
} from './types.js'

export interface CreateClientOptions {
  /** Gateway base URL. Defaults to env `NEXT_PUBLIC_HALOPENCLAW_URL`
   *  then `http://localhost:18790`. */
  baseUrl?: string
  /** Custom fetch (server-side SSR, testing). Default: global fetch. */
  fetchImpl?: typeof fetch
}

export function createHalopenclawClient(
  options: CreateClientOptions = {},
): HalopenclawClient {
  // Read env safely — browser build may not have process defined.
  const envUrl =
    typeof globalThis !== 'undefined' &&
    typeof (globalThis as { process?: { env?: Record<string, string | undefined> } })
      .process !== 'undefined'
      ? (globalThis as { process?: { env?: Record<string, string | undefined> } })
          .process?.env?.NEXT_PUBLIC_HALOPENCLAW_URL
      : undefined
  const baseUrl = options.baseUrl ?? envUrl ?? 'http://localhost:18790'
  const fetchFn = options.fetchImpl ?? fetch

  async function jsonRpc(method: string, params?: Record<string, unknown>) {
    const response = await fetchFn(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: Math.floor(Math.random() * 10_000),
        method,
        params,
      }),
    })
    if (!response.ok) {
      throw new Error(
        `halopenclaw ${method} failed: HTTP ${response.status}`,
      )
    }
    const body = await response.json()
    if (body.error) {
      throw new Error(`halopenclaw ${method} rpc error: ${JSON.stringify(body.error)}`)
    }
    return body.result
  }

  return {
    baseUrl,

    async call<T = string>(
      tool: ToolName,
      args: Record<string, unknown>,
    ): Promise<T> {
      const result = await jsonRpc('tools/call', { name: tool, arguments: args })
      if (result?.isError) {
        throw new Error(
          `halopenclaw tool '${tool}' returned error: ${
            result?.content?.[0]?.text ?? 'unknown'
          }`,
        )
      }
      // Most tools return a single text content block; typed as T for flexibility.
      const text = result?.content?.[0]?.text ?? ''
      return text as T
    },

    async listTools() {
      const result = await jsonRpc('tools/list')
      return (result?.tools ?? []) as { name: string; description: string }[]
    },

    async health() {
      const response = await fetchFn(`${baseUrl}/health`)
      if (!response.ok) {
        throw new Error(`health check failed: HTTP ${response.status}`)
      }
      return (await response.json()) as {
        ok: boolean
        service: string
        version: string
        tools: string[]
      }
    },

    async validate(
      mode: ValidateMode,
      scene: SerializedScene,
      opts?: { toleranceCm?: number; marginCm?: number },
    ) {
      const args: Record<string, unknown> = { mode, scene }
      if (opts?.toleranceCm !== undefined) args.tolerance_cm = opts.toleranceCm
      if (opts?.marginCm !== undefined) args.margin_cm = opts.marginCm
      return this.call('halofire_validate', args)
    },
  }
}
