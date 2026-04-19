/**
 * NFPA 13 2022 hazard classifications.
 *
 * Drives max head spacing, max coverage per head, and density curves for
 * hydraulic calcs. Values cited here are from NFPA 13 2022 Table 11.2.3.1.1
 * (sprinkler protection area limitations for light and ordinary hazard
 * occupancies). Full-code subscription required for production use; double-
 * check every value against the current edition before any real bid.
 */

export const HazardClass = {
  LIGHT: 'light',
  ORDINARY_I: 'ordinary_i',
  ORDINARY_II: 'ordinary_ii',
  EXTRA_I: 'extra_i',
  EXTRA_II: 'extra_ii',
} as const

export type HazardClass = (typeof HazardClass)[keyof typeof HazardClass]

/**
 * Head spacing limits per hazard class. Dimensions in feet (NFPA is imperial).
 * Convert to meters for display as needed.
 */
export const SPACING_LIMITS_FT = {
  [HazardClass.LIGHT]: {
    max_coverage_sq_ft: 225,
    max_spacing_ft: 15,
    max_distance_from_wall_ft: 7.5,
  },
  [HazardClass.ORDINARY_I]: {
    max_coverage_sq_ft: 130,
    max_spacing_ft: 15,
    max_distance_from_wall_ft: 7.5,
  },
  [HazardClass.ORDINARY_II]: {
    max_coverage_sq_ft: 130,
    max_spacing_ft: 15,
    max_distance_from_wall_ft: 7.5,
  },
  [HazardClass.EXTRA_I]: {
    max_coverage_sq_ft: 100,
    max_spacing_ft: 12,
    max_distance_from_wall_ft: 6,
  },
  [HazardClass.EXTRA_II]: {
    max_coverage_sq_ft: 100,
    max_spacing_ft: 12,
    max_distance_from_wall_ft: 6,
  },
} as const

/**
 * Minimum design density (gpm per sq ft) over a remote design area,
 * from NFPA 13 Figure 19.2.3.1.1.
 * These are starting points for density/area method calcs.
 */
export const DENSITY_GPM_PER_SQFT = {
  [HazardClass.LIGHT]: 0.1,
  [HazardClass.ORDINARY_I]: 0.15,
  [HazardClass.ORDINARY_II]: 0.2,
  [HazardClass.EXTRA_I]: 0.3,
  [HazardClass.EXTRA_II]: 0.4,
} as const
