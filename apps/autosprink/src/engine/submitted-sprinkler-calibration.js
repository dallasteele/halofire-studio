import { z } from 'zod';
import { SourceBindingSchema, sha256Hex } from './elevation-datums.js';
import { pointInPolygon, roofElevationAt } from './roof-geometry.js';

const SHA256_RE = /^[0-9a-f]{64}$/;
const PointSchema = z.tuple([z.number().finite(), z.number().finite()]);
const EvidenceSourceSchema = z.object({ id: z.string().min(1), binding: SourceBindingSchema }).strict();
const RegistrationSchema = z.object({
  viewId: z.enum(['south', 'north']),
  sourceSheetId: z.literal('FP-8-R2'),
  targetSheetId: z.literal('A-108'),
  transform: z.object({
    planXFromSourceTopY: z.tuple([z.number().finite(), z.number().finite()]),
    planYFromSourceX: z.tuple([z.number().finite(), z.number().finite()]),
  }).strict(),
  controls: z.object({
    numberGridLabels: z.array(z.string().min(1)).min(10),
    letterGridLabels: z.array(z.string().min(1)).min(10),
    planXRmsResidualFt: z.number().nonnegative(),
    planYRmsResidualFt: z.number().nonnegative(),
  }).strict(),
}).strict();
const PipeSchema = z.object({
  id: z.string().min(1), sourceViewId: z.enum(['south', 'north']),
  fromPlanFt: PointSchema, toPlanFt: PointSchema,
  submittedColorRole: z.enum(['primary-orange', 'secondary-green']),
}).strict();
const HeadSchema = z.object({
  id: z.string().min(1), sourceViewId: z.enum(['south', 'north']),
  positionPlanFt: PointSchema,
  symbolClass: z.enum(['round-standard-spray-reference', 'horizontal-sidewall-reference']),
  nearestSubmittedPipeFt: z.number().nonnegative(),
}).strict();
const HydraulicNodeSchema = z.object({
  nodeId: z.string().regex(/^\d+$/), elevationFt: z.number().finite(),
  sourceElevationText: z.string().min(1), fittings: z.string(),
  pressurePsi: z.number().nonnegative(), dischargeGpm: z.number().nonnegative(),
  nodeKind: z.enum(['sprinkler', 'pipe']), planPointFt: PointSchema,
  sourceViewId: z.literal('north'),
  calloutRegistration: z.literal('yellow-node-callout-to-black-vector-leader-endpoint'),
  protectionSurfaceKind: z.literal('level8-ceiling-or-sky-balcony-not-pitched-roof'),
}).strict();
const DraftSchema = z.object({
  artifactType: z.literal('halofire.submitted-sprinkler-calibration.v1'),
  projectName: z.string().min(1), level: z.literal(8), units: z.literal('ft'),
  sourceBindings: z.array(EvidenceSourceSchema).min(4),
  viewRegistrations: z.array(RegistrationSchema).length(2),
  submittedTopView: z.object({
    pipeSegments: z.array(PipeSchema).min(1), heads: z.array(HeadSchema).min(1),
  }).strict(),
  submittedElevationView: z.object({
    hydraulicNodes: z.array(HydraulicNodeSchema).min(1),
    sourcePageRole: z.literal('DA-3 submitted node analysis'),
  }).strict(),
  atticProtectionBasis: z.object({
    sourceNote: z.literal('ATTIC SPACE WILL BE FILLED WITH NON-COMBUSTIBLE INSULATION'),
    physicalPages: z.array(z.number().int()).length(8),
    pageBindings: z.array(SourceBindingSchema).length(8),
    interpretation: z.string().min(1),
  }).strict(),
  coverage: z.object({
    complete: z.literal(false), registeredViews: z.array(z.string().min(1)).length(3),
    headCount: z.number().int().nonnegative(), pipeSegmentCount: z.number().int().nonnegative(),
    hydraulicNodeCount: z.number().int().nonnegative(), unresolved: z.array(z.string().min(1)).min(1),
  }).strict(),
  claimStatus: z.literal('completed-bid-calibration-reference-not-code-compliance-or-approval'),
}).strict();
const PacketSchema = DraftSchema.extend({ evidenceReceiptSha256: z.string().regex(SHA256_RE) }).strict();

