import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import evidence from '../src/data/eos-ellsworth-autosprink-dwg-calibration.json';
import nativeInspection from '../src/data/eos-ellsworth-native-cad-inspection.json';
import {
  evaluateNativeAutosprinkCalibration,
  ocsPointToWcs,
  parseSeidbHeader,
  parseSeidbTypeCatalog,
} from '../src/engine/native-autosprink-cad-intake.js';

const EXPECTED_DWG_SHA256 = '93C002A7A8F689A441FBD17C3602106DA99013CD1070430A17E792EF29081A9B';

function compact(value) {
  return value < 0x40 ? [value] : [0x40 | (value >> 8), value & 0xff];
}

function makeSeidb(typeNames) {
  const rootOffset = 8;
  const root = [0x01, 0x00];
  const catalogOffset = rootOffset + root.length;
  const catalog = [0x02, 0x40, 0x9c];
  typeNames.forEach((name, id) => {
    const encoded = [...name].flatMap((character) => [character.charCodeAt(0), 0]);
    catalog.push(...compact(encoded.length), ...encoded, id, 0, 0, 0);
  });
  catalog.push(0xff);
  const bytes = new Uint8Array(catalogOffset + catalog.length);
  new DataView(bytes.buffer).setUint32(0, rootOffset, true);
  new DataView(bytes.buffer).setUint32(4, catalogOffset, true);
  bytes.set(root, rootOffset);
  bytes.set(catalog, catalogOffset);
  return bytes;
}

