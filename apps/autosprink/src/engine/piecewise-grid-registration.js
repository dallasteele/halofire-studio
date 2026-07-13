import { sha256Hex } from './elevation-datums.js';
import { validateRasterBullseyeHeadEvidence } from './raster-bullseye-head-evidence.js';

const SHA256 = /^[0-9a-f]{64}$/;
const issue = (code, message) => ({ severity: 'blocking', code, message });
const near = (left, right, tolerance = 1e-6) => Math.abs(left - right) <= tolerance;

export function piecewiseMap(value, sourceControls, targetControls) {
  if (!Array.isArray(sourceControls) || !Array.isArray(targetControls) || sourceControls.length !== targetControls.length || sourceControls.length < 2) return null;
  let index = sourceControls.findIndex((control) => value <= control);
  if (index <= 0) index = 1;
  if (index >= sourceControls.length) index = sourceControls.length - 1;
  const source0 = sourceControls[index - 1]; const source1 = sourceControls[index];
  const target0 = targetControls[index - 1]; const target1 = targetControls[index];
  const ratio = (value - source0) / (source1 - source0);
  return target0 + ratio * (target1 - target0);
}

function globalAffineResidual(source, target) {
  const count = source.length;
  const meanSource = source.reduce((sum, value) => sum + value, 0) / count;
  const meanTarget = target.reduce((sum, value) => sum + value, 0) / count;
  const numerator = source.reduce((sum, value, index) => sum + (value - meanSource) * (target[index] - meanTarget), 0);
  const denominator = source.reduce((sum, value) => sum + (value - meanSource) ** 2, 0);
  const scale = numerator / denominator; const offset = meanTarget - scale * meanSource;
  return Math.max(...source.map((value, index) => Math.abs(scale * value + offset - target[index])));
}

export async function sealPiecewiseGridRegistration(value) {
  const draft = structuredClone(value);
  delete draft.receiptSha256;
  return { ...draft, receiptSha256: await sha256Hex(draft) };
}

export async function validatePiecewiseGridRegistration(value) {
  if (!value || value.artifactType !== 'halofire.piecewise-grid-registration.v1') return { status: 'blocked', issues: [issue('GRID_REGISTRATION_SCHEMA_INVALID', 'Grid registration schema is invalid.')] };
  const issues = []; const { receiptSha256, ...draft } = value;
  if (!SHA256.test(receiptSha256 || '') || await sha256Hex(draft) !== receiptSha256) issues.push(issue('GRID_REGISTRATION_RECEIPT_MISMATCH', 'Grid registration no longer matches its sealed receipt.'));
  if (value.source?.pdfSha256 !== '0fa8d19cf2a8ca421a3cad7200b410763eee701bb566ca84d37321b1b51ce921' || value.target?.pdfSha256 !== '93f8df04bc84ac817ecd2e222812fede93565879094c66b4d7511f783631543e' || !SHA256.test(value.source?.renderedSha256 || '') || !SHA256.test(value.target?.renderedSha256 || '')) issues.push(issue('GRID_REGISTRATION_SOURCE_DRIFT', 'A121 or FP3 source/render identity changed.'));
  const axes = [value.gridX, value.gridY];
  for (const axis of axes) {
    if (!axis || axis.labels?.length !== axis.sourcePx?.length || axis.labels?.length !== axis.targetPx?.length || axis.sourcePx.some((entry, index) => index && entry <= axis.sourcePx[index - 1]) || axis.targetPx.some((entry, index) => index && entry <= axis.targetPx[index - 1])) issues.push(issue('GRID_REGISTRATION_CONTROLS_INVALID', 'Grid controls must be paired, complete, and monotonic.'));
  }
  const ridge = piecewiseMap(value.chapel?.sourceRidgeYPx, value.gridY?.sourcePx, value.gridY?.targetPx);
  if (!near(ridge, value.chapel?.targetRidgeYPx, 1e-4) || value.registrationMode !== 'labeled-piecewise-grid') issues.push(issue('GRID_REGISTRATION_RIDGE_DRIFT', 'A121 ridge no longer maps to the sealed FP3 ridge.'));
  const xResidual = globalAffineResidual(value.gridX.sourcePx, value.gridX.targetPx);
  const yResidual = globalAffineResidual(value.gridY.sourcePx, value.gridY.targetPx);
  if (xResidual < 20 || yResidual < 20 || value.globalTransformRejected !== true) issues.push(issue('GRID_REGISTRATION_GLOBAL_TRANSFORM_NOT_REJECTED', 'Observed revision drift requires piecewise grid registration.'));
  if (value.chapel?.absoluteDeflectorDatumReady !== false || value.projectionReady !== false || value.complianceReady !== false) issues.push(issue('GRID_REGISTRATION_FAIL_CLOSED_STATUS_DRIFT', 'Plane membership cannot enable absolute projection or compliance.'));
  return { status: issues.length ? 'blocked' : 'passed', issues, metrics: { xGlobalAffineMaxResidualPx: xResidual, yGlobalAffineMaxResidualPx: yResidual, targetRidgeYPx: ridge }, projectionReady: false, complianceReady: false };
}

