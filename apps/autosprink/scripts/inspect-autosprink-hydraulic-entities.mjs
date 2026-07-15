import fs from 'node:fs';
import path from 'node:path';

import { Dwg_File_Type, LibreDwg } from '@mlightcad/libredwg-web';

const [inputPath, ...requestedNodeIds] = process.argv.slice(2);
if (!inputPath) throw new Error('USAGE: inspect-autosprink-hydraulic-entities.mjs <source.dwg>');

const countBy = (values) => Object.fromEntries([...values.reduce((counts, value) => {
  counts.set(value, (counts.get(value) ?? 0) + 1);
  return counts;
}, new Map())].sort((left, right) => right[1] - left[1] || String(left[0]).localeCompare(String(right[0]))));

const wasmRoot = path.resolve('node_modules/@mlightcad/libredwg-web/wasm/').replaceAll('\\', '/');
const libredwg = await LibreDwg.create(`${wasmRoot}/`);
const raw = libredwg.dwg_read_data(fs.readFileSync(inputPath), Dwg_File_Type.DWG);
const converted = libredwg.convertEx(raw);
const { database } = converted;
const areaEntities = database.entities.filter((entity) => entity.layer === 'AS_SPRINKLER SYSTEM_AREAS');
const interestingBlockNames = database.tables.BLOCK_RECORD.entries
  .map((block) => block.name)
  .filter((name) => /node|hyd|calc|area/i.test(name));
const areaLines = areaEntities.filter((entity) => entity.type === 'LINE');
const numericNodeTexts = areaEntities.filter((entity) => entity.type === 'TEXT'
  && /^\d+$/.test(String(entity.text ?? '').trim())
  && (requestedNodeIds.length === 0 || requestedNodeIds.includes(String(entity.text).trim())));
const planDistance = (left, right) => Math.hypot(left.x - right.x, left.y - right.y);
const nodeLineNeighborhoods = numericNodeTexts.map((text) => ({
  nodeId: String(text.text).trim(),
  textHandle: String(text.handle),
  textPropertyKeys: Object.keys(text),
  textElevation: text.elevation,
  textThickness: text.thickness,
  textExtrusionDirection: text.extrusionDirection,
  textStartPoint: text.startPoint,
  textEndPoint: text.endPoint,
  nearestLines: areaLines.map((line) => ({
    handle: String(line.handle),
    startPoint: line.startPoint,
    endPoint: line.endPoint,
    minimumTextEndpointDistance: Math.min(
      planDistance(line.startPoint, text.startPoint),
      planDistance(line.startPoint, text.endPoint),
      planDistance(line.endPoint, text.startPoint),
      planDistance(line.endPoint, text.endPoint),
    ),
  })).sort((left, right) => left.minimumTextEndpointDistance - right.minimumTextEndpointDistance).slice(0, 16),
}));

process.stdout.write(`${JSON.stringify({
  source: path.basename(inputPath),
  parserStats: converted.stats,
  areaEntityTypeCounts: countBy(areaEntities.map((entity) => entity.type)),
  areaInsertNameCounts: countBy(areaEntities.filter((entity) => entity.type === 'INSERT').map((entity) => entity.name)),
  interestingBlockNames,
  nodeLineNeighborhoods,
}, null, 2)}\n`);
libredwg.dwg_free(raw);
