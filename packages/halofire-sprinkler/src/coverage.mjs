const MAX_COVERAGE_SQ_FT_PER_HEAD = Object.freeze({
  Light: 150,
  Ordinary: 175,
  Extra: 225,
})

/**
 * Maximum sprinkler coverage area in square feet by coarse hazard class.
 * Values are hard-coded from the task handoff's NFPA 13 table reference.
 */
export function maxCoverageSqFtPerHead(hazardClass) {
  const value = MAX_COVERAGE_SQ_FT_PER_HEAD[hazardClass]

  if (value === undefined) {
    throw new RangeError(`Unknown hazard class: ${hazardClass}`)
  }

  return value
}

/**
 * Minimum sprinkler head count needed to cover a floor area.
 * Uses the coarse hazard-class coverage cap and rounds partial heads up.
 */
export function headsForArea(areaSqFt, hazardClass) {
  return Math.ceil(areaSqFt / maxCoverageSqFtPerHead(hazardClass))
}
