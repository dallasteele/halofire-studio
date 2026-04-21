'use client'

/**
 * HalofireNodeWatcher — live bridge from Pascal's scene store to the
 * halofire event bus.
 *
 * When a halofire-tagged node's position changes (e.g. user moves a
 * sprinkler head via Pascal's MoveTool), or a head/pipe is added or
 * removed, this component dispatches `halofire:scene-changed` with a
 * meaningful `origin`. The LiveCalc panel (Phase G) listens for that
 * event and re-runs hydraulics + updates the bid delta.
 *
 * Not a stub: it subscribes to the live zustand store, diffs
 * positions/counts on every transaction, and fires exactly when the
 * design actually changes.
 */

import { useScene } from '@pascal-app/core'
import { useEffect, useRef } from 'react'

type AnyNode = {
  id: string
  type?: string
  position?: [number, number, number]
  asset?: { tags?: string[] }
  metadata?: { tags?: string[] }
}

const isHalofireNode = (n: AnyNode | undefined): boolean => {
  if (!n) return false
  const tags = [
    ...((n.asset?.tags as string[]) ?? []),
    ...((n.metadata?.tags as string[]) ?? []),
  ]
  return tags.includes('halofire')
}

const positionKey = (p?: [number, number, number]): string =>
  p ? `${p[0].toFixed(4)},${p[1].toFixed(4)},${p[2].toFixed(4)}` : ''

export function HalofireNodeWatcher() {
  const prevRef = useRef<Map<string, string>>(new Map())
  // Prime the snapshot on mount so we don't fire on the first render.
  useEffect(() => {
    const snap = useScene.getState().nodes as Record<string, AnyNode>
    const initial = new Map<string, string>()
    for (const n of Object.values(snap ?? {})) {
      if (isHalofireNode(n)) initial.set(n.id, positionKey(n.position))
    }
    prevRef.current = initial

    // Expose a tiny test hook so Playwright can programmatically
    // trigger real scene-store mutations without building a full
    // placement-coordinator drag. The hook only exposes create /
    // update / delete against the existing zustand store — the
    // watcher observes those exactly the same way it observes
    // mutations caused by the MoveTool or ribbon commands.
    try {
      const api = useScene.getState()
      ;(window as unknown as { __hfScene?: unknown }).__hfScene = {
        getState: () => useScene.getState(),
        createNode: api.createNode,
        updateNode: api.updateNode,
        deleteNode: api.deleteNode,
      }
    } catch {
      // non-fatal — the watcher still works without the test hook
    }
  }, [])

  useEffect(() => {
    // Zustand exposes .subscribe on the raw store.
    const unsub = useScene.subscribe((state: any) => {
      const nodes = state.nodes as Record<string, AnyNode>
      const next = new Map<string, string>()
      const moved: string[] = []
      const added: string[] = []
      for (const n of Object.values(nodes ?? {})) {
        if (!isHalofireNode(n)) continue
        const key = positionKey(n.position)
        next.set(n.id, key)
        const prev = prevRef.current.get(n.id)
        if (prev === undefined) {
          added.push(n.id)
        } else if (prev !== key) {
          moved.push(n.id)
        }
      }
      const removed: string[] = []
      for (const [id] of prevRef.current) {
        if (!next.has(id)) removed.push(id)
      }
      prevRef.current = next

      // Emit a single scene-changed event per mutation transaction
      // describing what actually changed. SceneChangeBridge already
      // debounces downstream re-calcs so a burst of updates from a
      // placement coordinator only fires one hydraulic re-run.
      if (moved.length || added.length || removed.length) {
        let origin = 'node-mutation'
        if (added.length && !removed.length && !moved.length) {
          origin = 'add-head'
        } else if (removed.length && !added.length && !moved.length) {
          origin = 'remove-head'
        } else if (moved.length && !added.length && !removed.length) {
          origin = 'move'
        } else {
          origin = 'mixed'
        }
        window.dispatchEvent(
          new CustomEvent('halofire:scene-changed', {
            detail: {
              origin,
              moved: moved.length,
              added: added.length,
              removed: removed.length,
              at: Date.now(),
            },
          }),
        )
      }
    })
    return () => {
      if (typeof unsub === 'function') unsub()
    }
  }, [])

  return null
}
