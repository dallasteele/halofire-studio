import fs from 'node:fs';
import path from 'node:path';

import { Dwg_File_Type, LibreDwg } from '@mlightcad/libredwg-web';

const [inputPath] = process.argv.slice(2);
const summaryOnly = process.argv.includes('--summary');
const vertexCountIndex = process.argv.indexOf('--vertex-count');
const requiredVertexCount = vertexCountIndex >= 0 ? Number(process.argv[vertexCountIndex + 1]) : null;
const entityTypesIndex = process.argv.indexOf('--entity-types');
const requestedEntityTypes = entityTypesIndex >= 0 ? new Set(process.argv[entityTypesIndex + 1].split(',')) : null;
const includeBlockRecords = process.argv.includes('--block-records');
const blockNameIndex = process.argv.indexOf('--block-name');
const requestedBlockName = blockNameIndex >= 0 ? process.argv[blockNameIndex + 1] : null;
const nearIndex = process.argv.indexOf('--near');
const near = nearIndex >= 0 ? {
  x: Number(process.argv[nearIndex + 1]),
  y: Number(process.argv[nearIndex + 2]),
  radius: Number(process.argv[nearIndex + 3]),
} : null;
const layerIndex = process.argv.indexOf('--layer');
const requestedLayer = layerIndex >= 0 ? process.argv[layerIndex + 1] : null;
if (!inputPath) throw new Error('USAGE: inspect-dwg-registration-candidates.mjs <source.dwg>');

const countBy = (values) => Object.fromEntries([...values.reduce((counts, value) => {
  counts.set(value, (counts.get(value) ?? 0) + 1);
  return counts;
}, new Map())].sort((left, right) => right[1] - left[1] || String(left[0]).localeCompare(String(right[0]))));

const pointsFor = (entity) => [
  entity.startPoint,
  entity.endPoint,
  entity.center,
  entity.insertionPoint,
  ...(entity.vertices ?? []),
].filter((point) => Number.isFinite(point?.x) && Number.isFinite(point?.y));

const summarizeBounds = (points) => {
  if (!points.length) return null;
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  };
};

const wasmRoot = path.resolve('node_modules/@mlightcad/libredwg-web/wasm/').replaceAll('\\', '/');
const libredwg = await LibreDwg.create(`${wasmRoot}/`);
const raw = libredwg.dwg_read_data(fs.readFileSync(inputPath), Dwg_File_Type.DWG);
const converted = libredwg.convertEx(raw);
const { database } = converted;
const layerSummaries = [...database.entities.reduce((layers, entity) => {
  const value = layers.get(entity.layer) ?? { layer: entity.layer, entities: [], points: [] };
  value.entities.push(entity);
  value.points.push(...pointsFor(entity));
  layers.set(entity.layer, value);
  return layers;
}, new Map()).values()].map((value) => ({
  layer: value.layer,
  entityCount: value.entities.length,
  typeCounts: countBy(value.entities.map((entity) => entity.type)),
  bounds: summarizeBounds(value.points),
})).sort((left, right) => right.entityCount - left.entityCount);

const polylineCandidates = database.entities
  .filter((entity) => ['LWPOLYLINE', 'POLYLINE_2D', 'POLYLINE_3D', 'POLYLINE'].includes(entity.type)
    && (entity.vertices?.length ?? 0) >= 4
    && (requiredVertexCount === null || entity.vertices.length === requiredVertexCount))
  .map((entity) => ({
    handle: String(entity.handle),
    type: entity.type,
    layer: entity.layer,
    closed: entity.closed ?? entity.flagClosed ?? null,
    vertexCount: entity.vertices.length,
    bounds: summarizeBounds(entity.vertices),
    ...(summaryOnly ? {} : { vertices: entity.vertices }),
  }))
  .sort((left, right) => (right.bounds?.width ?? 0) * (right.bounds?.height ?? 0)
    - (left.bounds?.width ?? 0) * (left.bounds?.height ?? 0))
  .slice(0, summaryOnly ? 80 : Number.POSITIVE_INFINITY);

process.stdout.write(`${JSON.stringify({
  source: path.basename(inputPath),
  parserStats: converted.stats,
  entityCount: database.entities.length,
  entityTypeCounts: countBy(database.entities.map((entity) => entity.type)),
  layerSummaries: requiredVertexCount === null && !requestedBlockName && !near ? layerSummaries : [],
  polylineCandidates: requestedBlockName || near ? [] : polylineCandidates,
  requestedEntities: requestedEntityTypes
    ? database.entities.filter((entity) => requestedEntityTypes.has(entity.type))
    : [],
  nearbyEntities: near ? database.entities.filter((entity) => !requestedLayer || entity.layer === requestedLayer).map((entity) => {
    const points = pointsFor(entity);
    const minimumDistance = Math.min(Number.POSITIVE_INFINITY, ...points.map((point) => Math.hypot(point.x - near.x, point.y - near.y)));
    return {
      handle: String(entity.handle),
      type: entity.type,
      layer: entity.layer,
      minimumDistance,
      bounds: summarizeBounds(points),
      vertexCount: entity.vertices?.length ?? null,
      name: entity.name ?? null,
      text: entity.text?.text ?? entity.text ?? null,
      lineType: entity.lineType ?? null,
      constantWidth: entity.constantWidth ?? null,
      startPoint: entity.startPoint ?? null,
      endPoint: entity.endPoint ?? null,
      vertices: entity.vertices ?? null,
    };
  }).filter((entity) => entity.minimumDistance <= near.radius)
    .sort((left, right) => left.minimumDistance - right.minimumDistance) : [],
  ownerHandleCounts: requestedBlockName || near ? {} : countBy(database.entities.map((entity) => entity.ownerBlockRecordSoftId)),
  blockRecords: includeBlockRecords || requestedBlockName
    ? database.tables.BLOCK_RECORD.entries.filter((block) => !requestedBlockName || block.name === requestedBlockName)
    : [],
  blockNames: requestedBlockName || near ? [] : database.tables.BLOCK_RECORD.entries.map((block) => block.name),
}, (_key, value) => typeof value === 'bigint' ? value.toString() : value, 2)}\n`);
libredwg.dwg_free(raw);