describe('native AutoSPRINK and exported DWG 3D intake', () => {
  it('parses bounded SEiDB headers and native spatial type catalogs', () => {
    const bytes = makeSeidb(['CEltPipe', 'CEltSprinkler', 'CEltFitting', 'CEltRoof', 'CEltCeiling']);
    expect(parseSeidbHeader(bytes)).toMatchObject({ rootOffset: 8, typeCatalogOffset: 10 });
    expect(parseSeidbTypeCatalog(bytes)).toMatchObject({ typeCount: 5, nativeSpatialTypesReady: true });
  });

  it('accepts the real AutoSPRINK catalog variant without loosening the signature gate', () => {
    const bytes = makeSeidb(['CEltPipe', 'CEltSprinkler', 'CEltFitting', 'CEltRoof', 'CEltCeiling']);
    bytes[12] = 0x9d;
    expect(parseSeidbTypeCatalog(bytes)).toMatchObject({
      catalogVariant: 0x9d,
      typeCount: 5,
      nativeSpatialTypesReady: true,
    });
    bytes[12] = 0x9e;
    expect(() => parseSeidbTypeCatalog(bytes)).toThrow('SEIDB_TYPE_CATALOG_SIGNATURE_INVALID');
  });

  it('rejects corrupt offsets, truncated compact values, and substituted type catalogs', () => {
    const corrupt = makeSeidb(['CEltPipe']);
    new DataView(corrupt.buffer).setUint32(4, corrupt.length + 1, true);
    expect(() => parseSeidbHeader(corrupt)).toThrow('SEIDB_TYPE_CATALOG_OFFSET_OUT_OF_BOUNDS');
    const substituted = makeSeidb(['CEltPipe', 'CEltSprinkler']);
    expect(parseSeidbTypeCatalog(substituted)).toMatchObject({
      nativeSpatialTypesReady: false,
      missingRequiredTypes: ['CEltFitting', 'CEltRoof', 'CEltCeiling'],
    });
  });

  it('converts AutoCAD OCS insert points to WCS without losing elevation', () => {
    expect(ocsPointToWcs(
      { x: -621.4313807726046, y: 119.99999999999957, z: 3692.4561031264725 },
      { x: 1, y: 0, z: 1.2246467991473535e-16 },
    )).toEqual(expect.objectContaining({
      x: expect.closeTo(3692.4561031264725, 8),
      y: expect.closeTo(-621.4313807726046, 8),
      z: expect.closeTo(120, 8),
    }));
  });

  it('accepts only hash-bound finite pipe, sprinkler, and fitting XYZ evidence', () => {
    const receipt = evaluateNativeAutosprinkCalibration(evidence, { sha256: EXPECTED_DWG_SHA256 });
    expect(receipt).toMatchObject({
      status: 'passed',
      counts: { pipes: 248, sprinklers: 271, fittings: 63, distinctPipeElevations: 7 },
      exactSourceDrawingXyzReady: true,
      approvedPdfRegistrationReady: true,
      pitchedRoofCalibrationReady: false,
      newHopeExactPipeCenterlineZReady: false,
      properPipeLayoutReady: false,
      fabricationReady: false,
      fieldReleaseReady: false,
    });
  });

  it('binds the real native AutoSPRINK archive catalog while holding native record decoding closed', () => {
    expect(nativeInspection).toMatchObject({
      source: {
        byteLength: 36805317,
        sha256: '1CBD6B94271DBD482E572230089535BF48D6C2BC8BF686022A10C79802510BA8',
        hashVerified: true,
      },
      archive: { entryCount: 8 },
      drawingSeidb: {
        rootOffset: 39002555,
        typeCatalogOffset: 39002906,
        byteLength: 39008232,
        typeCount: 157,
        nativeSpatialTypesReady: true,
        geometryRecordDecodeReady: false,
      },
      claims: {
        nativeCadArchiveIntakeReady: true,
        nativeElementTypeCatalogReady: true,
        nativeElementGeometryRecordDecodeReady: false,
        exactSourceDrawingXyzReady: false,
        newHopeExactPipeCenterlineZReady: false,
        properPipeLayoutReady: false,
      },
    });
    expect(nativeInspection.archive.entries.map((entry) => entry.name)).toEqual([
      'drawing.SEiDB',
      'sheet_1.SEiDB',
      'sheet_2.SEiDB',
      'sheet_3.SEiDB',
      'sheet_4.SEiDB',
      'sheet_5.SEiDB',
      'TreeItem.bmp',
      'CADThumb.bmp',
    ]);
  });

  it('fails closed on hash substitution, nonfinite geometry, and false promotion flags', () => {
    const mutated = structuredClone(evidence);
    mutated.pipes[0].start.z = Number.NaN;
    mutated.claims.approvedPdfRegistrationReady = true;
    mutated.claims.pitchedRoofCalibrationReady = true;
    mutated.claims.properPipeLayoutReady = true;
    const receipt = evaluateNativeAutosprinkCalibration(mutated, { sha256: '00'.repeat(32) });
    expect(receipt.status).toBe('blocked');
    expect(receipt.issues).toEqual(expect.arrayContaining(['SOURCE_SHA256_MISMATCH', 'PIPE_XYZ_NONFINITE']));
    expect(receipt.properPipeLayoutReady).toBe(false);
    expect(receipt.fabricationReady).toBe(false);
  });

  it('binds the actual approved-PDF visual proof without promoting pitched or New Hope readiness', () => {
    const proofRoot = new URL('../src/data/proofs/eos-ellsworth-native-cad/', import.meta.url);
    const proof = JSON.parse(fs.readFileSync(new URL('proof.json', proofRoot), 'utf8'));
    const digest = (name) => createHash('sha256').update(fs.readFileSync(new URL(name, proofRoot))).digest('hex').toUpperCase();
    expect(digest('approved-fp1-source.png')).toBe(proof.artifacts.approvedSource.sha256);
    expect(digest('approved-fp1-dwg-overlay.png')).toBe(proof.artifacts.approvedOverlay.sha256);
    expect(digest('dwg-plan-only.png')).toBe(proof.artifacts.dwgPlanOnly.sha256);
    expect(proof).toMatchObject({
      counts: { pipes: 248, sprinklerSymbols: 271, fittingSymbols: 63, verticalTransitions: 71 },
      planRegistration: { sprinklerSymbolSamples: 271, p95ResidualPx: 11.022681 },
      claims: {
        exactSourceDrawingXyzReady: true,
        approvedPdfPlanProjectionRegistrationReady: true,
        pitchedRoofCalibrationReady: false,
        newHopeExactPipeCenterlineZReady: false,
        properPipeLayoutReady: false,
      },
    });
    const html = fs.readFileSync(new URL('index.html', proofRoot), 'utf8');
    expect(html).toContain('Approved FP1 with source-DWG projection');
    expect(html).toContain('not pitched-roof proof');
  });
});
