'use client'

/**
 * Ribbon — HaloFire Studio command surface.
 *
 * Phase G redesign — the "engineer's drafting room meets mission
 * console" top band. Three design goals:
 *
 *   1. Never overflow. Three responsive tiers:
 *        ≥1440px   full text
 *        1024–1439 abbreviated labels
 *        <1024     icon-only with tooltips
 *   2. Read as a tool, not a web app. Plex Mono labels, zero radius,
 *      drafting hairlines, small-caps group tags on the right edge
 *      of each group.
 *   3. One surgical accent. #e8432d is reserved for the active tool
 *      indicator + the single primary CTA per tab (Auto-Design,
 *      Dimension, Calculate, NFPA 8-Report). Everything else is ink.
 *
 * No icon library — glyphs are inline SVG so the bundle stays tight
 * and the line-weight stays consistent with the drafting aesthetic.
 */

import { useCallback, useEffect, useState } from 'react'

export type RibbonCommand =
  | 'bid-new'
  | 'bid-load'
  | 'bid-save'
  | 'auto-design'
  // Phase B — tool activations.
  | 'tool-sprinkler'
  | 'tool-pipe'
  | 'tool-fitting'
  | 'tool-hanger'
  | 'tool-sway-brace'
  | 'tool-remote-area'
  | 'tool-move'
  | 'tool-resize'
  | 'tool-measure'
  | 'tool-section'
  | 'undo'
  | 'redo'
  | 'rules-run'
  | 'bom-recompute'
  | 'layer-heads'
  | 'layer-pipes'
  | 'layer-walls'
  | 'layer-zones'
  | 'snap-toggle'
  | 'measure'
  | 'section'
  | 'remote-area'
  | 'auto-dim-pipe-runs'
  | 'dimension'
  | 'text'
  | 'revision-cloud'
  | 'hydraulic-calc'
  | 'hydraulics-optimize'
  | 'hydraulics-auto-peak'
  | 'hydraulics-report'
  | 'node-tags-toggle'
  | 'rule-check'
  | 'stress-test'
  | 'report-proposal'
  | 'report-submittal'
  | 'report-export-dxf'
  | 'report-export-ifc'
  | 'report-nfpa-8'
  | 'report-approve-submit'
  | 'report-send-to-client'

type RibbonTab = 'design' | 'annotate' | 'analyze' | 'report'

interface Btn {
  cmd: RibbonCommand
  label: string
  /** Short label for 1024–1440 viewport tier. */
  abbr?: string
  hint?: string
  tone?: 'default' | 'accent' | 'danger'
  /** Optional glyph for <1024 tier. */
  glyph?: React.ReactNode
}

interface Group {
  label: string
  buttons: Btn[]
}

/**
 * Glyph primitives — 14×14, stroke-only, 1.5 weight. Consistent with
 * every CAD app you've ever seen. Use via `<svg>` wrapper below.
 */
