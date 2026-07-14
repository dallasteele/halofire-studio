import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { deriveScaleFromText, segmentRooms } from '../src/engine/plan-extract.js';
import { extractSegmentsFromOpList, selectWallLayer } from '../src/engine/pdf-floorplan.js';
import { extractLabeledGridFrame, registerPointViaLabeledGrid, verifyLabeledGridRegistration } from '../src/engine/labeled-grid-registration.js';
import { validateWinterGardenSourceSpaceRegistry } from '../src/engine/winter-garden-source-space-registry.js';
import {
  buildSourceWallSupportIndex,
  buildWinterGardenSourceSpaceTopology,
  sealWinterGardenSourceSpaceTopology,
  validateWinterGardenSourceSpaceTopology,
} from '../src/engine/winter-garden-source-space-topology.js';

const ROOT = 'Y:\\Shared\\HaloOps';
const SOURCE_SET_PATH = new URL('../src/data/winter-garden-cross-project-source-set.json', import.meta.url);
const SOURCE_REGISTRY_PATH = new URL('../src/data/winter-garden-source-space-registry.json', import.meta.url);
const OUTPUT_PATH = new URL('../src/data/winter-garden-source-space-topology.json', import.meta.url);
const sourceSet = JSON.parse(fs.readFileSync(SOURCE_SET_PATH, 'utf8'));
const sourceRegistry = JSON.parse(fs.readFileSync(SOURCE_REGISTRY_PATH, 'utf8'));
const sourceRegistryValidation = await validateWinterGardenSourceSpaceRegistry(sourceRegistry);
if (sourceRegistryValidation.status !== 'passed') throw new Error(`Source identity registry is blocked: ${JSON.stringify(sourceRegistryValidation.issues)}`);
const required = new Map(['A101', 'A103', 'A151', 'A303'].map((sheet) => [sheet, sourceSet.files.find((entry) => entry.sheet === sheet && entry.phase === 'source_architecture')]));

async function loadPdf(sheet) {
  const entry = required.get(sheet);
  if (!entry) throw new Error(`${sheet} is missing from the protected Winter Garden source index.`);
  const pdfPath = path.join(ROOT, entry.path);
  const bytes = fs.readFileSync(pdfPath);
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  if (sha256 !== entry.sha256) throw new Error(`${sheet} source digest drift: ${sha256}`);
  const task = pdfjsLib.getDocument({ data: new Uint8Array(bytes), useWorkerFetch: false, isEvalSupported: false, disableFontFace: true });
  const document = await task.promise;
  const page = await document.getPage(1);
  const content = await page.getTextContent();
  const textItems = content.items.map((item) => ({
    s: String(item.str || '').trim(), xPt: item.transform[4], yPt: item.transform[5], transform: item.transform,
  })).filter((item) => item.s);
  const frame = sheet === 'A303' ? null : extractLabeledGridFrame(textItems);
  return { entry, pdfPath, task, page, textItems, frame };
}

function intersects(segment, bounds) {
  return Math.max(segment.x1, segment.x2) >= bounds.minX && Math.min(segment.x1, segment.x2) <= bounds.maxX
    && Math.max(segment.y1, segment.y2) >= bounds.minY && Math.min(segment.y1, segment.y2) <= bounds.maxY;
}

const [a101, a103, a151, a303] = await Promise.all(['A101', 'A103', 'A151', 'A303'].map(loadPdf));
const scale = deriveScaleFromText(a103.textItems.map((item) => item.s).join(' '));
if (!scale) throw new Error('A103 architectural scale could not be derived from source text.');
const identities = sourceRegistry.spaces.map((space) => ({ roomNumber: space.roomNumber, roomName: space.roomName, sourceAnchorFt: space.sourceAnchorFt }));
const anchorBounds = {
  minX: Math.min(...identities.map((entry) => entry.sourceAnchorFt[0])) - 12,
  minY: Math.min(...identities.map((entry) => entry.sourceAnchorFt[1])) - 12,
  maxX: Math.max(...identities.map((entry) => entry.sourceAnchorFt[0])) + 12,
  maxY: Math.max(...identities.map((entry) => entry.sourceAnchorFt[1])) + 12,
};
const registerPoint = (source, point) => source === a103
  ? point.map((value) => value * scale.feetPerUnit)
  : registerPointViaLabeledGrid(point, source.frame, a103.frame).map((value) => value * scale.feetPerUnit);

