// Must be statically analyzable under `output: 'export'` (Tauri build).
// A dynamic timestamp is evaluated at build time — acceptable for a liveness probe.
export const dynamic = 'force-static'

export function GET() {
  return Response.json({ status: 'ok', app: 'editor', timestamp: new Date().toISOString() })
}
