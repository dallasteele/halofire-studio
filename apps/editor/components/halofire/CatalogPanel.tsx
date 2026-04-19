'use client'

/**
 * Halofire Catalog browser panel.
 *
 * Shows the @halofire/catalog components grouped by category. Clicking
 * an entry selects it as the "active placement item" for the head placer
 * tool (wired in M1 week 4). For now this is a catalog-browsing view
 * that demonstrates the 20 authored components + their NFPA metadata.
 */

import { useMemo, useState } from 'react'
import { CATALOG, type CatalogEntry } from '@halofire/catalog'

type Category = CatalogEntry['category']

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
    const out: { label: string; items: CatalogEntry[] }[] = []
    for (const group of CATEGORY_GROUPS) {
      const items = filtered.filter((e) => matchesGroup(e.category, group.prefixes))
      if (items.length > 0) out.push({ label: group.label, items })
    }
    return out
  }, [filtered])

  return (
    <div className="flex h-full flex-col gap-3 p-3 text-sm">
      <div>
        <h2 className="mb-2 text-base font-semibold">Component Catalog</h2>
        <p className="text-xs text-neutral-500">
          {CATALOG.length} components authored. Click to select for placement.
        </p>
      </div>

      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search SKU, name, manufacturer…"
        className="w-full rounded border border-neutral-300 bg-neutral-50 px-2 py-1 text-xs outline-none focus:border-neutral-500 dark:border-neutral-700 dark:bg-neutral-900"
      />

      <div className="flex-1 overflow-y-auto">
        {grouped.length === 0 && (
          <p className="py-8 text-center text-xs text-neutral-500">No matches.</p>
        )}
        {grouped.map((group) => (
          <div key={group.label} className="mb-4">
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">
              {group.label}
            </h3>
            <ul className="space-y-0.5">
              {group.items.map((e) => (
                <li key={e.sku}>
                  <button
                    type="button"
                    onClick={() => setSelectedSku(e.sku)}
                    className={`w-full rounded px-2 py-1.5 text-left text-xs transition-colors ${
                      selectedSku === e.sku
                        ? 'bg-blue-600 text-white'
                        : 'hover:bg-neutral-100 dark:hover:bg-neutral-800'
                    }`}
                  >
                    <div className="font-medium">{e.name}</div>
                    <div className="mt-0.5 flex items-center gap-2 text-[10px] opacity-75">
                      <span className="font-mono">{e.sku}</span>
                      {e.k_factor !== undefined && <span>K={e.k_factor}</span>}
                      {e.pipe_size_in !== undefined && (
                        <span>{e.pipe_size_in}&quot;</span>
                      )}
                      <span>
                        {e.dims_cm[0]}×{e.dims_cm[1]}×{e.dims_cm[2]}cm
                      </span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {selectedSku && (
        <SelectedDetail entry={CATALOG.find((e) => e.sku === selectedSku)!} />
      )}
    </div>
  )
}

function SelectedDetail({ entry }: { entry: CatalogEntry }) {
  return (
    <div className="rounded border border-neutral-300 bg-neutral-50 p-2 text-xs dark:border-neutral-700 dark:bg-neutral-900">
      <div className="mb-1 font-semibold">{entry.name}</div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-[11px]">
        <dt className="text-neutral-500">SKU</dt>
        <dd className="font-mono">{entry.sku}</dd>
        <dt className="text-neutral-500">Manufacturer</dt>
        <dd>
          {entry.manufacturer} {entry.model}
        </dd>
        <dt className="text-neutral-500">Mounting</dt>
        <dd>{entry.mounting}</dd>
        <dt className="text-neutral-500">Connection</dt>
        <dd>{entry.connection ?? '—'}</dd>
        <dt className="text-neutral-500">Finish</dt>
        <dd>{entry.finish ?? '—'}</dd>
        {entry.k_factor !== undefined && (
          <>
            <dt className="text-neutral-500">K-factor</dt>
            <dd>{entry.k_factor}</dd>
          </>
        )}
        {entry.temp_rating_f !== undefined && (
          <>
            <dt className="text-neutral-500">Temp</dt>
            <dd>{entry.temp_rating_f}°F</dd>
          </>
        )}
        {entry.pipe_size_in !== undefined && (
          <>
            <dt className="text-neutral-500">Pipe size</dt>
            <dd>{entry.pipe_size_in}&quot;</dd>
          </>
        )}
      </dl>
      {entry.notes && (
        <p className="mt-2 border-t border-neutral-200 pt-1 text-[10px] text-neutral-600 dark:border-neutral-800 dark:text-neutral-400">
          {entry.notes}
        </p>
      )}
      <button
        type="button"
        disabled
        className="mt-2 w-full rounded bg-blue-600 px-2 py-1 text-xs font-medium text-white opacity-50"
        title="Placer tool ships in M1 week 4"
      >
        Place in scene (M1 week 4)
      </button>
    </div>
  )
}
