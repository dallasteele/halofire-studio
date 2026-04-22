'use client'

/**
 * Halofire Catalog browser panel.
 *
 * Shows the @halofire/catalog components grouped by category. Clicking
 * an entry selects it as the "active placement item" for the head placer
 * tool (wired in M1 week 4). For now this is a catalog-browsing view
 * that demonstrates the 20 authored components + their NFPA metadata.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { CATALOG, type LegacyCatalogEntry } from '@halofire/catalog'
import {
  type Catalog as HfCatalog,
  type CatalogPart as HfCatalogPart,
  loadCatalog,
} from '@halofire/core/catalog/load'
import { generateId, useScene } from '@pascal-app/core'

type Category = LegacyCatalogEntry['category']

const CATEGORY_GROUPS: { label: string; prefixes: string[] }[] = [
  { label: 'Sprinkler Heads', prefixes: ['sprinkler_head_'] },
  { label: 'Pipes', prefixes: ['pipe_'] },
  { label: 'Fittings', prefixes: ['fitting_'] },
  { label: 'Valves', prefixes: ['valve_'] },
  { label: 'Riser', prefixes: ['riser_'] },
  { label: 'Hangers', prefixes: ['hanger_'] },
  { label: 'External', prefixes: ['external_'] },
  { label: 'Signs', prefixes: ['sign_'] },
]

function matchesGroup(cat: Category, prefixes: string[]): boolean {
  return prefixes.some((p) => cat.startsWith(p))
}

export function CatalogPanel() {
  const [selectedSku, setSelectedSku] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    if (!query.trim()) return CATALOG
    const q = query.toLowerCase()
    return CATALOG.filter(
      (e) =>
        e.sku.toLowerCase().includes(q) ||
        e.name.toLowerCase().includes(q) ||
        e.manufacturer.toLowerCase().includes(q),
    )
  }, [query])

  const grouped = useMemo(() => {
    const out: { label: string; items: LegacyCatalogEntry[] }[] = []
    for (const group of CATEGORY_GROUPS) {
      const items = filtered.filter((e) => matchesGroup(e.category, group.prefixes))
      if (items.length > 0) out.push({ label: group.label, items })
    }
    return out
  }, [filtered])

  return (
    <div className="hf-scroll flex h-full flex-col gap-3 overflow-y-auto px-3 py-4">
      <header>
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
        <p className="mt-1.5 text-[11px] text-[var(--color-hf-ink-mute)]">
          <span className="hf-num text-[var(--color-hf-paper)]">
            {CATALOG.length}
          </span>{' '}
          authored parts · click a row to select for placement.
        </p>
      </header>

      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search SKU · name · manufacturer"
        style={{ borderRadius: 0 }}
        className="w-full border border-[var(--color-hf-edge)] bg-[var(--color-hf-bg)] px-2 py-1.5 font-[var(--font-plex)] text-[11px] text-[var(--color-hf-paper)] placeholder:text-[var(--color-hf-ink-dim)] focus:border-[var(--color-hf-accent)] focus:outline-none"
      />

      <div className="flex-1 overflow-y-auto hf-scroll">
        {grouped.length === 0 && (
          <p className="py-8 text-center text-[11px] text-[var(--color-hf-ink-dim)]">
            No matches.
          </p>
        )}
        {grouped.map((group) => (
          <div key={group.label} className="mb-4">
            <h3 className="pb-1.5 hf-label tracking-[0.22em]">
              {group.label} ·{' '}
              <span className="hf-num text-[var(--color-hf-ink-mute)]">
                {group.items.length}
              </span>
            </h3>
            <ul className="divide-y divide-[var(--color-hf-edge)] border-y border-[var(--color-hf-edge)]">
              {group.items.map((e) => {
                const active = selectedSku === e.sku
                return (
                  <li key={e.sku}>
                    <button
                      type="button"
                      onClick={() => setSelectedSku(e.sku)}
                      style={{ borderRadius: 0 }}
                      className={
                        'group flex w-full items-start gap-2.5 px-2 py-2 text-left transition-colors ' +
                        (active
                          ? 'bg-[rgba(232,67,45,0.12)] border-l-2 border-[var(--color-hf-accent)]'
                          : 'border-l-2 border-transparent hover:bg-white/[0.03] hover:border-[var(--color-hf-accent)]/40')
                      }
                    >
                      {/* Part kind glyph square */}
                      <span
                        aria-hidden
                        className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center border border-[var(--color-hf-edge)] bg-[var(--color-hf-bg)]"
                        style={{ borderRadius: 0 }}
                      >
                        <span
                          className="block h-2 w-2"
                          style={{
                            background: active
                              ? 'var(--color-hf-accent)'
                              : 'var(--color-hf-ink-deep)',
                          }}
                        />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[11.5px] font-medium text-[var(--color-hf-paper)]">
                          {e.name}
                        </div>
                        <div className="mt-0.5 flex items-center gap-2 text-[9.5px] text-[var(--color-hf-ink-dim)]">
                          <span className="hf-num text-[var(--color-hf-ink-mute)]">{e.sku}</span>
                          {e.k_factor !== undefined && (
                            <span className="hf-label">
                              K=<span className="hf-num normal-case text-[var(--color-hf-paper)]">{e.k_factor}</span>
                            </span>
                          )}
                          {e.pipe_size_in !== undefined && (
                            <span className="hf-num text-[var(--color-hf-paper)]">{e.pipe_size_in}"</span>
                          )}
                          <span className="hf-num">
                            {e.dims_cm[0]}×{e.dims_cm[1]}×{e.dims_cm[2]}
                            <span className="hf-label ml-0.5">cm</span>
                          </span>
                        </div>
                      </div>
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </div>

      {selectedSku && (
        <SelectedDetail entry={CATALOG.find((e) => e.sku === selectedSku)!} />
      )}

      <HfCatalogBrowser />
    </div>
  )
}

