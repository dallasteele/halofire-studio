/**
 * Catalog entry + category types.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * SOURCE OF TRUTH (Phase D.1 reconcile — 2026-04-21)
 * ─────────────────────────────────────────────────────────────────────────
 *
 * The **canonical** catalog schema is the JSON emitted by
 * `scripts/build-catalog.ts` into
 * `packages/halofire-catalog/catalog.json`, which is itself derived from
 * `@part / @kind / @category / @mfg / @param / @port / ...` annotations
 * in `packages/halofire-catalog/authoring/scad/*.scad`.
 *
 *   .scad annotations  →  build-catalog.ts  →  catalog.json  →  loadCatalog()
 *                                                             (zod-validated)
 *
 * Consumers (hf-core, editor, placer/router/BOM agents) read the JSON
 * via `@halofire/core/catalog/load`. The `CatalogEntry` type below is
 * the TS mirror of one element of `catalog.parts[]` in that JSON.
 *
 * The OLD hard-coded `CATALOG` array in `manifest.ts` — with fields like
 * `dims_cm`, `mounting`, `glb_path`, `connection`, `finish`, `open_source`
 * — is retained as `LegacyCatalogEntry` for three existing consumers
 * (`CatalogPanel`, `SceneBootstrap`, `FireProtectionPanel`) + the legacy
 * `connectors.ts` / `material.ts` helpers. Do NOT add new code against
 * the legacy shape. Everything new must go through the JSON path.
 * ─────────────────────────────────────────────────────────────────────────
 */

// ── Canonical part-kind vocabulary ──────────────────────────────────────
// Mirrors `PartKind` in `@halofire/core/catalog/part` — kept in sync by
// the SCAD annotation grammar. `@kind <value>` in a .scad header writes
// directly into `CatalogEntry.kind`.
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

// ── Parameter schema (matches what `parseScad` emits) ───────────────────
export type CatalogParamType =
  | { kind: 'number'; min?: number; max?: number }
  | { kind: 'enum'; values: Array<number | string> }
  | { kind: 'string' }
  | { kind: 'bool' }

export interface CatalogParam {
  /** Parameter name (matches the .scad `<name> = <default>` variable). */
  name: string
  type: CatalogParamType
  default?: number | string | boolean
  label?: string
  unit?: string
}

// ── Connection port vocabulary ─────────────────────────────────────────
export type CatalogPortStyle =
  | 'NPT_threaded'
  | 'grooved'
  | 'flanged.150'
  | 'flanged.300'
  | 'solvent_welded'
  | 'soldered'
  | 'stortz'
  | 'none'

export type CatalogPortRole = 'run_a' | 'run_b' | 'branch' | 'drop'

export interface CatalogPort {
  /** Port name from `@port <name>` (e.g. "in", "out", "branch"). */
  name: string
  /** Local-frame position in METERS (origin = part's geometric center). */
  position_m: [number, number, number]
  /** Unit vector pointing OUT of the part. */
  direction: [number, number, number]
  style: CatalogPortStyle
  size_in: number
  role: CatalogPortRole
}

/**
 * Canonical catalog entry — one element of `catalog.parts[]` in the
 * generated `catalog.json`. Field names are snake_case because JSON-on-
 * disk is snake_case, and consumers across Python (placer / router /
 * BOM) and TS alike read this shape.
 *
 * Annotation sources (from `@`-comments in the .scad file):
 *   @part <slug>          →  sku
 *   @kind <kind>          →  kind
 *   @category <dotted>    →  category
 *   @display-name "..."   →  display_name
 *   @mfg <name>           →  manufacturer
 *   @mfg-pn <pn>          →  mfg_part_number
 *   @listing UL FM ...    →  listing
 *   @hazard-classes ...   →  hazard_classes
 *   @price-usd <num>      →  price_usd
 *   @install-minutes <n>  →  install_minutes
 *   @crew <role>          →  crew
 *   @k-factor <num>       →  k_factor    (heads only)
 *   @orientation <kind>   →  orientation (heads only)
 *   @response <kind>      →  response    (heads only)
 *   @temperature <spec>   →  temperature (heads only)
 *   @param <name> ...     →  params[name]
 *   @port <name> ...      →  ports[]
 */
export interface CatalogEntry {
  /** Unique SKU — matches the `@part <slug>` annotation. Also the GLB filename stem. */
  sku: string
  /** Part kind — dispatches agent rules (placer / router / BOM). */
  kind: PartKind
  /** Dotted category (e.g. "head.pendant.k56", "pipe.sch10.grooved"). */
  category: string
  /** Human-readable display name. */
  display_name: string

