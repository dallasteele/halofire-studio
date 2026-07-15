import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Dwg_File_Type, LibreDwg } from '@mlightcad/libredwg-web';

const SOURCE_KIND = 'halofire.autosprink-dwg-3d-calibration.v1';

const round = (value, precision = 9) => Number(value.toFixed(precision));
const point = (value) => ({ x: round(value.x), y: round(value.y), z: round(value.z) });
const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const scale = (value, amount) => ({ x: value.x * amount, y: value.y * amount, z: value.z * amount });
const cross = (a, b) => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
const magnitude = (value) => Math.hypot(value.x, value.y, value.z);
const normalize = (value) => {
  const length = magnitude(value);
  if (!Number.isFinite(length) || length === 0) throw new Error('INVALID_EXTRUSION_DIRECTION');
  return scale(value, 1 / length);
};

export function ocsPointToWcs(value, extrusion = { x: 0, y: 0, z: 1 }) {
  const normal = normalize(extrusion);
  const xAxis = Math.abs(normal.x) < 1 / 64 && Math.abs(normal.y) < 1 / 64
    ? normalize(cross({ x: 0, y: 1, z: 0 }, normal))
    : normalize(cross({ x: 0, y: 0, z: 1 }, normal));
  const yAxis = cross(normal, xAxis);
  return add(add(scale(xAxis, value.x), scale(yAxis, value.y)), scale(normal, value.z));
}

function transformBlockPoint(value, insert, basePoint) {
  const local = {
    x: (value.x - basePoint.x) * insert.xScale,
    y: (value.y - basePoint.y) * insert.yScale,
    z: (value.z - basePoint.z) * insert.zScale,
  };
  const cosine = Math.cos(insert.rotation || 0);
  const sine = Math.sin(insert.rotation || 0);
  const rotated = {
    x: local.x * cosine - local.y * sine,
    y: local.x * sine + local.y * cosine,
    z: local.z,
  };
  return add(
    ocsPointToWcs(insert.insertionPoint, insert.extrusionDirection),
    ocsPointToWcs(rotated, insert.extrusionDirection),
  );
}

function sourceSha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex').toUpperCase();
}

function numericHandle(value) {
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && /^[0-9A-F]+$/i.test(value)) return Number.parseInt(value, 16);
  return Number(value);
}

const stableHandle = (value) => String(numericHandle(value));
const endpointKey = (value) => [value.x, value.y, value.z ?? 0].map((coordinate) => round(coordinate, 6)).join('|');

function parseArguments(argv) {
  const [inputPath, ...rest] = argv;
  if (!inputPath) throw new Error('USAGE: extract-autosprink-dwg-calibration.mjs <source.dwg> [--expected-sha256 HASH]');
  const expectedIndex = rest.indexOf('--expected-sha256');
  return {
    inputPath,
    expectedSha256: expectedIndex >= 0 ? rest[expectedIndex + 1]?.toUpperCase() : null,
  };
}

