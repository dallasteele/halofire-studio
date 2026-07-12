import { z } from 'zod';
import { sha256Hex } from './elevation-datums.js';

const SHA256 = z.string().regex(/^[0-9a-f]{64}$/);
const Point = z.tuple([z.number().finite(), z.number().finite()]);
const Head = z.object({ id: z.string(), symbolClass: z.enum(['round-pendent-vector', 'alternate-pendent-vector']), sourceTopLeftPt: Point, drawingIndices: z.array(z.number().int()).min(1), planPointDwgFt: Point, verticalStatus: z.literal('unresolved') }).strict();
const Pipe = z.object({ id: z.string(), sourceTopLeftPt: z.tuple([Point, Point]), planDwgFt: z.tuple([Point, Point]), verticalStatus: z.literal('unresolved') }).strict();
const Registration = z.object({
  method: z.literal('orthogonal-vector-wall-coordinate-match'), pageWidthPt: z.literal(2160), pageHeightPt: z.literal(3024), printedScalePtPerFt: z.literal(13.5),
  formula: z.literal('dwgX = topLeftY/13.5 + xOffsetFt; dwgY = topLeftX/13.5 + yOffsetFt'), xOffsetFt: z.number(), yOffsetFt: z.number(),
  matchedCoordinates: z.number().int().min(100), xWeightedRmsFt: z.number().nonnegative().max(0.025), yWeightedRmsFt: z.number().nonnegative().max(0.025), independentRcpMaxDifferenceFt: z.number().nonnegative().max(0.04).nullable(),
}).strict();
const Sheet = z.object({
  id: z.enum(['FP-1', 'FP-2']), levelId: z.enum(['main-house-main', 'main-house-upper']), sourceId: z.enum(['submitted-FP1', 'submitted-FP2']), sourceSha256: SHA256,
  schedule: z.object({ declaredTotal: z.number().int().positive(), declaredRound: z.number().int().positive(), declaredAlternate: z.number().int().positive(), detected: z.object({ round: z.number().int(), alternate: z.number().int(), total: z.number().int() }).strict(), complete: z.boolean(), unresolvedCount: z.number().int().nonnegative() }).strict(),
  registration: Registration, heads: z.array(Head).min(1), pipeSegments: z.array(Pipe).min(1),
  vectorEvidence: z.object({ candidatePipeRectangles: z.number().int().positive(), connectedPipeSegments: z.number().int().positive(), maxHeadToPipeDistancePt: z.number().max(0.1), allDetectedHeadsTouchPipeNetwork: z.literal(true) }).strict(),
}).strict();
const Draft = z.object({
  artifactType: z.literal('halofire.dillon-completed-bid-geometry.v1'), projectName: z.literal('Dillon Residence'), extractor: z.object({ tool: z.literal('PyMuPDF'), version: z.literal('1.27.2.2'), mode: z.literal('offline-vector-only') }).strict(),
  architecturalGeometrySha256: SHA256, sheets: z.array(Sheet).length(2), totals: z.object({ declaredHeads: z.literal(77), detectedHeads: z.literal(76), unresolvedHeads: z.literal(1), pipeSegments: z.literal(67) }).strict(),
  verticalGeometryReady: z.literal(false), geometryGrounded: z.literal(true), complianceReady: z.literal(false), approvalReady: z.literal(false), limitations: z.array(z.string()).min(4), claimStatus: z.literal('completed-bid-plan-geometry-registered-to-source-dwg-with-one-fp1-head-unresolved'),
}).strict();
const Packet = Draft.extend({ receiptSha256: SHA256 }).strict();
const issue = (code, message) => ({ severity: 'blocking', code, message });
const near = (a, b, tolerance = 0.00002) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= tolerance;
const transform = ([u, v], registration) => [Number((v / 13.5 + registration.xOffsetFt).toFixed(5)), Number((u / 13.5 + registration.yOffsetFt).toFixed(5))];