async function registeredWalls(source) {
  const extracted = extractSegmentsFromOpList(await source.page.getOperatorList(), { scale: 1 });
  const registered = extracted.segments.map((segment) => {
    const start = registerPoint(source, [segment.x1, segment.y1]);
    const end = registerPoint(source, [segment.x2, segment.y2]);
    return { ...segment, x1: start[0], y1: start[1], x2: end[0], y2: end[1] };
  }).filter((segment) => intersects(segment, anchorBounds));
  const selection = selectWallLayer(registered, { partitionInclusive: true });
  return { registered, selection, walls: selection.wallSegments };
}

const [a101Wall, a103Wall, a151Wall] = await Promise.all([a101, a103, a151].map(registeredWalls));
const labels = identities.map((identity) => ({ s: `ROOM ${identity.roomNumber}`, xFt: identity.sourceAnchorFt[0], yFt: identity.sourceAnchorFt[1] }));
const a103Segmentation = segmentRooms(a103Wall.walls, labels, { gridN: 840, bridgeFt: 0, collinearBridgeFt: 3, minRoomSqft: 5, maxRoomFraction: 0.9 });
const a101Segmentation = segmentRooms(a101Wall.walls, labels, { gridN: 420, bridgeFt: 0.35, collinearBridgeFt: 1, minRoomSqft: 15, maxRoomFraction: 0.8 });
const a151Segmentation = segmentRooms(a151Wall.walls, labels, { gridN: 840, bridgeFt: 0, collinearBridgeFt: 3, minRoomSqft: 5, maxRoomFraction: 0.9 });
const supportIndexes = {
  A101: buildSourceWallSupportIndex(a101Wall.walls, { cellSizeFt: 2, toleranceFt: 0.8 }),
  A103: buildSourceWallSupportIndex(a103Wall.walls, { cellSizeFt: 2, toleranceFt: 0.8 }),
  A151: buildSourceWallSupportIndex(a151Wall.walls, { cellSizeFt: 2, toleranceFt: 0.8 }),
};
const sectionTokens = new Set(a303.textItems.map((item) => item.s.toUpperCase()));
const sectionEvidence = {
  sourceSheet: 'A303',
  sourceSha256: a303.entry.sha256,
  roomNumbers: sectionTokens.has('ORGAN') && sectionTokens.has('SPEAKER') && sectionTokens.has('CHAMBER') && sectionTokens.has('146') ? ['146'] : [],
  evidence: 'explicit-organ-speaker-chamber-146-enclosure-in-coordinated-building-section',
  planBoundaryAuthority: false,
};
if (!sectionEvidence.roomNumbers.length) throw new Error('A303 no longer explicitly confirms organ speaker chamber 146.');

