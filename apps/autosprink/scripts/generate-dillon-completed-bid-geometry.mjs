import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256Hex } from '../src/engine/elevation-datums.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const extractionDir = path.join(root, 'tmp/pdfs/dillon-roof-calibration');
const read = (name) => JSON.parse(fs.readFileSync(path.join(extractionDir, name), 'utf8'));
const round = (value) => Number(value.toFixed(5));
const transformPoint = ([u, v], registration) => [round(v / 13.5 + registration.xOffsetFt), round(u / 13.5 + registration.yOffsetFt)];

const configs = [
  {
    id: 'FP-1', levelId: 'main-house-main', sourceId: 'submitted-FP1', sourceSha256: 'ea09a1fe2b1e175170e980a0e0960a7e7f2bf82f949668ae1c895e163c604a63',
    schedule: { declaredTotal: 52, declaredRound: 40, declaredAlternate: 12 }, xOffsetFt: -76.70833, yOffsetFt: -142.85417,
    registrationEvidence: { matchedCoordinates: 195, xWeightedRmsFt: 0.00721, yWeightedRmsFt: 0.01759, independentRcpMaxDifferenceFt: 0.0301 },
    vectorEvidence: { candidatePipeRectangles: 59, connectedPipeSegments: 43, maxHeadToPipeDistancePt: 0.05 },
  },
  {
    id: 'FP-2', levelId: 'main-house-upper', sourceId: 'submitted-FP2', sourceSha256: 'dd4612854552928e6b9d06584b97c5434009536282813e40accd3343a480a3f6',
    schedule: { declaredTotal: 25, declaredRound: 24, declaredAlternate: 1 }, xOffsetFt: -101.1875, yOffsetFt: -134.66667,
    registrationEvidence: { matchedCoordinates: 136, xWeightedRmsFt: 0.00926, yWeightedRmsFt: 0.01251, independentRcpMaxDifferenceFt: null },
    vectorEvidence: { candidatePipeRectangles: 43, connectedPipeSegments: 24, maxHeadToPipeDistancePt: 0.05 },
  },
];

const sheets = configs.map((config, sheetIndex) => {
  const headsInput = read(`fp${sheetIndex + 1}-all-heads.json`);
  const pipeInput = read(`fp${sheetIndex + 1}-pipe-network.json`);
  const registration = {
    method: 'orthogonal-vector-wall-coordinate-match', pageWidthPt: 2160, pageHeightPt: 3024, printedScalePtPerFt: 13.5,
    formula: 'dwgX = topLeftY/13.5 + xOffsetFt; dwgY = topLeftX/13.5 + yOffsetFt', xOffsetFt: config.xOffsetFt, yOffsetFt: config.yOffsetFt,
    ...config.registrationEvidence,
  };
  const heads = [
    ...headsInput.roundTopLeftPt.map((head, index) => ({ id: `${config.id.toLowerCase()}-round-${index + 1}`, symbolClass: 'round-pendent-vector', sourceTopLeftPt: head.point.map(round), drawingIndices: head.drawingIndices, planPointDwgFt: transformPoint(head.point, registration), verticalStatus: 'unresolved' })),
    ...headsInput.alternateTopLeftPt.map((head, index) => ({ id: `${config.id.toLowerCase()}-alternate-${index + 1}`, symbolClass: 'alternate-pendent-vector', sourceTopLeftPt: head.point.map(round), drawingIndices: head.drawingIndices, planPointDwgFt: transformPoint(head.point, registration), verticalStatus: 'unresolved' })),
  ];
  const pipeSegments = pipeInput.segmentsTopLeftPt.map((segment, index) => ({ id: `${config.id.toLowerCase()}-pipe-${index + 1}`, sourceTopLeftPt: segment.map((point) => point.map(round)), planDwgFt: segment.map((point) => transformPoint(point, registration)), verticalStatus: 'unresolved' }));
  const detected = { round: headsInput.roundTopLeftPt.length, alternate: headsInput.alternateTopLeftPt.length, total: heads.length };
  const unresolvedCount = config.schedule.declaredTotal - detected.total;
  return {
    id: config.id, levelId: config.levelId, sourceId: config.sourceId, sourceSha256: config.sourceSha256,
    schedule: { ...config.schedule, detected, complete: unresolvedCount === 0, unresolvedCount }, registration,
    heads, pipeSegments, vectorEvidence: { ...config.vectorEvidence, allDetectedHeadsTouchPipeNetwork: true },
  };
});

const draft = {
  artifactType: 'halofire.dillon-completed-bid-geometry.v1', projectName: 'Dillon Residence', extractor: { tool: 'PyMuPDF', version: '1.27.2.2', mode: 'offline-vector-only' },
  architecturalGeometrySha256: '1e40c9fd90e62ae96ce3a7d3a0f7410d880178dc2d326d888ea37d3f810880e0',
  sheets,
  totals: { declaredHeads: sheets.reduce((n, sheet) => n + sheet.schedule.declaredTotal, 0), detectedHeads: sheets.reduce((n, sheet) => n + sheet.schedule.detected.total, 0), unresolvedHeads: sheets.reduce((n, sheet) => n + sheet.schedule.unresolvedCount, 0), pipeSegments: sheets.reduce((n, sheet) => n + sheet.pipeSegments.length, 0) },
  verticalGeometryReady: false, geometryGrounded: true, complianceReady: false, approvalReady: false,
  limitations: [
    'FP-1 schedule declares 52 heads but its vector plan contains 51 head symbols; the missing head remains unresolved.',
    'FP-2 is a separate 25-head upper-level schedule and cannot be used to close the FP-1 count mismatch.',
    'Head and pipe X/Y coordinates are source-grounded; per-element ceiling and roof Z assignment remains unresolved except in the separate sealed sloped-region calibration.',
    'This completed-bid calibration does not establish current-code compliance, hydraulic node identity, approval, or fabrication readiness.',
  ],
  claimStatus: 'completed-bid-plan-geometry-registered-to-source-dwg-with-one-fp1-head-unresolved',
};
const packet = { ...draft, receiptSha256: await sha256Hex(draft) };
fs.writeFileSync(path.join(root, 'src/data/dillon-completed-bid-geometry.json'), `${JSON.stringify(packet)}\n`);
console.log(JSON.stringify({ receiptSha256: packet.receiptSha256, totals: packet.totals, sheets: packet.sheets.map((sheet) => ({ id: sheet.id, schedule: sheet.schedule, pipeSegments: sheet.pipeSegments.length })) }, null, 2));
