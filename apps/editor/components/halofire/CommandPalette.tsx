'use client'

/**
 * CommandPalette — AutoCAD-class quick-access overlay (Ctrl+K or
 * Ctrl+Shift+P). Lists every RibbonCommand plus a "Go to tab"
 * section for each sidebar tab. Fuzzy-filtered by typed query.
 *
 * Dispatches the same `halofire:ribbon` CustomEvent the Ribbon does,
 * so every subscriber reacts identically regardless of origin.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { RibbonCommand } from './Ribbon'

interface Entry {
  id: string
  label: string
  group: string
  cmd?: RibbonCommand
  goTab?: string          // sidebar tab id to switch to
  hint?: string
  keywords?: string[]
}

const DEFAULT_ENTRIES: Entry[] = [
  // Design
  { id: 'cmd.auto-design',   label: 'Run Auto-Design',        group: 'Design',  cmd: 'auto-design', hint: 'Full pipeline', keywords: ['pipeline', 'bid', 'generate'] },
  { id: 'cmd.layer-heads',   label: 'Toggle Heads layer',     group: 'Design',  cmd: 'layer-heads' },
  { id: 'cmd.layer-pipes',   label: 'Toggle Pipes layer',     group: 'Design',  cmd: 'layer-pipes' },
  { id: 'cmd.layer-walls',   label: 'Toggle Walls layer',     group: 'Design',  cmd: 'layer-walls' },
  { id: 'cmd.layer-zones',   label: 'Toggle Zones layer',     group: 'Design',  cmd: 'layer-zones' },
  { id: 'cmd.measure',       label: 'Measure tool',           group: 'Design',  cmd: 'measure', keywords: ['ruler', 'distance'] },
  { id: 'cmd.section',       label: 'Section tool',           group: 'Design',  cmd: 'section', keywords: ['cut'] },
  { id: 'cmd.snap',          label: 'Toggle snap',            group: 'Design',  cmd: 'snap-toggle' },
  // Analyze
  { id: 'cmd.hydraulic',     label: 'Hydraulic calculate',    group: 'Analyze', cmd: 'hydraulic-calc', hint: 'Run NFPA solver' },
  { id: 'cmd.remote-area',   label: 'Remote area',            group: 'Analyze', cmd: 'remote-area', hint: 'Click-drag to pick flowing heads', keywords: ['boundary', 'design area'] },
  { id: 'cmd.nfpa',          label: 'NFPA rule check',        group: 'Analyze', cmd: 'rule-check', keywords: ['compliance', 'violations'] },
  { id: 'cmd.stress',        label: 'Stress test',            group: 'Analyze', cmd: 'stress-test' },
  // Report
  { id: 'cmd.proposal',      label: 'Generate proposal',      group: 'Report',  cmd: 'report-proposal' },
  { id: 'cmd.submittal',     label: 'Generate submittal',     group: 'Report',  cmd: 'report-submittal' },
  { id: 'cmd.dxf',           label: 'Export DXF',             group: 'Report',  cmd: 'report-export-dxf' },
  { id: 'cmd.ifc',           label: 'Export IFC',             group: 'Report',  cmd: 'report-export-ifc' },
  { id: 'cmd.send',          label: 'Send bid to client',     group: 'Report',  cmd: 'report-send-to-client', hint: 'Opens proposal.html', keywords: ['deliver', 'portal'] },
  // File
  { id: 'cmd.new',           label: 'New bid',                group: 'File',    cmd: 'bid-new' },
  { id: 'cmd.load',          label: 'Load bid',               group: 'File',    cmd: 'bid-load' },
  { id: 'cmd.save',          label: 'Save bid',               group: 'File',    cmd: 'bid-save' },
  // Navigation
  { id: 'go.auto',           label: 'Go to Auto-Design panel', group: 'Go to', goTab: 'halofire-auto' },
  { id: 'go.project',        label: 'Go to Project brief',    group: 'Go to',  goTab: 'halofire-project' },
  { id: 'go.catalog',        label: 'Go to Catalog',          group: 'Go to',  goTab: 'halofire-catalog' },
  { id: 'go.fp',             label: 'Go to Manual FP',        group: 'Go to',  goTab: 'halofire-fp' },
]

export function rankEntries(entries: Entry[], query: string): Entry[] {
  const q = query.trim().toLowerCase()
  if (!q) return entries
  const tokens = q.split(/\s+/).filter(Boolean)
  const score = (e: Entry): number => {
    const hay = [
      e.label,
      e.group,
      e.hint ?? '',
      ...(e.keywords ?? []),
    ].join(' ').toLowerCase()
    let s = 0
    for (const t of tokens) {
      const idx = hay.indexOf(t)
      if (idx < 0) return -1
      s += idx === 0 ? 5 : 2 + (1 / (idx + 1))
    }
    if (e.label.toLowerCase().startsWith(q)) s += 10
    return s
  }
  return entries
    .map((e) => [e, score(e)] as const)
    .filter(([, s]) => s >= 0)
    .sort((a, b) => b[1] - a[1])
    .map(([e]) => e)
}

export interface CommandPaletteProps {
  entries?: Entry[]
}

export function CommandPalette({ entries = DEFAULT_ENTRIES }: CommandPaletteProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const inputRef = useRef<HTMLInputElement | null>(null)

  // Global hotkey: Ctrl+K or Ctrl+Shift+P
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const cmd = e.ctrlKey || e.metaKey
      if (cmd && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault()
        setOpen((v) => !v)
      } else if (cmd && e.shiftKey && (e.key === 'P' || e.key === 'p')) {
        e.preventDefault()
        setOpen((v) => !v)
      } else if (open && e.key === 'Escape') {
        e.preventDefault()
        setOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  useEffect(() => {
    if (open) {
      setQuery('')
      setCursor(0)
      // Focus after render
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [open])

  const ranked = useMemo(() => rankEntries(entries, query), [entries, query])

  const fire = useCallback((entry: Entry) => {
    setOpen(false)
    if (entry.cmd && typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('halofire:ribbon', { detail: { cmd: entry.cmd } }),
      )
    }
    if (entry.goTab && typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('halofire:goto-tab', { detail: { tab: entry.goTab } }),
      )
    }
  }, [])

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setCursor((c) => Math.min(c + 1, Math.max(0, ranked.length - 1)))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setCursor((c) => Math.max(0, c - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const entry = ranked[cursor]
      if (entry) fire(entry)
    }
  }

  if (!open) return null

  return (
    <div
      data-testid="halofire-command-palette"
      className="fixed inset-0 z-[9999] flex items-start justify-center bg-black/60 pt-[16vh] backdrop-blur-sm"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-[min(640px,92vw)] overflow-hidden rounded-md border border-white/15 bg-[#0f0f14] text-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Command palette"
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => { setQuery(e.target.value); setCursor(0) }}
          onKeyDown={onKeyDown}
          placeholder="Type a command or search…"
          className="w-full border-b border-white/10 bg-transparent px-4 py-3 text-sm outline-none placeholder:text-neutral-500"
        />
        <div className="max-h-[56vh] overflow-auto">
          {ranked.length === 0 && (
            <div className="px-4 py-6 text-center text-xs text-neutral-500">
              No commands match "{query}"
            </div>
          )}
          {ranked.map((e, i) => (
            <button
              key={e.id}
              type="button"
              data-testid={`palette-entry-${e.id}`}
              onMouseEnter={() => setCursor(i)}
              onClick={() => fire(e)}
              className={
                'flex w-full items-center justify-between gap-3 px-4 py-2 text-left text-sm transition-colors ' +
                (i === cursor
                  ? 'bg-[#e8432d]/20 text-white'
                  : 'text-neutral-200 hover:bg-neutral-900')
              }
            >
              <span className="truncate">
                <span className="text-[10px] uppercase tracking-[0.1em] text-neutral-500">
                  {e.group}
                </span>
                <span className="ml-3">{e.label}</span>
              </span>
              {e.hint && (
                <span className="shrink-0 text-xs text-neutral-500">
                  {e.hint}
                </span>
              )}
            </button>
          ))}
        </div>
        <div className="flex items-center justify-between border-t border-white/10 bg-black/30 px-4 py-1.5 text-[10px] uppercase tracking-[0.1em] text-neutral-500">
          <span>↑↓ navigate · Enter select · Esc close</span>
          <span>Ctrl+K</span>
        </div>
      </div>
    </div>
  )
}

export { DEFAULT_ENTRIES, type Entry }
