/**
 * Sprinkler head catalog types.
 *
 * Phase 3 will populate a concrete catalog of manufacturer SKUs (Victaulic
 * VK102, Tyco TY-FRB, Reliable F1-FR56, Viking Micromatic etc.) loaded
 * from manufacturer BIM or measured from spec sheets.
 */

export type HeadOrientation =
  | 'pendant'
  | 'upright'
  | 'sidewall'
  | 'concealed'
  | 'horizontal_sidewall'
  | 'vertical_sidewall'

/** K-factor nominal values (metric-adjusted GPM/psi^0.5). */
export type KFactor = 2.8 | 4.2 | 5.6 | 8.0 | 11.2 | 14.0 | 16.8 | 22.4 | 25.2

export interface Head {
  /** Manufacturer + model (e.g. "Victaulic VK102") */
  model: string
  manufacturer: string
  orientation: HeadOrientation
  k_factor: KFactor
  /** Response time index: fast | standard */
  response: 'fast' | 'standard'
  /** Temperature rating in Fahrenheit (135, 155, 165, 175, 200, 286, ...) */
  temp_rating_f: number
  /** Finish (chrome, bright brass, white polyester, etc.) */
  finish: string
  /** Thread size (1/2 in NPT typical) */
  thread: string
  /** GLB mesh path for 3D visualization */
  mesh_glb?: string
  /** Overall height in mm for visual placement */
  height_mm: number
  /** Deflector diameter in mm */
  deflector_diameter_mm: number
}
