/**
 * Sprinkler head placement validator.
 *
 * Given a proposed head position + ceiling context + hazard class, returns
 * PASS/FAIL and a list of rule violations. Phase 3 fills out the rules.
 */

import type { HazardClass } from './hazard-class.js'
import type { Head } from './head.js'

/** World-space context around a proposed head placement. */
export interface PlacementContext {
  /** Position of the head in world-space meters [x, y, z] */
  position: [number, number, number]
  /** Head orientation + catalog entry */
  head: Head
  /** Ceiling height above the finish floor in meters */
  ceiling_height_m: number
  /** Hazard class of the area */
  hazard: HazardClass
  /** Nearest wall distance (meters). Walls within 0.5 × max_spacing are relevant. */
  nearest_wall_distance_m: number
  /** Other head positions within 2 × max_spacing of this one */
  neighbors: { position: [number, number, number]; head: Head }[]
  /** Obstructions (beams, columns, ducts) within the head's throw radius */
  obstructions: { bbox_min: [number, number, number]; bbox_max: [number, number, number] }[]
}

export type RuleId =
  | 'max_spacing'
  | 'max_distance_from_wall'
  | 'max_coverage_area'
  | 'obstruction_3x_rule'
  | 'obstruction_4x_rule'
  | 'min_distance_between_heads'
  | 'deflector_to_ceiling'

export interface RuleViolation {
  rule: RuleId
  severity: 'warning' | 'error'
  message: string
  /** Cite the NFPA 13 section being violated. */
  code_cite: string
}

export interface PlacementResult {
  passed: boolean
  violations: RuleViolation[]
}

/**
 * Stub validator — Phase 3 implements the full rule set.
 */
export function validatePlacement(_ctx: PlacementContext): PlacementResult {
  return {
    passed: true,
    violations: [
      {
        rule: 'max_spacing',
        severity: 'warning',
        message:
          'NFPA 13 rules engine not yet implemented. See HALOFIRE_ROADMAP Phase 3.',
        code_cite: 'NFPA 13-2022 Ch 11.2 (stub)',
      },
    ],
  }
}
