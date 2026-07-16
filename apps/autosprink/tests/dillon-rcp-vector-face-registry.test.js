import fs from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { sha256Hex } from '../src/engine/elevation-datums.js';
import { dillonRcpFaceContainsSegment, locateDillonRcpVectorFace, validateDillonRcpVectorFaceRegistry } from '../src/engine/dillon-rcp-vector-face-registry.js';

const read = (name) => JSON.parse(fs.readFileSync(new URL(`../src/data/${name}`, import.meta.url), 'utf8'));
const packet = read('dillon-rcp-vector-face-registry.json');
const vertical = read('dillon-vertical-registration.json');
const dependencies = { verticalSheets: vertical.sheets };
const reseal = async (value) => { const { receiptSha256: _receipt, ...draft } = value; value.receiptSha256 = await sha256Hex(draft); return value; };
let result;
beforeAll(async () => { result = await validateDillonRcpVectorFaceRegistry(packet, dependencies); });

describe('Dillon source architectural RCP vector-face registry', () => {
  it('replays single-surface faces while keeping mixed faces unresolved', () => {
    expect(result.status).toBe('passed');
    expect(result.counts).toEqual({ totalVectorFaces: 386, annotatedFaces: 42, singleSurfaceFaces: 37, mixedSurfaceFaces: 5 });
    expect(packet.generationPolicy).toMatchObject({ answerKeyUsed: false, completedBidGeometryUsed: false, mixedSurfacePolicy: 'fail-closed-unresolved' });
    expect(packet.sheets.map((sheet) => sheet.sourceCounts)).toEqual([
      { selectedLineSegments: 1902, usableLineSegments: 1897, polygonizedFaces: 231, annotatedFaces: 28, singleSurfaceFaces: 25, mixedSurfaceFaces: 3 },
      { selectedLineSegments: 1435, usableLineSegments: 1430, polygonizedFaces: 155, annotatedFaces: 14, singleSurfaceFaces: 12, mixedSurfaceFaces: 2 },
    ]);
    expect(packet.sheets.flatMap((sheet) => sheet.faces).filter((face) => !face.surfaceResolved).every((face) => face.surfaceKeys.length > 1 && face.heightAboveFloorFt == null)).toBe(true);
  });

  it('locates an accepted head and requires a whole pipe segment to remain inside one face', () => {
    const assignment = vertical.sheets.flatMap((sheet) => sheet.headAssignments.map((head) => ({ sheetId: sheet.sheetId, head }))).find(({ head }) => head.sourceFaceId);
    const located = locateDillonRcpVectorFace(packet, assignment.sheetId, assignment.head.planPointDwgFt);
    expect(located.ambiguous).toBe(false); expect(located.face.id).toBe(assignment.head.sourceFaceId);
    const pipe = vertical.sheets.flatMap((sheet) => sheet.pipeAssignments.map((entry) => ({ sheetId: sheet.sheetId, entry }))).find(({ entry }) => entry.endpointSourceFaceIds);
    const face = packet.sheets.find((sheet) => sheet.sheetId === pipe.sheetId).faces.find((entry) => entry.id === pipe.entry.endpointSourceFaceIds[0]);
    expect(dillonRcpFaceContainsSegment(face, pipe.entry.planDwgFt[0], pipe.entry.planDwgFt[1])).toBe(true);
  });

  it.each([
    ['mixed face false promotion', async (value) => { const face = value.sheets.flatMap((sheet) => sheet.faces).find((entry) => !entry.surfaceResolved); face.surfaceResolved = true; face.surfaceKind = 'clg'; face.heightAboveFloorFt = 9; }],
    ['PDF to DWG transform drift', async (value) => { value.sheets[0].faces[0].polygonDwgFt[0][0] += 1; }],
    ['source annotation reuse', async (value) => { value.sheets[0].faces[1].annotationIds[0] = value.sheets[0].faces[0].annotationIds[0]; }],
    ['source face index reuse', async (value) => { value.sheets[0].faces[1].sourceFaceIndex = value.sheets[0].faces[0].sourceFaceIndex; }],
    ['extraction count inflation', async (value) => { value.sheets[0].sourceCounts.selectedLineSegments += 1; }],
    ['source hash substitution', async (value) => { value.sheets[0].source.sourceSha256 = '0'.repeat(64); }],
  ])('blocks resealed adversarial %s', async (_label, mutate) => {
    const changed = structuredClone(packet); await mutate(changed); await reseal(changed);
    expect((await validateDillonRcpVectorFaceRegistry(changed, dependencies)).status).toBe('blocked');
  });
});
