'use client'

/**
 * AiPipelineRunner — upload an architect PDF/IFC/DWG, run the full
 * HaloFire CAD pipeline end-to-end, stream progress, show deliverables.
 *
 * Wraps the gateway's /intake/upload + /intake/status/{id} endpoints.
 * The same endpoints are MCP-callable by Claude/Codex for autonomous
 * runs with zero UI.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

const GATEWAY_URL =
  process.env.NEXT_PUBLIC_HALOPENCLAW_URL ?? 'http://localhost:18080'

interface JobStatus {
  job_id: string
  project_id: string
  status: 'queued' | 'running' | 'completed' | 'failed'
  percent: number
  steps_complete: string[]
  error?: string | null
  summary?: any | null
}

export function AiPipelineRunner({ projectId }: { projectId: string }) {
  const [file, setFile] = useState<File | null>(null)
  const [job, setJob] = useState<JobStatus | null>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const inputRef = useRef<HTMLInputElement>(null)

  const stopPoll = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [])

  useEffect(() => () => stopPoll(), [stopPoll])

  const upload = useCallback(async () => {
    if (!file) return
    setUploading(true)
    setError(null)
    try {
      const form = new FormData()
      form.append('file', file)
      form.append('project_id', projectId)
      form.append('mode', 'pipeline')
      const res = await fetch(`${GATEWAY_URL}/intake/upload?project_id=${projectId}`, {
        method: 'POST',
        body: form,
      })
      if (!res.ok) throw new Error(`upload HTTP ${res.status}`)
      const body = await res.json()
      setJob({
        job_id: body.job_id,
        project_id: body.project_id,
        status: body.status,
        percent: 0,
        steps_complete: [],
      })
      // Start polling
      pollRef.current = setInterval(async () => {
        try {
          const r = await fetch(`${GATEWAY_URL}/intake/status/${body.job_id}`)
          if (!r.ok) return
          const s = await r.json()
          setJob(s)
          if (s.status === 'completed' || s.status === 'failed') {
            stopPoll()
          }
        } catch (e) {
          // transient; keep polling
          void e
        }
      }, 2000)
    } catch (e) {
      setError(String(e))
    } finally {
      setUploading(false)
    }
  }, [file, projectId, stopPoll])

  const runQuickBid = useCallback(async () => {
    setError(null)
    try {
      const res = await fetch(`${GATEWAY_URL}/quickbid`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: projectId,
          total_sqft: 170654,
          level_count: 6,
          standpipe_count: 2,
          dry_systems: 2,
          hazard_mix: { residential: 0.7, ordinary_i: 0.3 },
        }),
      })
      const body = await res.json()
      setJob({
        job_id: 'quickbid',
        project_id: projectId,
        status: 'completed',
        percent: 100,
        steps_complete: ['quickbid'],
        summary: body,
      })
    } catch (e) {
      setError(String(e))
    }
  }, [projectId])

  return (
    <div className="rounded border border-neutral-300 p-2 text-xs dark:border-neutral-700">
      <h3 className="mb-1 text-xs font-semibold">AI CAD Pipeline</h3>
      <p className="mb-2 text-[10px] text-neutral-500">
        Upload architect PDF / IFC / DWG. Full pipeline:
        intake → classify → place → route → calc → rulecheck → BOM → labor →
        proposal → submittal (DXF / GLB / IFC / PDF / XLSX).
      </p>

      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.ifc,.dwg,.dxf"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        className="w-full text-[10px]"
      />
      {file && (
        <p className="mt-1 font-mono text-[9px] text-neutral-500">
          {file.name} ({(file.size / 1024).toFixed(1)} KB)
        </p>
      )}
      <div className="mt-2 flex gap-1">
        <button
          type="button"
          disabled={!file || uploading}
          onClick={upload}
          className="flex-1 rounded bg-[#e8432d] px-2 py-1.5 text-[11px] font-semibold text-white hover:bg-[#c43719] disabled:opacity-50"
        >
          {uploading ? 'Uploading…' : 'Run full AI CAD pipeline'}
        </button>
        <button
          type="button"
          onClick={runQuickBid}
          className="rounded border border-neutral-400 bg-neutral-100 px-2 py-1.5 text-[10px] font-medium text-neutral-700 hover:bg-neutral-200 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-200"
        >
          Quick bid (60s)
        </button>
      </div>

      {error && (
        <p className="mt-1 text-[10px] text-red-700 dark:text-red-300">{error}</p>
      )}

      {job && (
        <div className="mt-2 rounded border border-neutral-300 bg-neutral-50 p-2 text-[10px] dark:border-neutral-700 dark:bg-neutral-900">
          <div className="flex items-center justify-between">
            <span className="font-mono">{job.job_id.slice(0, 8)}</span>
            <span
              className={`rounded px-1 font-mono ${
                job.status === 'completed'
                  ? 'bg-green-200 text-green-900 dark:bg-green-950 dark:text-green-300'
                  : job.status === 'failed'
                    ? 'bg-red-200 text-red-900 dark:bg-red-950 dark:text-red-300'
                    : 'bg-amber-200 text-amber-900 dark:bg-amber-950 dark:text-amber-300'
              }`}
            >
              {job.status}
            </span>
          </div>
          {job.steps_complete && job.steps_complete.length > 0 && (
            <p className="mt-1 text-neutral-500">
              Steps complete: {job.steps_complete.join(' → ')}
            </p>
          )}
          {job.status === 'completed' && job.summary && job.job_id !== 'quickbid' && (
            <>
              <p className="mt-1">
                Deliverables at{' '}
                <a
                  href={`${GATEWAY_URL}/projects/${projectId}/proposal.json`}
                  target="_blank"
                  className="underline"
                  rel="noreferrer"
                >
                  /projects/{projectId}/proposal.json
                </a>
              </p>
              <p>
                Open the client bid viewer at{' '}
                <a
                  href={`/bid/${projectId}`}
                  target="_blank"
                  className="underline"
                  rel="noreferrer"
                >
                  /bid/{projectId}
                </a>
              </p>
            </>
          )}
          {job.status === 'completed' && job.summary && job.job_id === 'quickbid' && (
            <div className="mt-1">
              <p className="text-sm font-bold text-[#e8432d]">
                ${job.summary.total_usd.toLocaleString()}
              </p>
              <p className="text-[9px] italic text-neutral-500">
                Quick-bid estimate · {(job.summary.confidence * 100).toFixed(0)}% confidence
              </p>
            </div>
          )}
          {job.error && (
            <p className="mt-1 text-red-700 dark:text-red-300">{job.error}</p>
          )}
        </div>
      )}
    </div>
  )
}
