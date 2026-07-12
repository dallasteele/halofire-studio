/**
 * Generate the sealed, source-bound Cooperative 1881 roof reconstruction input.
 *
 * The packet resolves all primary A-121 roof planes, five paired cricket planes,
 * the dimensioned roof hatch, and every 07.01 / 07.02 drain callout visible on
 * the sheet. The current architectural, MEP, submitted sprinkler, and hydraulic
 * sources are sealed into the packet. Their availability is not treated as proof
 * that every feature is registered, clearances are resolved, or the set is approved.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { sealRoofReconstructionInput } from '../src/engine/roof-geometry.js';

const PAGE_HEIGHT_PT = 1728;
const SCALE_FT_PER_POINT = 4 / 27; // A-121: 3/32 in = 1 ft.
const EAVE_ELEVATION_FT = 81;
const MAIN_SLOPE = 0.5 / 12;
const CRICKET_SLOPE = 0.25 / 12;
const END_AND_SOUTH_SLOPE = 2 / 12;
const EXPECTED_SOURCE_PDF_SHA256 = '179a572ea380be805131aabdeb7c3a3a041f9c2f5aaf55d2fcde673289ab6d53';
const EXPECTED_MEP_PDF_SHA256 = '56ee069667ceac63be2012bc3a93fb2e3806cb502bcc963cf05b39097a39b4bc';
const EXPECTED_FIRE_PDF_SHA256 = 'bae3cbfeb4c93812fe9a5a168dcf3e16836a6d13a3a75bb33c147cc1ebc0ac29';
const EXPECTED_HYDRAULIC_PDF_SHA256 = '389c8943c4bac1f6eeac9a884cd91da8f29920ef513cf7b0be48ae2da8de18fb';

const sourcePdf = path.resolve(process.env.COOPERATIVE_1881_ARCH_PDF
  || 'plans/cooperative-1881/1881-updated-architectural.pdf');
const mepPdf = path.resolve(process.env.COOPERATIVE_1881_MEP_PDF
  || 'plans/cooperative-1881/1881-updated-mep.pdf');
const firePdf = path.resolve(process.env.COOPERATIVE_1881_FIRE_PDF
  || 'plans/cooperative-1881/fire-sprinkler-r2.pdf');
const hydraulicPdf = path.resolve(process.env.COOPERATIVE_1881_HYDRAULIC_PDF
  || 'plans/cooperative-1881/hydraulics-r2.pdf');
const outputPath = path.resolve(process.env.COOPERATIVE_1881_ROOF_OUTPUT
  || 'src/data/roof-reconstruction.cooperative-1881.json');

function round(value) {
  return Math.round((Number(value) + Number.EPSILON) * 1e6) / 1e6;
}

function planPoint([pdfX, pdfY]) {
  return [round(pdfX * SCALE_FT_PER_POINT), round((PAGE_HEIGHT_PT - pdfY) * SCALE_FT_PER_POINT)];
}

function derivedDatum(id, kind, pdfPoint, elevationFt, method, extra = {}) {
  return {
    id,
    kind,
    label: id,
    elevationFt: round(elevationFt),
    planPointFt: planPoint(pdfPoint),
    sourceBindingRefs: ['elevation-A201', 'roof-plan-A121'],
    derivation: {
      method,
      anchorDatumId: 'roof-eave',
      sourcePdfPoint: pdfPoint,
      sheetScaleFtPerPoint: SCALE_FT_PER_POINT,
      ...extra,
    },
  };
}

const triangles = [
  [382.14, 528.65, 675.16],
  [688.66, 835.17, 981.68],
  [995.50, 1141.69, 1287.89],
  [1301.70, 1448.21, 1594.72],
  [1608.22, 1754.73, 1901.25],
];
const baseY = 1162.71;
const peakY = 1089.45;
const datums = [];
const regions = [];
const featureClearanceBasis = 'A-121 locates the feature, but does not establish NFPA sprinkler obstruction clearance or coordinated MEP penetration extents.';

const mainLeft = [triangles[0][0], baseY];
const mainRight = [triangles[triangles.length - 1][2], baseY];
const mainPeak = [triangles[0][1], peakY];
const mainPeakElevation = EAVE_ELEVATION_FT
  + (planPoint(mainPeak)[1] - planPoint(mainLeft)[1]) * MAIN_SLOPE;
datums.push(
  derivedDatum('north-main-valley-left', 'valley', mainLeft, EAVE_ELEVATION_FT, 'direct-elevation-datum'),
  derivedDatum('north-main-valley-right', 'valley', mainRight, EAVE_ELEVATION_FT, 'direct-elevation-datum'),
  derivedDatum('north-main-slope-point', 'roof-point', mainPeak, mainPeakElevation, 'slope-from-anchor', {
    slopeRisePerFoot: MAIN_SLOPE,
    sourceSlopeText: 'SLOPE 1/2 IN PER FOOT',
  }),
);

const jaggedInnerPdf = [];
for (let index = triangles.length - 1; index >= 0; index -= 1) {
  const [leftX, peakX, rightX] = triangles[index];
  jaggedInnerPdf.push([rightX, baseY], [peakX, peakY], [leftX, baseY]);
}
regions.push({
  id: 'north-center-primary',
  boundaryPlanFt: [
    planPoint([368.64, 940.03]),
    planPoint([1914.74, 940.03]),
    ...jaggedInnerPdf.map(planPoint),
  ],
  datumIds: ['north-main-valley-left', 'north-main-valley-right', 'north-main-slope-point'],
});

triangles.forEach(([leftX, peakX, rightX], index) => {
  const ordinal = index + 1;
  const left = [leftX, baseY];
  const center = [peakX, baseY];
  const right = [rightX, baseY];
  const peak = [peakX, peakY];
  const leftHigh = EAVE_ELEVATION_FT
    + (planPoint(center)[0] - planPoint(left)[0]) * CRICKET_SLOPE;
  const rightHigh = EAVE_ELEVATION_FT
    + (planPoint(right)[0] - planPoint(center)[0]) * CRICKET_SLOPE;
  datums.push(
    derivedDatum(`cricket-${ordinal}-left-low`, 'valley', left, EAVE_ELEVATION_FT, 'direct-elevation-datum'),
    derivedDatum(`cricket-${ordinal}-left-ridge-base`, 'ridge', center, leftHigh, 'slope-from-anchor', { slopeRisePerFoot: CRICKET_SLOPE, sourceSlopeText: 'SLOPE 1/4 IN PER FOOT' }),
    derivedDatum(`cricket-${ordinal}-left-ridge-peak`, 'ridge', peak, leftHigh, 'slope-from-anchor', { slopeRisePerFoot: CRICKET_SLOPE, sourceSlopeText: 'SLOPE 1/4 IN PER FOOT' }),
    derivedDatum(`cricket-${ordinal}-right-ridge-base`, 'ridge', center, rightHigh, 'slope-from-anchor', { slopeRisePerFoot: CRICKET_SLOPE, sourceSlopeText: 'SLOPE 1/4 IN PER FOOT' }),
    derivedDatum(`cricket-${ordinal}-right-ridge-peak`, 'ridge', peak, rightHigh, 'slope-from-anchor', { slopeRisePerFoot: CRICKET_SLOPE, sourceSlopeText: 'SLOPE 1/4 IN PER FOOT' }),
    derivedDatum(`cricket-${ordinal}-right-low`, 'valley', right, EAVE_ELEVATION_FT, 'direct-elevation-datum'),
  );
  regions.push(
    {
      id: `cricket-${ordinal}-left`,
      boundaryPlanFt: [planPoint(left), planPoint(center), planPoint(peak)],
      datumIds: [`cricket-${ordinal}-left-low`, `cricket-${ordinal}-left-ridge-base`, `cricket-${ordinal}-left-ridge-peak`],
    },
    {
      id: `cricket-${ordinal}-right`,
      boundaryPlanFt: [planPoint(center), planPoint(right), planPoint(peak)],
      datumIds: [`cricket-${ordinal}-right-ridge-base`, `cricket-${ordinal}-right-low`, `cricket-${ordinal}-right-ridge-peak`],
    },
  );
});

const rectangularPlanes = [
  { id: 'north-west-end', x0: 85.00, x1: 366.92, outerY: 878.57, innerY: 1131.07 },
  { id: 'north-east-end', x0: 1915.34, x1: 2262.44, outerY: 878.57, innerY: 1131.07 },
  { id: 'south-west', x0: 85.00, x1: 1106.29, outerY: 1415.20, innerY: 1162.71 },
  { id: 'south-east', x0: 1324.40, x1: 2262.44, outerY: 1415.20, innerY: 1162.71 },
];
for (const rectangle of rectangularPlanes) {
  const innerLeft = [rectangle.x0, rectangle.innerY];
  const innerRight = [rectangle.x1, rectangle.innerY];
  const outerLeft = [rectangle.x0, rectangle.outerY];
  const outerRight = [rectangle.x1, rectangle.outerY];
  const riseFt = Math.abs(planPoint(outerLeft)[1] - planPoint(innerLeft)[1]) * END_AND_SOUTH_SLOPE;
  datums.push(
    derivedDatum(`${rectangle.id}-inner-left`, 'valley', innerLeft, EAVE_ELEVATION_FT, 'direct-elevation-datum'),
    derivedDatum(`${rectangle.id}-inner-right`, 'valley', innerRight, EAVE_ELEVATION_FT, 'direct-elevation-datum'),
    derivedDatum(`${rectangle.id}-outer-left`, 'roof-point', outerLeft, EAVE_ELEVATION_FT + riseFt, 'slope-from-anchor', {
      slopeRisePerFoot: END_AND_SOUTH_SLOPE,
      sourceSlopeText: 'SLOPE 2 IN PER FOOT',
    }),
  );
  regions.push({
    id: rectangle.id,
    boundaryPlanFt: [planPoint(innerLeft), planPoint(innerRight), planPoint(outerRight), planPoint(outerLeft)],
    datumIds: [`${rectangle.id}-inner-left`, `${rectangle.id}-inner-right`, `${rectangle.id}-outer-left`],
  });
}

const sourceBytes = fs.readFileSync(sourcePdf);
const sourcePdfSha256 = createHash('sha256').update(sourceBytes).digest('hex');
if (sourcePdfSha256 !== EXPECTED_SOURCE_PDF_SHA256) {
  throw new Error(`source PDF hash mismatch: ${sourcePdfSha256}`);
}
function verifiedPdfHash(filePath, expected, label) {
  const actual = createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
  if (actual !== expected) throw new Error(`${label} PDF hash mismatch: ${actual}`);
  return actual;
}
const mepPdfSha256 = verifiedPdfHash(mepPdf, EXPECTED_MEP_PDF_SHA256, 'MEP');
const firePdfSha256 = verifiedPdfHash(firePdf, EXPECTED_FIRE_PDF_SHA256, 'fire sprinkler');
const hydraulicPdfSha256 = verifiedPdfHash(hydraulicPdf, EXPECTED_HYDRAULIC_PDF_SHA256, 'hydraulic');
const renderProfile = {
  renderer: 'PyMuPDF', rendererVersion: '1.27.2.2', matrixScale: 2.5,
  colorspace: 'rgb', alpha: false,
};
const sealed = await sealRoofReconstructionInput({
  artifactType: 'halofire.roof-reconstruction-input.v1',
  projectName: 'The Cooperative 1881 - Salt Lake City UT',
  sourceBindings: [
    {
      id: 'roof-plan-A121',
      binding: {
        sourcePdfSha256, physicalPageNumber: 36, pageIndex: 35,
        renderedPageSha256: '658402dc30c2ff57c0bc95c81ce1d5e23f9efe5b6c899296e7d8391c29ddc1fa',
        sheetId: 'A-121', coordinateSpace: 'pdf-points', renderProfile,
      },
    },
    {
      id: 'elevation-A201',
      binding: {
        sourcePdfSha256, physicalPageNumber: 61, pageIndex: 60,
        renderedPageSha256: 'ea47dd4c5f6d38be5cf1b53172048cb9ac57ed24877ff4b063d38028cdc3b888',
        sheetId: 'A-201', coordinateSpace: 'pdf-points', renderProfile,
      },
    },
    { id: 'section-A301', binding: { sourcePdfSha256, physicalPageNumber: 65, pageIndex: 64, renderedPageSha256: 'aefea2121a7727af85a506cd6996a3491259051f55d8da71228071e34d127780', sheetId: 'A-301', coordinateSpace: 'pdf-points', renderProfile } },
    { id: 'mechanical-M109', binding: { sourcePdfSha256: mepPdfSha256, physicalPageNumber: 10, pageIndex: 9, renderedPageSha256: 'f252bd4539461bdbcb7e45b9c94855ba9f6f8a7a5714b5c4a02f93e674fbadd9', sheetId: 'M109', coordinateSpace: 'pdf-points', renderProfile } },
    { id: 'plumbing-P109', binding: { sourcePdfSha256: mepPdfSha256, physicalPageNumber: 69, pageIndex: 68, renderedPageSha256: 'b55701c3c985cff21015d6a9822776991ce0da59a49bebab4ac44e1488275545', sheetId: 'P109', coordinateSpace: 'pdf-points', renderProfile } },
    { id: 'submitted-fire-cover-r2', binding: { sourcePdfSha256: firePdfSha256, physicalPageNumber: 1, pageIndex: 0, renderedPageSha256: 'a698a2459dcb6d3f89c02cce7cf6ad4f1bc0afa86bbf15b7a9876bbd1524d107', sheetId: 'FP-cover-R2', coordinateSpace: 'pdf-points', renderProfile } },
    { id: 'submitted-fire-FP8-r2', binding: { sourcePdfSha256: firePdfSha256, physicalPageNumber: 12, pageIndex: 11, renderedPageSha256: '2f20907cec537c92bff749f476d7c14712941421b367c2f6f4b428ccae2e6d20', sheetId: 'FP-8-R2', coordinateSpace: 'pdf-points', renderProfile } },
    { id: 'submitted-hydraulic-DA3-r2', binding: { sourcePdfSha256: hydraulicPdfSha256, physicalPageNumber: 20, pageIndex: 19, renderedPageSha256: '574bf1b357f226666a7d36323ee7e435216fd76b9eb1be10a272b03e390d18f5', sheetId: 'DA-3-node-analysis-R2', coordinateSpace: 'pdf-points', renderProfile } },
  ],
  datums,
  regions,
  exclusions: [
    {
      id: 'central-south-open-core',
      boundaryPlanFt: [
        planPoint([1106.29, 1162.71]), planPoint([1324.40, 1162.71]),
        planPoint([1324.40, 1415.20]), planPoint([1106.29, 1415.20]),
      ],
      reason: 'open-core',
      sourceBindingRefs: ['roof-plan-A121'],
    },
  ],
  features: [
    ...[
      ['drain-west-1', 'internal-roof-drain', [382.30075, 1157.64551], '07.01'],
      ['overflow-west-1', 'internal-overflow-drain', [374.17947, 1157.64551], '07.02'],
      ['drain-west-2', 'internal-roof-drain', [893.12451, 1157.64551], '07.01'],
      ['overflow-west-2', 'internal-overflow-drain', [885.04578, 1157.64551], '07.02'],
      ['drain-east-1', 'internal-roof-drain', [1404.03625, 1157.64551], '07.01'],
      ['overflow-east-1', 'internal-overflow-drain', [1395.91492, 1157.64551], '07.02'],
      ['drain-east-2', 'internal-roof-drain', [1914.90527, 1157.64551], '07.01'],
      ['overflow-east-2', 'internal-overflow-drain', [1906.78125, 1157.64551], '07.02'],
      ['overflow-north-west', 'internal-overflow-drain', [750.50488, 977.57697], '07.02'],
      ['overflow-north-east', 'internal-overflow-drain', [1717.68188, 971.93903], '07.02'],
    ].map(([id, type, pdfPoint, sourceCallout]) => ({
      id, type, geometry: { kind: 'point', planPointFt: planPoint(pdfPoint) },
      sourceBindingRefs: ['roof-plan-A121'], sourceCallout, sourcePdfPoint: pdfPoint,
      clearance: { status: 'unresolved', basis: featureClearanceBasis },
    })),
    {
      id: 'roof-access-hatch-1', type: 'roof-hatch',
      geometry: {
        kind: 'polygon',
        boundaryPlanFt: [
          planPoint([1134.40991, 1166.43579]), planPoint([1154.66077, 1166.43579]),
          planPoint([1154.66077, 1220.43591]), planPoint([1134.40991, 1220.43591]),
        ],
      },
      sourceBindingRefs: ['roof-plan-A121', 'section-A301'], sourceCallout: '08.01 roof access hatch; A-301 section',
      sourcePdfPoint: [1154.66077, 1166.43579], dimensionsFt: [3, 8],
      clearance: { status: 'unresolved', basis: featureClearanceBasis },
    },
  ],
  coordinationEvidence: [
    {
      id: 'roof-mechanical-coordination', role: 'roof-mechanical',
      sourceBindingRefs: ['mechanical-M109'], evidenceStatus: 'issued-coordination-source',
      approvalStatus: 'not-an-approval-artifact',
      observations: ['M109 locates rooftop HP and ODU equipment fields for Areas B and C at 1/8 inch equals 1 foot.'],
      registration: { status: 'unregistered', basis: 'Equipment footprints have not yet been transformed from the M109 area views into the sealed A-121 plan coordinate space.' },
    },
    {
      id: 'roof-plumbing-coordination', role: 'roof-plumbing',
      sourceBindingRefs: ['plumbing-P109'], evidenceStatus: 'issued-coordination-source',
      approvalStatus: 'not-an-approval-artifact',
      observations: ['P109 locates RD-1 roof drains and vent-through-roof penetrations and requires vents to terminate at least 10 feet from mechanical intakes and building openings.'],
      registration: { status: 'partially-registered', basis: 'A-121 drain points are registered; the complete P109 vent inventory is not yet transformed into A-121 coordinates.' },
    },
    {
      id: 'roof-section-coordination', role: 'architectural-section',
      sourceBindingRefs: ['section-A301'], evidenceStatus: 'issued-coordination-source',
      approvalStatus: 'not-an-approval-artifact',
      observations: ['A-301 shows the eighth-floor ceiling below the pitched roof cavity and identifies the insulated roof access hatch.'],
      registration: { status: 'registered', basis: 'A-301 is bound to the roof hatch and vertical roof/eighth-floor relationship; it does not by itself establish the attic sprinkler protection basis.' },
    },
    {
      id: 'submitted-sprinkler-calibration', role: 'submitted-sprinkler-plan',
      sourceBindingRefs: ['submitted-fire-cover-r2', 'submitted-fire-FP8-r2'], evidenceStatus: 'submitted-reference',
      approvalStatus: 'submittal-only-not-approved',
      observations: ['The R2 set contains submitted level-by-level sprinkler plans through FP-8 and no separate roof or attic sprinkler plan.'],
      registration: { status: 'unregistered', basis: 'The submitted FP-8 head and pipe geometry has not yet been transformed and compared node-by-node with generated Level 8 output.' },
    },
    {
      id: 'submitted-hydraulic-calibration', role: 'submitted-hydraulic-calculation',
      sourceBindingRefs: ['submitted-hydraulic-DA3-r2'], evidenceStatus: 'submitted-reference',
      approvalStatus: 'submittal-only-not-approved',
      observations: ['DA-3 node analysis includes sprinkler elevations at 89 feet 5 inches and upstream pipe elevations at 83 feet 4 inches.'],
      registration: { status: 'unregistered', basis: 'Hydraulic nodes have not yet been mapped to FP-8 plan coordinates or used as proof of an attic/ceiling protection classification.' },
    },
  ],
  coverage: {
    complete: false,
    resolvedScope: 'Current A-121 primary planes, five paired cricket planes, A-301 roof hatch, visible A-121 drain callouts, and available M109/P109/R2 calibration sources',
    unresolvedRegions: ['mep-feature-coordinate-registration-and-clearances', 'level-8-ceiling-versus-attic-protection-basis', 'submitted-output-node-by-node-comparison'],
  },
});

fs.writeFileSync(outputPath, `${JSON.stringify(sealed, null, 2)}\n`);
console.log(JSON.stringify({ outputPath, receiptSha256: sealed.evidenceReceiptSha256, datums: sealed.datums.length, regions: sealed.regions.length, features: sealed.features.length, coverage: sealed.coverage }, null, 2));
