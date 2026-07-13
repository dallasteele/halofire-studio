import { sha256Hex } from './elevation-datums.js';
import { buildWinterGardenChapelPlaneAssignments } from './piecewise-grid-registration.js';

const SHA256 = /^[0-9a-f]{64}$/;
const issue = (code, message) => ({ severity: 'blocking', code, message });
const expectedSegmentIds = ['branch-north', 'branch-ridge', 'branch-south', 'main-north', 'main-jog-upper', 'main-middle', 'main-jog-lower', 'main-south'];

function axisStats(source, target) {
  const deltas = source.map((value, index) => value - target[index]);
  const mean = deltas.reduce((sum, value) => sum + value, 0) / deltas.length;
  return { mean, maxResidual: Math.max(...deltas.map((value) => Math.abs(value - mean))) };
}

function pointOnSegment([x, y], segment, tolerance = 1e-6) {
  const [[x1, y1], [x2, y2]] = [segment.fromPx, segment.toPx];
  const cross = (x - x1) * (y2 - y1) - (y - y1) * (x2 - x1);
  return Math.abs(cross) <= tolerance && x >= Math.min(x1, x2) - tolerance && x <= Math.max(x1, x2) + tolerance && y >= Math.min(y1, y2) - tolerance && y <= Math.max(y1, y2) + tolerance;
}

function segmentsTouch(left, right) {
  if ([left.fromPx, left.toPx].some((point) => pointOnSegment(point, right)) || [right.fromPx, right.toPx].some((point) => pointOnSegment(point, left))) return true;
  const leftHorizontal = left.fromPx[1] === left.toPx[1]; const rightHorizontal = right.fromPx[1] === right.toPx[1];
  if (leftHorizontal === rightHorizontal) return false;
  const horizontal = leftHorizontal ? left : right; const vertical = leftHorizontal ? right : left;
  return vertical.fromPx[0] >= Math.min(horizontal.fromPx[0], horizontal.toPx[0]) && vertical.fromPx[0] <= Math.max(horizontal.fromPx[0], horizontal.toPx[0]) && horizontal.fromPx[1] >= Math.min(vertical.fromPx[1], vertical.toPx[1]) && horizontal.fromPx[1] <= Math.max(vertical.fromPx[1], vertical.toPx[1]);
}

function isConnected(segments) {
  if (!segments.length) return false;
  const seen = new Set([0]); const queue = [0];
  while (queue.length) {
    const current = queue.shift();
    segments.forEach((segment, index) => { if (!seen.has(index) && segmentsTouch(segments[current], segment)) { seen.add(index); queue.push(index); } });
  }
  return seen.size === segments.length;
}

export async function sealFp2PipeEvidence(value) {
  const draft = structuredClone(value); delete draft.receiptSha256;
  return { ...draft, receiptSha256: await sha256Hex(draft) };
}

