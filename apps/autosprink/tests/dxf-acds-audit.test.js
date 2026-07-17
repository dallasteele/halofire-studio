import { describe, expect, it } from 'vitest';
import { auditDxfAcdsBodies, verifyDxfAcdsAudit } from '../scripts/lib/dxf-acds-audit.mjs';

const pair = (code, value) => `${String(code).padStart(3, ' ')}\n${value}\n`;
const solid = (handle, uuid) => [
  pair(0, '3DSOLID'), pair(5, handle), pair(100, 'AcDbEntity'),
  pair(100, 'AcDbModelerGeometry'), pair(290, '1'), pair(2, uuid), pair(100, 'AcDb3dSolid'),
].join('');
const acds = (handle, body, overrides = {}) => [
  pair(0, 'ACDSRECORD'), pair(90, '1'), pair(2, 'AcDbDs::ID'), pair(320, overrides.handle ?? handle),
  pair(2, 'ASM_Data'), pair(94, String(overrides.declaredBytes ?? body.length)),
  pair(310, overrides.hex ?? body.toString('hex').toUpperCase()),
].join('');
const asm = (suffix) => Buffer.from(`ASM BinaryFile4${suffix}`);

describe('ASCII DXF AcDs body audit', () => {
  it('binds each 3DSOLID handle to one length-valid ASM body', () => {
    const source = `${solid('1B6', '{one}')}${solid('1B7', '{two}')}${acds('1B6', asm('A'))}${acds('1B7', asm('B'))}`;
    const audit = auditDxfAcdsBodies(source);
    expect(audit.valid).toBe(true);
    expect(audit.solidHandles).toEqual(['1B6', '1B7']);
    expect(audit.acdsBodies.every((body) => body.header === 'ASM BinaryFile4')).toBe(true);
    expect(verifyDxfAcdsAudit(audit, { solidCount: 2, solidHandles: ['1B6', '1B7'] })).toEqual({ ok: true, errors: [] });
  });

  it('fails closed when a solid has no matching AcDs body', () => {
    const audit = auditDxfAcdsBodies(`${solid('1B6', '{one}')}${solid('1B7', '{two}')}${acds('1B6', asm('A'))}`);
    expect(audit.valid).toBe(false);
    expect(audit.missingAcdsHandles).toEqual(['1B7']);
  });

  it('fails closed on a declared body length mismatch', () => {
    const audit = auditDxfAcdsBodies(`${solid('1B6', '{one}')}${acds('1B6', asm('A'), { declaredBytes: 999 })}`);
    expect(audit.valid).toBe(false);
    expect(audit.acdsBodies[0].declaredLengthMatches).toBe(false);
  });

  it('rejects malformed binary hex instead of silently dropping geometry', () => {
    expect(() => auditDxfAcdsBodies(`${solid('1B6', '{one}')}${acds('1B6', asm('A'), { hex: 'NOTHEX' })}`))
      .toThrow(/ACDS_HEX_INVALID/);
  });

  it('reports source and topology expectation drift', () => {
    const audit = auditDxfAcdsBodies(`${solid('1B6', '{one}')}${acds('1B6', asm('A'))}`);
    expect(verifyDxfAcdsAudit(audit, { sourceSha256: '00', solidCount: 2 }).errors)
      .toEqual(['SOURCE_SHA256_MISMATCH', 'SOLID_COUNT_MISMATCH']);
  });
});
