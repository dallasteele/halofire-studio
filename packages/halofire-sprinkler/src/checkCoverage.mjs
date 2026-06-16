const NFPA13_SPACING_LIMITS_FT = {
  light: { min: 15, max: 20 },
  ordinary: { min: 15, max: 20 },
  extra: { min: 10, max: 15 },
}

export function checkCoverage(headSpacingFt, hazardClass) {
  if (typeof headSpacingFt !== 'number' || Number.isNaN(headSpacingFt) || headSpacingFt <= 0) {
    throw new TypeError('headSpacingFt must be a number greater than 0')
  }

  if (!Object.hasOwn(NFPA13_SPACING_LIMITS_FT, hazardClass)) {
    throw new TypeError("hazardClass must be 'light', 'ordinary', or 'extra'")
  }

  const limits = NFPA13_SPACING_LIMITS_FT[hazardClass]
  const violations = []

  if (headSpacingFt < limits.min) {
    violations.push('head spacing too small')
  }

  if (headSpacingFt > limits.max) {
    violations.push('head spacing too large')
  }

  return {
    ok: violations.length === 0,
    violations,
  }
}
