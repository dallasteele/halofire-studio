/**
 * Connector graph — the typed sockets on every catalog part and the
 * rules for when two connectors may mate.
 *
 * AI agents (placer, router, BOM, hydraulic) MUST consult
 * `connectorsFor(entry)` instead of eyeballing geometry.
 *
 * Coordinates: METERS relative to the item's local origin (same frame
 * Pascal uses for `ItemNode.position`). Direction vectors are unit,
 * pointing OUTWARD from the part — the mating connector must point
 * back (opposite direction, same line).
 */
import type { CatalogEntry } from './types.js'

export type ConnectionType =
  | 'grooved'
  | 'npt'
  | 'flanged'
  | 'solvent_weld'
  | 'thread_female'

export type ConnectorRole =
  | 'inlet'
  | 'outlet'
  | 'branch'
  | 'tap'
  | 'coupling'

export interface Connector {
  id: string
  role: ConnectorRole
  position_m: [number, number, number]
  direction: [number, number, number]
  size_in: number
  type: ConnectionType
  note?: string
}

// ── per-category generators ─────────────────────────────────────────

function pipeSegment(e: CatalogEntry): Connector[] {
  const size = e.pipe_size_in ?? 2.0
  const halfLen = e.dims_cm[2] / 200 // cm/100/2
  const ct: ConnectionType = e.connection === 'npt' ? 'npt' : 'grooved'
  return [
    {
      id: 'end_a',
      role: 'coupling',
      position_m: [0, 0, -halfLen],
      direction: [0, 0, -1],
      size_in: size,
      type: ct,
    },
    {
      id: 'end_b',
      role: 'coupling',
      position_m: [0, 0, halfLen],
      direction: [0, 0, 1],
      size_in: size,
      type: ct,
    },
  ]
}

function elbow90(e: CatalogEntry): Connector[] {
  const size = e.pipe_size_in ?? 2.0
  const half = e.dims_cm[0] / 200
  return [
    {
      id: 'inlet',
      role: 'inlet',
      position_m: [-half, 0, 0],
      direction: [-1, 0, 0],
      size_in: size,
      type: 'grooved',
    },
    {
      id: 'outlet',
      role: 'outlet',
      position_m: [0, 0, half],
      direction: [0, 0, 1],
      size_in: size,
      type: 'grooved',
    },
  ]
}

function teeEqual(e: CatalogEntry): Connector[] {
  const size = e.pipe_size_in ?? 2.0
  const hx = e.dims_cm[0] / 200
  const hz = e.dims_cm[2] / 200
  return [
    {
      id: 'run_in',
      role: 'inlet',
      position_m: [-hx, 0, 0],
      direction: [-1, 0, 0],
      size_in: size,
      type: 'grooved',
    },
    {
      id: 'run_out',
      role: 'outlet',
      position_m: [hx, 0, 0],
      direction: [1, 0, 0],
      size_in: size,
      type: 'grooved',
    },
    {
      id: 'branch',
      role: 'branch',
      position_m: [0, 0, hz],
      direction: [0, 0, 1],
      size_in: size,
      type: 'grooved',
    },
  ]
}

function reducer(e: CatalogEntry): Connector[] {
  const big = e.pipe_size_in ?? 2.0
  const m = /(\d+(?:\.\d+)?)to(\d+(?:\.\d+)?)/i.exec(e.model)
  const small = m?.[2] ? Number.parseFloat(m[2]) : big / 2
  const hx = e.dims_cm[0] / 200
  return [
    {
      id: 'inlet_large',
      role: 'inlet',
      position_m: [-hx, 0, 0],
      direction: [-1, 0, 0],
      size_in: big,
      type: 'grooved',
    },
    {
      id: 'outlet_small',
      role: 'outlet',
      position_m: [hx, 0, 0],
      direction: [1, 0, 0],
      size_in: small,
      type: 'grooved',
    },
  ]
}

function coupling(e: CatalogEntry): Connector[] {
  const size = e.pipe_size_in ?? 2.0
  const hx = e.dims_cm[0] / 200
  return [
    {
      id: 'end_a',
      role: 'coupling',
      position_m: [-hx, 0, 0],
      direction: [-1, 0, 0],
      size_in: size,
      type: 'grooved',
    },
    {
      id: 'end_b',
      role: 'coupling',
      position_m: [hx, 0, 0],
      direction: [1, 0, 0],
      size_in: size,
      type: 'grooved',
    },
  ]
}