function issue(code, message, refs = []) {
  return { severity: 'blocking', code, message, refs };
}

function distanceToSegment(point, start, end) {
  const dx = end[0] - start[0]; const dy = end[1] - start[1];
  const length2 = dx * dx + dy * dy;
  const t = length2 === 0 ? 0 : Math.max(0, Math.min(1,
    ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / length2));
  return Math.hypot(point[0] - (start[0] + t * dx), point[1] - (start[1] + t * dy));
}

function uniqueIds(entries, field, code, issues) {
  const seen = new Set();
  for (const entry of entries) {
    const value = entry[field];
    if (seen.has(value)) issues.push(issue(code, `Duplicate ${field}: ${value}`, [value]));
    seen.add(value);
  }
}

export async function sealSubmittedSprinklerCalibration(draft) {
  const parsed = DraftSchema.parse(draft);
  return { ...parsed, evidenceReceiptSha256: await sha256Hex(parsed) };
}

export async function validateSubmittedSprinklerCalibration(packetInput, context = {}) {
  const parsed = PacketSchema.safeParse(packetInput);
  if (!parsed.success) {
    return { status: 'blocked', issues: [issue('SUBMITTED_CALIBRATION_SCHEMA_INVALID', parsed.error.issues.map((entry) => entry.message).join('; '))], complianceReady: false };
  }
  const packet = parsed.data;
  const { evidenceReceiptSha256, ...draft } = packet;
  const issues = [];
  const actualReceiptSha256 = await sha256Hex(draft);
  if (actualReceiptSha256 !== evidenceReceiptSha256) {
    issues.push(issue('SUBMITTED_CALIBRATION_RECEIPT_MISMATCH', 'Submitted calibration content does not match its immutable receipt.', [evidenceReceiptSha256, actualReceiptSha256]));
  }
  const sourceIds = new Set(packet.sourceBindings.map((entry) => entry.id));
  for (const required of ['target-architectural-A108', 'target-roof-A121', 'submitted-fire-FP8-r2', 'submitted-hydraulic-DA3-r2']) {
    if (!sourceIds.has(required)) issues.push(issue('SUBMITTED_CALIBRATION_SOURCE_MISSING', `Missing required source binding: ${required}`, [required]));
  }
  if (packet.atticProtectionBasis.physicalPages.join(',') !== '5,6,7,8,9,10,11,12') {
    issues.push(issue('SUBMITTED_ATTIC_NOTE_PAGE_COVERAGE_INVALID', 'The repeated submitted attic note must be bound to physical pages 5 through 12.'));
  }
  const atticHashes = new Set(packet.atticProtectionBasis.pageBindings.map((entry) => entry.renderedPageSha256));
  if (atticHashes.size !== 8) issues.push(issue('SUBMITTED_ATTIC_NOTE_PAGE_SUBSTITUTION', 'Every attic-note page must have its own rendered-page hash.'));

  for (const registration of packet.viewRegistrations) {
    const xSlope = Math.abs(registration.transform.planXFromSourceTopY[0]);
    const ySlope = Math.abs(registration.transform.planYFromSourceX[0]);
    if (Math.abs(xSlope - 1 / 9) > 0.002 || Math.abs(ySlope - 1 / 9) > 0.002) {
      issues.push(issue('SUBMITTED_VIEW_SCALE_INVALID', `${registration.viewId} does not preserve the printed 1/8 inch equals 1 foot scale.`, [registration.viewId]));
    }
    if (registration.controls.planXRmsResidualFt > 0.2 || registration.controls.planYRmsResidualFt > 0.2) {
      issues.push(issue('SUBMITTED_VIEW_GRID_REGISTRATION_RESIDUAL', `${registration.viewId} grid registration exceeds 0.2 feet RMS.`, [registration.viewId]));
    }
  }
  if (new Set(packet.viewRegistrations.map((entry) => entry.viewId)).size !== 2) {
    issues.push(issue('SUBMITTED_VIEW_DUPLICATE', 'Both north and south FP-8 views are required.'));
  }

  const pipes = packet.submittedTopView.pipeSegments;
  const heads = packet.submittedTopView.heads;
  const nodes = packet.submittedElevationView.hydraulicNodes;
  uniqueIds(pipes, 'id', 'SUBMITTED_PIPE_ID_DUPLICATE', issues);
  uniqueIds(heads, 'id', 'SUBMITTED_HEAD_ID_DUPLICATE', issues);
  uniqueIds(nodes, 'nodeId', 'SUBMITTED_HYDRAULIC_NODE_DUPLICATE', issues);
  if (packet.coverage.pipeSegmentCount !== pipes.length || packet.coverage.headCount !== heads.length
    || packet.coverage.hydraulicNodeCount !== nodes.length) {
    issues.push(issue('SUBMITTED_CALIBRATION_COUNT_DRIFT', 'Reported calibration counts do not match the sealed entities.'));
  }

  const footprint = context.planFootprint;
  if (!Array.isArray(footprint) || footprint.length < 3) {
    issues.push(issue('SUBMITTED_CALIBRATION_PLAN_FOOTPRINT_MISSING', 'The current A-108 footprint is required for registration validation.'));
  } else {
    for (const head of heads) {
      if (!pointInPolygon(head.positionPlanFt, footprint)) {
        issues.push(issue('SUBMITTED_HEAD_OUTSIDE_A108', `Submitted head ${head.id} is outside current A-108.`, [head.id]));
      }
    }
  }

  for (const head of heads) {
    const sameViewPipes = pipes.filter((pipe) => pipe.sourceViewId === head.sourceViewId);
    const nearest = Math.min(...sameViewPipes.map((pipe) => distanceToSegment(head.positionPlanFt, pipe.fromPlanFt, pipe.toPlanFt)));
    if (!Number.isFinite(nearest) || nearest > 0.75 || Math.abs(nearest - head.nearestSubmittedPipeFt) > 0.02) {
      issues.push(issue('SUBMITTED_HEAD_PIPE_BINDING_INVALID', `Submitted head ${head.id} is not bound to the submitted pipe vector.`, [head.id]));
    }
  }

  let pitchedRoofNodeCount = 0;
  const roofRelations = [];
  if (!context.roofModel || context.roofModel.status !== 'passed') {
    issues.push(issue('SUBMITTED_CALIBRATION_ROOF_MODEL_MISSING', 'The current passed roof model is required to distinguish ceiling/balcony nodes from pitched-roof nodes.'));
  } else {
    for (const node of nodes) {
      const roof = roofElevationAt(context.roofModel, node.planPointFt);
      if (roof.status === 'passed') {
        pitchedRoofNodeCount += 1;
        issues.push(issue('SUBMITTED_NODE_FALSELY_CLASSIFIED_NON_ROOF', `Submitted node ${node.nodeId} lands on a pitched roof plane and cannot be labeled ceiling/balcony.`, [node.nodeId, roof.planeId]));
      } else {
        const code = roof.issues[0]?.code || 'UNKNOWN';
        if (!['ROOF_POINT_OUTSIDE_MODEL', 'ROOF_POINT_IN_EXCLUDED_OPENING'].includes(code)) {
          issues.push(issue('SUBMITTED_NODE_ROOF_RELATION_AMBIGUOUS', `Submitted node ${node.nodeId} has an unexpected roof relation.`, [node.nodeId, code]));
        }
        roofRelations.push({ nodeId: node.nodeId, relation: code === 'ROOF_POINT_IN_EXCLUDED_OPENING' ? 'sky-balcony-or-open-core' : 'outside-pitched-roof-plane' });
      }
    }
  }

  return {
    status: issues.length ? 'blocked' : 'passed',
    artifactType: 'halofire.submitted-sprinkler-calibration-validation.v1',
    packet: issues.length ? null : packet,
    issues,
    counts: { heads: heads.length, pipeSegments: pipes.length, hydraulicNodes: nodes.length, pitchedRoofNodes: pitchedRoofNodeCount },
    roofRelations,
    protectionBasis: issues.length ? null : {
      roofForm: 'source-bound-pitched-roof',
      submittedLevel8Mode: 'flat-ceiling-and-sky-balcony-reference',
      atticFillNoteBoundPages: 8,
      projectLevel8LayoutMayBeBlindlyProjectedToRoof: false,
      atticSprinklerRequirementEstablished: false,
    },
    complianceReady: false,
    claimStatus: 'completed-bid-calibration-validated-not-code-compliance-or-approval',
  };
}

