'use client'

/**
 * ReportTab — deliverables library.
 *
 * Phase G redesign: each deliverable is a row in a drafting-style
 * document ledger — file-type glyph, title, description, "open"
 * action. Empty state speaks in prose. The whole thing reads like
 * a submittal index sheet, because that's what it *is*.
 */

import { useEffect, useState } from 'react'

import { ipc } from '@/lib/ipc'
import { GATEWAY_URL } from '@/lib/halofire/gateway-client'

const DELIVERABLES: Array<{
  name: string
  label: string
  description: string
  kind: 'pdf' | 'csv' | 'glb' | 'dxf' | 'ifc' | 'xlsx' | 'json'
}> = [
  { name: 'proposal.pdf',          label: 'Proposal',     description: 'Client-facing bid proposal.',    kind: 'pdf' },
  { name: 'submittal.pdf',         label: 'Submittal',    description: 'AHJ submittal package.',        kind: 'pdf' },
  { name: 'cut_sheets.pdf',        label: 'Cut sheets',   description: 'Bundled manufacturer cut-sheets.', kind: 'pdf' },
  { name: 'prefab.pdf',            label: 'Prefab',       description: 'Shop prefab packet.',            kind: 'pdf' },
  { name: 'cut_list.csv',          label: 'Cut list',     description: 'Pipe cut-list for fabrication.', kind: 'csv' },
  { name: 'design.glb',            label: 'Design (GLB)', description: '3D model for viewers.',          kind: 'glb' },
  { name: 'design.dxf',            label: 'Design (DXF)', description: '2D CAD export.',                 kind: 'dxf' },
  { name: 'design.ifc',            label: 'Design (IFC)', description: 'BIM interchange.',               kind: 'ifc' },
  { name: 'bom.xlsx',              label: 'BOM',          description: 'Full bill of materials.',        kind: 'xlsx' },
  { name: 'pipeline_summary.json', label: 'Summary',      description: 'Pipeline stage summary (JSON).', kind: 'json' },
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
      <div className="p-4 hf-label tracking-[0.22em]">
        loading deliverables…
      </div>
    )
  }

  if (!hasAny) {
    return (
      <div className="flex h-full flex-col items-start justify-start gap-3 px-3 py-6">
        <div className="hf-label tracking-[0.24em]">Deliverables</div>
        <h2
          className="text-[22px] leading-none tracking-tight text-[var(--color-hf-paper)]"
          style={{
            fontFamily: 'var(--font-fraunces), serif',
            fontVariationSettings: '"SOFT" 30, "WONK" 0, "opsz" 144',
          }}
        >
          Nothing to deliver yet.
        </h2>
        <p className="max-w-sm text-[11.5px] leading-relaxed text-[var(--color-hf-ink-mute)]">
          Run a bid from the{' '}
          <span className="text-[var(--color-hf-accent)]">Auto-Design</span>{' '}
          tab. Proposal, submittal, cut sheets, BOM and CAD exports land
          here as each pipeline stage finishes — the latest run always
          overwrites the last, and the scene renders in the viewport
          at the same time.
        </p>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col gap-2 px-3 py-4 hf-scroll overflow-y-auto">
      <div className="flex items-baseline justify-between pb-1">
        <div>
          <div className="hf-label tracking-[0.24em]">Deliverables</div>
          <h2
            className="mt-1 text-[20px] leading-none tracking-tight text-[var(--color-hf-paper)]"
            style={{
              fontFamily: 'var(--font-fraunces), serif',
              fontVariationSettings: '"SOFT" 30, "WONK" 0, "opsz" 144',
            }}
          >
            Submittal ledger
          </h2>
        </div>
        <span className="hf-num text-[10px] text-[var(--color-hf-ink-dim)]">
          {projectId}
        </span>
      </div>

      <ul className="divide-y divide-[var(--color-hf-edge)] border-y border-[var(--color-hf-edge)]">
        {DELIVERABLES.map((d, i) => {
          const href = `${GATEWAY_URL}/projects/${encodeURIComponent(projectId)}/deliverable/${encodeURIComponent(d.name)}`
          return (
            <li
              key={d.name}
              className="flex items-center gap-3 px-2 py-2.5 hover:bg-white/[0.02]"
            >
              <span
                aria-hidden
                className="hf-num text-[9px] text-[var(--color-hf-ink-deep)] w-5 tabular-nums"
              >
                {String(i + 1).padStart(2, '0')}
              </span>
              <KindBadge kind={d.kind} />
              <div className="min-w-0 flex-1">
                <div className="text-[12px] font-medium text-[var(--color-hf-paper)]">
                  {d.label}
                </div>
                <div className="truncate text-[10px] text-[var(--color-hf-ink-dim)]">
                  {d.description}
                </div>
              </div>
              <a
                href={href}
                target="_blank"
                rel="noreferrer"
                data-testid={`report-dl-${d.name}`}
                style={{ borderRadius: 0 }}
                className="ml-2 shrink-0 border border-[rgba(232,67,45,0.4)] bg-[rgba(232,67,45,0.08)] px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-[var(--color-hf-accent)] hover:border-[var(--color-hf-accent)] hover:bg-[rgba(232,67,45,0.18)] hover:text-white transition-colors"
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

function KindBadge({ kind }: { kind: string }) {
  const palette: Record<string, { fg: string; bg: string }> = {
    pdf:  { fg: 'var(--color-hf-brick)',      bg: 'rgba(154,60,60,0.08)' },
    csv:  { fg: 'var(--color-hf-moss)',       bg: 'rgba(107,142,58,0.08)' },
    xlsx: { fg: 'var(--color-hf-moss)',       bg: 'rgba(107,142,58,0.08)' },
    glb:  { fg: 'var(--color-hf-accent)',     bg: 'rgba(232,67,45,0.08)' },
    dxf:  { fg: 'var(--color-hf-gold)',       bg: 'rgba(200,154,60,0.08)' },
    ifc:  { fg: 'var(--color-hf-gold)',       bg: 'rgba(200,154,60,0.08)' },
    json: { fg: 'var(--color-hf-ink-mute)',   bg: 'rgba(255,255,255,0.04)' },
  }
  const { fg, bg } = palette[kind] ?? palette.json!
  return (
    <span
      className="inline-flex h-7 w-9 shrink-0 items-center justify-center border hf-num text-[9px] uppercase tracking-[0.1em]"
      style={{
        borderRadius: 0,
        color: fg,
        background: bg,
        borderColor: bg,
      }}
    >
      {kind}
    </span>
  )
}
