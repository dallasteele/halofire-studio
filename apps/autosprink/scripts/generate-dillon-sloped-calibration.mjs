import fs from 'node:fs';
import { sealSubmittedSlopedCeilingCalibration } from '../src/engine/submitted-sloped-ceiling-calibration.js';

const round = [[445.67,336.72],[527.37,444.48],[684.06,678.72],[684.06,735.9],[684.06,795.96],[666.04,1001.25],[858.67,1150.44],[666.01,1150.44],[960.03,1111.47],[858.67,1001.37],[1014.43,1001.37],[1014.44,950.22],[774.97,625.68],[918.08,625.68],[774.98,774.78],[918.08,774.78],[1139.01,1097.85],[1139.02,896.55],[1139.02,699.15],[1267.92,1097.85],[1267.93,896.55],[1267.96,699.15],[1014.44,673.23],[1049.63,615.03],[1721.43,713.97],[1721.43,838.95],[1841.03,838.95],[2015.37,683.67],[1859.07,683.67],[2015.37,469.35],[1859.07,469.35],[2087.04,575.79],[2087.04,289.47],[2214.78,274.35],[2028.81,370.95],[2087.04,167.91],[2173.22,569.37],[2173.22,381.6],[937.81,894.66],[1014.43,805.29]];
const cross = [[406.41,660.71],[555.99,660.7],[451.77,589.95],[518.85,589.95],[598.89,589.95],[406.41,871],[555.99,870.96],[406.41,1038.57],[555.99,1038.57],[652.83,926.34]];
const slopeRaw = [[1658.6746,1560.5979],[1534.2318,1320.5962],[1285.1718,918.9564],[1390.4718,1403.2162],[1365.8718,1289.2761],[1175.7917,1218.2362],[1526.8483,1306.8906],[1661.0082,1543.2307]];
const rcpRegions = [
  { id: 'slope-region-east-patio', annotationId: 'slope-3', polygon: [[1940,1215],[2225,1215],[2225,1415],[1940,1415]], protectionBasis: 'completed-bid-no-submitted-heads', submittedHeadIds: [], obstructions: [], elevationDatum: null },
  { id: 'slope-region-east-covered', annotationId: 'slope-6', polygon: [[1670,1085],[1900,1085],[1900,1330],[1670,1330]], protectionBasis: 'completed-bid-protected', submittedHeadIds: ['round-27','round-29'], obstructions: [{ id: 'east-covered-fan-1', kind: 'ceiling-fan', centerRcpPt: [1814.7,1188], clearanceFt: 6, preferredSide: 'negative-x', sourceGeometry: 'four-blade-ceiling-fan-vector' }], elevationDatum: { sourceText: 'SOFFIT @ 9\'-0" (109\'-0")', datumPointRcpPt: [1805.5,1101.5], projectElevationFt: 109, slopeDirection: 'positive-y-down' } },
  { id: 'slope-region-south-covered', annotationId: 'slope-7', polygon: [[1560,1425],[1805,1425],[1805,1750],[1560,1750]], protectionBasis: 'completed-bid-no-submitted-heads', submittedHeadIds: [], obstructions: [], elevationDatum: null },
  { id: 'slope-region-west-covered', annotationId: 'slope-8', polygon: [[1285,1560],[1590,1560],[1590,1850],[1285,1850]], protectionBasis: 'completed-bid-no-submitted-heads', submittedHeadIds: [], obstructions: [], elevationDatum: null },
];
const draft = {
  artifactType: 'halofire.submitted-sloped-ceiling-calibration.v1', projectName: 'Dillon Residence', units: 'pdf-pt', printedScalePtPerFt: 13.5,
  sources: [
    { id: 'submitted-FP1', sha256: 'ea09a1fe2b1e175170e980a0e0960a7e7f2bf82f949668ae1c895e163c604a63' },
    { id: 'architectural-RCP', sha256: 'ed51fe47cdbb0c95db5d3a4f64117fe2625d3c0bf4e7170c6f3dec0d38ed11ba' },
    { id: 'hydraulic-RA1', sha256: '773a2c38d2c9e2a9807828c91ec5b6f5c56900f2c10c68c25473c7e1eb60e705' },
    { id: 'hydraulic-RA2', sha256: '4cecd2c732934b4f8e000d634664b6b3e10ba3a7fa85b91a462ecc90da69ffe0' },
    { id: 'hydraulic-RA3', sha256: '65ec2e6709642cddda97de90bd902cc6efd4f8a459e3d94eedc04f7d494e219c' },
  ],
  registration: { method: 'three-independent-raster-control-crops', architectureFromSubmitted: { xOffsetPt: -114, yOffsetPt: 460, scale: 1, rotationDeg: 0 }, controls: [{ id: 'whole-plan', xOffsetPt: -113, yOffsetPt: 460, score: .1946 },{ id: 'main-building', xOffsetPt: -114, yOffsetPt: 460, score: .1766 },{ id: 'east-wing', xOffsetPt: -114, yOffsetPt: 460, score: .1661 }], xRmsResidualPt: .4714, yRmsResidualPt: 0, scaleErrorPct: 0 },
  ceilingSlopeAnnotations: slopeRaw.map((point, index) => ({ id: `slope-${index + 1}`, sourcePointUnrotatedPt: point, registeredSubmittedPointPt: [3024 - point[1] + 114, point[0] - 460], riseIn: 3, runIn: 12, text: '3"/12"' })),
  slopeRegions: rcpRegions.map((region) => ({ id: region.id, annotationId: region.annotationId, polygonRcpPt: region.polygon, polygonSubmittedPt: region.polygon.map(([x, y]) => [x + 114, y - 460]), slopeAxis: 'y', downhillDirection: 'positive-y', protectionBasis: region.protectionBasis, submittedHeadIds: region.submittedHeadIds, obstructions: region.obstructions.map((obstruction) => ({ ...obstruction, centerSubmittedPt: [obstruction.centerRcpPt[0] + 114, obstruction.centerRcpPt[1] - 460] })), elevationDatum: region.elevationDatum ? { ...region.elevationDatum, datumPointSubmittedPt: [region.elevationDatum.datumPointRcpPt[0] + 114, region.elevationDatum.datumPointRcpPt[1] - 460] } : null })),
  submittedHeads: [...round.map((point, index) => ({ id: `round-${index + 1}`, pointPt: point, symbolClass: 'round-pendent-vector-candidate' })), ...cross.map((point, index) => ({ id: `cross-${index + 1}`, pointPt: point, symbolClass: 'cross-pendent-vector-candidate' }))],
  schedule: { totalHeads: 52, roundPendent: 40, alternatePendent: 12 },
  hydraulicEvidence: [{ report: 'RA-1', nodeId: '1', elevationFt: 10, nodeKind: 'active-sprinkler' },{ report: 'RA-1', nodeId: '7', elevationFt: 10, nodeKind: 'active-sprinkler' },{ report: 'RA-2', nodeId: '4', elevationFt: 10, nodeKind: 'active-sprinkler' },{ report: 'RA-3', nodeId: '13', elevationFt: 22, nodeKind: 'active-sprinkler' },{ report: 'RA-3', nodeId: '15', elevationFt: 22, nodeKind: 'active-sprinkler' }],
  coverage: { complete: false, detectedVectorCandidates: 50, unresolved: ['two-alternate-pendent-symbols-not-yet-vector-classified','full-sloped-ceiling-boundary-polygons-not-yet-sealed','generated-layout-parity-not-yet-executed','code-compliance-and-approval-not-inferred-from-completed-bid'] },
  claimStatus: 'completed-bid-sloped-ceiling-calibration-not-code-compliance-or-approval',
};
const packet = await sealSubmittedSlopedCeilingCalibration(draft);
fs.writeFileSync(new URL('../src/data/submitted-sloped-ceiling-calibration.dillon.json', import.meta.url), `${JSON.stringify(packet, null, 2)}\n`);
