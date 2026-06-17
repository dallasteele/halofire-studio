const EPS = 1e-6;

export const LOCAL_RUN_AXIS = Object.freeze([0, 1, 0]);
export const LOCAL_OUTLET_AXIS = Object.freeze([0, 0, -1]);

function finiteVec3(axis, label) {
  if (!Array.isArray(axis) || axis.length !== 3) {
    throw new Error(`${label} must be a 3-vector`);
  }
  const out = axis.map((v) => Number(v));
  if (out.some((v) => !Number.isFinite(v))) {
    throw new Error(`${label} must contain finite numbers`);
  }
  return out;
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function length(axis) {
  return Math.hypot(axis[0], axis[1], axis[2]);
}

export function normalizeAxis(axis, label = 'axis') {
  const vec = finiteVec3(axis, label);
  const len = length(vec);
  if (len < EPS) {
    throw new Error(`${label} must be non-zero`);
  }
  return vec.map((v) => v / len);
}

export function normalizeRunAxis(axis) {
  const [x, y] = finiteVec3(axis, 'runAxis');
  const len = Math.hypot(x, y);
  if (len < EPS) {
    throw new Error('runAxis must have a non-zero XY projection');
  }
  return [x / len, y / len, 0];
}

export function stablePerpendicularAxis(runAxis, preferred = [0, 0, -1]) {
  const run = normalizeAxis(runAxis, 'runAxis');
  const pref = normalizeAxis(preferred, 'preferredAxis');
  let axis = [
    pref[0] - dot(pref, run) * run[0],
    pref[1] - dot(pref, run) * run[1],
    pref[2] - dot(pref, run) * run[2],
  ];
  if (length(axis) < EPS) {
    const fallback = Math.abs(run[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    axis = cross(run, fallback);
  }
  return normalizeAxis(axis, 'perpendicularAxis');
}

export function orthogonalOutletAxis(runAxis, outletAxis) {
  const run = normalizeAxis(runAxis, 'runAxis');
  if (!outletAxis) return stablePerpendicularAxis(run);
  const raw = normalizeAxis(outletAxis, 'outletAxis');
  const ortho = [
    raw[0] - dot(raw, run) * run[0],
    raw[1] - dot(raw, run) * run[1],
    raw[2] - dot(raw, run) * run[2],
  ];
  if (length(ortho) < EPS) {
    throw new Error('outletAxis must not be parallel to runAxis');
  }
  return normalizeAxis(ortho, 'outletAxis');
}

export function fittingBasis(runAxis, outletAxis) {
  const yAxis = normalizeAxis(runAxis, 'runAxis');
  const outlet = orthogonalOutletAxis(yAxis, outletAxis);
  let zAxis = outlet.map((v) => -v);
  let xAxis = cross(yAxis, zAxis);
  xAxis = normalizeAxis(xAxis, 'basisXAxis');
  zAxis = normalizeAxis(cross(xAxis, yAxis), 'basisZAxis');
  return {
    xAxis,
    yAxis,
    zAxis,
    outletAxis: zAxis.map((v) => -v),
  };
}

export function fittingRotationMatrix(runAxis, outletAxis) {
  const basis = fittingBasis(runAxis, outletAxis);
  return [
    [basis.xAxis[0], basis.yAxis[0], basis.zAxis[0]],
    [basis.xAxis[1], basis.yAxis[1], basis.zAxis[1]],
    [basis.xAxis[2], basis.yAxis[2], basis.zAxis[2]],
  ];
}

export function transformVector(matrix, vector) {
  const v = finiteVec3(vector, 'vector');
  if (!Array.isArray(matrix) || matrix.length !== 3 || matrix.some((row) => !Array.isArray(row) || row.length !== 3)) {
    throw new Error('matrix must be a 3x3 array');
  }
  return [
    matrix[0][0] * v[0] + matrix[0][1] * v[1] + matrix[0][2] * v[2],
    matrix[1][0] * v[0] + matrix[1][1] * v[1] + matrix[1][2] * v[2],
    matrix[2][0] * v[0] + matrix[2][1] * v[1] + matrix[2][2] * v[2],
  ];
}

const SQRT1_2 = Math.SQRT1_2;
const RAW_CONNECTION_PORTS = Object.freeze({
  fitting_tee: [
    { id: 'run-a', position: [0, -0.5, 0], axis: [0, -1, 0] },
    { id: 'run-b', position: [0, 0.5, 0], axis: [0, 1, 0] },
    { id: 'outlet', position: [0, 0, -0.5], axis: [0, 0, -1] },
  ],
  fitting_cross: [
    { id: 'run-a', position: [0, -0.5, 0], axis: [0, -1, 0] },
    { id: 'run-b', position: [0, 0.5, 0], axis: [0, 1, 0] },
    { id: 'branch-a', position: [-0.5, 0, 0], axis: [-1, 0, 0] },
    { id: 'branch-b', position: [0.5, 0, 0], axis: [1, 0, 0] },
  ],
  fitting_elbow_90: [
    { id: 'run', position: [0, -0.5, 0], axis: [0, -1, 0] },
    { id: 'outlet', position: [0, 0, -0.5], axis: [0, 0, -1] },
  ],
  fitting_elbow_45: [
    { id: 'run', position: [0, -0.5, 0], axis: [0, -1, 0] },
    { id: 'outlet', position: [0, 0.35, -0.35], axis: [0, SQRT1_2, -SQRT1_2] },
  ],
  fitting_coupling: [
    { id: 'run-a', position: [0, -0.5, 0], axis: [0, -1, 0] },
    { id: 'run-b', position: [0, 0.5, 0], axis: [0, 1, 0] },
  ],
  fitting_reducer: [
    { id: 'large-end', position: [0, -0.5, 0], axis: [0, -1, 0] },
    { id: 'small-end', position: [0, 0.5, 0], axis: [0, 1, 0] },
  ],
});

export function connectionPortsFor(componentKey) {
  return (RAW_CONNECTION_PORTS[componentKey] || []).map((port) => ({
    id: port.id,
    position: [...port.position],
    axis: [...port.axis],
  }));
}

export function createFittingPlacement(componentKey, runAxis, outletAxis, opts = {}) {
  const basis = fittingBasis(runAxis, outletAxis);
  const matrix = fittingRotationMatrix(basis.yAxis, basis.outletAxis);
  const ports = connectionPortsFor(componentKey).map((port) => ({
    id: port.id,
    position: port.position,
    axis: port.axis,
    worldAxis: normalizeAxis(transformVector(matrix, port.axis), `connectionPort:${port.id}`),
  }));
  return {
    runAxis: [...basis.yAxis],
    outletAxis: [...basis.outletAxis],
    rotationMatrix: matrix,
    basis: {
      xAxis: [...basis.xAxis],
      yAxis: [...basis.yAxis],
      zAxis: [...basis.zAxis],
    },
    connectionPorts: ports,
    ...opts,
  };
}
