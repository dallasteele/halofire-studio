'use client'

/**
 * HalofireProperties — selection-aware properties widget for any
 * halofire-tagged item (sprinkler head, pipe, column, FDC, etc).
 *
 * V2 Phase 5.3. Mounts beside the viewport (top-right, below the
 * camera toolbar) only when the active selection includes a node
 * tagged with `'halofire'`. Surfaces:
 *   * Asset name + category
 *   * Pipe role (drop / branch / cross_main / main / riser_nipple)
 *   * Pipe size (in)
 *   * Head SKU + K-factor (when known)
 *   * "Swap SKU" button (placeholder — opens the catalog picker)
 *
 * Empty selection or non-halofire item → component renders null.
 */

import { useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'

interface SelectedItem {
  id: string
  type?: string
  asset?: {
    id?: string
    name?: string
    category?: string
    tags?: string[]
    dimensions?: [number, number, number]
  }
  metadata?: {
    role?: string
    size_in?: number
    k_factor?: number
    sku?: string
    tags?: string[]
  }
}

function tagsOf(node: SelectedItem | undefined): string[] {
  if (!node) return []
  return [
    ...((node.asset?.tags as string[]) ?? []),
    ...((node.metadata?.tags as string[]) ?? []),
  ]
}

function isHalofire(node: SelectedItem | undefined): boolean {
  return tagsOf(node).includes('halofire')
}

export function HalofireProperties() {
  const selection = useViewer((s) => s.selection)
  const nodes = useScene((s) => s.nodes)
  const selectedId = selection.selectedIds?.[0]
  const node = selectedId
    ? (nodes[selectedId as keyof typeof nodes] as SelectedItem | undefined)
    : undefined

  if (!isHalofire(node)) return null

  const tags = tagsOf(node)
  const role = node?.metadata?.role
    ?? tags.find((t) => t.startsWith('role_'))?.slice(5)
  const sizeIn = node?.metadata?.size_in
    ?? (Number(tags.find((t) => t.startsWith('size_'))?.slice(5)) || undefined)
  const k = node?.metadata?.k_factor
  const sku = node?.metadata?.sku ?? node?.asset?.id
  const dims = node?.asset?.dimensions
  const cat = node?.asset?.category ?? node?.type ?? '—'
  const isPipe = cat.startsWith('pipe_') || tags.includes('pipe_steel_sch10')
  const isHead = cat.startsWith('sprinkler_head') || tags.includes('sprinkler_head_pendant')

  return (
    <div
      data-testid="halofire-properties"
      className="pointer-events-auto fixed right-3 top-20 z-40 w-[260px] border border-white/8 bg-[#0a0a0b]/95 backdrop-blur-sm text-white shadow-[0_4px_20px_rgba(0,0,0,0.5)]"
      style={{ borderRadius: 0 }}
    >
      <div className="flex items-center justify-between border-b border-white/8 px-3 py-1.5">
        <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-neutral-500">
          {isPipe ? 'Pipe' : isHead ? 'Sprinkler' : 'Halofire item'}
        </span>
        <span className="font-mono text-[9px] uppercase tracking-wider text-[#e8432d]">
          selected
        </span>
      </div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 px-3 py-2 font-mono text-[11px]">
        <dt className="text-neutral-500">Name</dt>
        <dd className="truncate text-neutral-100" title={node?.asset?.name}>
          {node?.asset?.name ?? '—'}
        </dd>

        <dt className="text-neutral-500">SKU</dt>
        <dd className="truncate text-neutral-200" title={sku}>
          {sku ?? '—'}
        </dd>

        <dt className="text-neutral-500">Category</dt>
        <dd className="text-neutral-200">{cat}</dd>

        {role && (
          <>
            <dt className="text-neutral-500">Role</dt>
            <dd className="text-[#e8432d]">{role}</dd>
          </>
        )}

        {sizeIn !== undefined && (
          <>
            <dt className="text-neutral-500">Size</dt>
            <dd className="text-neutral-200">{sizeIn}″</dd>
          </>
        )}

        {k !== undefined && (
          <>
            <dt className="text-neutral-500">K-factor</dt>
            <dd className="text-neutral-200">{k}</dd>
          </>
        )}

        {dims && (
          <>
            <dt className="text-neutral-500">Dim (W×H×D)</dt>
            <dd className="text-neutral-200">
              {dims[0].toFixed(2)} × {dims[1].toFixed(2)} × {dims[2].toFixed(2)} m
            </dd>
          </>
        )}
      </dl>

      <div className="flex border-t border-white/8">
        <button
          type="button"
          className="flex-1 border-r border-white/8 px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-neutral-400 transition-colors hover:bg-white/5 hover:text-[#e8432d]"
          onClick={() => {
            // V2 Phase 5.3 placeholder — opens catalog picker once
            // Phase 5.5 lands. For now, log intent so user sees it
            // wired.
            window.dispatchEvent(
              new CustomEvent('halofire:swap-sku', { detail: { id: selectedId } }),
            )
          }}
          style={{ borderRadius: 0 }}
        >
          Swap SKU
        </button>
        <button
          type="button"
          className="flex-1 px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-neutral-400 transition-colors hover:bg-white/5 hover:text-[#e8432d]"
          onClick={() => {
            window.dispatchEvent(
              new CustomEvent('halofire:isolate', { detail: { id: selectedId } }),
            )
          }}
          style={{ borderRadius: 0 }}
        >
          Isolate
        </button>
      </div>
    </div>
  )
}