export async function extractAutosprinkDwgCalibration(inputPath, expectedSha256 = null) {
  const bytes = fs.readFileSync(inputPath);
  const sha256 = sourceSha256(bytes);
  if (expectedSha256 && sha256 !== expectedSha256) throw new Error('SOURCE_SHA256_MISMATCH');

  const wasmRoot = path.resolve('node_modules/@mlightcad/libredwg-web/wasm/').replaceAll('\\', '/');
  const libredwg = await LibreDwg.create(`${wasmRoot}/`);
  const raw = libredwg.dwg_read_data(bytes, Dwg_File_Type.DWG);
  const converted = libredwg.convertEx(raw);
  const database = converted.database;
  const blocks = new Map(database.tables.BLOCK_RECORD.entries.map((block) => [block.name, block]));
  const inserts = database.entities.filter((entity) => entity.type === 'INSERT');
  const attributesByInsertHandle = new Map();
  for (const attribute of database.entities.filter((entity) => entity.type === 'ATTRIB')) {
    const ownerHandle = numericHandle(attribute.ownerBlockRecordSoftId);
    if (!Number.isFinite(ownerHandle)) continue;
    const values = attributesByInsertHandle.get(ownerHandle) ?? [];
    values.push(attribute);
    attributesByInsertHandle.set(ownerHandle, values);
  }

  const insertAttributes = (entity) => Object.fromEntries((entity.attribs?.length
    ? entity.attribs
    : attributesByInsertHandle.get(numericHandle(entity.handle)) ?? [])
    .map((attribute) => [attribute.tag, typeof attribute.text === 'string' ? attribute.text : attribute.text?.text])
    .filter(([tag, value]) => tag && value));

  const pipes = inserts
    .filter((entity) => entity.layer === 'AS_SPRINKLER SYSTEM_PIPES' && entity.name?.startsWith('Pipe'))
    .map((entity) => {
      const block = blocks.get(entity.name);
      const rawCenterlines = block?.entities.filter((child) => child.type === 'LINE') ?? [];
      const centerlines = rawCenterlines.filter((line, index) => {
        const key = JSON.stringify([line.startPoint, line.endPoint]);
        return rawCenterlines.findIndex((candidate) => JSON.stringify([candidate.startPoint, candidate.endPoint]) === key) === index;
      });
      if (centerlines.length !== 1) throw new Error(`PIPE_CENTERLINE_CARDINALITY:${entity.name}:${centerlines.length}`);
      const sectionRadii = block?.entities
        .filter((child) => child.type === 'CIRCLE' && Number.isFinite(child.radius))
        .map((child) => child.radius) ?? [];
      const start = transformBlockPoint(centerlines[0].startPoint, entity, block.basePoint);
      const end = transformBlockPoint(centerlines[0].endPoint, entity, block.basePoint);
      const planLength = Math.hypot(end.x - start.x, end.y - start.y);
      const length3d = Math.hypot(end.x - start.x, end.y - start.y, end.z - start.z);
      return {
        id: `pipe-${stableHandle(entity.handle)}`,
        blockName: entity.name,
        layer: entity.layer,
        start: point(start),
        end: point(end),
        planLength: round(planLength),
        length3d: round(length3d),
        deltaZ: round(end.z - start.z),
        maxSectionRadius: sectionRadii.length ? round(Math.max(...sectionRadii)) : null,
        attributes: insertAttributes(entity),
      };
    });

  const pointInsert = (entity, prefix) => ({
    id: `${prefix}-${stableHandle(entity.handle)}`,
    blockName: entity.name,
    layer: entity.layer,
    point: point(ocsPointToWcs(entity.insertionPoint, entity.extrusionDirection)),
    attributes: insertAttributes(entity),
  });
  const sprinklers = inserts
    .filter((entity) => entity.layer === 'AS_SPRINKLER SYSTEM_SPRINKLERS' && entity.name?.startsWith('Fitting'))
    .map((entity) => pointInsert(entity, 'sprinkler'));
  const fittings = inserts
    .filter((entity) => entity.layer === 'AS_SPRINKLER SYSTEM_FITTINGS')
    .map((entity) => pointInsert(entity, 'fitting'));
  const hydraulicAreaLines = database.entities.filter((entity) => entity.type === 'LINE'
    && entity.layer === 'AS_SPRINKLER SYSTEM_AREAS');
  const hydraulicLineIndicesByEndpoint = new Map();
  hydraulicAreaLines.forEach((line, index) => {
    for (const endpoint of [line.startPoint, line.endPoint]) {
      const key = endpointKey(endpoint);
      const indices = hydraulicLineIndicesByEndpoint.get(key) ?? [];
      indices.push(index);
      hydraulicLineIndicesByEndpoint.set(key, indices);
    }
  });
  const hydraulicNodeLabels = database.entities
    .filter((entity) => entity.type === 'TEXT'
      && entity.layer === 'AS_SPRINKLER SYSTEM_AREAS'
      && /^\d+$/.test(String(entity.text ?? '').trim()))
    .map((entity) => {
      const nearbySeedCandidates = hydraulicAreaLines.map((line, index) => ({
        index,
        distance: Math.min(
          Math.hypot(line.startPoint.x - entity.startPoint.x, line.startPoint.y - entity.startPoint.y),
          Math.hypot(line.startPoint.x - entity.endPoint.x, line.startPoint.y - entity.endPoint.y),
          Math.hypot(line.endPoint.x - entity.startPoint.x, line.endPoint.y - entity.startPoint.y),
          Math.hypot(line.endPoint.x - entity.endPoint.x, line.endPoint.y - entity.endPoint.y),
        ),
      })).filter((candidate) => candidate.distance <= 20);
      const candidateComponents = new Map();
      for (const seed of nearbySeedCandidates) {
        const pendingLineIndices = [seed.index];
        const lineIndices = new Set(pendingLineIndices);
        while (pendingLineIndices.length) {
          const currentIndex = pendingLineIndices.shift();
          const line = hydraulicAreaLines[currentIndex];
          for (const endpoint of [line.startPoint, line.endPoint]) {
            for (const adjacentIndex of hydraulicLineIndicesByEndpoint.get(endpointKey(endpoint)) ?? []) {
              if (!lineIndices.has(adjacentIndex)) {
                lineIndices.add(adjacentIndex);
                pendingLineIndices.push(adjacentIndex);
              }
            }
          }
        }
        const key = [...lineIndices].sort((left, right) => left - right).join(',');
        candidateComponents.set(key, lineIndices);
      }
      const validComponents = [...candidateComponents.values()].map((lineIndices) => {
        const lines = [...lineIndices].map((index) => hydraulicAreaLines[index]);
        const endpointCounts = new Map();
        const endpointValues = new Map();
        for (const line of lines) {
          for (const endpoint of [line.startPoint, line.endPoint]) {
            const key = endpointKey(endpoint);
            endpointCounts.set(key, (endpointCounts.get(key) ?? 0) + 1);
            endpointValues.set(key, endpoint);
          }
        }
        const degreeSignature = [...endpointCounts.values()].sort((left, right) => left - right);
        const leaderTips = [...endpointCounts.entries()]
          .filter(([, count]) => count === 1)
          .map(([key]) => endpointValues.get(key));
        return {
          lines,
          degreeSignature,
          leaderTips,
          handleResidual: Math.min(...lines.map((line) => Math.abs(numericHandle(line.handle) - numericHandle(entity.handle)))),
        };
      }).filter((component) => JSON.stringify(component.degreeSignature) === JSON.stringify([1, 2, 2, 2, 2, 2, 3])
        && component.leaderTips.length === 1)
        .sort((left, right) => left.handleResidual - right.handleResidual);
      if (validComponents.length === 0) {
        throw new Error(`HYDRAULIC_NODE_GLYPH_TOPOLOGY:${String(entity.text).trim()}:no-valid-seven-line-component`);
      }
      const glyph = validComponents[0];
      return {
        nodeId: String(entity.text).trim(),
        labelPoint: point({ x: entity.startPoint.x, y: entity.startPoint.y, z: 0 }),
        alignmentPoint: point({ x: entity.endPoint.x, y: entity.endPoint.y, z: 0 }),
        connectionPoint: point(glyph.leaderTips[0]),
        glyphLineHandles: glyph.lines.map((line) => stableHandle(line.handle)).sort((left, right) => Number(left) - Number(right)),
        glyphTopologyDegreeSignature: glyph.degreeSignature,
      };
    });
  const noteLines = database.entities.filter((entity) => entity.type === 'LINE'
    && entity.layer === 'AS_SPRINKLER SYSTEM_NOTES');
  const sourceNotes = database.entities
    .filter((entity) => entity.type === 'TEXT'
      && entity.layer === 'AS_SPRINKLER SYSTEM_NOTES'
      && /^(?:MAIN DRAIN|3" RISER)$/i.test(String(entity.text ?? '').trim()))
    .map((entity) => {
      const firstLeader = noteLines.find((line) => Math.abs(line.startPoint.x - entity.startPoint.x) <= 1e-6
        && Math.abs(line.startPoint.y - entity.startPoint.y) <= entity.textHeight);
      const secondLeader = firstLeader && noteLines.find((line) => line !== firstLeader
        && Math.hypot(
          line.startPoint.x - firstLeader.endPoint.x,
          line.startPoint.y - firstLeader.endPoint.y,
          (line.startPoint.z ?? 0) - (firstLeader.endPoint.z ?? 0),
        ) <= 1e-6);
      return {
        text: String(entity.text).trim(),
        labelPoint: point({ x: entity.startPoint.x, y: entity.startPoint.y, z: 0 }),
        leaderTip: secondLeader ? point(secondLeader.endPoint) : null,
        leaderSegmentCount: secondLeader ? 2 : firstLeader ? 1 : 0,
      };
    });

  const elevations = [...new Set(pipes.flatMap((pipe) => [pipe.start.z, pipe.end.z]))].sort((a, b) => a - b);
  const result = {
    schema: SOURCE_KIND,
    source: {
      fileName: path.basename(inputPath),
      byteLength: bytes.length,
      sha256,
      parser: '@mlightcad/libredwg-web@0.7.7 (LibreDWG)',
      unknownEntityCount: converted.stats.unknownEntityCount,
      parserScope: 'read-only development intake; not included in the production browser bundle',
    },
    coordinateSystem: {
      units: 'source-drawing-units',
      conversionToFeetReady: false,
      note: 'Coordinates are preserved exactly in source drawing units; unit conversion requires a drawing-specific scale receipt.',
    },
    summary: {
      modelEntityCount: database.entities.length,
      pipeCount: pipes.length,
      sprinklerSymbolCount: sprinklers.length,
      fittingSymbolCount: fittings.length,
      hydraulicNodeLabelCount: hydraulicNodeLabels.length,
      hydraulicNodeConnectionPointCount: hydraulicNodeLabels.filter((label) => label.connectionPoint).length,
      sourceNoteCount: sourceNotes.length,
      distinctPipeElevationCount: elevations.length,
      pipeElevationRange: elevations.length ? [elevations[0], elevations.at(-1)] : null,
    },
    pipes,
    sprinklers,
    fittings,
    hydraulicNodeLabels,
    sourceNotes,
    claims: {
      sourceArchiveHashVerified: Boolean(expectedSha256),
      exactSourceDrawingXyzReady: pipes.length > 0 && sprinklers.length > 0 && fittings.length > 0,
      sourceDrawingUnitConversionReady: false,
      approvedPdfRegistrationReady: false,
      pitchedRoofCalibrationReady: false,
      newHopeExactPipeCenterlineZReady: false,
      properPipeLayoutReady: false,
      fabricationReady: false,
      fieldReleaseReady: false,
    },
  };
  libredwg.dwg_free(raw);
  return result;
}

if (import.meta.url === `file:///${process.argv[1]?.replaceAll('\\', '/')}`) {
  const args = parseArguments(process.argv.slice(2));
  const result = await extractAutosprinkDwgCalibration(args.inputPath, args.expectedSha256);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