export async function validateDillonCompletedBidGeometry(input, floorModel = null) {
  const parsed = Packet.safeParse(input);
  if (!parsed.success) return { status: 'blocked', issues: [issue('DILLON_BID_GEOMETRY_SCHEMA_INVALID', parsed.error.issues.map((x) => x.message).join('; '))], complianceReady: false };
  const packet = parsed.data; const { receiptSha256, ...draft } = packet; const issues = [];
  if (await sha256Hex(draft) !== receiptSha256) issues.push(issue('DILLON_BID_GEOMETRY_RECEIPT_MISMATCH', 'Packet content does not match its receipt.'));
  if (floorModel?.sourceGeometrySha256 !== packet.architecturalGeometrySha256) issues.push(issue('DILLON_BID_ARCHITECTURAL_SOURCE_MISMATCH', 'Bid geometry is not bound to the supplied architectural DWG geometry.'));
  for (const sheet of packet.sheets) {
    const round = sheet.heads.filter((head) => head.symbolClass === 'round-pendent-vector').length;
    const alternate = sheet.heads.filter((head) => head.symbolClass === 'alternate-pendent-vector').length;
    if (round !== sheet.schedule.detected.round || alternate !== sheet.schedule.detected.alternate || round + alternate !== sheet.schedule.detected.total) issues.push(issue('DILLON_BID_HEAD_CLASS_COUNT_MISMATCH', `${sheet.id} detected head classes do not match its sealed counts.`));
    if (sheet.schedule.declaredTotal - sheet.schedule.detected.total !== sheet.schedule.unresolvedCount || sheet.schedule.complete !== (sheet.schedule.unresolvedCount === 0)) issues.push(issue('DILLON_BID_SCHEDULE_COVERAGE_INVALID', `${sheet.id} schedule coverage is internally inconsistent.`));
    for (const head of sheet.heads) if (!near(transform(head.sourceTopLeftPt, sheet.registration), head.planPointDwgFt)) issues.push(issue('DILLON_BID_HEAD_TRANSFORM_DRIFT', `${head.id} does not follow the sealed PDF-to-DWG transform.`));
    for (const pipe of sheet.pipeSegments) for (let index = 0; index < 2; index += 1) if (!near(transform(pipe.sourceTopLeftPt[index], sheet.registration), pipe.planDwgFt[index])) issues.push(issue('DILLON_BID_PIPE_TRANSFORM_DRIFT', `${pipe.id} does not follow the sealed PDF-to-DWG transform.`));
    const level = floorModel?.levels?.find((entry) => entry.id === sheet.levelId);
    if (level) for (const head of sheet.heads) { const [x, y] = head.planPointDwgFt; if (x < level.boundsFt.minX - 2 || x > level.boundsFt.maxX + 2 || y < level.boundsFt.minY - 2 || y > level.boundsFt.maxY + 2) issues.push(issue('DILLON_BID_HEAD_OUTSIDE_LEVEL', `${head.id} falls outside the registered architectural level.`)); }
  }
  return { status: issues.length ? 'blocked' : 'passed', issues, packet: issues.length ? null : packet, counts: packet.totals, geometryGrounded: !issues.length, verticalGeometryReady: false, complianceReady: false, claimStatus: packet.claimStatus };
}

function esc(value) { return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
export function renderDillonCompletedBidViews(validation, floorModel) {
  if (validation?.status !== 'passed' || !validation.packet || !floorModel) return { status: 'blocked', issues: [issue('DILLON_BID_GEOMETRY_NOT_VALIDATED', 'Passed geometry and floor model are required.')] };
  const views = validation.packet.sheets.map((sheet) => {
    const level = floorModel.levels.find((entry) => entry.id === sheet.levelId); const w = 760, h = 500, pad = 25; const scale = Math.min((w - 2 * pad) / level.boundsFt.widthFt, (h - 2 * pad) / level.boundsFt.depthFt);
    const map = ([x, y]) => [pad + (x - level.boundsFt.minX) * scale, h - pad - (y - level.boundsFt.minY) * scale];
    const walls = level.wallPolygonsFt.map((polygon) => `<polygon points="${polygon.map((point) => map(point).map((v) => v.toFixed(2)).join(',')).join(' ')}" fill="#cbd5e1" fill-opacity=".45" stroke="#64748b" stroke-width=".45"/>`).join('');
    const pipes = sheet.pipeSegments.map((pipe) => { const [a, b] = pipe.planDwgFt.map(map); return `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="#d946ef" stroke-width="2.2"/>`; }).join('');
    const heads = sheet.heads.map((head) => { const [x, y] = map(head.planPointDwgFt); return `<circle cx="${x}" cy="${y}" r="3.4" fill="${head.symbolClass.startsWith('alternate') ? '#f59e0b' : '#16a34a'}" stroke="#052e16" stroke-width=".7"/>`; }).join('');
    const coverage = sheet.schedule.complete ? 'schedule closed' : `${sheet.schedule.unresolvedCount} scheduled head unresolved`;
    return { sheetId: sheet.id, levelId: sheet.levelId, svg: `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(sheet.id)} completed bid registered to ${esc(level.label)} DWG" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#f8fafc"/>${walls}${pipes}${heads}<text x="16" y="20" font-family="monospace" font-size="12" fill="#0f172a">${sheet.id} · ${sheet.heads.length}/${sheet.schedule.declaredTotal} heads · ${sheet.pipeSegments.length} pipe vectors · ${coverage}</text></svg>` };
  });
  return { status: 'passed', planViews: views, verticalStatus: 'per-element-z-unresolved', complianceReady: false };
}
