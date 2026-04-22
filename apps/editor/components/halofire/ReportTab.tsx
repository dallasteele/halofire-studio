'use client'

/**
 * ReportTab — deliverables browser.
 *
 * Lists the 8 artifacts the auto-design / single-op paths drop on
 * disk. Each card is a download link pointing at the gateway's
 * `GET /projects/:id/deliverable/:name` route (which already powers
 * the LiveCalc summary read). Empty state shows when no pipeline
 * has been run yet.
 */

import { useEffect, useState } from 'react'

import { ipc } from '@/lib/ipc'
import { GATEWAY_URL } from '@/lib/halofire/gateway-client'

const DELIVERABLES: Array<{
  name: string
  label: string
  description: string
}> = [
  { name: 'proposal.pdf',        label: 'Proposal',     description: 'Client-facing bid proposal.' },
  { name: 'submittal.pdf',       label: 'Submittal',    description: 'AHJ submittal package.' },
  { name: 'cut_sheets.pdf',      label: 'Cut sheets',   description: 'Bundled manufacturer cut-sheets.' },
  { name: 'prefab.pdf',          label: 'Prefab',       description: 'Shop prefab packet.' },
  { name: 'cut_list.csv',        label: 'Cut list',     description: 'Pipe cut-list for fabrication.' },
  { name: 'design.glb',          label: 'Design (GLB)', description: '3D model for viewers.' },
  { name: 'design.dxf',          label: 'Design (DXF)', description: '2D CAD export.' },
  { name: 'design.ifc',          label: 'Design (IFC)', description: 'BIM interchange.' },
  { name: 'bom.xlsx',            label: 'BOM',          description: 'Full bill of materials.' },
  { name: 'pipeline_summary.json', label: 'Summary',    description: 'Pipeline stage summary (JSON).' },
]

interface Props {
  projectId: string
}

export function ReportTab({ projectId }: Props) {
  const [hasAny, setHasAny] = useState<boolean | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const summary = (await ipc.readDeliverable({
          projectId, name: 'pipeline_summary.json',
        })) as { steps?: unknown[] } | null
        if (!cancelled) setHasAny(Boolean(summary))
      } catch {
        if (!cancelled) setHasAny(false)
      }
    })()
    return () => { cancelled = true }
  }, [projectId])

  if (hasAny === null) {
    return (
      <div className="p-4 font-mono text-xs text-neutral-500">loading deliverables…</div>
    )
  }

  if (!hasAny) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-neutral-500">
          no deliverables yet
        </div>
        <p className="max-w-xs text-xs text-neutral-400">
          Run a bid from the Auto-Design tab. Proposal, submittal,
          cut sheets, BOM, and CAD exports will land here.
        </p>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col gap-2 p-3">
      <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-neutral-500">
        Deliverables · {projectId}
      </div>
      <ul className="flex flex-col gap-1.5">
        {DELIVERABLES.map((d) => {
          const href = `${GATEWAY_URL}/projects/${encodeURIComponent(projectId)}/deliverable/${encodeURIComponent(d.name)}`
          return (
            <li
              key={d.name}
              className="flex items-center justify-between border border-white/10 bg-neutral-900/40 px-3 py-2"
              style={{ borderRadius: 0 }}
            >
              <div className="min-w-0">
                <div className="font-mono text-[12px] text-neutral-100">{d.label}</div>
                <div className="truncate text-[10px] text-neutral-500">{d.description}</div>
              </div>
              <a
                href={href}
                target="_blank"
                rel="noreferrer"
                className="ml-3 shrink-0 border border-[#e8432d]/40 bg-[#e8432d]/10 px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-[#ffb4a6] hover:bg-[#e8432d]/25 hover:text-white"
                style={{ borderRadius: 0 }}
                data-testid={`report-dl-${d.name}`}
              >
                download
              </a>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