export async function validateFp2PipeEvidence(value) {
  if (!value || value.artifactType !== 'halofire.winter-garden-fp2-pipe-evidence.v1') return { status: 'blocked', issues: [issue('FP2_PIPE_SCHEMA_INVALID', 'FP2 pipe evidence schema is invalid.')] };
  const issues = []; const { receiptSha256, ...draft } = value;
  if (!SHA256.test(receiptSha256 || '') || await sha256Hex(draft) !== receiptSha256) issues.push(issue('FP2_PIPE_RECEIPT_MISMATCH', 'FP2 pipe evidence no longer matches its sealed receipt.'));
  if (value.source?.pdfSha256 !== 'ac052124095f73e3529fd63906127bac9c2cf3b3f6abd45222c5125fa4195977' || value.source?.renderedSha256 !== 'b72b609d35e6db71d7f15c82a2174dcc337ce7fb86e8e32dee25ef7e12177744' || value.target?.pdfSha256 !== '93f8df04bc84ac817ecd2e222812fede93565879094c66b4d7511f783631543e' || value.target?.renderedSha256 !== 'c08f646e35fe14af5367b6a38fb378ce6f89e8773d50e849a95af7800d14b3a2') issues.push(issue('FP2_PIPE_SOURCE_DRIFT', 'FP2 or FP3 source/render identity changed.'));
  const axes = [value.gridX, value.gridY];
  if (axes.some((axis) => !axis || axis.labels?.length !== axis.sourcePx?.length || axis.labels?.length !== axis.targetPx?.length || axis.labels.length < 8)) issues.push(issue('FP2_PIPE_CONTROLS_INVALID', 'Paired labeled grid controls are incomplete.'));
  const x = axisStats(value.gridX.sourcePx, value.gridX.targetPx); const y = axisStats(value.gridY.sourcePx, value.gridY.targetPx);
  if (Math.abs(x.mean - value.registration?.meanDeltaPx?.[0]) > 1e-6 || Math.abs(y.mean - value.registration?.meanDeltaPx?.[1]) > 1e-6 || x.maxResidual > 2 || y.maxResidual > 0.1) issues.push(issue('FP2_PIPE_REGISTRATION_DRIFT', 'FP2-to-FP3 labeled-grid registration exceeded its residual bound.'));
  const ratios = value.detectorReceipt?.independent?.ninePixelBandBlackRatios || [];
  if (value.detectorReceipt?.primary?.branchRowsPx?.length !== 3 || ratios.length !== 3 || ratios.some((ratio) => ratio < value.detectorReceipt.independent.minimumAcceptedRatio)) issues.push(issue('FP2_PIPE_BRANCH_EVIDENCE_MISSING', 'Primary and independent branch-line evidence must agree for all three chapel rows.'));
  const ids = new Set((value.segments || []).map((segment) => segment.id));
  if (expectedSegmentIds.some((id) => !ids.has(id)) || value.segments.length !== expectedSegmentIds.length) issues.push(issue('FP2_PIPE_SEGMENT_MISSING', 'The sealed three-branch main-and-jog topology is incomplete.'));
  if (!isConnected(value.segments || [])) issues.push(issue('FP2_PIPE_TOPOLOGY_DISCONNECTED', 'The chapel pipe network is disconnected.'));
  if (value.pipeSizesReady !== false || value.absoluteDeflectorDatumReady !== false || value.projectionReady !== false || value.complianceReady !== false) issues.push(issue('FP2_PIPE_FAIL_CLOSED_STATUS_DRIFT', 'Unproven pipe sizes or elevations cannot enable projection or compliance.'));
  return { status: issues.length ? 'blocked' : 'passed', issues, metrics: { meanDeltaPx: [x.mean, y.mean], maxControlResidualPx: [x.maxResidual, y.maxResidual] }, projectionReady: false, complianceReady: false };
}

export async function buildWinterGardenChapelPipeNetwork(pipeEvidence, gridRegistration, headEvidence) {
  const [pipes, planes] = await Promise.all([validateFp2PipeEvidence(pipeEvidence), buildWinterGardenChapelPlaneAssignments(gridRegistration, headEvidence)]);
  if (pipes.status !== 'passed' || planes.status !== 'passed') return { status: 'blocked', issues: [...pipes.issues, ...planes.issues], segments: [], projectionReady: false, complianceReady: false };
  const [dx, dy] = pipeEvidence.registration.meanDeltaPx;
  const branchByPlane = new Map(pipeEvidence.segments.filter((segment) => segment.kind === 'branch').map((segment) => [segment.plane, segment]));
  const armOvers = planes.assignments.map((head) => {
    const branch = branchByPlane.get(head.plane); const point = [head.renderedPointPx[0] + dx, head.renderedPointPx[1] + dy];
    return { id: `arm-over-${head.headId}`, kind: 'arm-over', headId: head.headId, plane: head.plane, fromPx: point, toPx: [point[0], branch.fromPx[1]] };
  });
  const segments = [...pipeEvidence.segments, ...armOvers]; const issues = [];
  if (armOvers.length !== 15 || !isConnected(segments)) issues.push(issue('FP2_PIPE_HEAD_CONNECTIVITY_FAILED', 'All 15 chapel heads must connect through arm-overs to one branch/main network.'));
  return { status: issues.length ? 'blocked' : 'passed', artifactType: 'halofire.winter-garden-chapel-pipe-network.v1', segments: issues.length ? [] : segments, headCount: armOvers.length, branchCount: 3, issues, pipeSizesReady: false, absoluteDeflectorDatumReady: false, projectionReady: false, complianceReady: false, residuals: ['pipe_sizes_unresolved', 'absolute_deflector_datum_unresolved'] };
}
