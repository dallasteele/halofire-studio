export const MAX_COVERAGE_SQ_FT_PER_HEAD = {
  light: 225,
  ordinary_i: 130,
  ordinary_ii: 130,
  extra_i: 100,
  extra_ii: 100,
}

export function minHeadsForRoom(areaSqFt, hazardClass) {
  if (!Number.isFinite(areaSqFt) || areaSqFt <= 0) {
    throw new TypeError('areaSqFt must be a finite number greater than 0')
  }

  if (!Object.hasOwn(MAX_COVERAGE_SQ_FT_PER_HEAD, hazardClass)) {
    throw new TypeError('hazardClass must be a supported NFPA-13 hazard class')
  }

  return Math.ceil(areaSqFt / MAX_COVERAGE_SQ_FT_PER_HEAD[hazardClass])
}
