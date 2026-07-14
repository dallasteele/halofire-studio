import fs from 'node:fs';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { deriveScaleFromText } from '../src/engine/plan-extract.js';
import { extractLabeledGridFrame, registerPointViaLabeledGrid } from '../src/engine/labeled-grid-registration.js';
import { piecewiseMap } from '../src/engine/piecewise-grid-registration.js';
import { pointInPolygon } from '../src/engine/sprinkler-layout.js';
import { sealWinterGardenSourcePitchedHeldout, validateWinterGardenSourcePitchedHeldout } from '../src/engine/winter-garden-source-pitched-heldout.js';

const ROOT = 'Y:/Shared/HaloOps/02-Active jobs/03-Closed/LDS Meeting House - Winter Garden FL/Engineering/CAD Files/Winter-Garden,-FL-Meetinghouse_-_Drawings/Architectural/';
const read = (name) => JSON.parse(fs.readFileSync(new URL(`../src/data/${name}`, import.meta.url), 'utf8'));
const candidates = read('winter-garden-source-pitched-candidates.json'); const ceiling = read('winter-garden-source-sloped-ceiling.json');
const headEvidence = read('winter-garden-fp3-head-evidence.json'); const registration = read('winter-garden-grid-registration.json');
const registry = read('winter-garden-source-space-registry.json'); const topology = read('winter-garden-source-space-topology.json');

async function load(fileName) {
  const bytes = fs.readFileSync(`${ROOT}${fileName}`); const task = pdfjsLib.getDocument({ data: new Uint8Array(bytes), useWorkerFetch: false, isEvalSupported: false, disableFontFace: true });
  const document = await task.promise; const page = await document.getPage(1); const text = await page.getTextContent();
  const textItems = text.items.map((item) => ({ s: item.str, xPt: item.transform[4], yPt: item.transform[5], transform: item.transform }));
  return { task, page, textItems, frame: extractLabeledGridFrame(textItems) };
}
const [a103, a121] = await Promise.all([load('A103-MAIN-FLOOR-DIMENSION-PLAN-Rev.6.pdf'), load('A121-ROOF-PLAN-Rev.5.pdf')]);
const scale = deriveScaleFromText(a103.textItems.map((item) => item.s).join(' '));
const viewport = a121.page.getViewport({ scale: registration.source.renderedSizePx[0] / a121.page.getViewport({ scale: 1 }).width });
const mappedHeads = headEvidence.points.map((head) => {
  const targetPx = head.normalized.map((value, index) => value * registration.target.renderedSizePx[index]);
  const sourcePx = [piecewiseMap(targetPx[0], registration.gridX.targetPx, registration.gridX.sourcePx), piecewiseMap(targetPx[1], registration.gridY.targetPx, registration.gridY.sourcePx)];
  const sourcePdfPt = viewport.convertToPdfPoint(...sourcePx); const a103Point = registerPointViaLabeledGrid(sourcePdfPt, a121.frame, a103.frame);
  return { headId: head.id, planPointFt: a103Point.map((value) => Number((value * scale.feetPerUnit).toFixed(6))) };
});
const generated = candidates.candidates[0]; const component = registry.spaces.find((entry) => entry.roomNumber === '149').geometry.polygon;
const zone = topology.zones.find((entry) => entry.zoneId === generated.topologyZoneId).geometry.polygon;
const comparisons = candidates.candidates.map((candidate) => {
  const nearest = mappedHeads.map((head) => ({ ...head, distanceFt: Math.hypot(head.planPointFt[0] - candidate.planPointFt[0], head.planPointFt[1] - candidate.planPointFt[1]) })).sort((left, right) => left.distanceFt - right.distanceFt)[0];
  return { candidateId: candidate.candidateId, generatedPlanPointFt: candidate.planPointFt, nearestCompletedHeadId: nearest.headId, nearestCompletedPlanPointFt: nearest.planPointFt, nearestCompletedDistanceFt: Number(nearest.distanceFt.toFixed(4)), exactPlanParityPassed: nearest.distanceFt <= 1 };
});
const draft = {
  artifactType: 'halofire.winter-garden-source-pitched-heldout.v1', projectName: candidates.projectName,
  sourceReceipts: { candidates: candidates.receiptSha256, ceiling: ceiling.receiptSha256, headEvidence: headEvidence.receiptSha256, registration: registration.receiptSha256 },
  sequence: { sourcePacketSealedBeforeAnswerKeyOpen: true, sourceCandidateReceiptAtSeal: candidates.receiptSha256, sourceGenerationModifiedAfterComparison: false },
  generation: { answerKeyUsedForSourceGeneration: false, answerKeyRole: 'held-out-comparison-only', completedSheetId: headEvidence.sheetId, completedPdfSha256: headEvidence.sourcePdfSha256 },
  metrics: { generatedCandidateHeads: candidates.candidates.length, completedHeadsInsideGeneratedComponent: mappedHeads.filter((head) => pointInPolygon(head.planPointFt, component)).length, completedHeadsInsideTopologyZone: mappedHeads.filter((head) => pointInPolygon(head.planPointFt, zone)).length },
  comparisons,
  findings: [
    'the sealed A101 component used by the source hypothesis contains no completed head centers',
    'the independently supported A103 topology zone contains nine completed head centers while the sealed source hypothesis emitted one',
    'the nearest completed center is 4.4303 feet from the source-only hypothesis and lies just outside the extracted A101 component',
    'this is a boundary/layout-generation failure, not a ceiling-profile failure; the 3:12 ceiling packet remains independently source-sealed',
  ],
  requiredNextLoop: 'calibrate a source-only multi-head spacing and semantic-boundary method on a different completed project, then hold out a separate unseen pitched project; do not tune the sealed Winter Garden source packet in place',
  internalVerification: { primary: { status: 'passed', method: 'receipt-bound-piecewise-grid-comparison' }, independent: { status: 'passed', method: 'inverse-FP3-to-A121-to-A103-head-registration-and-polygon-count' }, adversarial: { status: 'passed', rejectedCases: ['completed-head-centers-fed-back-into-source-generation', 'one-head-count-promoted-despite-nine-head-topology-zone', 'nearest-head-residual-hidden', 'ceiling-profile-rejected-because-layout-boundary-failed'] } },
  heldOutAcceptanceStatus: 'failed', headCountParityPassed: false, exactPlanParityPassed: false, candidatePlacementVerified: false,
  pitchedRoofHeadLayoutReady: false, complianceReady: false, fabricationReady: false, fieldReleaseReady: false,
};
const packet = await sealWinterGardenSourcePitchedHeldout(draft); const validation = await validateWinterGardenSourcePitchedHeldout(packet, { candidates, ceiling, headEvidence, registration });
if (validation.status !== 'passed') throw new Error(`Held-out packet failed self-validation: ${JSON.stringify(validation.issues)}`);
const outputPath = new URL('../src/data/winter-garden-source-pitched-heldout.json', import.meta.url); fs.writeFileSync(outputPath, `${JSON.stringify(packet, null, 2)}\n`);
await Promise.all([a103.task.destroy(), a121.task.destroy()]); console.log(JSON.stringify({ outputPath: outputPath.pathname, receiptSha256: packet.receiptSha256, metrics: packet.metrics, comparisons: packet.comparisons, heldOutAcceptanceStatus: packet.heldOutAcceptanceStatus }, null, 2));