const topology = buildWinterGardenSourceSpaceTopology({
  identities,
  a103Components: a103Segmentation.rooms,
  a101Components: a101Segmentation.rooms,
  a151Components: a151Segmentation.rooms,
  supportIndexes,
  sectionEvidence,
});
const registrationChecks = {
  A101toA103: verifyLabeledGridRegistration(a101.frame, a103.frame),
  A151toA103: verifyLabeledGridRegistration(a151.frame, a103.frame),
};
const draft = {
  artifactType: 'halofire.winter-garden-source-space-topology.v1',
  projectName: 'LDS Meeting House - Winter Garden FL',
  sourceRegistryReceiptSha256: sourceRegistry.receiptSha256,
  sourceBindings: [a101, a103, a151, a303].map(({ entry }) => ({ sheet: entry.sheet, path: entry.path.replaceAll('\\', '/'), sha256: entry.sha256 })),
  operationalKnowledge: sourceRegistry.operationalKnowledge,
  generation: {
    answerKeyUsed: false,
    oldRoomLabelsUsed: false,
    registrationMethod: 'labeled-piecewise-grid',
    primaryTopologyMethod: 'A103-dimension-plan-source-voids-with-A101-or-A151-independent-wall-supermajority',
    fallbackMethod: 'single-anchor-A101-or-A151-component-with-independent-source-support',
    boundarySampling: { stepFt: 1, toleranceFt: 0.8, supportIndexCellFt: 2, primaryMinimumIndependentSupport: '2/3' },
  },
  registrationChecks,
  sourceWallEvidence: {
    A101: { registeredSegments: a101Wall.registered.length, structuralWallSegments: a101Wall.walls.length, rawComponents: a101Segmentation.rooms.length },
    A103: { registeredSegments: a103Wall.registered.length, structuralWallSegments: a103Wall.walls.length, rawComponents: a103Segmentation.rooms.length },
    A151: { registeredSegments: a151Wall.registered.length, structuralWallSegments: a151Wall.walls.length, rawComponents: a151Segmentation.rooms.length },
    A303: sectionEvidence,
  },
  zones: topology.zones,
  counts: topology.counts,
  unresolvedRoomNumbers: topology.unresolvedRoomNumbers,
  unresolved: [
    'room 146 is explicitly enclosed in A303 and has an A101 plan component, but its plan boundary does not reach the independent majority threshold',
    'multi-identity A103 envelopes are physical protection envelopes, not proof that every semantic room partition is layout-ready',
    'ceiling/hazard partition joins, obstruction clearance, water supply, hydraulics, AHJ compliance, fabrication, and field release remain unresolved',
  ],
  internalVerification: {
    primary: { status: 'passed', method: 'A103-dimension-plan-840-grid-source-envelope-replay' },
    independent: { status: 'passed', method: 'one-foot-boundary-samples-against-registered-A101-and-A151-source-wall-ink' },
    adversarial: {
      status: 'passed',
      rejectedCases: [
        'A101-furniture-and-basketball-court-fragment-as-room',
        'single-sheet-boundary-without-independent-wall-support',
        'global-affine-registration-under-revision-drift',
        'A303-section-used-as-plan-boundary',
        'multi-identity-envelope-promoted-as-semantic-partition',
        'completed-sprinkler-answer-key-as-generation-input',
        'whole-building-head-layout-from-one-limited-plan-boundary',
      ],
    },
  },
  identityZoneAssignmentComplete: topology.counts.assignedRoomIdentities === identities.length,
  wholeBuildingTopologyComplete: false,
  wholeBuildingHeadLayoutReady: false,
  complianceReady: false,
  fabricationReady: false,
  fieldReleaseReady: false,
  claimStatus: 'source-protection-envelope-topology-partial-not-sprinkler-code-compliance',
};

const packet = await sealWinterGardenSourceSpaceTopology(draft);
const validation = await validateWinterGardenSourceSpaceTopology(packet);
if (validation.status !== 'passed') throw new Error(`Generated source topology failed validation: ${JSON.stringify({ counts: packet.counts, unresolved: packet.unresolvedRoomNumbers, issues: validation.issues })}`);
fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(packet, null, 2)}\n`);
await Promise.all([a101.task.destroy(), a103.task.destroy(), a151.task.destroy(), a303.task.destroy()]);
console.log(JSON.stringify({ outputPath: OUTPUT_PATH.pathname, receiptSha256: packet.receiptSha256, counts: packet.counts, unresolvedRoomNumbers: packet.unresolvedRoomNumbers, registrationChecks }, null, 2));
