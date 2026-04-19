/**
 * Halopenclaw gateway client types.
 *
 * Keep tool-name + mode enums in ONE place so TS catches misspellings
 * at the call-site. If a new tool or mode ships on the gateway, add it
 * here first.
 */

export type ToolName =
  | 'halofire_validate'
  | 'halofire_ingest'
  | 'halofire_place_head'
  | 'halofire_route_pipe'
  | 'halofire_calc'
  | 'halofire_export'

export type ValidateMode = 'shell' | 'collisions' | 'nfpa13' | 'hydraulic' | 'completeness'

export type IngestMode = 'pdf' | 'ifc' | 'dwg'

export type PlaceHeadMode = 'manual' | 'auto_grid' | 'at_coords'

export type RoutePipeMode = 'manual_segment' | 'auto_tree' | 'auto_loop' | 'auto_grid'

export type CalcMode = 'hazen_williams' | 'density_area' | 'remote_area' | 'supply_check'

export type ExportMode =
  | 'pdf_plan'
  | 'dxf'
  | 'ifc'
  | 'cut_sheets'
  | 'proposal'
  | 'sheet_set'

export interface SerializedNode {
  id: string
  type: string
  folder?: string
  bbox_world: {
    min: [number, number, number]
    max: [number, number, number]
  }
  metadata?: Record<string, unknown>
}

export interface SerializedScene {
  nodes: SerializedNode[]
  units: 'cm' | 'm'
  /** Optional project-level metadata (bid ID, scale, hazard class, …) */
  project?: Record<string, unknown>
}

export interface HalopenclawClient {
  readonly baseUrl: string
  /** Generic tool call. Use the typed wrappers below when possible. */
  call<T = string>(tool: ToolName, args: Record<string, unknown>): Promise<T>
  /** List all tools the gateway currently exposes. */
  listTools(): Promise<{ name: string; description: string }[]>
  /** Health check. Throws on non-200 response. */
  health(): Promise<{ ok: boolean; service: string; version: string; tools: string[] }>

  // ── Typed wrappers per tool (add as tools ship) ──────────────────────────
  validate(mode: ValidateMode, scene: SerializedScene, opts?: {
    toleranceCm?: number
    marginCm?: number
  }): Promise<string>
}
