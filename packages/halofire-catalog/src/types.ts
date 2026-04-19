/**
 * Catalog entry + category types.
 */

export type ComponentCategory =
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

export type MountingClass =
  | 'floor_standing'      // stands on floor (valves, risers, FDC)
  | 'ceiling_flush'       // mounts flush to ceiling (recessed head, concealed)
  | 'ceiling_pendent'     // hangs below ceiling (pendant head)
  | 'ceiling_upright'     // points up from below ceiling (upright head)
  | 'wall_mount'          // attaches to vertical wall (sidewall head, FDC)
  | 'pipe_inline'         // inserts into a pipe run (fitting, valve, coupling)
  | 'pipe_segment'        // the pipe itself (stretches between two fittings)

export interface CatalogEntry {
  /** Unique SKU — e.g. "SM_Head_Pendant_VK102_K56" */
  sku: string
  /** Display name */
  name: string
  category: ComponentCategory
  mounting: MountingClass

  /** Manufacturer; "(generic)" for open-authored components */
  manufacturer: string
  /** Model number */
  model: string

  /** GLB mesh path relative to this package (assets/glb/...) */
  glb_path: string
  /** Nominal overall dimensions in cm [L, D, H] */
  dims_cm: [number, number, number]

  /** Pipe size in inches (pipes + fittings) */
  pipe_size_in?: number
  /** K-factor (heads) — metric GPM/psi^0.5 */
  k_factor?: number
  /** Temperature rating in Fahrenheit (heads) */
  temp_rating_f?: number
  /** Response type (heads) */
  response?: 'fast' | 'standard'
  /** Thread/connection type */
  connection?: 'npt' | 'grooved' | 'flanged' | 'solvent_weld'

  /** Finish description */
  finish?: string

  /** Free-form notes */
  notes?: string

  /** Open-source? If false, mesh is loaded on-demand at bid time */
  open_source: boolean
}
