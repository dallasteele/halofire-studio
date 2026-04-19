/**
 * Client for the halopenclaw gateway's takeoff endpoints.
 */

import type { TakeoffRequest, TakeoffResult, TakeoffProgress } from './types.js'

const GATEWAY_URL = process.env.NEXT_PUBLIC_HALOPENCLAW_URL ?? 'http://localhost:18790'

/**
 * Upload a PDF, get back a job ID. Use pollTakeoffJob() to watch progress.
 */
export async function uploadPdfForTakeoff(req: TakeoffRequest): Promise<{ jobId: string }> {
  const form = new FormData()
  form.append('pdf', new Blob([req.pdfBytes], { type: 'application/pdf' }))
  form.append('projectId', req.projectId)
  if (req.forceAllLayers) form.append('forceAllLayers', 'true')

  const response = await fetch(`${GATEWAY_URL}/takeoff/upload`, {
    method: 'POST',
    body: form,
  })
  if (!response.ok) {
    throw new Error(`halopenclaw upload failed: ${response.status} ${await response.text()}`)
  }
  return (await response.json()) as { jobId: string }
}

/**
 * Poll the job status until complete. Yields progress updates as they arrive.
 * Gateway should stream Server-Sent Events for low-latency updates; fall back
 * to polling every 500ms if SSE is unavailable.
 */
export async function* pollTakeoffJob(
  jobId: string,
): AsyncGenerator<TakeoffProgress | TakeoffResult, void, undefined> {
  // Prefer SSE when available
  const sseUrl = `${GATEWAY_URL}/takeoff/stream/${jobId}`
  try {
    const response = await fetch(sseUrl, { headers: { Accept: 'text/event-stream' } })
    if (response.ok && response.headers.get('content-type')?.includes('text/event-stream')) {
      const reader = response.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        for (const line of buffer.split('\n\n')) {
          if (!line.startsWith('data: ')) continue
          yield JSON.parse(line.slice(6)) as TakeoffProgress | TakeoffResult
        }
        buffer = ''
      }
      return
    }
  } catch {
    // Fall through to polling
  }

  // Fallback: poll every 500ms
  while (true) {
    const response = await fetch(`${GATEWAY_URL}/takeoff/status/${jobId}`)
    if (!response.ok) {
      throw new Error(`halopenclaw status failed: ${response.status}`)
    }
    const body = (await response.json()) as TakeoffProgress | TakeoffResult
    yield body
    if (body.status === 'succeeded' || body.status === 'failed') return
    await new Promise((r) => setTimeout(r, 500))
  }
}