// ---------------------------------------------------------------------------
// New @halofire/core loadCatalog-backed browser (M1 week 4).
// Renders parts shipped in packages/halofire-catalog/catalog.json with
// kind-pill + search + manufacturer filters. Clicking a row dispatches
// a `halofire:catalog-select` CustomEvent carrying `{ sku }`.
// ---------------------------------------------------------------------------

const KIND_PILLS: { label: string; kind: string | 'all' }[] = [
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

function HfCatalogBrowser() {
  const [catalog, setCatalog] = useState<HfCatalog | null>(null)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [kindFilter, setKindFilter] = useState<string>('all')
  const [mfgFilter, setMfgFilter] = useState<string>('all')

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

  const manufacturers = useMemo(() => {
    if (!catalog) return []
    const s = new Set<string>()
    for (const p of catalog.parts) if (p.manufacturer) s.add(p.manufacturer)
    return ['all', ...Array.from(s).sort()]
  }, [catalog])

  const filtered = useMemo<HfCatalogPart[]>(() => {
    if (!catalog) return []
    const q = query.trim().toLowerCase()
    return catalog.parts.filter((p) => {
      if (kindFilter !== 'all' && p.kind !== kindFilter) return false
      if (mfgFilter !== 'all' && (p.manufacturer ?? '') !== mfgFilter) return false
      if (!q) return true
      return (
        p.sku.toLowerCase().includes(q) ||
        p.display_name.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q)
      )
    })
  }, [catalog, query, kindFilter, mfgFilter])

  const onSelect = useCallback((sku: string) => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('halofire:catalog-select', { detail: { sku } }),
      )
    }
  }, [])

  return (
    <section
      data-testid="hf-catalog-browser"
      className="mt-4 border-t border-[var(--color-hf-edge)] pt-3"
    >
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="hf-label tracking-[0.22em]">Parts Catalog</h3>
        <span className="hf-num text-[10px] text-[var(--color-hf-ink-dim)]">
          {catalog
            ? `${catalog.parts.length} · v${catalog.catalog_version}`
            : '…'}
        </span>
      </div>

      {loadErr && (
        <p className="mb-2 text-[11px] text-[var(--color-hf-brick)]">
          Failed to load catalog: {loadErr}
        </p>
      )}

      <input
        data-testid="hf-catalog-search"
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search parts"
        style={{ borderRadius: 0 }}
        className="mb-2 w-full border border-[var(--color-hf-edge)] bg-[var(--color-hf-bg)] px-2 py-1.5 text-[11px] text-[var(--color-hf-paper)] placeholder:text-[var(--color-hf-ink-dim)] focus:border-[var(--color-hf-accent)] focus:outline-none"
      />

      <div
        data-testid="hf-catalog-kind-pills"
        className="mb-2 flex flex-wrap gap-1"
      >
        {KIND_PILLS.map((p) => {
          const active = kindFilter === p.kind
          return (
            <button
              key={p.kind}
              type="button"
              onClick={() => setKindFilter(p.kind)}
              data-testid={`hf-kind-pill-${p.kind}`}
              style={{ borderRadius: 0 }}
              className={
                'border px-2 py-0.5 text-[10px] uppercase tracking-[0.1em] transition-colors ' +
                (active
                  ? 'border-[var(--color-hf-accent)] bg-[rgba(232,67,45,0.18)] text-[var(--color-hf-paper)]'
                  : 'border-[var(--color-hf-edge)] text-[var(--color-hf-ink-mute)] hover:border-[var(--color-hf-edge-strong)] hover:text-[var(--color-hf-paper)]')
              }
            >
              {p.label}
            </button>
          )
        })}
      </div>

      {manufacturers.length > 1 && (
        <select
          data-testid="hf-catalog-mfg-filter"
          value={mfgFilter}
          onChange={(e) => setMfgFilter(e.target.value)}
          style={{ borderRadius: 0 }}
          className="mb-2 w-full border border-[var(--color-hf-edge)] bg-[var(--color-hf-bg)] px-2 py-1.5 text-[11px] text-[var(--color-hf-paper)]"
        >
          {manufacturers.map((m) => (
            <option key={m} value={m}>
              {m === 'all' ? 'All manufacturers' : m}
            </option>
          ))}
        </select>
      )}

      <ul
        className="max-h-72 divide-y divide-[var(--color-hf-edge)] overflow-y-auto border border-[var(--color-hf-edge)] hf-scroll"
        data-testid="hf-catalog-list"
      >
        {filtered.length === 0 && catalog && (
          <li className="py-6 text-center text-[11px] text-[var(--color-hf-ink-dim)]">
            No matching parts.
          </li>
        )}
        {filtered.map((p) => (
          <li key={p.sku}>
            <button
              type="button"
              onClick={() => onSelect(p.sku)}
              data-testid={`hf-catalog-row-${p.sku}`}
              style={{ borderRadius: 0 }}
              className="w-full px-2 py-1.5 text-left text-[11px] text-[var(--color-hf-paper)] transition-colors hover:bg-white/[0.03] hover:border-l-2 hover:border-[var(--color-hf-accent)]"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-medium">{p.display_name}</span>
                {typeof p.price_usd === 'number' && (
                  <span className="shrink-0 hf-num text-[10px] text-[var(--color-hf-gold)]">
                    ${p.price_usd.toFixed(2)}
                  </span>
                )}
              </div>
              <div className="mt-0.5 flex items-center gap-1.5 text-[9.5px] text-[var(--color-hf-ink-dim)]">
                <span className="hf-num">{p.sku}</span>
                <span
                  className="border border-[var(--color-hf-edge)] px-1 py-[1px] uppercase tracking-wide text-[var(--color-hf-ink-mute)]"
                  style={{ borderRadius: 0 }}
                >
                  {p.kind}
                </span>
                {p.manufacturer && (
                  <span
                    className="border border-[rgba(200,154,60,0.35)] bg-[rgba(200,154,60,0.08)] px-1 py-[1px] text-[var(--color-hf-gold)]"
                    style={{ borderRadius: 0 }}
                  >
                    {p.manufacturer}
                  </span>
                )}
              </div>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

function SelectedDetail({ entry }: { entry: LegacyCatalogEntry }) {
  return (
    <div
      className="hf-card p-3"
      style={{
        borderRadius: 0,
        boxShadow: 'inset 0 1px 0 0 rgba(232,67,45,0.45)',
      }}
    >
      <div className="hf-label pb-1 tracking-[0.22em]">Selected</div>
      <div
        className="mb-2 text-[13px] font-medium text-[var(--color-hf-paper)]"
        style={{
          fontFamily: 'var(--font-fraunces), serif',
          fontVariationSettings: '"SOFT" 30, "WONK" 0, "opsz" 144',
        }}
      >
        {entry.name}
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[10.5px]">
        <DtDd k="SKU" v={<span className="hf-num">{entry.sku}</span>} />
        <DtDd
          k="Mfr"
          v={`${entry.manufacturer} ${entry.model}`}
        />
        <DtDd k="Mount" v={entry.mounting} />
        <DtDd k="Conn" v={entry.connection ?? '—'} />
        <DtDd k="Finish" v={entry.finish ?? '—'} />
        {entry.k_factor !== undefined && (
          <DtDd k="K-factor" v={<span className="hf-num">{entry.k_factor}</span>} />
        )}
        {entry.temp_rating_f !== undefined && (
          <DtDd
            k="Temp"
            v={<span className="hf-num">{entry.temp_rating_f}°F</span>}
          />
        )}
        {entry.pipe_size_in !== undefined && (
          <DtDd
            k="Pipe size"
            v={<span className="hf-num">{entry.pipe_size_in}&quot;</span>}
          />
        )}
      </dl>
      {entry.notes && (
        <p className="mt-2 border-t border-[var(--color-hf-edge)] pt-2 text-[10px] leading-relaxed text-[var(--color-hf-ink-mute)]">
          {entry.notes}
        </p>
      )}
      <PlaceButton entry={entry} />
    </div>
  )
}

function DtDd({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <>
      <dt className="hf-label">{k}</dt>
      <dd className="text-[var(--color-hf-paper)]">{v}</dd>
    </>
  )
}

function PlaceButton({ entry }: { entry: LegacyCatalogEntry }) {
  const createNode = useScene((s) => s.createNode)
  const rootNodeIds = useScene((s) => s.rootNodeIds)
  const [status, setStatus] = useState<string | null>(null)
  const [xStr, setXStr] = useState('0')
  const [yStr, setYStr] = useState('0')
  const [zStr, setZStr] = useState('0')

  const onPlace = useCallback(() => {
    // Build an ItemNode referencing the catalog entry's GLB.
    const [w, d, h] = entry.dims_cm
    // Pascal uses meters; convert cm -> m (divide by 100)
    const dimsMeters: [number, number, number] = [w / 100, h / 100, d / 100]

    // Determine attachment: ceiling_pendent / ceiling_upright / ceiling_flush
    // -> attachTo 'ceiling'; wall_mount -> 'wall'; everything else -> 'floor'.
    const attachTo: 'floor' | 'ceiling' | 'wall' =
      entry.mounting.startsWith('ceiling') ? 'ceiling'
      : entry.mounting === 'wall_mount' ? 'wall'
      : 'floor'

    // User-input coords in cm → convert to meters for Pascal
    const px = (Number(xStr) || 0) / 100
    const py = (Number(yStr) || 0) / 100
    const pz = (Number(zStr) || 0) / 100

    const id = generateId('item') as `item_${string}`
    const node = {
      id,
      type: 'item' as const,
      position: [px, py, pz] as [number, number, number],
      rotation: [0, 0, 0] as [number, number, number],
      scale: [1, 1, 1] as [number, number, number],
      children: [],
      asset: {
        category: entry.category,
        dimensions: dimsMeters,
        src: `/halofire-catalog/glb/${entry.sku}.glb`,
        attachTo,
        offset: [0, 0, 0] as [number, number, number],
        rotation: [0, 0, 0] as [number, number, number],
        scale: [1, 1, 1] as [number, number, number],
        tags: ['halofire', entry.category],
      },
    }

    try {
      // Pascal's store accepts any parent id; if no scene exists, fall back to
      // top-level (will show under Scene sidebar).
      const parentId = rootNodeIds?.[0]
      // @ts-expect-error - ItemNode schema is strict; runtime accepts the shape
      createNode(node, parentId)
      setStatus(`Placed ${entry.sku} @ (${px.toFixed(2)}, ${py.toFixed(2)}, ${pz.toFixed(2)}) m`)
    } catch (e) {
      setStatus(`Failed: ${String(e)}`)
    }
  }, [entry, createNode, rootNodeIds, xStr, yStr, zStr])

  return (
    <>
      <div className="mt-3 grid grid-cols-3 gap-1.5">
        {(['X', 'Y', 'Z'] as const).map((axis, i) => {
          const [val, setter] =
            axis === 'X' ? [xStr, setXStr] : axis === 'Y' ? [yStr, setYStr] : [zStr, setZStr]
          return (
            <label key={axis} className="flex flex-col gap-0.5">
              <span className="hf-label">
                {axis} <span className="text-[var(--color-hf-ink-deep)]">cm</span>
              </span>
              <input
                type="number"
                value={val}
                onChange={(e) => setter(e.target.value)}
                style={{ borderRadius: 0 }}
                className="w-full border border-[var(--color-hf-edge)] bg-[var(--color-hf-bg)] px-1.5 py-0.5 hf-num text-[11px] text-[var(--color-hf-paper)] focus:border-[var(--color-hf-accent)] focus:outline-none"
              />
            </label>
          )
        })}
      </div>
      <button
        type="button"
        onClick={onPlace}
        style={{ borderRadius: 0 }}
        className="mt-2.5 w-full border border-[rgba(232,67,45,0.6)] bg-[linear-gradient(180deg,rgba(232,67,45,0.2),rgba(232,67,45,0.06))] px-2 py-1.5 text-[10.5px] font-medium uppercase tracking-[0.14em] text-[var(--color-hf-paper)] hover:border-[var(--color-hf-accent)] hover:bg-[rgba(232,67,45,0.28)]"
      >
        Place at coordinates
      </button>
      {status && (
        <p
          className="mt-1.5 text-[10px] font-[var(--font-plex)]"
          style={{
            color: status.startsWith('Failed')
              ? 'var(--color-hf-brick)'
              : 'var(--color-hf-moss)',
          }}
        >
          {status}
        </p>
      )}
    </>
  )
}
