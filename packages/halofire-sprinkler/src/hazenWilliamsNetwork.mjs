const FLOW_EXPONENT = 1.85;
const DIAMETER_EXPONENT = 4.87;
const HAZEN_WILLIAMS_COEFFICIENT = 4.52;
const DEFAULT_C = 130;

function frictionLossForSegment({ Q, d, len, C = DEFAULT_C }) {
  return (
    HAZEN_WILLIAMS_COEFFICIENT *
    Math.pow(Q, FLOW_EXPONENT) /
    (Math.pow(C, FLOW_EXPONENT) * Math.pow(d, DIAMETER_EXPONENT)) *
    len
  );
}

export function frictionLossForRun(segments) {
  let totalLossPsi = 0;

  for (const segment of segments) {
    totalLossPsi += frictionLossForSegment(segment);
  }

  return totalLossPsi;
}