function valveInline(e: CatalogEntry): Connector[] {
  const size = e.pipe_size_in ?? 4.0
  const hx = e.dims_cm[0] / 200
  const type: ConnectionType =
    e.connection === 'flanged' ? 'flanged' : 'grooved'
  return [
    {
      id: 'inlet',
      role: 'inlet',
      position_m: [-hx, 0, 0],
      direction: [-1, 0, 0],
      size_in: size,
      type,
      note: 'upstream / water-supply side',
    },
    {
      id: 'outlet',
      role: 'outlet',
      position_m: [hx, 0, 0],
      direction: [1, 0, 0],
      size_in: size,
      type,
      note: 'downstream / system side',
    },
  ]
}

function flowSwitch(e: CatalogEntry): Connector[] {
  const size = e.pipe_size_in ?? 2.0
  return [
    {
      id: 'pipe_tap',
      role: 'tap',
      position_m: [0, -e.dims_cm[2] / 200, 0],
      direction: [0, -1, 0],
      size_in: size,
      type: 'npt',
      note: 'saddle mount; paddle extends into pipe interior',
    },
  ]
}

function headPendent(e: CatalogEntry): Connector[] {
  return [
    {
      id: 'inlet',
      role: 'inlet',
      position_m: [0, e.dims_cm[2] / 200, 0],
      direction: [0, 1, 0],
      size_in: 0.5,
      type: 'npt',
      note: '1/2" NPT male; mates to 1/2" reducing bushing on branch line',
    },
  ]
}

function headUpright(e: CatalogEntry): Connector[] {
  return [
    {
      id: 'inlet',
      role: 'inlet',
      position_m: [0, -e.dims_cm[2] / 200, 0],
      direction: [0, -1, 0],
      size_in: 0.5,
      type: 'npt',
      note: '1/2" NPT male; mates to branch line from below',
    },
  ]
}

function headSidewall(e: CatalogEntry): Connector[] {
  return [
    {
      id: 'inlet',
      role: 'inlet',
      position_m: [-e.dims_cm[0] / 200, 0, 0],
      direction: [-1, 0, 0],
      size_in: 0.5,
      type: 'npt',
      note: '1/2" NPT male; mates to horizontal branch inside wall cavity',
    },
  ]
}

function gauge(e: CatalogEntry): Connector[] {
  return [
    {
      id: 'pipe_tap',
      role: 'tap',
      position_m: [0, -e.dims_cm[2] / 200, 0],
      direction: [0, -1, 0],
      size_in: 0.25,
      type: 'npt',
      note: '1/4" NPT petcock to riser test port',
    },
  ]
}

// ── public resolver ─────────────────────────────────────────────────

export function connectorsFor(entry: CatalogEntry): Connector[] {
  switch (entry.category) {
    case 'pipe_steel_sch10':
    case 'pipe_steel_sch40':
    case 'pipe_cpvc':
    case 'pipe_copper':
      return pipeSegment(entry)
    case 'fitting_elbow_90':
    case 'fitting_elbow_45':
      return elbow90(entry)
    case 'fitting_tee_equal':
    case 'fitting_tee_reducing':
      return teeEqual(entry)
    case 'fitting_reducer':
      return reducer(entry)
    case 'fitting_coupling_grooved':
    case 'fitting_coupling_flexible':
      return coupling(entry)
    case 'valve_osy_gate':
    case 'valve_butterfly':
    case 'valve_check':
    case 'valve_ball':
      return valveInline(entry)
    case 'riser_flow_switch':
      return flowSwitch(entry)
    case 'riser_pressure_gauge':
      return gauge(entry)
    case 'sprinkler_head_pendant':
    case 'sprinkler_head_concealed':
    case 'sprinkler_head_residential':
      return headPendent(entry)
    case 'sprinkler_head_upright':
      return headUpright(entry)
    case 'sprinkler_head_sidewall':
      return headSidewall(entry)
    default:
      return []
  }
}

/**
 * Compatibility rule: two connectors may mate if their nominal sizes
 * match, their connection types match, and their roles are
 * compatible (outlet↔inlet, coupling↔anything, tap↔nothing-else,
 * branch↔inlet/outlet/coupling but not another branch).
 *
 * AI agents use this to validate proposed connections before placing
 * nodes in the scene tree.
 */
export function canMate(a: Connector, b: Connector): boolean {
  if (a.size_in !== b.size_in) return false
  if (a.type !== b.type) return false
  if (a.role === 'tap' || b.role === 'tap') return false
  if (a.role === 'branch' && b.role === 'branch') return false
  return true
}
