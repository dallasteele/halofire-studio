'use client'

/**
 * Ribbon — AutoSprink-style top bar for HaloFire Studio.
 *
 * Three tabs (Design / Analyze / Report) group the heavy commands.
 * An always-visible "Home" band on the left hosts the file + project
 * shortcuts the estimator uses every minute (new bid, load bid, save,
 * run Auto-Design, submit proposal).
 *
 * No icon library — we draw the few glyphs we need with inline SVG
 * so the bundle stays tight and the look stays industrial.
 */

import { useCallback, useState } from 'react'

export type RibbonCommand =
  | 'bid-new'
  | 'bid-load'
  | 'bid-save'
  | 'auto-design'
  | 'layer-heads'
  | 'layer-pipes'
  | 'layer-walls'
  | 'layer-zones'
  | 'snap-toggle'
  | 'measure'
  | 'section'
  | 'hydraulic-calc'
  | 'rule-check'
  | 'stress-test'
  | 'report-proposal'
  | 'report-submittal'
  | 'report-export-dxf'
  | 'report-export-ifc'
  | 'report-send-to-client'

type RibbonTab = 'design' | 'analyze' | 'report'

interface Group {
  label: string
  buttons: {
    cmd: RibbonCommand
    label: string
    hint?: string
    tone?: 'default' | 'accent' | 'danger'
  }[]
}

const TABS: Record<RibbonTab, Group[]> = {
  design: [
    {
      label: 'Auto',
      buttons: [
        {
          cmd: 'auto-design',
          label: 'Auto-Design',
          hint: 'Run full pipeline on loaded plans',
          tone: 'accent',
        },
      ],
    },
    {
      label: 'Layers',
      buttons: [
        { cmd: 'layer-heads', label: 'Heads' },
        { cmd: 'layer-pipes', label: 'Pipes' },
        { cmd: 'layer-walls', label: 'Walls' },
        { cmd: 'layer-zones', label: 'Zones' },
      ],
    },
    {
      label: 'Tools',
      buttons: [
        { cmd: 'measure', label: 'Measure' },
        { cmd: 'section', label: 'Section' },
        { cmd: 'snap-toggle', label: 'Snap' },
      ],
    },
  ],
  analyze: [
    {
      label: 'Hydraulics',
      buttons: [
        { cmd: 'hydraulic-calc', label: 'Calculate', tone: 'accent' },
      ],
    },
    {
      label: 'Compliance',
      buttons: [
        { cmd: 'rule-check', label: 'NFPA check' },
        { cmd: 'stress-test', label: 'Stress test' },
      ],
    },
  ],
  report: [
    {
      label: 'Generate',
      buttons: [
        { cmd: 'report-proposal', label: 'Proposal', tone: 'accent' },
        { cmd: 'report-submittal', label: 'Submittal' },
      ],
    },
    {
      label: 'Export',
      buttons: [
        { cmd: 'report-export-dxf', label: 'DXF' },
        { cmd: 'report-export-ifc', label: 'IFC' },
      ],
    },
    {
      label: 'Client',
      buttons: [
        {
          cmd: 'report-send-to-client',
          label: 'Send bid',
          hint: 'Deliver proposal.html + design.glb to the client portal',
          tone: 'accent',
        },
      ],
    },
  ],
}

export interface RibbonProps {
  onCommand?: (cmd: RibbonCommand) => void
  defaultTab?: RibbonTab
}

