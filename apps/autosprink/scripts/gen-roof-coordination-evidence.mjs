import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const [heatPumpPath, ventPath, outputPath = path.resolve('src/data/roof-coordination.cooperative-1881.json')] = process.argv.slice(2);
if (!heatPumpPath || !ventPath) throw new Error('usage: node scripts/gen-roof-coordination-evidence.mjs <m109-derived.json> <p109-derived.json> [output.json]');
const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const heatPumps = read(heatPumpPath); const vents = read(ventPath);
const roof = read(path.resolve('src/data/roof-reconstruction.cooperative-1881.json'));
const pickSource = (id) => roof.sourceBindings.find((entry) => entry.id === id);
const round = (value) => Math.round((value + Number.EPSILON) * 1e6) / 1e6;
const a121Plan = ([x, y]) => [round(x * 4 / 27), round((1728 - y) * 4 / 27)];
const transform = (point, sourceAnchor, targetAnchor) => {
  const target = a121Plan(targetAnchor);
  return [round(target[0] + (point[0] - sourceAnchor[0]) / 9), round(target[1] + (sourceAnchor[1] - point[1]) / 9)];
};
const areas = {
  B: { sourceAnchor: [149.558, 126.61], targetAnchor: [109.888, 912.259] },
  C: { sourceAnchor: [205.358, 910.572], targetAnchor: [733.63, 912.259] },
};
const distance = (a, b) => round(Math.hypot(a[0] - b[0], a[1] - b[1]));
const control = (id, sourcePdfPoint, targetA121PdfPoint, area) => {
  const derivedPlanPointFt = transform(sourcePdfPoint, areas[area].sourceAnchor, areas[area].targetAnchor);
  const expectedPlanPointFt = a121Plan(targetA121PdfPoint);
  return { id, sourcePdfPoint, targetA121PdfPoint, derivedPlanPointFt, expectedPlanPointFt, residualFt: distance(derivedPlanPointFt, expectedPlanPointFt) };
};
const transformRows = [
  ['m109-area-b', 'M109', 'B', [control('grid-28.1-A', [149.558, 126.61], [109.888, 912.259], 'B'), control('grid-20-A', [980.559, 126.61], [733.63, 912.259], 'B'), control('grid-28.1-K', [149.558, 709.211], [109.888, 1349.552], 'B')]],
  ['p109-area-b', 'P109', 'B', [control('grid-28.1-A', [149.558, 126.61], [109.888, 912.259], 'B'), control('grid-20-A', [980.559, 126.61], [733.63, 912.259], 'B'), control('grid-28.1-K', [149.558, 709.211], [109.888, 1349.552], 'B')]],
  ['m109-area-c', 'M109', 'C', [control('grid-20-A', [205.358, 910.572], [733.63, 912.259], 'C'), control('grid-1-A', [2085.101, 910.572], [2144.384, 912.259], 'C'), control('grid-20-K', [205.358, 1493.293], [733.63, 1349.552], 'C')]],
  ['p109-area-c', 'P109', 'C', [control('grid-20-A', [205.358, 910.572], [733.63, 912.259], 'C'), control('grid-1-A', [2085.101, 910.572], [2144.384, 912.259], 'C'), control('grid-20-K', [205.358, 1493.293], [733.63, 1349.552], 'C')]],
].map(([id, sourceSheetId, area, controls]) => ({ id, sourceSheetId, area, sourceScaleFtPerPoint: 1 / 9, targetScaleFtPerPoint: 4 / 27,
  sourceAnchorPdf: areas[area].sourceAnchor, targetAnchorA121Pdf: areas[area].targetAnchor, targetAnchorPlanFt: a121Plan(areas[area].targetAnchor), controls,
  maxResidualFt: Math.max(...controls.map((entry) => entry.residualFt)) }));
const odus = [
  ['m109-odu-1', 'ODU-1', [654.26, 1086, 692.42, 1109.28]], ['m109-odu-2', 'ODU-2', [654.26, 1122.84, 692.42, 1146.12]],
  ['m109-odu-3', 'ODU-3', [654.26, 1160.28, 692.42, 1183.56]], ['m109-odu-4', 'ODU-4', [654.26, 1198.32, 692.42, 1221.72]],
].map(([id, modelTag, sourceRectPdf]) => {
  const [x1, y1, x2, y2] = sourceRectPdf; const map = (point) => transform(point, areas.C.sourceAnchor, areas.C.targetAnchor);
  return { id, kind: 'outdoor-unit', modelTag, area: 'C', sourceBindingRefs: ['mechanical-M109'], sourceRectPdf,
    boundaryPlanFt: [map([x1, y1]), map([x2, y1]), map([x2, y2]), map([x1, y2])], heightFt: null,
    heightStatus: 'unresolved-model-specific-dimension', clearanceStatus: 'unresolved' };
});
const equipment = heatPumps.rectangles.map((item) => ({ id: item.id, kind: 'heat-pump', modelTag: item.sourceType, area: item.area,
  sourceBindingRefs: ['mechanical-M109'], sourceRectPdf: item.sourceRectPdf, boundaryPlanFt: item.boundaryPlanFt,
  heightFt: null, heightStatus: 'unresolved-model-specific-dimension', clearanceStatus: 'unresolved' })).concat(odus);
const ventRows = vents.vents.map((item) => ({ id: item.id, kind: 'vent-penetration', diameterIn: item.diameterIn, area: item.area,
  sourceBindingRefs: ['plumbing-P109'], sourceLabelPdf: item.sourceLabelPdf, sourcePointPdf: item.sourcePointPdf,
  planPointFt: item.planPointFt, clearanceStatus: 'unresolved' }));
const draft = {
  artifactType: 'halofire.roof-coordination-input.v1', projectName: roof.projectName,
  sourceBindings: [pickSource('roof-plan-A121'), pickSource('mechanical-M109'), pickSource('plumbing-P109')], transforms: transformRows,
  equipment, vents: ventRows,
  counts: { acceptedHeatPumpFootprints: heatPumps.count, acceptedOutdoorUnitFootprints: odus.length, acceptedVentPoints: vents.count,
    unmatchedMechanicalLabels: 5, unmatchedVentLabels: vents.diagnostics.sourceLabelCount - vents.count,
    scheduleCounts: { 'HP-1': 84, 'HP-2': 84, 'HP-3': 24 } },
  coverage: { complete: false, resolvedScope: 'Visible one-to-one M109 rooftop equipment footprints and P109 vent endpoints registered to A121 plan feet.',
    unresolved: ['five-unmatched-M109-labels', 'six-unmatched-P109-labels', 'equipment-model-specific-heights', 'feature-specific-obstruction-clearances', 'schedule-versus-visible-plan-count-discrepancy'] },
  derivation: { method: 'Vector rectangles/circles matched one-to-one to source labels, then transformed by issued sheet scales and independently checked grids.', oneToOneMatching: true, syntheticFeaturesAdded: false },
};
const canonicalize = (value) => Array.isArray(value) ? value.map(canonicalize) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])])) : value;
draft.evidenceReceiptSha256 = crypto.createHash('sha256').update(JSON.stringify(canonicalize(draft))).digest('hex');
fs.writeFileSync(outputPath, JSON.stringify(draft, null, 2) + '\n');
console.log(JSON.stringify({ outputPath, receipt: draft.evidenceReceiptSha256, equipment: equipment.length, vents: ventRows.length, maxResidualFt: Math.max(...transformRows.map((row) => row.maxResidualFt)) }));
