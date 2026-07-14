import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const PROJECT_ID = 'mit-riverside-building-j';
const PROJECT = 'MIT Riverside - Transportation Building J';
const READER = '@mlightcad/libredwg-web 0.7.7';
const FLOOR_SHA = '4310609e80ef25af2abbb164a623de1fe749fb37b04d165699acc4fc4f6297e5';
const ROOF_SHA = '94ee255614f7b403de5185622018eaaad8f80ebe253592418bc7e3b6d993c9aa';
const FLOOR_BYTES = 6418563;
const ROOF_BYTES = 701676;
const FLOOR_ORIGIN = Object.freeze({ x: 13437.687842947527, y: 11469.570653433395 });
const ROOF_ORIGIN = Object.freeze({ x: 5436.932431050957, y: 11469.528544309976 });
const SOURCE_X = Object.freeze([0, 15.666667, 17.333333, 30.666667, 39.666667, 45.666667, 61.333333, 76.333333]);
const STRUCTURAL_X = Object.freeze([0, 15.663824, 17.33348, 30.663824, 39.666667, 45.663824, 61.333333, 76.333333]);
const SOURCE_Y = Object.freeze([0, 32.166667, 64.833333, 89.166667, 100.166667]);
const STRUCTURAL_Y = Object.freeze([0, 32.166667, 64.833333, 90.166667, 100.166667]);
const EXPECTED_SLABS = Object.freeze({ Slab_106: 8, Slab_107: 4, Slab_108: 4 });
const round = (value) => Number(value.toFixed(6));
const close = (left, right, tolerance = 0.00001) => Math.abs(left - right) <= tolerance;

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 2) args[argv[index].replace(/^--/, '')] = argv[index + 1];
  for (const required of ['floor-dump', 'roof-dump', 'floor-dwg', 'roof-dwg', 'output']) {
    if (!args[required]) throw new Error(`missing --${required}`);
  }
  return args;
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function sha256Object(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function interpolate(value, source, target) {
  let startIndex = 0;
  if (value >= source.at(-1)) startIndex = source.length - 2;
  else if (value > source[0]) startIndex = source.findIndex((next, index) => index < source.length - 1 && value >= next && value <= source[index + 1]);
  for (let index = startIndex; index < source.length - 1; index += 1) {
    if (value >= source[index] && value <= source[index + 1]) {
      const ratio = (value - source[index]) / (source[index + 1] - source[index]);
      return target[index] + ratio * (target[index + 1] - target[index]);
    }
  }
  const ratio = (value - source[startIndex]) / (source[startIndex + 1] - source[startIndex]);
  return target[startIndex] + ratio * (target[startIndex + 1] - target[startIndex]);
}

function polygonArea(vertices) {
  return Math.abs(vertices.reduce((sum, vertex, index) => {
    const next = vertices[(index + 1) % vertices.length];
    return sum + vertex.x * next.y - next.x * vertex.y;
  }, 0) / 2);
}

function floorPoint(raw) {
  const sourceX = (raw.x - FLOOR_ORIGIN.x) / 12;
  const sourceY = (FLOOR_ORIGIN.y - raw.y) / 12;
  return { x: round(interpolate(sourceX, SOURCE_X, STRUCTURAL_X)), y: round(interpolate(sourceY, SOURCE_Y, STRUCTURAL_Y)) };
}

function roofPoint(raw) {
  return { x: round((raw.x - ROOF_ORIGIN.x) / 12), y: round((ROOF_ORIGIN.y - raw.y) / 12) };
}

function exactLine(lines, layer, a, b) {
  const found = lines.filter((line) => line.type === 'LINE' && line.layer === layer && (
    (close(line.startPoint.x, a.x) && close(line.startPoint.y, a.y) && close(line.endPoint.x, b.x) && close(line.endPoint.y, b.y)) ||
    (close(line.startPoint.x, b.x) && close(line.startPoint.y, b.y) && close(line.endPoint.x, a.x) && close(line.endPoint.y, a.y))
  ));
  if (found.length !== 1) throw new Error(`${layer} boundary line ${JSON.stringify([a, b])} count ${found.length}`);
  return found[0];
}

function containingLine(lines, layer, a, b) {
  const horizontal = close(a.y, b.y);
  const vertical = close(a.x, b.x);
  const between = (value, edgeA, edgeB) => value >= Math.min(edgeA, edgeB) - 0.00001 && value <= Math.max(edgeA, edgeB) + 0.00001;
  const found = lines.filter((line) => {
    if (line.type !== 'LINE' || line.layer !== layer) return false;
    if (horizontal) return close(line.startPoint.y, a.y) && close(line.endPoint.y, a.y) && between(a.x, line.startPoint.x, line.endPoint.x) && between(b.x, line.startPoint.x, line.endPoint.x);
    if (vertical) return close(line.startPoint.x, a.x) && close(line.endPoint.x, a.x) && between(a.y, line.startPoint.y, line.endPoint.y) && between(b.y, line.startPoint.y, line.endPoint.y);
    return false;
  });
  if (found.length !== 1) throw new Error(`${layer} containing boundary line ${JSON.stringify([a, b])} count ${found.length}`);
  return found[0];
}

function rectangleFromLines(lines, layer, x1, y1, x2, y2) {
  const vertices = [{ x: x1, y: y1 }, { x: x2, y: y1 }, { x: x2, y: y2 }, { x: x1, y: y2 }];
  for (let index = 0; index < vertices.length; index += 1) containingLine(lines, layer, vertices[index], vertices[(index + 1) % vertices.length]);
  return vertices;
}

const args = parseArgs(process.argv.slice(2));
const floorStat = fs.statSync(args['floor-dwg']);
const roofStat = fs.statSync(args['roof-dwg']);
if (floorStat.size !== FLOOR_BYTES || sha256File(args['floor-dwg']) !== FLOOR_SHA) throw new Error('MIT_J_FLOOR_DWG_SOURCE_MISMATCH');
if (roofStat.size !== ROOF_BYTES || sha256File(args['roof-dwg']) !== ROOF_SHA) throw new Error('MIT_J_ROOF_DWG_SOURCE_MISMATCH');

const floorDump = JSON.parse(fs.readFileSync(args['floor-dump'], 'utf8'));
const roofDump = JSON.parse(fs.readFileSync(args['roof-dump'], 'utf8'));
if (floorDump.unknownEntityCount !== 0 || roofDump.unknownEntityCount !== 0) throw new Error('MIT_J_DWG_UNKNOWN_ENTITIES');

const floorSlabs = Object.entries(EXPECTED_SLABS).map(([id, expectedVertices]) => {
  const blocks = floorDump.blockRecords.filter((block) => block.name === id);
  const entities = blocks[0]?.entities || [];
  if (blocks.length !== 1 || entities.length !== 1 || entities[0].type !== 'LWPOLYLINE' || entities[0].vertices.length !== expectedVertices) throw new Error(`${id} source polygon mismatch`);
  const rawVerticesInches = entities[0].vertices.map(({ x, y }) => ({ x, y }));
  const structuralLocalVerticesFt = rawVerticesInches.map(floorPoint);
  return { id, sourceLayer: entities[0].layer, rawVerticesInches, structuralLocalVerticesFt, areaSqFt: round(polygonArea(structuralLocalVerticesFt)) };
});

const roofLines = roofDump.relevant;
const mainRaw = rectangleFromLines(roofLines, 'A-ROOF', 5420.932431109933, 11481.997690799793, 6188.932431050939, 10664.090356279376);
const westRaw = [
  { x: 5420.932431077034, y: 10683.528544299996 },
  { x: 5640.932431050945, y: 10683.528544299996 },
  { x: 5640.932431050945, y: 10255.62120977943 },
  { x: 5420.932431077034, y: 10255.62120977943 },
];
exactLine(roofLines, 'A-ROOF', westRaw[0], westRaw[1]);
exactLine(roofLines, 'A-ROOF', westRaw[2], westRaw[3]);
exactLine(roofLines, 'A-ROOF', westRaw[3], westRaw[0]);
exactLine(roofLines, 'A-ROOF', westRaw[2], { x: 5640.932431050941, y: 10267.528544299996 });
exactLine(roofLines, 'A-WALL', { x: 5640.932431050941, y: 10267.528544299996 }, { x: 5640.932431050939, y: 10395.528544299996 });
exactLine(roofLines, 'A-WALL', { x: 5640.932431050939, y: 10395.528544299996 }, westRaw[1]);
const membraneRaw = rectangleFromLines(roofLines, 'A-WALL', 5648.932431050943, 10683.528544299996, 6344.9324319897105, 10275.528544299996);
const roofRegions = [
  ['main-standing-seam', 'standing-seam-metal-base-boundary', 'A-ROOF', mainRaw],
  ['west-lower-standing-seam', 'standing-seam-metal-base-boundary', 'A-ROOF plus A-WALL shared edge', westRaw],
  ['membrane-base', 'membrane-base-boundary-not-cricket-subfaces', 'A-WALL-inner-face', membraneRaw],
].map(([id, role, sourceLayer, rawVerticesInches]) => {
  const structuralLocalVerticesFt = rawVerticesInches.map(roofPoint);
  return { id, role, sourceLayer, rawVerticesInches, structuralLocalVerticesFt, areaSqFt: round(polygonArea(structuralLocalVerticesFt)) };
});
if (!close(roofRegions[2].areaSqFt, 1972, 0.001)) throw new Error(`MIT_J_MEMBRANE_AREA_MISMATCH_${roofRegions[2].areaSqFt}`);

const draft = {
  artifactType: 'halofire.mit-riverside-building-j-source-spatial-boundary-evidence.v1', projectId: PROJECT_ID, projectName: PROJECT,
  extraction: { reader: READER, floorDumpUnknownEntityCount: 0, roofDumpUnknownEntityCount: 0, units: 'source-inches-to-structural-local-feet' },
  sources: {
    architecturalFloorDwg: { path: 'Engineering/CAD Files/18_434 Riverside MIT Phase 2 Floor plans.dwg', bytes: FLOOR_BYTES, sha256: FLOOR_SHA },
    structuralRoofDwg: { path: 'Engineering/CAD Files/19PHX009 - OWP - Riverside MIT Phase 2-Sheet - S2-1 - ROOF FRAMING PLANS.dwg', bytes: ROOF_BYTES, sha256: ROOF_SHA },
  },
  coordinateFrames: {
    floorDwgOriginInches: FLOOR_ORIGIN, structuralRoofDwgOriginInches: ROOF_ORIGIN,
    architecturalToStructuralPiecewiseCorrection: { sourceXFt: [...SOURCE_X], structuralXFt: [...STRUCTURAL_X], sourceYFt: [...SOURCE_Y], structuralYFt: [...STRUCTURAL_Y] },
  },
  floorSlabs, roofRegions,
  independentClosure: { membraneDrawingNoteSqFt: 1972, membraneExtractedSqFt: roofRegions[2].areaSqFt, membraneWidthFt: 58, membraneDepthFt: 34 },
  claims: {
    exactFloorSlabPolygonsReady: true, mainStandingSeamBoundaryReady: true, westLowerStandingSeamBoundaryReady: true, membraneBaseBoundaryReady: true,
    cricketFaceTopologyReady: false, wholeRoofFaceTopologyReady: false, sourceProtectionPlaneReady: false, headElevationsReady: false,
    sourceGeneratedPitchedPlacementVerified: false, complianceReady: false, fabricationReady: false, fieldReleaseReady: false,
  },
};
const output = { ...draft, receiptSha256: sha256Object(draft) };
fs.mkdirSync(path.dirname(args.output), { recursive: true });
fs.writeFileSync(args.output, `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify({ output: args.output, floorSlabs: floorSlabs.map(({ id, areaSqFt }) => ({ id, areaSqFt })), roofRegions: roofRegions.map(({ id, areaSqFt }) => ({ id, areaSqFt })), receiptSha256: output.receiptSha256 }, null, 2));
