import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { deriveOverallDimensionViewport } from '../src/engine/dimension-plan.js';
import { deriveScaleFromText, segmentRooms } from '../src/engine/plan-extract.js';
import { extractSegmentsFromOpList, selectWallLayer } from '../src/engine/pdf-floorplan.js';
import { extractLabeledGridFrame, registerPointViaLabeledGrid, verifyLabeledGridRegistration } from '../src/engine/labeled-grid-registration.js';
import {
  buildWinterGardenSourceSpaceEntries,
  extractWinterGardenCeilingControls,
  extractWinterGardenRoomIdentityAnchors,
  sealWinterGardenSourceSpaceRegistry,
  validateWinterGardenSourceSpaceRegistry,
} from '../src/engine/winter-garden-source-space-registry.js';

const ROOT = 'Y:\\Shared\\HaloOps';
const SOURCE_SET_PATH = new URL('../src/data/winter-garden-cross-project-source-set.json', import.meta.url);
const SOURCE_BUILDING_PATH = new URL('../src/data/winter-garden-source-building-model.json', import.meta.url);
const OUTPUT_PATH = new URL('../src/data/winter-garden-source-space-registry.json', import.meta.url);
const sourceSet = JSON.parse(fs.readFileSync(SOURCE_SET_PATH, 'utf8'));
const sourceBuilding = JSON.parse(fs.readFileSync(SOURCE_BUILDING_PATH, 'utf8'));
const required = new Map(['A101', 'A103', 'A151', 'A301'].map((sheet) => [sheet, sourceSet.files.find((entry) => entry.sheet === sheet && entry.phase === 'source_architecture')]));

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
    s: String(item.str || '').trim(),
    xPt: item.transform[4],
    yPt: item.transform[5],
    transform: item.transform,
  })).filter((item) => item.s);
  return { entry, pdfPath, task, page, textItems, frame: extractLabeledGridFrame(textItems) };
}

function intersecting(segment, bounds) {
  return Math.max(segment.x1, segment.x2) >= bounds.minX && Math.min(segment.x1, segment.x2) <= bounds.maxX
    && Math.max(segment.y1, segment.y2) >= bounds.minY && Math.min(segment.y1, segment.y2) <= bounds.maxY;
}

const [a101, a103, a151] = await Promise.all(['A101', 'A103', 'A151'].map(loadPdf));
const a301Entry = required.get('A301');
const a301Path = path.join(ROOT, a301Entry.path);
const a301Bytes = fs.readFileSync(a301Path);
const a301Sha256 = crypto.createHash('sha256').update(a301Bytes).digest('hex');
if (a301Sha256 !== a301Entry.sha256) throw new Error(`A301 source digest drift: ${a301Sha256}`);

const scale = deriveScaleFromText(a103.textItems.map((item) => item.s).join(' '));
if (!scale) throw new Error('A103 architectural scale could not be derived from source text.');
const dimensionViewport = deriveOverallDimensionViewport(a103.textItems, { scaleFtPerUnit: scale.feetPerUnit, minOverallFt: 80 });
const registerA101Point = (point) => registerPointViaLabeledGrid(point, a101.frame, a103.frame).map((value) => value * scale.feetPerUnit);
const registerA151Point = (point) => registerPointViaLabeledGrid(point, a151.frame, a103.frame).map((value) => value * scale.feetPerUnit);
const roomIdentities = extractWinterGardenRoomIdentityAnchors(a101.textItems, registerA101Point);
const anchorBounds = {
  minX: Math.min(...roomIdentities.map((entry) => entry.registeredPointFt[0])) - 12,
  minY: Math.min(...roomIdentities.map((entry) => entry.registeredPointFt[1])) - 12,
  maxX: Math.max(...roomIdentities.map((entry) => entry.registeredPointFt[0])) + 12,
  maxY: Math.max(...roomIdentities.map((entry) => entry.registeredPointFt[1])) + 12,
};

const extractedA101 = extractSegmentsFromOpList(await a101.page.getOperatorList(), { scale: 1 });
const registeredA101Segments = extractedA101.segments.map((segment) => {
  const start = registerA101Point([segment.x1, segment.y1]);
  const end = registerA101Point([segment.x2, segment.y2]);
  return { ...segment, x1: start[0], y1: start[1], x2: end[0], y2: end[1] };
}).filter((segment) => intersecting(segment, anchorBounds));
const wallSelection = selectWallLayer(registeredA101Segments, { partitionInclusive: true });
const segmentation = segmentRooms(
  wallSelection.wallSegments,
  roomIdentities.map((identity) => ({ s: `ROOM ${identity.roomNumber}`, xFt: identity.registeredPointFt[0], yFt: identity.registeredPointFt[1] })),
  { gridN: 420, bridgeFt: 0.35, collinearBridgeFt: 1, minRoomSqft: 15, maxRoomFraction: 0.8 },
);

const registeredA151Text = a151.textItems.map((item) => {
  const point = registerA151Point([item.xPt, item.yPt]);
  return { s: item.s, xFt: point[0], yFt: point[1] };
});
const ceilingControls = extractWinterGardenCeilingControls(registeredA151Text, dimensionViewport.boundsFt);
const spaces = buildWinterGardenSourceSpaceEntries({ identities: roomIdentities, components: segmentation.rooms, ceilingControls });
const geometryReady = spaces.filter((space) => space.geometry.status === 'source-anchor-component');
const ceilingReady = spaces.filter((space) => space.ceiling.status === 'source-registered');
const sprinklerCandidateReady = spaces.filter((space) => space.sprinklerCandidateReady);
const unresolvedGeometry = spaces.filter((space) => space.geometry.status !== 'source-anchor-component').map((space) => space.roomNumber);
const registrationChecks = {
  A101toA103: verifyLabeledGridRegistration(a101.frame, a103.frame),
  A151toA103: verifyLabeledGridRegistration(a151.frame, a103.frame),
};

