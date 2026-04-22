/**
 * Phase B — Halofire scene store (TS mirror of the Python SceneStore).
 *
 * Mirrors the subset of `design.json` that the CAD tools mutate:
 * heads, pipes, fittings, hangers, braces, remote area. Each
 * mutation is optimistic: the local store is updated immediately so
 * the UI feels instant, then the gateway call either confirms (via
 * its `DeltaResponse`, which the store reconciles) or fails (the
 * store rolls back).
 *
 * A single SSE subscription per project consumes the `scene_delta`,
 * `rules_run`, and `bom_recompute` events so a second tab / HAL /
 * another user sees the same scene.
 *
 * Not a full clone of the Python `design.json` — just the node
 * kinds the manual tools care about. Richer fields round-trip
 * through the gateway without the TS side inspecting them.
 */

'use client'

import { create } from 'zustand'
import {
  type DeltaResponse,
  type InsertBraceBody,
  type InsertFittingBody,
  type InsertHangerBody,
  type InsertHeadBody,
  type InsertPipeBody,
  type ModifyHeadBody,
  type ModifyPipeBody,
  type RemoteAreaBody,
  type SceneDelta,
  type Vec2,
  type Vec3,
  halofireGateway,
} from './gateway-client'

export type HeadNode = {
  id: string
  kind: 'head'
  position_m: Vec3
  sku?: string
  k_factor?: number
  temp_rating_f?: number
  orientation?: string
  room_id?: string
}

export type PipeNode = {
  id: string
  kind: 'pipe'
  start_m: Vec3
  end_m: Vec3
  size_in?: number
  schedule?: string
  role?: string
}

export type FittingNode = {
  id: string
  kind: 'fitting'
  position_m: Vec3
  fitting_kind: string
  size_in?: number
}

export type HangerNode = {
  id: string
  kind: 'hanger'
  position_m: Vec3
  pipe_id: string
}

export type BraceNode = {
  id: string
  kind: 'brace'
  position_m: Vec3
  brace_kind: 'lateral' | 'longitudinal' | 'four_way'
  pipe_id?: string
}

export type AnyHalofireNode =
  | HeadNode
  | PipeNode
  | FittingNode
  | HangerNode
  | BraceNode

export type RemoteArea = {
  name?: string
  polygon_m: Vec2[]
}

export interface HalofireSceneState {
  projectId: string
  connected: boolean
  lastSeq: number
  /** Plain object for React-friendly iteration; id is node id. */
  nodes: Record<string, AnyHalofireNode>
  selection: Set<string>
  remoteArea: RemoteArea | null
  warnings: string[]

  // --- Mutations (optimistic + server reconcile) ---

  insertHead(body: InsertHeadBody): Promise<DeltaResponse>
  modifyHead(id: string, body: ModifyHeadBody): Promise<DeltaResponse>
  deleteHead(id: string): Promise<DeltaResponse>
  insertPipe(body: InsertPipeBody): Promise<DeltaResponse>
  modifyPipe(id: string, body: ModifyPipeBody): Promise<DeltaResponse>
  deletePipe(id: string): Promise<DeltaResponse>
  insertFitting(body: InsertFittingBody): Promise<DeltaResponse>
  insertHanger(body: InsertHangerBody): Promise<DeltaResponse>
  insertBrace(body: InsertBraceBody): Promise<DeltaResponse>
  setRemoteArea(body: RemoteAreaBody): Promise<DeltaResponse>
  undo(): Promise<DeltaResponse>
  redo(): Promise<DeltaResponse>

  // --- Selection ---
  select(ids: string[], mode?: 'set' | 'add' | 'toggle'): void
  clearSelection(): void

  // --- Internal bookkeeping ---
  applyDelta(delta: SceneDelta): void
  addLocal(node: AnyHalofireNode): void
  removeLocal(id: string): void
  updateLocal(id: string, patch: Partial<AnyHalofireNode>): void
  reset(): void
  setConnected(v: boolean): void
  /**
   * Phase F — rebuild the local nodes map from a server-side
   * `design.json` dict. Used after undo/redo to resync. Best-effort:
   * we keep richer fields round-tripped by the server but only
   * extract the subset the UI mutates.
   */
  rebuildFromDesign(design: unknown): void
  /** Phase F — fetch /projects/:id/scene and rebuild. */
  resyncFromServer(): Promise<void>
}