const g = {
  sparkle: <><path d="M12 3v6" /><path d="M9 6h6" /><path d="M5 16l3 3" /><path d="M16 14l4 4" /><circle cx="12" cy="12" r="1.2" /></>,
  head: <><circle cx="12" cy="12" r="3.5" /><path d="M12 3v4M12 17v4M3 12h4M17 12h4" /></>,
  pipe: <><path d="M4 12h16" /><path d="M4 9v6M20 9v6" /><path d="M10 9v6M14 9v6" /></>,
  fitting: <><path d="M4 12h8v-8" /><path d="M12 12v8" /><circle cx="12" cy="12" r="1" /></>,
  hanger: <><path d="M4 4h16" /><path d="M12 4v10" /><path d="M8 14h8v4H8z" /></>,
  brace: <><path d="M4 4l16 16" /><path d="M4 20L20 4" /></>,
  move: <><path d="M12 3v18M3 12h18" /><path d="M8 7l4-4 4 4M8 17l4 4 4-4M7 8l-4 4 4 4M17 8l4 4-4 4" /></>,
  resize: <><path d="M4 4h6v6H4z" /><path d="M14 14h6v6h-6z" /><path d="M10 10l4 4" /></>,
  undo: <><path d="M9 14l-4-4 4-4" /><path d="M5 10h9a5 5 0 010 10h-3" /></>,
  redo: <><path d="M15 14l4-4-4-4" /><path d="M19 10h-9a5 5 0 000 10h3" /></>,
  measure: <><path d="M3 12h18" /><path d="M6 10v4M10 9v6M14 9v6M18 10v4" /></>,
  section: <><path d="M3 8h18M3 16h18" /><path d="M8 3l-3 5M16 21l3-5" /></>,
  snap: <><path d="M4 4l8 4 4 8-4 4-8-4-4-8z" /><circle cx="4" cy="4" r="1" /><circle cx="12" cy="8" r="1" /><circle cx="16" cy="16" r="1" /></>,
  dim: <><path d="M3 12h18" /><path d="M6 8v8M18 8v8" /><path d="M3 8l3 4-3 4M21 8l-3 4 3 4" /></>,
  text: <><path d="M6 6h12" /><path d="M12 6v12" /></>,
  cloud: <><path d="M6 14a3 3 0 013-3 4 4 0 017.5-1.5A3.5 3.5 0 0118 16H9a3 3 0 01-3-2z" /></>,
  calc: <><path d="M5 3h14v18H5z" /><path d="M8 7h8M8 11h3M13 11h3M8 15h3M13 15h3" /></>,
  optimize: <><path d="M4 20l6-12 4 6 6-10" /><circle cx="10" cy="8" r="1" /><circle cx="14" cy="14" r="1" /></>,
  peak: <><path d="M3 20l6-10 4 6 8-14" /></>,
  tag: <><path d="M3 10l7-7h8v8l-7 7-8-8z" /><circle cx="14" cy="10" r="1.5" /></>,
  report: <><path d="M5 3h11l4 4v14H5z" /><path d="M8 11h8M8 15h8M8 7h5" /></>,
  remote: <><path d="M4 6l4 2 4-4 6 3 2 7-5 4-6-2-5-3z" /></>,
  nfpa: <><circle cx="12" cy="12" r="9" /><path d="M12 3v18M3 12h18" /></>,
  stress: <><path d="M12 3l3 6 6 .9-4.5 4.4 1 6.7L12 17.8 6.5 21l1-6.7L3 9.9 9 9z" /></>,
  newBid: <><path d="M6 3h9l3 3v15H6z" /><path d="M15 3v3h3" /><path d="M10 12h4M12 10v4" /></>,
  loadBid: <><path d="M3 7h18v12H3z" /><path d="M3 7l3-4h5l2 3" /></>,
  saveBid: <><path d="M4 4h13l3 3v13H4z" /><path d="M7 4v6h8V4M7 20v-6h10v6" /></>,
  proposal: <><path d="M6 3h9l3 3v15H6z" /><path d="M9 10h6M9 14h6M9 18h4" /></>,
  submittal: <><path d="M3 8l9 5 9-5" /><path d="M3 8v10h18V8" /></>,
  dxf: <><path d="M5 5h14v14H5z" /><path d="M8 5v14M16 5v14M5 12h14" /></>,
  ifc: <><path d="M4 7l8-4 8 4-8 4z" /><path d="M4 7v8l8 4 8-4V7" /></>,
  approve: <><path d="M4 12l5 5L20 6" /></>,
  sendBid: <><path d="M3 12L21 3l-6 18-3-8z" /></>,
  autoDim: <><path d="M3 17h18" /><path d="M6 13v8M12 11v10M18 13v8" /><path d="M5 7l2-3h10l2 3" /></>,
}

