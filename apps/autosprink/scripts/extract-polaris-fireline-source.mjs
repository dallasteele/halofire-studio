import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Dwg_File_Type, LibreDwg } from '@mlightcad/libredwg-web';

export const POLARIS_FIRELINE_SHA256 = 'EE9B22E5235AC137882BDB680A0295AFF87C53D444ED939E28CDA0A7EAAB9C9A';

const numericHandle = (value) => {
  if (typeof value === 'string' && /^[0-9A-F]+$/i.test(value)) return Number.parseInt(value, 16);
  return Number(value);
};

export async function extractPolarisFireLineSource(inputPath, expectedSha256 = POLARIS_FIRELINE_SHA256) {
  const bytes = fs.readFileSync(inputPath);
  const sha256 = createHash('sha256').update(bytes).digest('hex').toUpperCase();
  if (sha256 !== expectedSha256) throw new Error('POLARIS_FIRELINE_SOURCE_SHA256_MISMATCH');
  const wasmRoot = path.resolve('node_modules/@mlightcad/libredwg-web/wasm/').replaceAll('\\', '/');
  const libredwg = await LibreDwg.create(`${wasmRoot}/`);
  const raw = libredwg.dwg_read_data(bytes, Dwg_File_Type.DWG);
  const converted = libredwg.convertEx(raw);
  const textEntities = converted.database.entities
    .filter((entity) => entity.type === 'TEXT' || entity.type === 'MTEXT')
    .map((entity) => ({
      id: `text-${numericHandle(entity.handle)}`,
      type: entity.type,
      layer: entity.layer,
      text: String(typeof entity.text === 'string' ? entity.text : entity.text?.text ?? '').replaceAll(/\\[A-Za-z][^;]*;/g, '').trim(),
    }));
  const matchingText = (pattern) => textEntities.filter((entity) => pattern.test(entity.text));
  const newFireLineNotes = matchingText(/NEW\s+4["”]?\s+CLASS\s+350\s+FIRELINE/i);
  const backflowNotes = matchingText(/NEW\s+BACKFLOW\s+PREVENTION\s+ASSEMBLY/i);
  const cityWaterNotes = matchingText(/EXISTING\s+(?:8|12)["”]?\s+CITY\s+WATER\s+MAIN/i);
  const risers = converted.database.entities
    .filter((entity) => entity.type === 'INSERT' && entity.name === 'RISER')
    .map((entity) => ({
      id: `riser-${numericHandle(entity.handle)}`,
      layer: entity.layer,
      insertionPoint: entity.insertionPoint,
    }));
  const fireLinePolylines = converted.database.entities
    .filter((entity) => entity.type === 'LWPOLYLINE'
      && entity.layer === 'red'
      && Number(entity.constantWidth) > 4.68
      && Number(entity.constantWidth) < 4.70)
    .map((entity) => ({
      id: `polyline-${numericHandle(entity.handle)}`,
      lineType: entity.lineType || 'continuous',
      elevation: entity.elevation,
      vertices: entity.vertices.map((vertex) => ({ x: vertex.x, y: vertex.y, bulge: vertex.bulge })),
    }));
  const result = {
    schema: 'halofire.polaris-fireline-source.v1',
    source: {
      fileName: path.basename(inputPath),
      byteLength: bytes.length,
      sha256,
      parser: '@mlightcad/libredwg-web@0.7.7 (LibreDWG)',
      unknownEntityCount: converted.stats.unknownEntityCount,
    },
    evidence: {
      newFireLineNotes,
      backflowNotes,
      cityWaterNotes,
      risers,
      fireLinePolylines,
    },
    summary: {
      newFireLineNoteCount: newFireLineNotes.length,
      backflowNoteCount: backflowNotes.length,
      cityWaterNoteCount: cityWaterNotes.length,
      riserCount: risers.length,
      fireLinePolylineCount: fireLinePolylines.length,
    },
    claims: {
      sourceHashVerified: true,
      sourceFireLineContextReady: newFireLineNotes.length > 0
        && backflowNotes.length > 0
        && cityWaterNotes.length > 0
        && risers.length > 0
        && fireLinePolylines.length > 0,
      fireLineToSprinklerCadRegistrationReady: false,
      undergroundInvertElevationReady: false,
      fabricationReady: false,
      fieldReleaseReady: false,
    },
  };
  libredwg.dwg_free(raw);
  return result;
}

if (import.meta.url === `file:///${process.argv[1]?.replaceAll('\\', '/')}`) {
  const [inputPath] = process.argv.slice(2);
  if (!inputPath) throw new Error('USAGE: extract-polaris-fireline-source.mjs <fire-line.dwg>');
  process.stdout.write(`${JSON.stringify(await extractPolarisFireLineSource(inputPath), null, 2)}\n`);
}