  manufacturer?: string
  mfg_part_number?: string
  listing?: string
  hazard_classes?: string[]

  price_usd?: number
  /** Minutes of install labor per unit. */
  install_minutes?: number
  /** Crew role: "foreman" | "journeyman" | "apprentice" | "mixed" (string, not enforced). */
  crew?: string

  weight_kg?: number

  // ── NFPA-13 head metadata (optional; heads only) ─────────────────────
  /** K-factor (GPM/psi^0.5). Heads only. */
  k_factor?: number
  /** "pendant" | "upright" | "sidewall" | "concealed" (string, not enforced). */
  orientation?: string
  /** "standard" | "quick" | "esfr" (string, not enforced). */
  response?: string
  /** Thermal element rating, e.g. "155F", "200F". */
  temperature?: string

  /** SCAD `@param` declarations, keyed by param name. */
  params: Record<string, CatalogParam>
  /** SCAD `@port` declarations, in source order. */
  ports: CatalogPort[]

  /** Source file name (relative to `authoring/scad/`), for traceability. */
  scad_source: string
  /** Non-fatal warnings raised by `parseScad()`. */
  warnings: string[]
}

/** The envelope emitted at the top of `catalog.json`. */
export interface CatalogManifest {
  schema_version: 1
  catalog_version: string
  /** ISO-8601 timestamp of the build. */
  generated_at: string
  parts: CatalogEntry[]
}

// ─────────────────────────────────────────────────────────────────────────
// LEGACY — retained for in-memory CATALOG array in `manifest.ts` and
// the three existing editor consumers (CatalogPanel, SceneBootstrap,
// FireProtectionPanel). Do NOT extend.
// ─────────────────────────────────────────────────────────────────────────

export type LegacyComponentCategory =
  | 'sprinkler_head_pendant'
  | 'sprinkler_head_upright'
  | 'sprinkler_head_sidewall'
  | 'sprinkler_head_concealed'
  | 'sprinkler_head_dry_type'
  | 'sprinkler_head_residential'
  | 'pipe_steel_sch10'
  | 'pipe_steel_sch40'
  | 'pipe_cpvc'
  | 'pipe_copper'
  | 'fitting_elbow_90'
  | 'fitting_elbow_45'
  | 'fitting_tee_equal'
  | 'fitting_tee_reducing'
  | 'fitting_reducer'
  | 'fitting_coupling_grooved'
  | 'fitting_coupling_flexible'
  | 'valve_osy_gate'
  | 'valve_butterfly'
  | 'valve_check'
  | 'valve_ball'
  | 'valve_backflow'
  | 'valve_pressure_reducing'
  | 'riser_manifold'
  | 'riser_flow_switch'
  | 'riser_tamper_switch'
  | 'riser_pressure_gauge'
  | 'riser_test_drain'
  | 'hanger_clevis'
  | 'hanger_ring'
  | 'hanger_seismic_brace'
  | 'external_fdc'
  | 'external_alarm_bell'
  | 'external_piv'
  | 'external_standpipe'
  | 'sign_hydraulic_placard'

export type LegacyMountingClass =
  | 'floor_standing'
  | 'ceiling_flush'
  | 'ceiling_pendent'
  | 'ceiling_upright'
  | 'wall_mount'
  | 'pipe_inline'
  | 'pipe_segment'

/**
 * @deprecated Use `CatalogEntry` (the generated JSON shape) for any new
 * code. This type only describes the legacy hard-coded `CATALOG` array
 * in `manifest.ts`.
 */
export interface LegacyCatalogEntry {
  sku: string
  name: string
  category: LegacyComponentCategory
  mounting: LegacyMountingClass
  manufacturer: string
  model: string
  glb_path: string
  dims_cm: [number, number, number]
  pipe_size_in?: number
  k_factor?: number
  temp_rating_f?: number
  response?: 'fast' | 'standard'
  connection?: 'npt' | 'grooved' | 'flanged' | 'solvent_weld'
  finish?: string
  notes?: string
  open_source: boolean
}

// Back-compat aliases so existing external imports keep resolving. Once
// every consumer migrates, these can be removed.
/** @deprecated alias of LegacyComponentCategory */
export type ComponentCategory = LegacyComponentCategory
/** @deprecated alias of LegacyMountingClass */
export type MountingClass = LegacyMountingClass
