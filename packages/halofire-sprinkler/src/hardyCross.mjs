const HW_EXPONENT = 1.852;
const HW_CONSTANT = 4.52;
const MIN_FLOW = 1e-9;
const MAX_ITERATIONS = 1000;

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function segmentResistance(segment) {
  const length = Math.max(0, finiteNumber(segment.len));
  const diameter = finiteNumber(segment.d);
  if (!(diameter > 0) || length === 0) {
    return 0;
  }
  return (HW_CONSTANT * length) / Math.pow(diameter, 4.8704);
}

function segmentImbalance(segment, flow) {
  const resistance = segmentResistance(segment);
  if (resistance === 0 || flow === 0) {
    return 0;
  }
  return resistance * Math.pow(Math.abs(flow), HW_EXPONENT) * Math.sign(flow);
}

function segmentSlope(segment, flow) {
  const resistance = segmentResistance(segment);
  const magnitude = Math.max(Math.abs(flow), MIN_FLOW);
  if (resistance === 0) {
    return 0;
  }
  return HW_EXPONENT * resistance * Math.pow(magnitude, HW_EXPONENT - 1);
}

function buildFlowTable(loops) {
  const flows = new Map();
  for (const loop of loops) {
    const segments = Array.isArray(loop?.segments) ? loop.segments : [];
    const initialFlows = Array.isArray(loop?.initialFlows) ? loop.initialFlows : [];
    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index];
      if (!segment || segment.id == null || flows.has(segment.id)) {
        continue;
      }
      const seededFlow = index < initialFlows.length ? initialFlows[index] : segment.Q;
      flows.set(segment.id, finiteNumber(seededFlow));
    }
  }
  return flows;
}

export function balanceLoops(loops, tol = 1e-6) {
  const loopList = Array.isArray(loops) ? loops : [];
  const tolerance = Math.max(finiteNumber(tol, 1e-6), 0);
  const flows = buildFlowTable(loopList);

  let maxResidual = Infinity;
  let iteration = 0;

  while (iteration < MAX_ITERATIONS) {
    maxResidual = 0;

    for (const loop of loopList) {
      const segments = Array.isArray(loop?.segments) ? loop.segments : [];
      let sumImbalance = 0;
      let sumSlope = 0;

      for (const segment of segments) {
        if (!segment || segment.id == null) {
          continue;
        }
        const flow = flows.get(segment.id) ?? finiteNumber(segment.Q);
        sumImbalance += segmentImbalance(segment, flow);
        sumSlope += segmentSlope(segment, flow);
      }

      const residual = Math.abs(sumImbalance);
      if (residual > maxResidual) {
        maxResidual = residual;
      }

      if (!(sumSlope > 0)) {
        continue;
      }

      const delta = -sumImbalance / sumSlope;
      for (const segment of segments) {
        if (!segment || segment.id == null) {
          continue;
        }
        const flow = flows.get(segment.id) ?? finiteNumber(segment.Q);
        flows.set(segment.id, flow + delta);
      }
    }

    if (maxResidual < tolerance) {
      return {
        flows: Object.fromEntries(flows),
        maxResidual,
        converged: true,
      };
    }

    iteration += 1;
  }

  return {
    flows: Object.fromEntries(flows),
    maxResidual: Number.isFinite(maxResidual) ? maxResidual : 0,
    converged: false,
  };
}