function freshId(prefix: string): string {
  const r = Math.random().toString(36).slice(2, 10)
  return `${prefix}_${r}_tmp`
}

/**
 * Create a per-project Zustand scene store. We create stores lazily
 * per project id so multiple projects open in tabs don't collide.
 */
const storesByProject = new Map<string, ReturnType<typeof buildStore>>()

function buildStore(projectId: string) {
  return create<HalofireSceneState>((set, get) => ({
    projectId,
    connected: false,
    lastSeq: 0,
    nodes: {},
    selection: new Set<string>(),
    remoteArea: null,
    warnings: [],

    addLocal(node) {
      set((s) => ({ nodes: { ...s.nodes, [node.id]: node } }))
    },
    removeLocal(id) {
      set((s) => {
        const n = { ...s.nodes }
        delete n[id]
        const sel = new Set(s.selection)
        sel.delete(id)
        return { nodes: n, selection: sel }
      })
    },
    updateLocal(id, patch) {
      set((s) => {
        const existing = s.nodes[id]
        if (!existing) return s
        return { nodes: { ...s.nodes, [id]: { ...existing, ...patch } as AnyHalofireNode } }
      })
    },
    applyDelta(delta) {
      // Added / removed node ids are reconciliation hints. We don't
      // currently fetch the full node payload from the server; local
      // optimistic state is the source of truth for geometry until
      // the next /calculate or /bom/recompute fetches richer data.
      set((s) => {
        const warnings = delta.warnings?.length
          ? [...s.warnings, ...delta.warnings].slice(-25)
          : s.warnings
        return { warnings }
      })
    },
    reset() {
      set({ nodes: {}, selection: new Set(), remoteArea: null, warnings: [], lastSeq: 0 })
    },
    setConnected(v) {
      set({ connected: v })
    },

    // --- Mutations ---

    async insertHead(body) {
      const tempId = freshId('head')
      const optimistic: HeadNode = {
        id: tempId,
        kind: 'head',
        position_m: body.position_m,
        sku: body.sku,
        k_factor: body.k_factor,
        temp_rating_f: body.temp_rating_f,
        orientation: body.orientation,
        room_id: body.room_id,
      }
      get().addLocal(optimistic)
      try {
        const r = await halofireGateway.insertHead(projectId, body)
        // Swap temp id for server id. Server returns `added_nodes: [real_id]`.
        const realId = r.delta.added_nodes[0]
        if (realId && realId !== tempId) {
          set((s) => {
            const n = { ...s.nodes }
            delete n[tempId]
            n[realId] = { ...optimistic, id: realId }
            return { nodes: n, lastSeq: r.seq }
          })
        } else {
          set({ lastSeq: r.seq })
        }
        get().applyDelta(r.delta)
        return r
      } catch (err) {
        get().removeLocal(tempId)
        throw err
      }
    },

    async modifyHead(id, body) {
      const prev = get().nodes[id]
      if (prev && prev.kind === 'head') {
        const patch: Partial<HeadNode> = {}
        if (body.position_m) patch.position_m = body.position_m
        if (body.sku !== undefined) patch.sku = body.sku
        if (body.k_factor !== undefined) patch.k_factor = body.k_factor
        if (body.temp_rating_f !== undefined) patch.temp_rating_f = body.temp_rating_f
        if (body.orientation !== undefined) patch.orientation = body.orientation
        if (body.room_id !== undefined) patch.room_id = body.room_id
        get().updateLocal(id, patch)
      }
      try {
        const r = await halofireGateway.modifyHead(projectId, id, body)
        set({ lastSeq: r.seq })
        get().applyDelta(r.delta)
        return r
      } catch (err) {
        // Rollback by restoring prev
        if (prev) get().updateLocal(id, prev)
        throw err
      }
    },

    async deleteHead(id) {
      const prev = get().nodes[id]
      get().removeLocal(id)
      try {
        const r = await halofireGateway.deleteHead(projectId, id)
        set({ lastSeq: r.seq })
        get().applyDelta(r.delta)
        return r
      } catch (err) {
        if (prev) get().addLocal(prev)
        throw err
      }
    },

    async insertPipe(body) {
      const tempId = freshId('pipe')
      const optimistic: PipeNode = {
        id: tempId,
        kind: 'pipe',
        start_m: body.from_point_m,
        end_m: body.to_point_m,
        size_in: body.size_in,
        schedule: body.schedule,
        role: body.role,
      }
      get().addLocal(optimistic)
      try {
        const r = await halofireGateway.insertPipe(projectId, body)
        const realId = r.delta.added_nodes[0]
        if (realId && realId !== tempId) {
          set((s) => {
            const n = { ...s.nodes }
            delete n[tempId]
            n[realId] = { ...optimistic, id: realId }
            return { nodes: n, lastSeq: r.seq }
          })
        } else {
          set({ lastSeq: r.seq })
        }
        get().applyDelta(r.delta)
        return r
      } catch (err) {
        get().removeLocal(tempId)
        throw err
      }
    },

    async modifyPipe(id, body) {
      const prev = get().nodes[id]
      if (prev && prev.kind === 'pipe') {
        const patch: Partial<PipeNode> = {}
        if (body.size_in !== undefined) patch.size_in = body.size_in
        if (body.schedule !== undefined) patch.schedule = body.schedule
        if (body.role !== undefined) patch.role = body.role
        if (body.start_m) patch.start_m = body.start_m
        if (body.end_m) patch.end_m = body.end_m
        get().updateLocal(id, patch)
      }
      try {
        const r = await halofireGateway.modifyPipe(projectId, id, body)
        set({ lastSeq: r.seq })
        get().applyDelta(r.delta)
        return r
      } catch (err) {
        if (prev) get().updateLocal(id, prev)
        throw err
      }
    },

    async deletePipe(id) {
      const prev = get().nodes[id]
      get().removeLocal(id)
      try {
        const r = await halofireGateway.deletePipe(projectId, id)
        set({ lastSeq: r.seq })
        get().applyDelta(r.delta)
        return r
      } catch (err) {
        if (prev) get().addLocal(prev)
        throw err
      }
    },

    async insertFitting(body) {
      const tempId = freshId('fitting')
      const optimistic: FittingNode = {
        id: tempId,
        kind: 'fitting',
        position_m: body.position_m,
        fitting_kind: body.kind,
        size_in: body.size_in,
      }
      get().addLocal(optimistic)
      try {
        const r = await halofireGateway.insertFitting(projectId, body)
        const realId = r.delta.added_nodes[0]
        if (realId && realId !== tempId) {
          set((s) => {
            const n = { ...s.nodes }
            delete n[tempId]
            n[realId] = { ...optimistic, id: realId }
            return { nodes: n, lastSeq: r.seq }
          })
        } else {
          set({ lastSeq: r.seq })
        }
        get().applyDelta(r.delta)
        return r
      } catch (err) {
        get().removeLocal(tempId)
        throw err
      }
    },

    async insertHanger(body) {
      const tempId = freshId('hanger')
      const optimistic: HangerNode = {
        id: tempId,
        kind: 'hanger',
        position_m: body.position_m,
        pipe_id: body.pipe_id,
      }
      get().addLocal(optimistic)
      try {
        const r = await halofireGateway.insertHanger(projectId, body)
        const realId = r.delta.added_nodes[0]
        if (realId && realId !== tempId) {
          set((s) => {
            const n = { ...s.nodes }
            delete n[tempId]
            n[realId] = { ...optimistic, id: realId }
            return { nodes: n, lastSeq: r.seq }
          })
        } else {
          set({ lastSeq: r.seq })
        }
        get().applyDelta(r.delta)
        return r
      } catch (err) {
        get().removeLocal(tempId)
        throw err
      }
    },

    async insertBrace(body) {
      const tempId = freshId('brace')
      const optimistic: BraceNode = {
        id: tempId,
        kind: 'brace',
        position_m: body.position_m,
        brace_kind: body.kind,
        pipe_id: body.pipe_id,
      }
      get().addLocal(optimistic)
      try {
        const r = await halofireGateway.insertBrace(projectId, body)
        const realId = r.delta.added_nodes[0]
        if (realId && realId !== tempId) {
          set((s) => {
            const n = { ...s.nodes }
            delete n[tempId]
            n[realId] = { ...optimistic, id: realId }
            return { nodes: n, lastSeq: r.seq }
          })
        } else {
          set({ lastSeq: r.seq })
        }
        get().applyDelta(r.delta)
        return r
      } catch (err) {
        get().removeLocal(tempId)
        throw err
      }
    },

    async setRemoteArea(body) {
      const prev = get().remoteArea
      set({ remoteArea: { name: body.name, polygon_m: body.polygon_m } })
      try {
        const r = await halofireGateway.setRemoteArea(projectId, body)
        set({ lastSeq: r.seq })
        get().applyDelta(r.delta)
        return r
      } catch (err) {
        set({ remoteArea: prev })
        throw err
      }
    },

    async undo() {
      const r = await halofireGateway.undo(projectId)
      set({ lastSeq: r.seq })
      get().applyDelta(r.delta)
      // Phase F — fetch the canonical post-undo scene and rebuild
      // the local nodes map so the viewport reflects the actual
      // server state rather than the now-stale optimistic view.
      try {
        await get().resyncFromServer()
      } catch {
        // Non-fatal — SSE will eventually fire and older mutations
        // will rolled back via applyDelta. The viewport may look
        // stale in the meantime.
      }
      return r
    },

    async redo() {
      const r = await halofireGateway.redo(projectId)
      set({ lastSeq: r.seq })
      get().applyDelta(r.delta)
      try {
        await get().resyncFromServer()
      } catch { /* see undo */ }
      return r
    },

    // --- Selection ---

    select(ids, mode = 'set') {
      set((s) => {
        let next: Set<string>
        if (mode === 'set') {
          next = new Set(ids)
        } else if (mode === 'add') {
          next = new Set(s.selection)
          for (const id of ids) next.add(id)
        } else {
          next = new Set(s.selection)
          for (const id of ids) {
            if (next.has(id)) next.delete(id)
            else next.add(id)
          }
        }
        return { selection: next }
      })
    },
    clearSelection() {
      set({ selection: new Set() })
    },

    rebuildFromDesign(design: unknown) {
      if (!design || typeof design !== 'object') {
        set({ nodes: {}, remoteArea: null })
        return
      }
      const d = design as Record<string, unknown>
      const systems = (d.systems as Array<Record<string, unknown>> | undefined) ?? []
      const nodes: Record<string, AnyHalofireNode> = {}
      let remote: RemoteArea | null = null
      for (const system of systems) {
        const heads = (system.heads as Array<Record<string, unknown>> | undefined) ?? []
        for (const h of heads) {
          const id = h.id as string | undefined
          const pos = h.position_m as [number, number, number] | undefined
          if (!id || !pos) continue
          nodes[id] = {
            id,
            kind: 'head',
            position_m: { x: pos[0], y: pos[1], z: pos[2] },
            sku: h.sku as string | undefined,
            k_factor: h.k_factor as number | undefined,
            temp_rating_f: h.temp_rating_f as number | undefined,
            orientation: h.orientation as string | undefined,
            room_id: h.room_id as string | undefined,
          }
        }
        const pipes = (system.pipes as Array<Record<string, unknown>> | undefined) ?? []
        for (const p of pipes) {
          const id = p.id as string | undefined
          const from = p.from_point_m as [number, number, number] | undefined
          const to = p.to_point_m as [number, number, number] | undefined
          if (!id || !from || !to) continue
          nodes[id] = {
            id,
            kind: 'pipe',
            start_m: { x: from[0], y: from[1], z: from[2] },
            end_m: { x: to[0], y: to[1], z: to[2] },
            size_in: p.size_in as number | undefined,
            schedule: p.schedule as string | undefined,
            role: p.role as string | undefined,
          }
        }
        const hangers = (system.hangers as Array<Record<string, unknown>> | undefined) ?? []
        for (const hg of hangers) {
          const id = hg.id as string | undefined
          const pos = hg.position_m as [number, number, number] | undefined
          if (!id || !pos) continue
          nodes[id] = {
            id,
            kind: 'hanger',
            position_m: { x: pos[0], y: pos[1], z: pos[2] },
            pipe_id: (hg.pipe_id as string | undefined) ?? '',
          }
        }
        const braces = (system.sway_braces as Array<Record<string, unknown>> | undefined) ?? []
        for (const b of braces) {
          const id = b.id as string | undefined
          const pos = b.position_m as [number, number, number] | undefined
          if (!id || !pos) continue
          nodes[id] = {
            id,
            kind: 'brace',
            position_m: { x: pos[0], y: pos[1], z: pos[2] },
            brace_kind: (b.kind as 'lateral' | 'longitudinal' | 'four_way' | undefined) ?? 'lateral',
            pipe_id: b.pipe_id as string | undefined,
          }
        }
        const fittings = (system.fittings as Array<Record<string, unknown>> | undefined) ?? []
        for (const f of fittings) {
          const id = f.id as string | undefined
          const pos = f.position_m as [number, number, number] | undefined
          if (!id || !pos) continue
          nodes[id] = {
            id,
            kind: 'fitting',
            position_m: { x: pos[0], y: pos[1], z: pos[2] },
            fitting_kind: (f.kind as string | undefined) ?? 'elbow_90',
            size_in: f.size_in as number | undefined,
          }
        }
        const ra = system.remote_area as Record<string, unknown> | undefined
        if (ra && Array.isArray(ra.polygon_m)) {
          remote = {
            name: ra.name as string | undefined,
            polygon_m: (ra.polygon_m as Array<[number, number]>).map(
              ([x, y]) => ({ x, y }),
            ),
          }
        }
      }
      set({ nodes, remoteArea: remote })
    },

    async resyncFromServer() {
      const r = await halofireGateway.getScene(projectId)
      if (r.empty) {
        set({ nodes: {}, remoteArea: null })
        return
      }
      if (r.design) get().rebuildFromDesign(r.design)
      if (typeof r.seq === 'number') set({ lastSeq: r.seq })
    },
  }))
}

