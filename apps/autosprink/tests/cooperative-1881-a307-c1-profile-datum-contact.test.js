import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { extractCooperative1881A307C1ProfileDatumContact, resolveNativeMarkerLevelLine, segmentsTouch } from '../scripts/extract-cooperative-1881-a307-c1-profile-datum-contact.mjs';

describe('Cooperative 1881 A-307 C1 profile datum contact', () => {
  it('links a datum only through the native marker sequence immediately preceding its text', () => {
    const entities = [
      { handle: 'vertical', type: 'LINE', startPoint: { x: 10, y: 30 }, endPoint: { x: 10, y: 5 } },
      { handle: 'level', type: 'LINE', startPoint: { x: 0, y: 15 }, endPoint: { x: 10, y: 15 } },
      { handle: 'circle', type: 'CIRCLE' },
      { handle: 'text', type: 'MTEXT' },
    ];
    expect(resolveNativeMarkerLevelLine({ sourceHandle: 'text', sourcePoint: { x: 10, y: 30 } }, entities, { minX: 0, maxX: 20, minY: 0, maxY: 40 })).toMatchObject({ ok: true, sourceLineHandle: 'level', sourceCircleHandle: 'circle', sourceVerticalGuideHandle: 'vertical' });
  });

  it('rejects a nearest-looking level line when the native marker sequence is broken', () => {
    const entities = [
      { handle: 'vertical', type: 'LINE', startPoint: { x: 10, y: 30 }, endPoint: { x: 10, y: 5 } },
      { handle: 'level', type: 'LINE', startPoint: { x: 0, y: 15 }, endPoint: { x: 10, y: 15 } },
      { handle: 'not-circle', type: 'TEXT' },
      { handle: 'text', type: 'MTEXT' },
    ];
    expect(resolveNativeMarkerLevelLine({ sourceHandle: 'text', sourcePoint: { x: 10, y: 30 } }, entities, { minX: 0, maxX: 20, minY: 0, maxY: 40 })).toEqual({ ok: false, reason: 'MARKER_LEVEL_LINE_SEQUENCE_UNVERIFIED' });
  });

  it('requires actual segment intersection instead of a close parallel profile', () => {
    const level = { start: { x: 0, y: 10 }, end: { x: 20, y: 10 } };
    expect(segmentsTouch(level, { start: { x: 5, y: 10 }, end: { x: 5, y: 20 } })).toBe(true);
    expect(segmentsTouch(level, { start: { x: 0, y: 10.01 }, end: { x: 20, y: 10.01 } })).toBe(false);
  });

  it('rejects a parent C1 binding whose sealed architectural source hash was altered', async () => {
    const binding = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '../src/data/cooperative-1881-a307-c1-view-binding.json'), 'utf8'));
    binding.sources.architectural.sha256 = 'altered-source';
    const result = await extractCooperative1881A307C1ProfileDatumContact({ binding });
    expect(result.artifact.status).toBe('blocked');
    expect(result.artifact.issues.map((entry) => entry.code)).toContain('A307_C1_PARENT_BINDING_UNVERIFIED');
  });

  it('keeps the committed C1 receipt closed when neither native level line touches a roof profile', () => {
    const receipt = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '../src/data/cooperative-1881-a307-c1-profile-datum-contact.json'), 'utf8'));
    expect(receipt).toMatchObject({ status: 'passed', sourceView: { detailReference: 'C1', sheetReference: 'A-307' }, counts: { datums: 2, nativeLevelLines: 2, exactContacts: 0 } });
    expect(receipt.datumBindings.map((entry) => entry.levelLine.sourceLineHandle).sort()).toEqual(['144A2', '144B6']);
    expect(receipt.holds.map((entry) => entry.code)).toEqual(['A307_C1_DATUM_PROFILE_NO_EXACT_CONTACT', 'A307_C1_DATUM_PROFILE_NO_EXACT_CONTACT']);
    expect(receipt.claims).toMatchObject({ nativeDatumLevelLineRegistered: true, exactDatumToProfileContactRegistered: false, profileEdgeToDatumBound: false, roofSurfaceReconstructionReady: false, automaticSprinklerPlacementAllowed: false, automaticPipeRoutingAllowed: false, codeComplianceReady: false, employeeUseReady: false, vpsReleaseReady: false });
  });
});
