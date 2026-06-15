const HAZEN_WILLIAMS_COEFFICIENT = 4.52
const FLOW_EXPONENT = 1.85
const DIAMETER_EXPONENT = 4.87

export function frictionLossPsiPerFt(gpm, pipeInnerDiaIn, C) {
  if (!Number.isFinite(gpm) || !Number.isFinite(pipeInnerDiaIn) || !Number.isFinite(C)) {
    throw new TypeError('frictionLossPsiPerFt: all arguments must be finite numbers')
  }
  if (gpm < 0) {
    throw new RangeError('frictionLossPsiPerFt: gpm must be >= 0')
  }
  if (pipeInnerDiaIn <= 0) {
    throw new RangeError('frictionLossPsiPerFt: pipeInnerDiaIn must be > 0')
  }
  if (C <= 0) {
    throw new RangeError('frictionLossPsiPerFt: C must be > 0')
  }

  const numerator = HAZEN_WILLIAMS_COEFFICIENT * gpm ** FLOW_EXPONENT
  const denominator = C ** FLOW_EXPONENT * pipeInnerDiaIn ** DIAMETER_EXPONENT
  return numerator / denominator
}
