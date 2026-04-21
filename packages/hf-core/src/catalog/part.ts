/**
 * Part catalog schema — the authoritative bridge between OpenSCAD
 * geometry and the Pascal scene. Types only; no fs / path imports.
 *
 * Source of truth: docs/CORE_ARCHITECTURE.md §4.1 and
 * docs/blueprints/03_CATALOG_ENGINE.md §1 (annotation grammar).
 */

export type PartKind =
  | 'sprinkler_head'
  | 'pipe_segment'
  | 'fitting'
  | 'valve'
  | 'hanger'
  | 'device'
  | 'fdc'
  | 'riser_assy'
  | 'compound'
  | 'structural'
  | 'unknown'

/**
 * Dotted category — `kind.sub.spec`. The set is extensible; listing
 * the documented catalog-v1 values here so TS users get autocomplete
 * while still allowing unknown firm-override categories as strings.
 */
export type PartCategory =
  | 'head.pendant.k56'
  | 'head.pendant.k80'
  | 'head.pendant.esfr.k112'
  | 'head.upright.k56'
  | 'head.upright.k80'
  | 'head.sidewall.k56'
  | 'head.sidewall.k80'
  | 'head.concealed.cover'
  | 'pipe.sch10.grooved'
  | 'pipe.sch10.threaded'
  | 'pipe.sch40.threaded'
  | 'pipe.cpvc.blazemaster'
  | 'fitting.tee.grooved'
  | 'fitting.tee.reducing'
  | 'fitting.elbow90.grooved'
  | 'fitting.elbow45.grooved'
  | 'fitting.cross'
  | 'fitting.reducer.concentric'
  | 'fitting.reducer.eccentric'
  | 'fitting.cap'
  | 'fitting.flange.150'
  | 'fitting.union'
  | 'valve.gate.osy'
  | 'valve.butterfly.grooved'
  | 'valve.check.swing'
  | 'valve.alarm.check.wet'
  | 'valve.rpz.backflow'
  | 'valve.ball.threaded'
  | 'valve.globe'
  | 'hanger.clevis'
  | 'hanger.trapeze'
  | 'hanger.seismic.sway'
  | 'hanger.c.clamp.beam'
  | 'hanger.band.iron'
  | 'device.flow.switch'
  | 'device.tamper.switch'
  | 'device.pressure.switch'
  | 'device.gauge.liquid'
  | 'fdc.2.5in.stortz'
  // fall-through for firm overrides / future parts
  | (string & { readonly __brand?: 'PartCategory' })

export type ConnectionStyle =
  | 'NPT_threaded'
  | 'grooved'
  | 'flanged.150'
  | 'flanged.300'
  | 'solvent_welded'
  | 'soldered'
  | 'stortz'
  | 'none'

export type PortRole = 'run_a' | 'run_b' | 'branch' | 'drop'

export interface ConnectionPort {
  /** Human-readable port name from `@port <name>` annotation. */
  name: string
  /** Local-frame position in meters. */
  position_m: [number, number, number]
  /** Unit vector pointing OUT of the part. */
  direction: [number, number, number]
  style: ConnectionStyle
  size_in: number
  role: PortRole
}

export type ScadParamType =
  | { kind: 'number'; min?: number; max?: number }
  | { kind: 'enum'; values: Array<number | string> }
  | { kind: 'string' }
  | { kind: 'bool' }

export interface ScadParam {
  name: string
  type: ScadParamType
  default?: number | string | boolean
  label?: string
  unit?: string
}

export interface PartPricing {
  list_usd: number
  stale_at?: string
  source?: 'static' | 'crawler' | 'manual'
}

export interface PartLabor {
  minutes_install: number
  crew_role: 'foreman' | 'journeyman' | 'apprentice' | 'mixed'
}

export interface PartNfpa {
  k_factor?: number
  orientation?: 'pendant' | 'upright' | 'sidewall' | 'concealed'
  response?: 'standard' | 'quick' | 'esfr'
  temperature?: string
  listing?: string
  hazardClasses?: string[]
}

export interface ScadSource {
  scadFile: string
  paramSchema: Record<string, ScadParam>
  defaults: Record<string, number | string | boolean>
}

export interface Part {
  sku: string
  kind: PartKind
  category: PartCategory
  displayName: string
  manufacturer?: string
  mfgPartNumber?: string
  scad: ScadSource
  ports: ConnectionPort[]
  nfpa: PartNfpa
  pricing: PartPricing
  labor: PartLabor
  weight_kg?: number
  thumbnailPng?: string
  defaultGlb?: string
  tags?: string[]
}

export interface PartMeta {
  slug: string
  kind: PartKind
  category: PartCategory
  displayName: string
  manufacturer?: string
  mfgPartNumber?: string
  listing?: string
  hazardClasses?: string[]
  priceUsd?: number
  installMinutes?: number
  crewRole?: PartLabor['crew_role']
  weightKg?: number
  kFactor?: number
  orientation?: PartNfpa['orientation']
  response?: PartNfpa['response']
  temperature?: string
  thumbnail?: string
  tags?: string[]
}
