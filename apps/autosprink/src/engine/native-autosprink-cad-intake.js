const REQUIRED_NATIVE_TYPES = ['CEltPipe', 'CEltSprinkler', 'CEltFitting', 'CEltRoof', 'CEltCeiling'];

function view(bytes) {
  if (!(bytes instanceof Uint8Array)) throw new TypeError('SEIDB_BYTES_REQUIRED');
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function readCompactUnsigned(bytes, cursor) {
  if (cursor >= bytes.length) throw new RangeError('SEIDB_COMPACT_VALUE_TRUNCATED');
  const first = bytes[cursor];
  if (first < 0x40) return { value: first, next: cursor + 1 };
  if (first < 0x80) {
    if (cursor + 1 >= bytes.length) throw new RangeError('SEIDB_COMPACT_VALUE_TRUNCATED');
    return { value: ((first & 0x3f) << 8) | bytes[cursor + 1], next: cursor + 2 };
  }
  throw new RangeError('SEIDB_COMPACT_VALUE_UNSUPPORTED');
}

export function parseSeidbHeader(bytes) {
  const data = view(bytes);
  if (bytes.length < 8) throw new RangeError('SEIDB_HEADER_TRUNCATED');
  const rootOffset = data.getUint32(0, true);
  const typeCatalogOffset = data.getUint32(4, true);
  if (rootOffset < 8 || rootOffset >= bytes.length) throw new RangeError('SEIDB_ROOT_OFFSET_OUT_OF_BOUNDS');
  if (typeCatalogOffset <= rootOffset || typeCatalogOffset >= bytes.length) {
    throw new RangeError('SEIDB_TYPE_CATALOG_OFFSET_OUT_OF_BOUNDS');
  }
  return { rootOffset, typeCatalogOffset, byteLength: bytes.length };
}

export function parseSeidbTypeCatalog(bytes, typeCatalogOffset = parseSeidbHeader(bytes).typeCatalogOffset) {
  const data = view(bytes);
  const catalogVariant = bytes[typeCatalogOffset + 2];
  if (
    bytes[typeCatalogOffset] !== 0x02
    || bytes[typeCatalogOffset + 1] !== 0x40
    || (catalogVariant !== 0x9c && catalogVariant !== 0x9d)
  ) {
    throw new Error('SEIDB_TYPE_CATALOG_SIGNATURE_INVALID');
  }
  let cursor = typeCatalogOffset + 3;
  const types = [];
  while (cursor < bytes.length - 4) {
    const length = readCompactUnsigned(bytes, cursor);
    cursor = length.next;
    if (length.value < 2 || length.value > 512 || length.value % 2 !== 0 || cursor + length.value + 4 > bytes.length) break;
    let name = '';
    let printable = true;
    for (let index = 0; index < length.value; index += 2) {
      const code = data.getUint16(cursor + index, true);
      if (code < 0x20 || code > 0x7e) printable = false;
      name += String.fromCharCode(code);
    }
    if (!printable) break;
    cursor += length.value;
    types.push({ name, id: data.getUint32(cursor, true) });
    cursor += 4;
  }
  if (types.length === 0) throw new Error('SEIDB_TYPE_CATALOG_EMPTY');
  const names = new Set(types.map((entry) => entry.name));
  const missingRequiredTypes = REQUIRED_NATIVE_TYPES.filter((name) => !names.has(name));
  return {
    catalogVariant,
    types,
    typeCount: types.length,
    missingRequiredTypes,
    nativeSpatialTypesReady: missingRequiredTypes.length === 0,
    endOffset: cursor,
  };
}

export function ocsPointToWcs(point, extrusion = { x: 0, y: 0, z: 1 }) {
  const cross = (a, b) => ({
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  });
  const normalize = (value) => {
    const length = Math.hypot(value.x, value.y, value.z);
    if (!Number.isFinite(length) || length === 0) throw new Error('INVALID_EXTRUSION_DIRECTION');
    return { x: value.x / length, y: value.y / length, z: value.z / length };
  };
  const normal = normalize(extrusion);
  const xAxis = Math.abs(normal.x) < 1 / 64 && Math.abs(normal.y) < 1 / 64
    ? normalize(cross({ x: 0, y: 1, z: 0 }, normal))
    : normalize(cross({ x: 0, y: 0, z: 1 }, normal));
  const yAxis = cross(normal, xAxis);
  return {
    x: point.x * xAxis.x + point.y * yAxis.x + point.z * normal.x,
    y: point.x * xAxis.y + point.y * yAxis.y + point.z * normal.y,
    z: point.x * xAxis.z + point.y * yAxis.z + point.z * normal.z,
  };
}

export function evaluateNativeAutosprinkCalibration(evidence, expected = {}) {
  const issues = [];
  if (evidence?.schema !== 'halofire.autosprink-dwg-3d-calibration.v1') issues.push('CALIBRATION_SCHEMA_INVALID');
  if (expected.sha256 && evidence?.source?.sha256 !== expected.sha256.toUpperCase()) issues.push('SOURCE_SHA256_MISMATCH');
  if (!Array.isArray(evidence?.pipes) || evidence.pipes.length === 0) issues.push('PIPE_XYZ_MISSING');
  if (!Array.isArray(evidence?.sprinklers) || evidence.sprinklers.length === 0) issues.push('SPRINKLER_XYZ_MISSING');
  if (!Array.isArray(evidence?.fittings) || evidence.fittings.length === 0) issues.push('FITTING_XYZ_MISSING');

  const pointFinite = (point) => point && ['x', 'y', 'z'].every((axis) => Number.isFinite(point[axis]));
  const invalidPipe = evidence?.pipes?.find((pipe) => !pointFinite(pipe.start) || !pointFinite(pipe.end));
  if (invalidPipe) issues.push('PIPE_XYZ_NONFINITE');
  if (evidence?.sprinklers?.some((item) => !pointFinite(item.point))) issues.push('SPRINKLER_XYZ_NONFINITE');
  if (evidence?.fittings?.some((item) => !pointFinite(item.point))) issues.push('FITTING_XYZ_NONFINITE');

  const elevationValues = evidence?.pipes?.flatMap((pipe) => [pipe.start?.z, pipe.end?.z]).filter(Number.isFinite) ?? [];
  const distinctElevations = [...new Set(elevationValues)];
  const exactSourceDrawingXyzReady = issues.length === 0;
  return {
    status: exactSourceDrawingXyzReady ? 'passed' : 'blocked',
    issues,
    counts: {
      pipes: evidence?.pipes?.length ?? 0,
      sprinklers: evidence?.sprinklers?.length ?? 0,
      fittings: evidence?.fittings?.length ?? 0,
      distinctPipeElevations: distinctElevations.length,
    },
    exactSourceDrawingXyzReady,
    sourceDrawingUnitConversionReady: evidence?.claims?.sourceDrawingUnitConversionReady === true,
    approvedPdfRegistrationReady: evidence?.claims?.approvedPdfRegistrationReady === true,
    pitchedRoofCalibrationReady: evidence?.claims?.pitchedRoofCalibrationReady === true,
    newHopeExactPipeCenterlineZReady: false,
    properPipeLayoutReady: false,
    fabricationReady: false,
    fieldReleaseReady: false,
  };
}