const TABS: Record<RibbonTab, Group[]> = {
  design: [
    {
      label: 'Auto',
      buttons: [
        {
          cmd: 'auto-design',
          label: 'Auto-Design',
          abbr: 'Auto',
          hint: 'Run the full agent pipeline on the loaded architect set',
          tone: 'accent',
          glyph: g.sparkle,
        },
      ],
    },
    {
      label: 'Layers',
      buttons: [
        { cmd: 'layer-heads', label: 'Heads', abbr: 'Heads', glyph: g.head },
        { cmd: 'layer-pipes', label: 'Pipes', abbr: 'Pipes', glyph: g.pipe },
        { cmd: 'layer-walls', label: 'Walls', abbr: 'Walls', glyph: g.fitting },
        { cmd: 'layer-zones', label: 'Zones', abbr: 'Zones', glyph: g.remote },
      ],
    },
    {
      label: 'CAD',
      buttons: [
        { cmd: 'tool-sprinkler',  label: 'Sprinkler', abbr: 'Sprk', hint: 'Click to place a head at the snapped grid',   glyph: g.head },
        { cmd: 'tool-pipe',       label: 'Pipe',      abbr: 'Pipe', hint: 'Click start, click end',                       glyph: g.pipe },
        { cmd: 'tool-fitting',    label: 'Fitting',   abbr: 'Fit',  hint: 'Click to drop a fitting (default elbow_90)',   glyph: g.fitting },
        { cmd: 'tool-hanger',     label: 'Hanger',    abbr: 'Hang', hint: 'Click along a pipe',                           glyph: g.hanger },
        { cmd: 'tool-sway-brace', label: 'Sway brace',abbr: 'Sway', hint: 'Click along a pipe · Tab cycles direction',    glyph: g.brace },
      ],
    },
    {
      label: 'Edit',
      buttons: [
        { cmd: 'tool-move',   label: 'Move',   abbr: 'Move', hint: 'Drag selected head · PATCH on release',      glyph: g.move },
        { cmd: 'tool-resize', label: 'Resize', abbr: 'Size', hint: 'Pipe diameter · +/- cycles schedule',        glyph: g.resize },
        { cmd: 'undo',        label: 'Undo',   abbr: 'Undo', hint: 'Ctrl-Z',                                      glyph: g.undo },
        { cmd: 'redo',        label: 'Redo',   abbr: 'Redo', hint: 'Ctrl-Shift-Z',                                glyph: g.redo },
      ],
    },
    {
      label: 'Tools',
      buttons: [
        { cmd: 'tool-measure', label: 'Measure', abbr: 'Meas', hint: 'Two clicks, distance in m', glyph: g.measure },
        { cmd: 'tool-section', label: 'Section', abbr: 'Sect', hint: 'Drag a cutting plane',      glyph: g.section },
        { cmd: 'snap-toggle',  label: 'Snap',    abbr: 'Snap',                                     glyph: g.snap },
      ],
    },
  ],
  annotate: [
    {
      label: 'Dimensions',
      buttons: [
        {
          cmd: 'dimension',
          label: 'Dimension',
          abbr: 'Dim',
          hint: 'R8.2 · Click two points to place a linear dimension · D · Tab cycle · Esc cancel',
          tone: 'accent',
          glyph: g.dim,
        },
      ],
    },
    {
      label: 'Notes',
      buttons: [
        { cmd: 'text',           label: 'Text',           abbr: 'Text',  hint: 'R8.4 · Click anchor, type note · T',              glyph: g.text },
        { cmd: 'revision-cloud', label: 'Revision Cloud', abbr: 'Cloud', hint: 'R8.5 · Drag to outline a revision bubble',        glyph: g.cloud },
      ],
    },
  ],
  analyze: [
    {
      label: 'Auto',
      buttons: [
        { cmd: 'auto-dim-pipe-runs', label: 'Auto-Dim Pipes', abbr: 'Auto-Dim', hint: 'Generate continuous dimensions for every branch + cross-main', glyph: g.autoDim },
      ],
    },
    {
      label: 'Hydraulics',
      buttons: [
        { cmd: 'hydraulic-calc',       label: 'Calculate',        abbr: 'Calc', tone: 'accent', glyph: g.calc },
        { cmd: 'hydraulics-optimize',  label: 'System Optimizer', abbr: 'Opt',  hint: 'Iteratively upsize pipe schedules', glyph: g.optimize },
        { cmd: 'hydraulics-auto-peak', label: 'Auto Peak',        abbr: 'Peak', hint: 'Find the worst-case remote area',   glyph: g.peak },
        { cmd: 'node-tags-toggle',     label: 'Node Tags',        abbr: 'Tags', hint: 'Toggle pressure/flow/velocity labels on every head', glyph: g.tag },
        { cmd: 'hydraulics-report',    label: 'Hydraulic Report', abbr: 'Rpt',  hint: 'Open the NFPA 13 §27 8-section submittal PDF',       glyph: g.report },
        { cmd: 'remote-area',          label: 'Remote area',      abbr: 'Area', hint: 'Draw the flowing head window',       glyph: g.remote },
      ],
    },
    {
      label: 'Compliance',
      buttons: [
        { cmd: 'rule-check',    label: 'NFPA check',      abbr: 'NFPA', glyph: g.nfpa },
        { cmd: 'rules-run',     label: 'Run rules (live)',abbr: 'Rules',hint: 'POST /rules/run against current scene', glyph: g.nfpa },
        { cmd: 'bom-recompute', label: 'Recompute BOM',   abbr: 'BOM',  hint: 'POST /bom/recompute',                    glyph: g.calc },
        { cmd: 'stress-test',   label: 'Stress test',     abbr: 'Strs', glyph: g.stress },
      ],
    },
    {
      label: 'Tools',
      buttons: [
        { cmd: 'tool-remote-area', label: 'Remote area (polygon)', abbr: 'Poly', hint: 'Click vertices · double-click to close', glyph: g.remote },
      ],
    },
  ],
  report: [
    {
      label: 'Submittal',
      buttons: [
        { cmd: 'report-proposal', label: 'Proposal',       abbr: 'Prop', tone: 'accent', glyph: g.proposal },
        { cmd: 'report-nfpa-8',   label: 'NFPA 8-Report',  abbr: 'NFPA', hint: 'AHJ-grade NFPA 13 §27 + Annex E submittal', tone: 'accent', glyph: g.nfpa },
        { cmd: 'report-submittal',label: 'Submittal package', abbr: 'Pkg', glyph: g.submittal },
      ],
    },
    {
      label: 'Export',
      buttons: [
        { cmd: 'report-export-dxf', label: 'DXF', abbr: 'DXF', glyph: g.dxf },
        { cmd: 'report-export-ifc', label: 'IFC', abbr: 'IFC', glyph: g.ifc },
      ],
    },
    {
      label: 'Approve',
      buttons: [
        { cmd: 'report-approve-submit', label: 'Approve & Submit', abbr: 'Apprv', hint: 'Mark bid pe-reviewed, send to client + AHJ', tone: 'accent', glyph: g.approve },
        { cmd: 'report-send-to-client', label: 'Send bid',         abbr: 'Send',  hint: 'Deliver proposal.html + design.glb to the client portal', glyph: g.sendBid },
      ],
    },
  ],
}