export async function buildWinterGardenChapelPlaneAssignments(registration, headEvidence) {
  const [grid, heads] = await Promise.all([validatePiecewiseGridRegistration(registration), validateRasterBullseyeHeadEvidence(headEvidence)]);
  if (grid.status !== 'passed' || heads.status !== 'passed') return { status: 'blocked', issues: [...grid.issues, ...heads.issues], assignments: [], projectionReady: false, complianceReady: false };
  const x = new Map(registration.gridX.labels.map((label, index) => [label, registration.gridX.targetPx[index]]));
  const y = new Map(registration.gridY.labels.map((label, index) => [label, registration.gridY.targetPx[index]]));
  const bounds = registration.chapel.sourceGridBounds; const ridge = registration.chapel.targetRidgeYPx; const pxPerFt = registration.target.pxPerFt; const slope = registration.chapel.pitchRiseInPer12 / 12;
  const assignments = [];
  for (const point of heads.points) {
    const [pointX, pointY] = point.normalized.map((value, index) => value * registration.target.renderedSizePx[index]);
    if (pointX < x.get(bounds.left) || pointX > x.get(bounds.right) || pointY < y.get(bounds.top) || pointY > y.get(bounds.bottom)) continue;
    const ridgeDelta = pointY - ridge;
    const plane = Math.abs(ridgeDelta) <= 10 ? 'chapel-ridge' : (ridgeDelta < 0 ? 'chapel-north-slope' : 'chapel-south-slope');
    assignments.push({ headId: point.id, plane, renderedPointPx: [pointX, pointY], relativeElevationFromRidgeFt: -Math.abs(ridgeDelta) / pxPerFt * slope });
  }
  const counts = Object.fromEntries(['chapel-north-slope', 'chapel-ridge', 'chapel-south-slope'].map((plane) => [plane, assignments.filter((entry) => entry.plane === plane).length]));
  const issues = [];
  if (assignments.length !== 15 || Object.values(counts).some((count) => count !== 5)) issues.push(issue('CHAPEL_PLANE_ASSIGNMENT_COUNT_DRIFT', 'FP3 chapel must resolve as five north-slope, five ridge, and five south-slope heads.'));
  return { status: issues.length ? 'blocked' : 'passed', artifactType: 'halofire.winter-garden-chapel-plane-assignments.v1', assignments: issues.length ? [] : assignments, counts, roofPlanes: [
    { id: 'chapel-north-slope', polygonPx: [[x.get(bounds.left), y.get(bounds.top)], [x.get(bounds.right), y.get(bounds.top)], [x.get(bounds.right), ridge], [x.get(bounds.left), ridge]], riseIn: 4.5, runIn: 12 },
    { id: 'chapel-south-slope', polygonPx: [[x.get(bounds.left), ridge], [x.get(bounds.right), ridge], [x.get(bounds.right), y.get(bounds.bottom)], [x.get(bounds.left), y.get(bounds.bottom)]], riseIn: 4.5, runIn: 12 },
  ], issues, projectionReady: false, complianceReady: false, residual: 'absolute_deflector_datum_unresolved' };
}
