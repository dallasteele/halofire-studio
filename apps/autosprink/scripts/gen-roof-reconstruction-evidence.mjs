/**
 * Generate the sealed, source-bound Cooperative 1881 roof reconstruction input.
 *
 * The packet resolves all primary A-121 roof planes, five paired cricket planes,
 * the dimensioned roof hatch, and every 07.01 / 07.02 drain callout visible on
 * the sheet. A-121 requires coordination with mechanical/electrical drawings,
 * so undisclosed penetrations and feature-specific obstruction clearances remain
 * explicit unresolved gates and full-model sprinkler projection stays fail-closed.
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
const EXPECTED_SOURCE_PDF_SHA256 = 'bb3c85c8ae6a7709cb45d200b2aa38b26a75ec82870c01ba70346b2c1814008f';

const sourcePdf = path.resolve(process.env.COOPERATIVE_1881_ARCH_PDF
  || 'plans/cooperative-1881/1881-architecturals.pdf');
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
const renderProfile = {
  renderer: 'PyMuPDF', rendererVersion: '1.27.2.2', matrixScale: 2.5,
  colorspace: 'rgb', alpha: false,
};
const sealed = await sealRoofReconstructionInput({
  artifactType: 'halofire.roof-reconstruction-input.v1',
  sourceBindings: [
    {
      id: 'roof-plan-A121',
      binding: {
        sourcePdfSha256, physicalPageNumber: 32, pageIndex: 31,
        renderedPageSha256: 'fd6a414aba729b5a1b115bde5537405df7d5142e1bb01bd7651aea544d11fc47',
        sheetId: 'A-121', coordinateSpace: 'pdf-points', renderProfile,
      },
    },
    {
      id: 'elevation-A201',
      binding: {
        sourcePdfSha256, physicalPageNumber: 58, pageIndex: 57,
        renderedPageSha256: '40b57bce5407d403d2daf1b857313559da821b225ebc7e1fc8241bf45e97087c',
        sheetId: 'A-201', coordinateSpace: 'pdf-points', renderProfile,
      },
    },
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
      sourceBindingRefs: ['roof-plan-A121'], sourceCallout: '08.01',
      sourcePdfPoint: [1154.66077, 1166.43579], dimensionsFt: [3, 8],
      clearance: { status: 'unresolved', basis: featureClearanceBasis },
    },
  ],
  coverage: {
    complete: false,
    resolvedScope: 'A-121 primary planes, five paired cricket planes, dimensioned roof hatch, and visible 07.01/07.02 drain callouts',
    unresolvedRegions: ['roof-feature-clearances-and-uncoordinated-mep-penetrations'],
  },
});

fs.writeFileSync(outputPath, `${JSON.stringify(sealed, null, 2)}\n`);
console.log(JSON.stringify({ outputPath, receiptSha256: sealed.evidenceReceiptSha256, datums: sealed.datums.length, regions: sealed.regions.length, features: sealed.features.length, coverage: sealed.coverage }, null, 2));
