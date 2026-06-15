const HAZEN_WILLIAMS_COEFFICIENT = 4.52;
const FLOW_EXPONENT = 1.85;
const DIAMETER_EXPONENT = 4.87;

export function frictionLossPsiPerFt(gpm, pipeInnerDiaIn, C) {
  if (!Number.isFinite(gpm) || !Number.isFinite(pipeInnerDiaIn) || !Number.isFinite(C)) {
    throw new TypeError('frictionLossPsiPerFt expects finite numeric arguments');
  }
  if (pipeInnerDiaIn <= 0) {
    throw new RangeError('pipeInnerDiaIn must be greater than 0');
  }
  if (C <= 0) {
    throw new RangeError('C must be greater than 0');
  }
  if (gpm <= 0) {
    return 0;
  }

  const numerator = HAZEN_WILLIAMS_COEFFICIENT * Math.pow(gpm, FLOW_EXPONENT);
  const denominator =
    Math.pow(C, FLOW_EXPONENT) * Math.pow(pipeInnerDiaIn, DIAMETER_EXPONENT);

  return numerator / denominator;
}