function svgEscape(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
}

export function renderSubmittedCalibrationViews(validation) {
  if (!validation || validation.status !== 'passed' || !validation.packet) {
    return { status: 'blocked', issues: [issue('SUBMITTED_CALIBRATION_NOT_VALIDATED', 'A passed calibration validation is required to render views.')] };
  }
  const packet = validation.packet;
  const pipes = packet.submittedTopView.pipeSegments;
  const heads = packet.submittedTopView.heads;
  const nodes = packet.submittedElevationView.hydraulicNodes;
  const allPoints = [...pipes.flatMap((pipe) => [pipe.fromPlanFt, pipe.toPlanFt]), ...heads.map((head) => head.positionPlanFt)];
  const minX = Math.min(...allPoints.map((point) => point[0])); const maxX = Math.max(...allPoints.map((point) => point[0]));
  const minY = Math.min(...allPoints.map((point) => point[1])); const maxY = Math.max(...allPoints.map((point) => point[1]));
  const width = Math.max(1, maxX - minX); const height = Math.max(1, maxY - minY);
  const mapTop = (point) => [20 + (point[0] - minX) / width * 960, 20 + (maxY - point[1]) / height * 560];
  const pipeSvg = pipes.map((pipe) => {
    const a = mapTop(pipe.fromPlanFt); const b = mapTop(pipe.toPlanFt);
    const color = pipe.submittedColorRole === 'primary-orange' ? '#ff8040' : '#00a050';
    return `<line x1="${a[0].toFixed(2)}" y1="${a[1].toFixed(2)}" x2="${b[0].toFixed(2)}" y2="${b[1].toFixed(2)}" stroke="${color}" stroke-width="1.5"/>`;
  }).join('');
  const headSvg = heads.map((head) => {
    const point = mapTop(head.positionPlanFt);
    return `<circle cx="${point[0].toFixed(2)}" cy="${point[1].toFixed(2)}" r="2.2" fill="#111" data-head-id="${svgEscape(head.id)}"/>`;
  }).join('');
  const topSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 600" role="img" aria-label="Submitted FP-8 registered top view"><rect width="1000" height="600" fill="#fff"/>${pipeSvg}${headSvg}</svg>`;

  const minNodeX = Math.min(...nodes.map((node) => node.planPointFt[0])); const maxNodeX = Math.max(...nodes.map((node) => node.planPointFt[0]));
  const minZ = Math.min(...nodes.map((node) => node.elevationFt)) - 1; const maxZ = Math.max(...nodes.map((node) => node.elevationFt)) + 1;
  const elevationMarks = nodes.map((node) => {
    const x = 40 + (node.planPointFt[0] - minNodeX) / Math.max(1, maxNodeX - minNodeX) * 920;
    const y = 30 + (maxZ - node.elevationFt) / Math.max(1, maxZ - minZ) * 500;
    return `<g data-node-id="${node.nodeId}"><circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="4" fill="#f6d700" stroke="#111"/><text x="${(x + 5).toFixed(2)}" y="${(y - 5).toFixed(2)}" font-size="9">${node.nodeId} · ${node.sourceElevationText}</text></g>`;
  }).join('');
  const elevationSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 560" role="img" aria-label="Submitted DA-3 registered elevation view"><rect width="1000" height="560" fill="#fff"/>${elevationMarks}</svg>`;
  return { status: 'passed', topSvg, elevationSvg, complianceReady: false, claimStatus: validation.claimStatus };
}
