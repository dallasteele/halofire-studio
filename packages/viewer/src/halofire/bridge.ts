/**
 * Halofire ↔ r3f bridge — Phase F
 *
 * Provides a global mount-point inside Pascal's r3f `<Canvas>` that
 * the halofire app uses for:
 *
 *   1. Layer visibility — toggle sprinkler heads / pipes / hangers in
 *      the live viewport when the halofire LayerPanel emits
 *      `halofire:layer-visibility`.
 *   2. Real r3f raycaster — publish `{camera, raycaster, scene, gl}`
 *      to the halofire tool manager so every tool's
 *      screen→world projection comes from the actual viewport geometry
 *      rather than the old 30 m grid approximation.
 *   3. `<Html>` node tags — render pressure / flow / velocity labels
 *      as r3f children so they follow the camera automatically.
 *   4. Pipe handle gizmos — Phase F drag-resize.
 *
 * The bridge itself is just a zustand store; the r3f-aware component
 * `<HalofireBridgeSlot />` is rendered by `@pascal-app/editor`'s
 * `ViewerSceneContent`, which lives inside `<Canvas>`. Halofire app
 * code writes to the store; the slot component reacts.
 */

import { create } from 'zustand'
import type { Camera, Raycaster, Scene, WebGLRenderer } from 'three'

export type LayerId =
  | 'heads' | 'pipes' | 'walls' | 'zones'
  | 'hangers' | 'obstructions' | 'arch'

export type LayerVisibility = Record<LayerId, boolean>

export const DEFAULT_LAYER_VISIBILITY: LayerVisibility = {
  heads: true, pipes: true, walls: true, zones: true,
  hangers: true, obstructions: true, arch: true,
}

/** Minimal r3f handles exposed to halofire tools. */
export interface HalofireR3FRefs {
  camera: Camera | null
  raycaster: Raycaster | null
  scene: Scene | null
  gl: WebGLRenderer | null
  /** Viewport rect in CSS pixels (client-space). */
  domRect: DOMRect | null
}

export interface HalofireNodeTag {
  id: string
  position: [number, number, number]
  label: string
  severity: 'ok' | 'warn' | 'critical'
  onCriticalPath?: boolean
}

export interface HalofirePipeHandle {
  pipeId: string
  start: [number, number, number]
  end: [number, number, number]
  size_in: number
}

export interface HalofireBridgeState {
  /** Layer visibility — halofire-tagged nodes consult this. */
  layers: LayerVisibility
  setLayerVisibility(next: Partial<LayerVisibility>): void
  setAllLayers(value: boolean): void

  /** r3f refs, updated every frame by the slot. */
  refs: HalofireR3FRefs
  setRefs(next: Partial<HalofireR3FRefs>): void

  /** Node tags rendered as r3f `<Html>` anchors. */
  tags: HalofireNodeTag[]
  setTags(next: HalofireNodeTag[]): void

  /** Pipe-drag-handle descriptors. Empty = no handles visible. */
  pipeHandles: HalofirePipeHandle[]
  setPipeHandles(next: HalofirePipeHandle[]): void

  /**
   * Callback fired when a pipe endpoint drag completes. Halofire
   * registers this to PATCH the pipe via the scene store.
   */
  onPipeEndpointMove:
    | ((pipeId: string, which: 'start' | 'end', world: [number, number, number]) => void)
    | null
  setOnPipeEndpointMove(
    cb:
      | ((pipeId: string, which: 'start' | 'end', world: [number, number, number]) => void)
      | null,
  ): void

  onPipeDiameterStep:
    | ((pipeId: string, delta: 1 | -1) => void)
    | null
  setOnPipeDiameterStep(cb: ((pipeId: string, delta: 1 | -1) => void) | null): void
}

export const useHalofireBridge = create<HalofireBridgeState>((set) => ({
  layers: { ...DEFAULT_LAYER_VISIBILITY },
  setLayerVisibility: (next) => set((s) => ({ layers: { ...s.layers, ...next } })),
  setAllLayers: (value) => set((s) => ({
    layers: Object.fromEntries(
      Object.keys(s.layers).map((k) => [k, value]),
    ) as LayerVisibility,
  })),

  refs: { camera: null, raycaster: null, scene: null, gl: null, domRect: null },
  setRefs: (next) => set((s) => ({ refs: { ...s.refs, ...next } })),

  tags: [],
  setTags: (next) => set({ tags: next }),

  pipeHandles: [],
  setPipeHandles: (next) => set({ pipeHandles: next }),

  onPipeEndpointMove: null,
  setOnPipeEndpointMove: (cb) => set({ onPipeEndpointMove: cb }),

  onPipeDiameterStep: null,
  setOnPipeDiameterStep: (cb) => set({ onPipeDiameterStep: cb }),
}))

/**
 * Tag-to-layer mapping used by the visibility filter. Halofire-tagged
 * Pascal nodes carry `halofire_layer:<id>` tags set during intake.
 * Fallback: category-name prefix match ("sprinkler_head" → heads,
 * "pipe" → pipes, "hanger" → hangers).
 */
export function resolveHalofireLayer(params: {
  tags?: string[] | null
  category?: string | null
  type?: string | null
}): LayerId | null {
  const { tags, category, type } = params
  if (tags) {
    for (const t of tags) {
      if (typeof t !== 'string') continue
      if (t.startsWith('halofire_layer:')) {
        const id = t.slice('halofire_layer:'.length) as LayerId
        return id
      }
    }
  }
  const c = (category ?? '').toLowerCase()
  if (c.startsWith('sprinkler_head')) return 'heads'
  if (c.startsWith('pipe')) return 'pipes'
  if (c.startsWith('fitting')) return 'pipes'
  if (c.startsWith('hanger')) return 'hangers'
  if (c.startsWith('brace')) return 'hangers'
  if (c.includes('zone')) return 'zones'
  if (c.includes('wall')) return 'walls'
  const t = (type ?? '').toLowerCase()
  if (t === 'sprinkler_head') return 'heads'
  if (t === 'pipe') return 'pipes'
  if (t === 'wall') return 'walls'
  if (t === 'zone') return 'zones'
  return null
}

/** Internal — exported for tests only. */
export const _internals = { resolveHalofireLayer }
