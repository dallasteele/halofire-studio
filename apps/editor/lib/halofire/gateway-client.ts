/**
 * Phase B — thin gateway client for the 16 Phase A single-op
 * endpoints living at `services/halopenclaw-gateway`.
 *
 * Every mutation returns a `DeltaResponse` that the scene store
 * applies optimistically-then-confirm. SSE lives at `/projects/:id/events`
 * and is subscribed by `createHalofireSceneStore`.
 *
 * Kept separate from `lib/ipc.ts` for two reasons:
 *   1. `ipc.ts` is a dual-path (Tauri / fetch) abstraction for the
 *      top-level pipeline commands. Phase A endpoints are pure
 *      gateway HTTP — Tauri has no Rust wrapper for them yet.
 *   2. The scene-store code needs raw fetch(), not a Promise facade,
 *      so optimistic rollback is straightforward.
 */

export type Vec3 = { x: number; y: number; z: number }
export type Vec2 = { x: number; y: number }

export interface SceneDelta {
  added_nodes: string[]
  removed_nodes: string[]
  changed_nodes: string[]
  warnings: string[]
  recalc: Record<string, unknown>
}

export interface DeltaResponse {
  ok: boolean
  op: string
  seq: number
  delta: SceneDelta
}

export interface InsertHeadBody {
  position_m: Vec3
  sku?: string
  k_factor?: number
  temp_rating_f?: number
  orientation?: string
  room_id?: string
}

export interface ModifyHeadBody {
  sku?: string
  k_factor?: number
  temp_rating_f?: number
  position_m?: Vec3
  orientation?: string
  room_id?: string
}

export interface InsertPipeBody {
  from_point_m: Vec3
  to_point_m: Vec3
  size_in?: number
  schedule?: string
  role?: 'branch' | 'cross_main' | 'feed_main' | 'riser'
  downstream_heads?: string[]
}

export interface ModifyPipeBody {
  size_in?: number
  schedule?: string
  role?: string
  start_m?: Vec3
  end_m?: Vec3
  downstream_heads?: string[]
}

export interface InsertFittingBody {
  kind: string
  position_m: Vec3
  size_in?: number
}

export interface InsertHangerBody {
  pipe_id: string
  position_m: Vec3
}

export interface InsertBraceBody {
  pipe_id?: string
  position_m: Vec3
  kind: 'lateral' | 'longitudinal' | 'four_way'
  direction?: Vec3
}

export interface RemoteAreaBody {
  polygon_m: Vec2[]
  name?: string
}

export interface SkuSwapBody {
  sku: string
}

export interface ModifyNodeBody {
  // Generic — forwarded to the matching typed endpoint based on node
  // kind. The scene store uses this for drag-move.
  position_m?: Vec3
}

export const GATEWAY_URL: string =
  (typeof process !== 'undefined' &&
    process.env?.NEXT_PUBLIC_HALOPENCLAW_URL) ||
  'http://localhost:18080'

function headers(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' }
  if (typeof window !== 'undefined') {
    const key = (window as unknown as { __hfApiKey?: string }).__hfApiKey
    if (key) h['x-halofire-api-key'] = key
    const actor = (window as unknown as { __hfActor?: string }).__hfActor
    if (actor) h['x-halofire-actor'] = actor
  }
  return h
}

async function req<T>(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${GATEWAY_URL}${path}`, {
    method,
    headers: headers(),
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`gateway ${method} ${path} → HTTP ${res.status}: ${text.slice(0, 240)}`)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

export const halofireGateway = {
  insertHead(projectId: string, body: InsertHeadBody): Promise<DeltaResponse> {
    return req('POST', `/projects/${encodeURIComponent(projectId)}/heads`, body)
  },
  modifyHead(projectId: string, nid: string, body: ModifyHeadBody): Promise<DeltaResponse> {
    return req('PATCH', `/projects/${encodeURIComponent(projectId)}/heads/${encodeURIComponent(nid)}`, body)
  },
  deleteHead(projectId: string, nid: string): Promise<DeltaResponse> {
    return req('DELETE', `/projects/${encodeURIComponent(projectId)}/heads/${encodeURIComponent(nid)}`)
  },
  insertPipe(projectId: string, body: InsertPipeBody): Promise<DeltaResponse> {
    return req('POST', `/projects/${encodeURIComponent(projectId)}/pipes`, body)
  },
  modifyPipe(projectId: string, nid: string, body: ModifyPipeBody): Promise<DeltaResponse> {
    return req('PATCH', `/projects/${encodeURIComponent(projectId)}/pipes/${encodeURIComponent(nid)}`, body)
  },
  deletePipe(projectId: string, nid: string): Promise<DeltaResponse> {
    return req('DELETE', `/projects/${encodeURIComponent(projectId)}/pipes/${encodeURIComponent(nid)}`)
  },
  insertFitting(projectId: string, body: InsertFittingBody): Promise<DeltaResponse> {
    return req('POST', `/projects/${encodeURIComponent(projectId)}/fittings`, body)
  },
  insertHanger(projectId: string, body: InsertHangerBody): Promise<DeltaResponse> {
    return req('POST', `/projects/${encodeURIComponent(projectId)}/hangers`, body)
  },
  insertBrace(projectId: string, body: InsertBraceBody): Promise<DeltaResponse> {
    return req('POST', `/projects/${encodeURIComponent(projectId)}/braces`, body)
  },
  setRemoteArea(projectId: string, body: RemoteAreaBody): Promise<DeltaResponse> {
    return req('POST', `/projects/${encodeURIComponent(projectId)}/remote-areas`, body)
  },
  calculate(projectId: string, body: Record<string, unknown> = {}): Promise<unknown> {
    return req('POST', `/projects/${encodeURIComponent(projectId)}/calculate`, body)
  },
  runRules(projectId: string): Promise<unknown> {
    return req('POST', `/projects/${encodeURIComponent(projectId)}/rules/run`, {})
  },
  recomputeBom(projectId: string): Promise<unknown> {
    return req('POST', `/projects/${encodeURIComponent(projectId)}/bom/recompute`, {})
  },
  swapSku(projectId: string, nid: string, body: SkuSwapBody): Promise<DeltaResponse> {
    return req('PATCH', `/projects/${encodeURIComponent(projectId)}/nodes/${encodeURIComponent(nid)}/sku`, body)
  },
  undo(projectId: string): Promise<DeltaResponse> {
    return req('POST', `/projects/${encodeURIComponent(projectId)}/undo`, {})
  },
  redo(projectId: string): Promise<DeltaResponse> {
    return req('POST', `/projects/${encodeURIComponent(projectId)}/redo`, {})
  },
  eventsUrl(projectId: string): string {
    return `${GATEWAY_URL}/projects/${encodeURIComponent(projectId)}/events`
  },
  /**
   * Phase F — canonical scene fetch used to resync the TS store
   * after undo / redo pops. Returns the raw design.json plus the
   * current seq so stale events are de-duped.
   */
  getScene(
    projectId: string,
  ): Promise<{ project_id: string; seq: number; design?: unknown; empty?: boolean }> {
    return req('GET', `/projects/${encodeURIComponent(projectId)}/scene`)
  },
}

export type HalofireGateway = typeof halofireGateway
