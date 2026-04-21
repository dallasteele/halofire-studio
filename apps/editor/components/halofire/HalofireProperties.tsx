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

import { generateId, useScene } from '@pascal-app/core'
import { useEditor } from '@pascal-app/editor'
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

  // Real edit actions — wire into Pascal's built-in move/delete and
  // Pascal's scene store. No stubs; these mutate the actual design.
  const setMovingNode = useEditor((s) => s.setMovingNode)
  const deleteNode = useScene((s) => s.deleteNode)
  const createNode = useScene((s) => s.createNode)

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

      {/* Real edit actions — Move / Duplicate / Delete go through
          Pascal's built-in tool stack and scene store. */}
      <div className="grid grid-cols-3 border-t border-white/8">
        <button
          type="button"
          data-testid="halofire-props-move"
          className="border-r border-white/8 px-2 py-1.5 font-mono text-[10px] uppercase tracking-wider text-neutral-300 transition-colors hover:bg-white/5 hover:text-[#e8432d] disabled:opacity-40"
          disabled={!node || !selectedId}
          onClick={() => {
            if (!node || !selectedId) return
            // Enter Pascal's placement coordinator. On commit it
            // writes the new position back to the scene store,
            // which HalofireNodeWatcher observes and re-dispatches
            // as halofire:scene-changed so LiveCalc re-runs.
            setMovingNode(node as any)
          }}
          style={{ borderRadius: 0 }}
          title="Move this item (uses Pascal placement coordinator)"
        >
          Move
        </button>
        <button
          type="button"
          data-testid="halofire-props-duplicate"
          className="border-r border-white/8 px-2 py-1.5 font-mono text-[10px] uppercase tracking-wider text-neutral-300 transition-colors hover:bg-white/5 hover:text-[#e8432d] disabled:opacity-40"
          disabled={!node || !selectedId}
          onClick={() => {
            if (!node || !selectedId) return
            // Clone the node with a fresh id and isNew metadata so
            // Pascal's MoveTool adopts it as a draft (ghost follows
            // the cursor, clicks commit it). This is how Pascal
            // duplicates live nodes.
            const clone: any = {
              ...(node as any),
              id: generateId('item'),
              children: [],
              metadata: {
                ...((node as any).metadata ?? {}),
                isNew: true,
              },
            }
            // Commit the clone to the scene under the same parent so
            // Pascal's coordinator finds it, then enter move mode.
            try {
              createNode(clone, (node as any).parentId ?? null)
              setMovingNode(clone)
              window.dispatchEvent(
                new CustomEvent('halofire:add-head', {
                  detail: { id: clone.id, source: selectedId },
                }),
              )
            } catch (e) {
              console.warn('duplicate failed', e)
            }
          }}
          style={{ borderRadius: 0 }}
          title="Duplicate + place a copy"
        >
          Duplicate
        </button>
        <button
          type="button"
          data-testid="halofire-props-delete"
          className="px-2 py-1.5 font-mono text-[10px] uppercase tracking-wider text-neutral-300 transition-colors hover:bg-red-900/20 hover:text-red-300 disabled:opacity-40"
          disabled={!node || !selectedId}
          onClick={() => {
            if (!selectedId) return
            // Optimistic removal from the scene store. Pascal's
            // systems pick up the deletion in the next frame and
            // unmount the Three.js mesh.
            try {
              deleteNode(selectedId as any)
              window.dispatchEvent(
                new CustomEvent('halofire:remove-head', {
                  detail: { id: selectedId },
                }),
              )
            } catch (e) {
              console.warn('delete failed', e)
            }
          }}
          style={{ borderRadius: 0 }}
          title="Remove this item from the design"
        >
          Delete
        </button>
      </div>
      {/* Swap SKU + Isolate kept as a secondary row for Phase 5.5
          catalog picker + future isolation-view tool. */}
      <div className="flex border-t border-white/8">
        <button
          type="button"
          data-testid="halofire-props-swap-sku"
          className="flex-1 border-r border-white/8 px-2 py-1 font-mono text-[9px] uppercase tracking-wider text-neutral-500 transition-colors hover:bg-white/5 hover:text-[#e8432d]"
          onClick={() => {
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
          data-testid="halofire-props-isolate"
          className="flex-1 px-2 py-1 font-mono text-[9px] uppercase tracking-wider text-neutral-500 transition-colors hover:bg-white/5 hover:text-[#e8432d]"
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