export interface RibbonProps {
  onCommand?: (cmd: RibbonCommand) => void
  defaultTab?: RibbonTab
}

/** Viewport tier hook — clean SSR fallback to "full". */
type Tier = 'full' | 'abbr' | 'icon'
function useTier(): Tier {
  const [tier, setTier] = useState<Tier>('full')
  useEffect(() => {
    if (typeof window === 'undefined') return
    const resolve = () => {
      const w = window.innerWidth
      if (w >= 1440) setTier('full')
      else if (w >= 1024) setTier('abbr')
      else setTier('icon')
    }
    resolve()
    window.addEventListener('resize', resolve)
    return () => window.removeEventListener('resize', resolve)
  }, [])
  return tier
}

export function Ribbon({ onCommand, defaultTab = 'design' }: RibbonProps) {
  const [tab, setTab] = useState<RibbonTab>(defaultTab)
  const tier = useTier()

  const handleClick = useCallback(
    (cmd: RibbonCommand) => {
      onCommand?.(cmd)
    },
    [onCommand],
  )

  return (
    <div
      data-testid="halofire-ribbon"
      className="relative flex w-full flex-col bg-[var(--color-hf-bg)] text-[var(--color-hf-ink)] hf-rule-bottom"
    >
      {/* Top strip — wordmark, tabs, file shortcuts. */}
      <div className="flex items-center gap-1 px-4 pt-2.5 pb-1 border-b border-[var(--color-hf-edge)]">
        <Wordmark />
        <div className="mx-2 h-5 w-px bg-[var(--color-hf-edge)]" aria-hidden />
        <div className="flex items-center" role="tablist">
          {(['design', 'annotate', 'analyze', 'report'] as RibbonTab[]).map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={t === tab}
              data-testid={`ribbon-tab-${t}`}
              data-active={t === tab ? 'true' : 'false'}
              onClick={() => setTab(t)}
              className="hf-tab"
            >
              {t}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-1 pr-1">
          <RibbonIconButton label="New bid"  onClick={() => handleClick('bid-new')}  glyph={g.newBid} />
          <RibbonIconButton label="Load bid" onClick={() => handleClick('bid-load')} glyph={g.loadBid} />
          <RibbonIconButton label="Save bid" onClick={() => handleClick('bid-save')} glyph={g.saveBid} />
        </div>
      </div>

      {/* Active tab content. min-h-14, never overflows — horizontal
          scroll is the last resort and only appears on truly absurd
          <640px widths. */}
      <div className="flex min-h-[56px] items-stretch gap-0 overflow-x-auto px-2 py-1.5 hf-scroll">
        {TABS[tab].map((grp, idx) => (
          <div
            key={grp.label}
            className={
              'flex min-w-0 items-stretch gap-1.5 pl-2 pr-3 ' +
              (idx < TABS[tab].length - 1
                ? 'border-r border-[var(--color-hf-edge)]'
                : '')
            }
          >
            <div className="flex items-center gap-1">
              {grp.buttons.map((b) => (
                <RibbonButton
                  key={b.cmd}
                  btn={b}
                  tier={tier}
                  onClick={() => handleClick(b.cmd)}
                />
              ))}
            </div>
            <span
              className="self-stretch flex items-end pl-1 pb-0.5 hf-label select-none"
              aria-hidden
            >
              {grp.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function Wordmark() {
  return (
    <div className="flex items-baseline gap-2 pr-2 select-none">
      <span
        className="font-[var(--font-display)] italic text-[20px] leading-none tracking-tight text-[var(--color-hf-ink)]"
        style={{ fontFamily: 'var(--font-fraunces), serif', fontVariationSettings: '"SOFT" 30, "WONK" 1, "opsz" 144' }}
      >
        Halo Fire
      </span>
      <span
        aria-hidden
        className="h-1.5 w-1.5 translate-y-[-2px] bg-[var(--color-hf-accent)] hf-pulse"
      />
      <span className="hf-label hf-label-strong">Studio</span>
    </div>
  )
}

function RibbonButton({
  btn,
  tier,
  onClick,
}: {
  btn: Btn
  tier: Tier
  onClick: () => void
}) {
  const tone = btn.tone ?? 'default'
  const showLabel = tier !== 'icon'
  const labelText =
    tier === 'abbr' && btn.abbr ? btn.abbr : btn.label

  const base =
    'inline-flex shrink-0 items-center gap-1.5 border px-2.5 py-1.5 ' +
    'font-[var(--font-plex)] text-[11px] leading-none ' +
    'transition-[background,border-color,color] duration-150 ease-out'
  const palette =
    tone === 'accent'
      ? 'border-[rgba(232,67,45,0.55)] bg-[linear-gradient(180deg,rgba(232,67,45,0.18),rgba(232,67,45,0.06))] text-[#ffd7cd] hover:border-[rgba(232,67,45,0.85)] hover:text-white'
      : tone === 'danger'
        ? 'border-[rgba(154,60,60,0.5)] bg-[rgba(154,60,60,0.12)] text-[#e8b5b5] hover:bg-[rgba(154,60,60,0.22)] hover:text-white'
        : 'border-[var(--color-hf-edge)] bg-[var(--color-hf-surface)] text-[var(--color-hf-paper)] hover:border-[var(--color-hf-edge-strong)] hover:bg-[var(--color-hf-surface-2)]'
  return (
    <button
      type="button"
      title={btn.hint ?? btn.label}
      onClick={onClick}
      data-testid={`ribbon-btn-${btn.label.toLowerCase().replace(/\s+/g, '-')}`}
      style={{ borderRadius: 0 }}
      className={`${base} ${palette}`}
    >
      {btn.glyph && (
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
          className={tone === 'accent' ? 'opacity-95' : 'opacity-85'}
        >
          {btn.glyph}
        </svg>
      )}
      {showLabel && (
        <span
          className={
            'uppercase tracking-[0.08em] ' +
            (tier === 'abbr' ? 'text-[10.5px]' : 'text-[11px]')
          }
        >
          {labelText}
        </span>
      )}
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
      style={{ borderRadius: 0 }}
      className="flex h-7 w-7 items-center justify-center border border-[var(--color-hf-edge)] bg-[var(--color-hf-surface)] text-[var(--color-hf-ink-mute)] hover:border-[var(--color-hf-accent)]/50 hover:bg-[var(--color-hf-surface-2)] hover:text-[var(--color-hf-paper)] transition-colors"
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        {glyph}
      </svg>
    </button>
  )
}
