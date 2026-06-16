const FLOW_EXPONENT = 1.85;
const DIAMETER_EXPONENT = 4.87;
const HAZEN_WILLIAMS_COEFFICIENT = 4.52;
const DEFAULT_C = 130;

function frictionLossForSegment({ Q, d, len, C = DEFAULT_C }) {
  if (!Number.isFinite(Q) || Q < 0) {
    throw new Error(`Invalid flow: ${Q}`);
  }
  if (!Number.isFinite(d) || d <= 0) {
    throw new Error(`Invalid diameter: ${d}`);
  }
  if (!Number.isFinite(len) || len < 0) {
    throw new Error(`Invalid length: ${len}`);
  }
  if (!Number.isFinite(C) || C <= 0) {
    throw new Error(`Invalid Hazen-Williams C: ${C}`);
  }

  if (Q === 0 || len === 0) {
    return 0;
  }

  return (
    HAZEN_WILLIAMS_COEFFICIENT *
    Math.pow(Q, FLOW_EXPONENT) /
    (Math.pow(C, FLOW_EXPONENT) * Math.pow(d, DIAMETER_EXPONENT)) *
    len
  );
}

export function frictionLossForRun(segments) {
  if (!Array.isArray(segments)) {
    throw new Error('segments must be an array');
  }

  let totalLossPsi = 0;

  for (const segment of segments) {
    if (!segment || typeof segment !== 'object') {
      throw new Error('Each segment must be an object');
    }
    totalLossPsi += frictionLossForSegment(segment);
  }

  return totalLossPsi;
}
