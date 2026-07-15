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
  const database = libredwg.convert(raw);
  const blocks = new Map(database.tables.BLOCK_RECORD.entries.map((block) => [block.name, block]));
  const inserts = database.entities.filter((entity) => entity.type === 'INSERT');

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
      const start = transformBlockPoint(centerlines[0].startPoint, entity, block.basePoint);
      const end = transformBlockPoint(centerlines[0].endPoint, entity, block.basePoint);
      const planLength = Math.hypot(end.x - start.x, end.y - start.y);
      const length3d = Math.hypot(end.x - start.x, end.y - start.y, end.z - start.z);
      return {
        id: `pipe-${String(entity.handle)}`,
        blockName: entity.name,
        layer: entity.layer,
        start: point(start),
        end: point(end),
        planLength: round(planLength),
        length3d: round(length3d),
        deltaZ: round(end.z - start.z),
      };
    });

  const pointInsert = (entity, prefix) => ({
    id: `${prefix}-${String(entity.handle)}`,
    blockName: entity.name,
    layer: entity.layer,
    point: point(ocsPointToWcs(entity.insertionPoint, entity.extrusionDirection)),
  });
  const sprinklers = inserts
    .filter((entity) => entity.layer === 'AS_SPRINKLER SYSTEM_SPRINKLERS' && entity.name?.startsWith('Fitting'))
    .map((entity) => pointInsert(entity, 'sprinkler'));
  const fittings = inserts
    .filter((entity) => entity.layer === 'AS_SPRINKLER SYSTEM_FITTINGS')
    .map((entity) => pointInsert(entity, 'fitting'));

  const elevations = [...new Set(pipes.flatMap((pipe) => [pipe.start.z, pipe.end.z]))].sort((a, b) => a - b);
  const result = {
    schema: SOURCE_KIND,
    source: {
      fileName: path.basename(inputPath),
      byteLength: bytes.length,
      sha256,
      parser: '@mlightcad/libredwg-web@0.4.2 (LibreDWG)',
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
      distinctPipeElevationCount: elevations.length,
      pipeElevationRange: elevations.length ? [elevations[0], elevations.at(-1)] : null,
    },
    pipes,
    sprinklers,
    fittings,
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