export function getHalofireSceneStore(projectId: string) {
  let store = storesByProject.get(projectId)
  if (!store) {
    store = buildStore(projectId)
    storesByProject.set(projectId, store)
  }
  return store
}

// --- SSE subscription ---------------------------------------------

const activeSources = new Map<string, EventSource>()

export function connectHalofireSSE(projectId: string): () => void {
  if (typeof window === 'undefined' || typeof EventSource === 'undefined') {
    return () => {}
  }
  if (activeSources.has(projectId)) {
    // Already subscribed — return a no-op disposer that doesn't close
    // someone else's channel.
    return () => {}
  }
  const store = getHalofireSceneStore(projectId)
  const url = halofireGateway.eventsUrl(projectId)
  const es = new EventSource(url)
  activeSources.set(projectId, es)

  es.onopen = () => store.getState().setConnected(true)
  es.onerror = () => store.getState().setConnected(false)

  const handleDelta = (data: unknown) => {
    try {
      const payload = data as { seq?: number; delta?: SceneDelta }
      if (payload?.delta) {
        store.getState().applyDelta(payload.delta)
        if (typeof payload.seq === 'number') {
          // Only advance if greater (dedupe echoes of our own writes)
          const cur = store.getState().lastSeq
          if (payload.seq > cur) store.setState({ lastSeq: payload.seq })
        }
      }
    } catch {
      // malformed frame — drop
    }
  }

  es.addEventListener('scene_delta', (e) => {
    try { handleDelta(JSON.parse((e as MessageEvent).data)) } catch { /* */ }
  })
  es.addEventListener('rules_run', () => {
    window.dispatchEvent(new CustomEvent('halofire:rules-ran'))
  })
  es.addEventListener('bom_recompute', () => {
    window.dispatchEvent(new CustomEvent('halofire:bom-recomputed'))
  })
  es.onmessage = (e) => {
    try { handleDelta(JSON.parse(e.data)) } catch { /* */ }
  }

  return () => {
    try { es.close() } catch { /* */ }
    activeSources.delete(projectId)
    store.getState().setConnected(false)
  }
}

// --- Internals for tests ------------------------------------------

export const _internals = { freshId, buildStore }