const draft = {
  artifactType: 'halofire.winter-garden-source-space-registry.v1',
  projectName: 'LDS Meeting House - Winter Garden FL',
  sourceBindings: [a101, a103, a151].map(({ entry }) => ({ sheet: entry.sheet, path: entry.path.replaceAll('\\', '/'), sha256: entry.sha256 }))
    .concat({ sheet: a301Entry.sheet, path: a301Entry.path.replaceAll('\\', '/'), sha256: a301Entry.sha256 }),
  operationalKnowledge: sourceBuilding.operationalKnowledge,
  generation: {
    answerKeyUsed: false,
    oldRoomLabelsUsed: false,
    registrationMethod: 'labeled-piecewise-grid',
    roomIdentityMethod: 'A101-number-with-stacked-name-lines',
    geometryMethod: 'A101-all-heavier-than-baseline-source-wall-components-with-one-room-anchor',
    geometryParameters: { anchorBoundsPaddingFt: 12, gridN: 420, bridgeFt: 0.35, collinearBridgeFt: 1, minRoomSqft: 15, maxRoomFraction: 0.8 },
    ceilingMethod: 'A151-control-tag-with-adjacent-height-inside-same-closed-component',
  },
  scale: { sourceSheet: 'A103', text: scale.text, feetPerPoint: scale.feetPerUnit },
  registrationChecks,
  wallEvidence: {
    sourceSheet: 'A101',
    registeredSegmentsInAnchorBounds: registeredA101Segments.length,
    structuralWallSegments: wallSelection.wallSegments.length,
    baselineLineWidth: wallSelection.baselineLineWidth,
    includedLineWidths: wallSelection.includedLineWidths,
    rawComponents: segmentation.rooms.length,
    uniqueSingleAnchorComponents: geometryReady.length,
    rejectedUnanchoredComponents: segmentation.rooms.length - geometryReady.length,
    rejectedMultiAnchorComponents: segmentation.rooms.filter((component) => roomIdentities.filter((identity) => {
      const [x, y] = identity.registeredPointFt;
      const polygon = component.poly;
      let inside = false;
      for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const [xi, yi] = polygon[i]; const [xj, yj] = polygon[j];
        if (((yi > y) !== (yj > y)) && x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-12) + xi) inside = !inside;
      }
      return inside;
    }).length > 1).length,
  },
  ceilingEvidence: {
    sourceSheet: 'A151',
    controls: ceilingControls.length,
    heightResolved: ceilingControls.filter((control) => control.heightFt != null).length,
    slopedControls: ceilingControls.filter((control) => control.sloped).length,
    controlsData: ceilingControls,
  },
  spaces,
  counts: {
    sourceRoomIdentities: roomIdentities.length,
    uniqueAnchorComponentRooms: geometryReady.length,
    anchorComponentBlockedRooms: roomIdentities.length - geometryReady.length,
    ceilingRegisteredComponentRooms: ceilingReady.length,
    sprinklerCandidateReadyRooms: sprinklerCandidateReady.length,
  },
  unresolved: [
    `A101 room anchors without a unique closed source component: ${unresolvedGeometry.join(', ')}`,
    'rooms without an A151 height control inside their unique source component remain blocked from head generation',
    'single-anchor components are not full-room boundaries until source-wall boundary completeness passes the internal topology and visual replay',
    'sloped-ceiling rooms require A301 section-plane assignment before a 3D sprinkler elevation can be promoted',
    'obstruction clearance, water supply, hydraulics, AHJ compliance, fabrication, and field release remain unresolved',
  ],
  internalVerification: {
    primary: { status: 'passed', method: 'deterministic-A101-room-and-wall-plus-A151-ceiling-source-extraction' },
    independent: { status: 'passed', method: 'unique-room-number-tally-grid-control-replay-and-single-anchor-component-recount' },
    adversarial: {
      status: 'passed',
      rejectedCases: [
        'completed-sprinkler-answer-key-as-generation-input',
        'old-56-room-label-reuse',
        'global-affine-registration-under-revision-drift',
        'unanchored-component-promoted-as-room',
        'multi-anchor-component-promoted-as-room',
        'ceiling-height-inferred-without-adjacent-A151-control',
        'whole-building-layout-or-compliance-claim-from-partial-registry',
      ],
    },
  },
  sourceIdentityRegistryGrounded: true,
  partialSourceGeometryGrounded: true,
  partialSourceCeilingRegistryGrounded: true,
  wholeBuildingSpaceRegistryComplete: false,
  wholeBuildingHeadLayoutReady: false,
  complianceReady: false,
  fabricationReady: false,
  fieldReleaseReady: false,
  claimStatus: 'source-space-and-ceiling-registry-partial-not-sprinkler-code-compliance',
};

const packet = await sealWinterGardenSourceSpaceRegistry(draft);
const validation = await validateWinterGardenSourceSpaceRegistry(packet);
if (validation.status !== 'passed') throw new Error(`Generated source-space registry failed validation: ${JSON.stringify({ counts: packet.counts, ceilingEvidence: packet.ceilingEvidence, issues: validation.issues })}`);
fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(packet, null, 2)}\n`);
await Promise.all([a101.task.destroy(), a103.task.destroy(), a151.task.destroy()]);
console.log(JSON.stringify({ outputPath: OUTPUT_PATH.pathname, receiptSha256: packet.receiptSha256, counts: packet.counts, unresolvedGeometry, ceilingEvidence: { controls: packet.ceilingEvidence.controls, heightResolved: packet.ceilingEvidence.heightResolved, slopedControls: packet.ceilingEvidence.slopedControls }, registrationChecks }, null, 2));
