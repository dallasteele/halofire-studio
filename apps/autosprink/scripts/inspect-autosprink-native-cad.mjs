import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { inflateRawSync } from 'node:zlib';

import {
  parseSeidbHeader,
  parseSeidbTypeCatalog,
} from '../src/engine/native-autosprink-cad-intake.js';

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_ENTRY_SIGNATURE = 0x02014b50;
const LOCAL_ENTRY_SIGNATURE = 0x04034b50;

function findEocd(bytes) {
  const minimum = Math.max(0, bytes.length - 65_557);
  for (let cursor = bytes.length - 22; cursor >= minimum; cursor -= 1) {
    if (bytes.readUInt32LE(cursor) === EOCD_SIGNATURE) return cursor;
  }
  throw new Error('AUTOSPRINK_CAD_ZIP_EOCD_MISSING');
}

export function inspectZip(bytes) {
  if (!Buffer.isBuffer(bytes)) throw new TypeError('AUTOSPRINK_CAD_BUFFER_REQUIRED');
  const eocd = findEocd(bytes);
  const entryCount = bytes.readUInt16LE(eocd + 10);
  const centralDirectorySize = bytes.readUInt32LE(eocd + 12);
  const centralDirectoryOffset = bytes.readUInt32LE(eocd + 16);
  if (centralDirectoryOffset + centralDirectorySize > eocd) {
    throw new RangeError('AUTOSPRINK_CAD_CENTRAL_DIRECTORY_OUT_OF_BOUNDS');
  }

  const entries = [];
  let cursor = centralDirectoryOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (bytes.readUInt32LE(cursor) !== CENTRAL_ENTRY_SIGNATURE) {
      throw new Error('AUTOSPRINK_CAD_CENTRAL_ENTRY_SIGNATURE_INVALID');
    }
    const compressionMethod = bytes.readUInt16LE(cursor + 10);
    const compressedSize = bytes.readUInt32LE(cursor + 20);
    const uncompressedSize = bytes.readUInt32LE(cursor + 24);
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const extraLength = bytes.readUInt16LE(cursor + 30);
    const commentLength = bytes.readUInt16LE(cursor + 32);
    const localHeaderOffset = bytes.readUInt32LE(cursor + 42);
    const name = bytes.toString('utf8', cursor + 46, cursor + 46 + nameLength);
    if (bytes.readUInt32LE(localHeaderOffset) !== LOCAL_ENTRY_SIGNATURE) {
      throw new Error(`AUTOSPRINK_CAD_LOCAL_ENTRY_SIGNATURE_INVALID:${name}`);
    }
    const localNameLength = bytes.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = bytes.readUInt16LE(localHeaderOffset + 28);
    const dataOffset = localHeaderOffset + 30 + localNameLength + localExtraLength;
    if (dataOffset + compressedSize > bytes.length) {
      throw new RangeError(`AUTOSPRINK_CAD_ENTRY_OUT_OF_BOUNDS:${name}`);
    }
    entries.push({
      name,
      compressionMethod,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
      dataOffset,
    });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  if (cursor !== centralDirectoryOffset + centralDirectorySize) {
    throw new Error('AUTOSPRINK_CAD_CENTRAL_DIRECTORY_SIZE_MISMATCH');
  }
  return entries;
}

export function readZipEntry(bytes, entry) {
  const compressed = bytes.subarray(entry.dataOffset, entry.dataOffset + entry.compressedSize);
  const value = entry.compressionMethod === 0
    ? compressed
    : entry.compressionMethod === 8
      ? inflateRawSync(compressed)
      : (() => { throw new Error(`AUTOSPRINK_CAD_COMPRESSION_UNSUPPORTED:${entry.compressionMethod}`); })();
  if (value.length !== entry.uncompressedSize) {
    throw new Error(`AUTOSPRINK_CAD_ENTRY_SIZE_MISMATCH:${entry.name}`);
  }
  return value;
}

export function inspectNativeAutosprinkCad(inputPath, expectedSha256 = null) {
  const bytes = fs.readFileSync(inputPath);
  const sha256 = createHash('sha256').update(bytes).digest('hex').toUpperCase();
  if (expectedSha256 && sha256 !== expectedSha256.toUpperCase()) {
    throw new Error('AUTOSPRINK_CAD_SHA256_MISMATCH');
  }
  const entries = inspectZip(bytes);
  const drawingEntry = entries.find((entry) => entry.name === 'drawing.SEiDB');
  if (!drawingEntry) throw new Error('AUTOSPRINK_CAD_DRAWING_SEIDB_MISSING');
  const drawingBytes = readZipEntry(bytes, drawingEntry);
  const header = parseSeidbHeader(drawingBytes);
  const catalog = parseSeidbTypeCatalog(drawingBytes, header.typeCatalogOffset);
  return {
    schema: 'halofire.autosprink-native-cad-inspection.v1',
    source: {
      fileName: inputPath.split(/[\\/]/).at(-1),
      byteLength: bytes.length,
      sha256,
      hashVerified: Boolean(expectedSha256),
    },
    archive: {
      entryCount: entries.length,
      entries: entries.map(({ name, compressedSize, uncompressedSize }) => ({
        name,
        compressedSize,
        uncompressedSize,
      })),
    },
    drawingSeidb: {
      ...header,
      typeCount: catalog.typeCount,
      nativeSpatialTypesReady: catalog.nativeSpatialTypesReady,
      missingRequiredTypes: catalog.missingRequiredTypes,
      requiredTypes: catalog.types
        .filter((entry) => ['CEltPipe', 'CEltSprinkler', 'CEltFitting', 'CEltRoof', 'CEltCeiling'].includes(entry.name)),
      geometryRecordDecodeReady: false,
      unsupportedBoundary: 'Native SEiDB element payload records are not decoded; exact XYZ comes from the paired exported DWG only.',
    },
    claims: {
      nativeCadArchiveIntakeReady: true,
      nativeElementTypeCatalogReady: catalog.nativeSpatialTypesReady,
      nativeElementGeometryRecordDecodeReady: false,
      exactSourceDrawingXyzReady: false,
      newHopeExactPipeCenterlineZReady: false,
      properPipeLayoutReady: false,
      fabricationReady: false,
      fieldReleaseReady: false,
    },
  };
}

if (import.meta.url === `file:///${process.argv[1]?.replaceAll('\\', '/')}`) {
  const [inputPath, expectedSha256] = process.argv.slice(2);
  if (!inputPath) {
    throw new Error('USAGE: inspect-autosprink-native-cad.mjs <source.cad> [expected-sha256]');
  }
  process.stdout.write(`${JSON.stringify(inspectNativeAutosprinkCad(inputPath, expectedSha256), null, 2)}\n`);
}
