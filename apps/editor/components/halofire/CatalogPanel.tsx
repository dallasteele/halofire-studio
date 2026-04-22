'use client'

/**
 * Halofire Catalog panel — Phase H.4 surface.
 *
 * Grid layout:
 *   ┌──────────┬─────────────────────────────────┐
 *   │ filter   │ thumbnail grid (responsive)     │
 *   │ rail     │                                 │
 *   │          │                                 │
 *   └──────────┴─────────────────────────────────┘
 *
 * Click a card → opens `<CatalogDetailPanel>` slide-over on the right.
 * Each card surfaces its enrichment state (validated / needs_review /
 * rejected / fallback / not_yet_run) via the earthen status chip.
 *
 * Data: catalog.json (204 parts) + enriched.json via `useCatalogStore`.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  type Catalog as HfCatalog,
  type CatalogPart as HfCatalogPart,
  loadCatalog,
} from '@halofire/core/catalog/load'
import { CatalogCard } from './CatalogCard'
import { CatalogDetailPanel } from './CatalogDetailPanel'
import {
  connectCatalogSSE,
  ensureEnrichedLoaded,
  useEnrichedSnapshot,
} from '../../lib/halofire/catalog-store'

// ── Filter taxonomy ─────────────────────────────────────────────────

interface KindFilter {
  label: string
  kind: string | 'all'
}

const KIND_FILTERS: KindFilter[] = [
  { label: 'All', kind: 'all' },
  { label: 'Heads', kind: 'sprinkler_head' },
  { label: 'Pipes', kind: 'pipe_segment' },
  { label: 'Fittings', kind: 'fitting' },
  { label: 'Valves', kind: 'valve' },
  { label: 'Hangers', kind: 'hanger' },
  { label: 'Devices', kind: 'device' },
  { label: 'FDC', kind: 'fdc' },
  { label: 'Structural', kind: 'structural' },
]

type CategoryBucket = string // subcategory like "trim.main.drain" → "Trim · main · drain"

function prettyCategory(c: string | undefined): string {
  if (!c) return '—'
  return c
    .split('.')
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' '))
    .join(' · ')
}

// ── Panel ───────────────────────────────────────────────────────────

export function CatalogPanel() {
  const [catalog, setCatalog] = useState<HfCatalog | null>(null)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<string>('all')
  const [mfg, setMfg] = useState<string>('all')
  const [subType, setSubType] = useState<string>('all')
  const [selectedSku, setSelectedSku] = useState<string | null>(null)

  // Enriched map — just subscribe so re-renders occur when SSE updates.
  useEnrichedSnapshot()

  // One-time catalog fetch.
  useEffect(() => {
    let cancelled = false
    loadCatalog()
      .then((c) => {
        if (!cancelled) setCatalog(c)
      })
      .catch((e) => {
        if (!cancelled) setLoadErr(String(e))
      })
    return () => {
      cancelled = true
    }
  }, [])

  // One-time enriched.json fetch + SSE subscription.
  useEffect(() => {
    ensureEnrichedLoaded()
    return connectCatalogSSE()
  }, [])

  const manufacturers = useMemo(() => {
    if (!catalog) return ['all']
    const s = new Set<string>()
    for (const p of catalog.parts) if (p.manufacturer) s.add(p.manufacturer)
    return ['all', ...Array.from(s).sort()]
  }, [catalog])

  const subTypes = useMemo<CategoryBucket[]>(() => {
    if (!catalog) return ['all']
    const s = new Set<string>()
    for (const p of catalog.parts) {
      if (kind !== 'all' && p.kind !== kind) continue
      if (p.category) s.add(p.category)
    }
    return ['all', ...Array.from(s).sort()]
  }, [catalog, kind])

  const filtered = useMemo<HfCatalogPart[]>(() => {
    if (!catalog) return []
    const q = query.trim().toLowerCase()
    return catalog.parts.filter((p) => {
      if (kind !== 'all' && p.kind !== kind) return false
      if (mfg !== 'all' && (p.manufacturer ?? '') !== mfg) return false
      if (subType !== 'all' && p.category !== subType) return false
      if (!q) return true
      return (
        p.sku.toLowerCase().includes(q) ||
        p.display_name.toLowerCase().includes(q) ||
        (p.manufacturer ?? '').toLowerCase().includes(q) ||
        (p.mfg_part_number ?? '').toLowerCase().includes(q)
      )
    })
  }, [catalog, query, kind, mfg, subType])

  const onOpenCard = useCallback((sku: string) => {
    setSelectedSku(sku)
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('halofire:catalog-select', { detail: { sku } }),
      )
    }
  }, [])

  const selectedPart = useMemo<HfCatalogPart | null>(() => {
    if (!catalog || !selectedSku) return null
    return catalog.parts.find((p) => p.sku === selectedSku) ?? null
  }, [catalog, selectedSku])

  return (
    <div
      className="hf-scroll flex h-full flex-col overflow-hidden"
      data-testid="hf-catalog-panel"
    >
      {/* Header */}
      <header className="px-3 pb-2 pt-4">
        <div className="hf-label tracking-[0.24em] pb-1">Library</div>
        <h2
          className="text-[22px] leading-none tracking-tight text-[var(--color-hf-paper)]"
          style={{
            fontFamily: 'var(--font-fraunces), serif',
            fontVariationSettings: '"SOFT" 30, "WONK" 0, "opsz" 144',
          }}
        >
          Components
        </h2>
        <p className="mt-1.5 text-[10.5px] text-[var(--color-hf-ink-mute)]">
          {catalog ? (
            <>
              <span className="hf-num text-[var(--color-hf-paper)]">
                {catalog.parts.length}
              </span>{' '}
              parts · v{catalog.catalog_version} · click a card for detail.
            </>
          ) : (
            'Loading catalog…'
          )}
        </p>
        {loadErr && (
          <p className="mt-1 text-[10px] text-[var(--color-hf-brick)]">
            Catalog failed to load: {loadErr}
          </p>
        )}
      </header>

      {/* Search */}
      <div className="px-3 pb-2">
        <input
          type="text"
          data-testid="hf-catalog-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search SKU · name · manufacturer · part #"
          style={{ borderRadius: 0 }}
          className="w-full border border-[var(--color-hf-edge)] bg-[var(--color-hf-bg)] px-2 py-1.5 font-[var(--font-plex)] text-[11px] text-[var(--color-hf-paper)] placeholder:text-[var(--color-hf-ink-dim)] focus:border-[var(--color-hf-accent)] focus:outline-none"
        />
      </div>

      {/* Grid layout: filter rail + thumbnail grid */}
      <div className="grid min-h-0 flex-1 grid-cols-[140px_minmax(0,1fr)] gap-3 px-3 pb-3">
        {/* Filter rail */}
        <aside
          data-testid="hf-catalog-filter-rail"
          className="hf-scroll flex flex-col gap-3 overflow-y-auto border-r border-[var(--color-hf-edge)] pr-2"
        >
          <FilterGroup
            title="Kind"
            options={KIND_FILTERS.map((k) => ({ id: k.kind, label: k.label }))}
            value={kind}
            onChange={(v) => {
              setKind(v)
              setSubType('all')
            }}
          />
          <FilterGroup
            title="Manufacturer"
            options={manufacturers.map((m) => ({
              id: m,
              label: m === 'all' ? 'All' : m.replace(/_/g, ' '),
            }))}
            value={mfg}
            onChange={setMfg}
          />
          <FilterGroup
            title="Sub-type"
            options={subTypes.map((s) => ({
              id: s,
              label: s === 'all' ? 'All' : prettyCategory(s),
            }))}
            value={subType}
            onChange={setSubType}
          />
        </aside>

        {/* Thumbnail grid */}
        <div
          className="hf-scroll overflow-y-auto"
          data-testid="hf-catalog-grid"
        >
          {catalog && filtered.length === 0 && (
            <p className="py-8 text-center text-[11px] text-[var(--color-hf-ink-dim)]">
              No parts match these filters.
            </p>
          )}
          <div
            className={
              'grid gap-2 ' +
              // 3 cols ≥1440, 2 cols 1024-1439, 1 col <1024 (Tailwind
              // breakpoints: md=768, lg=1024, xl=1280, 2xl=1536). We
              // use container-neutral Tailwind breakpoints because
              // this panel is a sidebar — the viewport width already
              // contracts the available space.
              'grid-cols-1 sm:grid-cols-1 md:grid-cols-1 lg:grid-cols-2 2xl:grid-cols-2 [@media(min-width:1700px)]:grid-cols-3'
            }
          >
            {filtered.map((p) => (
              <CatalogCard
                key={p.sku}
                part={p}
                selected={selectedSku === p.sku}
                onOpen={onOpenCard}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Slide-over detail */}
      {selectedPart && (
        <CatalogDetailPanel
          part={selectedPart}
          onClose={() => setSelectedSku(null)}
        />
      )}
    </div>
  )
}

// ── Filter group (radio-style pills) ────────────────────────────────

interface FilterGroupProps {
  title: string
  options: Array<{ id: string; label: string }>
  value: string
  onChange: (id: string) => void
}

function FilterGroup({ title, options, value, onChange }: FilterGroupProps) {
  return (
    <div>
      <div className="hf-label pb-1 tracking-[0.22em]">{title}</div>
      <ul className="flex flex-col gap-0.5">
        {options.map((o) => {
          const active = value === o.id
          return (
            <li key={o.id}>
              <button
                type="button"
                onClick={() => onChange(o.id)}
                data-testid={`hf-filter-${title.toLowerCase()}-${o.id}`}
                style={{ borderRadius: 0 }}
                className={
                  'w-full truncate border-l-2 px-1.5 py-0.5 text-left text-[10.5px] transition-colors ' +
                  (active
                    ? 'border-[var(--color-hf-accent)] bg-[rgba(232,67,45,0.08)] text-[var(--color-hf-paper)]'
                    : 'border-transparent text-[var(--color-hf-ink-mute)] hover:border-[var(--color-hf-accent)]/40 hover:text-[var(--color-hf-paper)]')
                }
              >
                {o.label}
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
