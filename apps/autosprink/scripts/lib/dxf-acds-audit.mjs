import { createHash } from 'node:crypto';

const sha256 = (value) => createHash('sha256').update(value).digest('hex').toUpperCase();

export function parseAsciiDxfPairs(text) {
  const lines = text.replace(/\r/g, '').split('\n');
  if (lines.at(-1) === '') lines.pop();
  if (lines.length % 2 !== 0) throw new Error(`DXF_PAIR_TRUNCATED lines=${lines.length}`);
  const pairs = [];
  for (let index = 0; index < lines.length; index += 2) {
    const code = Number(lines[index].trim());
    if (!Number.isInteger(code)) throw new Error(`DXF_GROUP_CODE_INVALID line=${index + 1}`);
    pairs.push({ code, value: lines[index + 1].trim() });
  }
  return pairs;
}

const recordsFromPairs = (pairs) => {
  const records = [];
  for (let cursor = 0; cursor < pairs.length;) {
    if (pairs[cursor].code !== 0) {
      cursor += 1;
      continue;
    }
    const type = pairs[cursor].value;
    const start = cursor + 1;
    cursor = start;
    while (cursor < pairs.length && pairs[cursor].code !== 0) cursor += 1;
    records.push({ type, pairs: pairs.slice(start, cursor) });
  }
  return records;
};

const decodeHexChunks = (chunks, handle) => {
  const hex = chunks.join('');
  if (hex.length % 2 !== 0) throw new Error(`ACDS_HEX_ODD handle=${handle}`);
  if (!/^[0-9A-Fa-f]*$/.test(hex)) throw new Error(`ACDS_HEX_INVALID handle=${handle}`);
  return Buffer.from(hex, 'hex');
};

const firstValue = (pairs, code) => pairs.find((pair) => pair.code === code)?.value ?? null;

export function auditDxfAcdsBodies(input) {
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input);
  const pairs = parseAsciiDxfPairs(bytes.toString('utf8'));
  const records = recordsFromPairs(pairs);
  const solids = records.filter((record) => record.type === '3DSOLID').map((record) => ({
    handle: firstValue(record.pairs, 5),
    uuid: firstValue(record.pairs, 2),
    hasModelerGeometry: record.pairs.some((pair) => pair.code === 100 && pair.value === 'AcDbModelerGeometry'),
  }));

  const acdsBodies = records.filter((record) => record.type === 'ACDSRECORD').flatMap((record) => {
    const asmIndex = record.pairs.findIndex((pair) => pair.code === 2 && pair.value === 'ASM_Data');
    if (asmIndex < 0) return [];
    const handle = firstValue(record.pairs, 320);
    if (!handle) throw new Error('ACDS_HANDLE_MISSING');
    const declaredBytesText = record.pairs.slice(asmIndex + 1).find((pair) => pair.code === 94)?.value;
    const chunks = record.pairs.slice(asmIndex + 1).filter((pair) => pair.code === 310).map((pair) => pair.value);
    const bodyBytes = decodeHexChunks(chunks, handle);
    const declaredBytes = Number(declaredBytesText);
    return [{
      handle,
      declaredBytes,
      actualBytes: bodyBytes.length,
      sha256: sha256(bodyBytes),
      header: bodyBytes.subarray(0, 15).toString('ascii'),
      declaredLengthMatches: Number.isInteger(declaredBytes) && declaredBytes === bodyBytes.length,
    }];
  });

  const solidHandles = solids.map((solid) => solid.handle);
  const acdsHandles = acdsBodies.map((body) => body.handle);
  const duplicateSolidHandles = solidHandles.filter((handle, index) => solidHandles.indexOf(handle) !== index);
  const duplicateAcdsHandles = acdsHandles.filter((handle, index) => acdsHandles.indexOf(handle) !== index);
  const missingAcdsHandles = solidHandles.filter((handle) => !acdsHandles.includes(handle));
  const orphanAcdsHandles = acdsHandles.filter((handle) => !solidHandles.includes(handle));

  return {
    artifactType: 'halofire.dxf-acds-body-audit.v1',
    sourceSha256: sha256(bytes),
    solidCount: solids.length,
    acdsBodyCount: acdsBodies.length,
    solidHandles,
    duplicateSolidHandles: [...new Set(duplicateSolidHandles)],
    duplicateAcdsHandles: [...new Set(duplicateAcdsHandles)],
    missingAcdsHandles,
    orphanAcdsHandles,
    solids,
    acdsBodies,
    valid: solids.length > 0
      && solids.every((solid) => solid.handle && solid.uuid && solid.hasModelerGeometry)
      && acdsBodies.every((body) => body.declaredLengthMatches && body.header === 'ASM BinaryFile4')
      && duplicateSolidHandles.length === 0
      && duplicateAcdsHandles.length === 0
      && missingAcdsHandles.length === 0
      && orphanAcdsHandles.length === 0,
  };
}

export function verifyDxfAcdsAudit(audit, expected = {}) {
  const errors = [];
  if (!audit.valid) errors.push('AUDIT_INVALID');
  if (expected.sourceSha256 && audit.sourceSha256 !== expected.sourceSha256.toUpperCase()) errors.push('SOURCE_SHA256_MISMATCH');
  if (expected.solidCount !== undefined && audit.solidCount !== expected.solidCount) errors.push('SOLID_COUNT_MISMATCH');
  if (expected.solidHandles && JSON.stringify(audit.solidHandles) !== JSON.stringify(expected.solidHandles)) errors.push('SOLID_HANDLES_MISMATCH');
  return { ok: errors.length === 0, errors };
}
