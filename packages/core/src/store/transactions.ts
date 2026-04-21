import useScene from './use-scene'

/**
 * Wrap a scene mutation in an atomic transaction. Records ONE zundo
 * diff for the whole block; undoing reverts the block together.
 *
 * Nested calls are safe — only the outermost pause/resume pair takes
 * effect so a nested txn collapses into its parent's single entry.
 *
 * Implementation: capture the pre-txn snapshot of the partialized
 * store state, pause zundo so intra-txn mutations don't each push a
 * history frame, then on exit push a single frame representing the
 * pre-txn state so `undo()` reverts the whole block.
 */
let depth = 0
let outerPastSnapshot: Record<string, unknown> | null = null

function getPartializedSnapshot(): Record<string, unknown> {
  const state = useScene.getState() as unknown as Record<string, unknown>
  return {
    nodes: state.nodes,
    rootNodeIds: state.rootNodeIds,
    collections: state.collections,
  }
}

export function txn<T>(label: string, fn: () => T): T {
  const temporal = (useScene as any).temporal as
    | { getState: () => any }
    | undefined
  if (!temporal) {
    return fn()
  }
  const isOuter = depth === 0
  if (isOuter) {
    try {
      outerPastSnapshot = getPartializedSnapshot()
      temporal.getState().pause()
    } catch {
      outerPastSnapshot = null
    }
  }
  depth += 1
  try {
    const result = fn()
    return result
  } finally {
    depth -= 1
    if (isOuter) {
      try {
        temporal.getState().resume()
        const tStore = (useScene as any).temporal as {
          getState: () => any
          setState: (partial: any) => void
        }
        const t = tStore.getState()
        const currentState = getPartializedSnapshot()
        const changed =
          outerPastSnapshot !== null &&
          (outerPastSnapshot.nodes !== currentState.nodes ||
            outerPastSnapshot.rootNodeIds !== currentState.rootNodeIds ||
            outerPastSnapshot.collections !== currentState.collections)
        if (changed && outerPastSnapshot) {
          // Push exactly one frame (the pre-txn snapshot) onto
          // pastStates and clear futureStates. Equivalent to what
          // zundo's internal `_handleSet` does, but we push directly
          // via the temporal store's setState so the subscription
          // listeners on useScene.temporal fire exactly once.
          const pastStates = [...(t.pastStates ?? []), outerPastSnapshot]
          const limited =
            pastStates.length > 50 ? pastStates.slice(-50) : pastStates
          tStore.setState({
            pastStates: limited,
            futureStates: [],
          })
        }
      } catch {
        // non-fatal
      }
      outerPastSnapshot = null
    }
    void label
  }
}

export function undo(): void {
  const temporal = (useScene as any).temporal as
    | { getState: () => any }
    | undefined
  if (temporal && typeof temporal.getState().undo === 'function') {
    temporal.getState().undo()
  }
}

export function redo(): void {
  const temporal = (useScene as any).temporal as
    | { getState: () => any }
    | undefined
  if (temporal && typeof temporal.getState().redo === 'function') {
    temporal.getState().redo()
  }
}

export function getHistory(): Array<{ label: string; at: number }> {
  const temporal = (useScene as any).temporal as
    | { getState: () => any }
    | undefined
  if (!temporal) return []
  const st = temporal.getState()
  const past = (st.pastStates ?? []).map((_: unknown, i: number) => ({
    label: `step ${i + 1}`,
    at: Date.now(),
  }))
  return past
}