export function Ribbon({ onCommand, defaultTab = 'design' }: RibbonProps) {
  const [tab, setTab] = useState<RibbonTab>(defaultTab)

  const handleClick = useCallback(
    (cmd: RibbonCommand) => {
      onCommand?.(cmd)
    },
    [onCommand],
  )

  return (
    <div
      data-testid="halofire-ribbon"
      className="flex w-full flex-col border-b border-white/10 bg-[#0c0c10] text-white"
    >
      {/* Tab strip */}
      <div className="flex items-center gap-1 px-3 pt-2">
        <div className="mr-4 select-none font-[Playfair_Display,Georgia,serif] text-[18px] font-bold tracking-tight">
          <span>Halo Fire</span>
          <span className="text-[var(--hf-accent,#e8432d)]">.</span>
          <span className="ml-2 text-[11px] font-normal uppercase tracking-[0.12em] text-neutral-500">
            Studio
          </span>
        </div>
        {(['design', 'analyze', 'report'] as RibbonTab[]).map((t) => (
          <button
            key={t}
            type="button"
            data-testid={`ribbon-tab-${t}`}
            onClick={() => setTab(t)}
            className={
              'rounded-sm border-b-2 px-4 py-1.5 text-xs uppercase tracking-[0.1em] transition-colors ' +
              (t === tab
                ? 'border-[#e8432d] text-white'
                : 'border-transparent text-neutral-400 hover:text-white')
            }
          >
            {t}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2 pr-2">
          <RibbonIconButton
            label="New bid"
            onClick={() => handleClick('bid-new')}
            glyph={
              <path d="M4 3h10l4 4v14H4z M14 3v4h4" />
            }
          />
          <RibbonIconButton
            label="Load bid"
            onClick={() => handleClick('bid-load')}
            glyph={<path d="M3 7h18v12H3zM3 7l3-4h5l2 3" />}
          />
          <RibbonIconButton
            label="Save bid"
            onClick={() => handleClick('bid-save')}
            glyph={
              <>
                <path d="M4 4h13l3 3v13H4z" />
                <path d="M7 4v6h8V4 M7 20v-6h10v6" />
              </>
            }
          />
        </div>
      </div>
      {/* Active tab content */}
      <div className="flex min-h-[64px] items-stretch gap-3 overflow-x-auto px-3 py-2">
        {TABS[tab].map((g) => (
          <div
            key={g.label}
            className="flex min-w-0 items-center gap-2 border-r border-white/5 pr-3 last:border-r-0"
          >
            <div className="flex gap-1.5">
              {g.buttons.map((b) => (
                <RibbonButton
                  key={b.cmd}
                  label={b.label}
                  hint={b.hint}
                  tone={b.tone ?? 'default'}
                  onClick={() => handleClick(b.cmd)}
                />
              ))}
            </div>
            <div className="shrink-0 text-[10px] uppercase tracking-[0.1em] text-neutral-600">
              {g.label}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function RibbonButton({
  label,
  hint,
  tone,
  onClick,
}: {
  label: string
  hint?: string
  tone: 'default' | 'accent' | 'danger'
  onClick: () => void
}) {
  const palette =
    tone === 'accent'
      ? 'bg-[#e8432d]/15 text-[#ffb4a6] border-[#e8432d]/40 hover:bg-[#e8432d]/25 hover:text-white'
      : tone === 'danger'
        ? 'bg-red-900/30 text-red-300 border-red-800/40 hover:bg-red-900/50'
        : 'bg-neutral-900/50 text-neutral-200 border-white/10 hover:bg-neutral-800 hover:text-white'
  return (
    <button
      type="button"
      title={hint}
      onClick={onClick}
      data-testid={`ribbon-btn-${label.toLowerCase().replace(/\s+/g, '-')}`}
      className={
        'rounded-sm border px-3 py-1.5 text-[12px] font-medium leading-none transition-colors ' +
        palette
      }
    >
      {label}
    </button>
  )
}

function RibbonIconButton({
  label,
  onClick,
  glyph,
}: {
  label: string
  onClick: () => void
  glyph: React.ReactNode
}) {
  return (
    <button
      type="button"
      title={label}
      onClick={onClick}
      className="flex h-7 w-7 items-center justify-center rounded-sm border border-white/10 bg-neutral-900/50 text-neutral-300 hover:bg-neutral-800 hover:text-white"
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        {glyph}
      </svg>
    </button>
  )
}
