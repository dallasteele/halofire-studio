const MAX_COVERAGE_SQ_FT_PER_HEAD = Object.freeze({
  Light: 150,
  Ordinary: 125,
  Extra: 100,
})

export function maxCoverageSqFtPerHead(hazardClass) {
  const maxCoverage = MAX_COVERAGE_SQ_FT_PER_HEAD[hazardClass]

  if (maxCoverage === undefined) {
    throw new RangeError(`Unknown hazard class: ${hazardClass}`)
  }

  return maxCoverage
}

export function headsForArea(areaSqFt, hazardClass) {
  return areaSqFt / maxCoverageSqFtPerHead(hazardClass)
}
