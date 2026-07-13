import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { buildDillonStructuralRoofModel, buildDillonStructuralRoofPacket, renderDillonStructuralRoofTopView, validateDillonStructuralRoofPacket } from '../src/engine/dillon-structural-roof-surfaces.js';

const read = (name) => JSON.parse(fs.readFileSync(new URL(`../src/data/${name}`, import.meta.url), 'utf8'));
const source = read('dillon-structural-framing-roof-source.json');
const floorModel = read('dillon-floor-by-floor-model.json');
const slopedCalibration = read('submitted-sloped-ceiling-calibration.dillon.json');
let packet; let validation;

beforeAll(async () => {
  packet = await buildDillonStructuralRoofPacket(source, floorModel, slopedCalibration);
  validation = await validateDillonStructuralRoofPacket(packet, { source, floorModel, slopedCalibration });
});

describe('Dillon structural slope-roof footprints', () => {
  it('preserves exact vector hatch sources and rejects the solid-gray fill by legend', () => {
    expect(validation.status).toBe('passed');
    expect(validation.counts).toEqual({ sourceHatchDrawings: 35, sourceHatchTriangles: 48, rejectedRecessFloorDrawings: 35, rejectedRecessFloorTriangles: 48, registeredRoofFacePatches: 0, structurallyResolvedPlanes: 0, existingCalibratedCeilingPlanes: 4, existingAbsoluteDatumCeilingPlanes: 1 });
    expect(packet.sheets.slice(0, 2).map((sheet) => sheet.registration.status)).toEqual(['registered', 'registered']);
    expect(packet.sheets.flatMap((sheet) => sheet.patches).every((patch) => patch.classification === 'recess-floor-at-bathroom' && patch.roofCandidateStatus === 'rejected-by-legend')).toBe(true);
  });

  it('keeps unlinked plane directions and datums out of 3D', () => {
    const model = buildDillonStructuralRoofModel(validation);
    expect(model.status).toBe('passed');
    expect(model.footprints).toEqual([]);
    expect(model.surfaces3d).toEqual([]);
    expect(model.rejectedCandidates).toBe(48);
    const view = renderDillonStructuralRoofTopView(model);
    expect(view.svg).toContain('0 registered structural roof faces');
    expect(view.svg).toContain('RECESS FLOOR AT BATHROOM');
  });

  it.each([
    ['receipt content', (value) => { value.sheets[0].patches[0].polygonDwgFt[0][0] += 1; }],
    ['registration transform', (value) => { value.sheets[0].registration.translateXFt += 1; }],
    ['legend reclassification', (value) => { value.sheets[0].patches[0].classification = 'slope-roof'; }],
    ['promoted rejected face', (value) => { value.sheets[2].patches[0].polygonDwgFt = [[0, 0], [1, 0], [0, 1]]; value.sheets[2].patches[0].render3d = true; }],
    ['count drift', (value) => { value.counts.rejectedRecessFloorTriangles -= 1; }],
  ])('blocks adversarial %s mutation', async (_label, mutate) => {
    const changed = structuredClone(packet); mutate(changed);
    expect((await validateDillonStructuralRoofPacket(changed, { source, floorModel, slopedCalibration })).status).toBe('blocked');
  });

  it('blocks source, floor-model, and sloped-calibration substitutions', async () => {
    const changedSource = structuredClone(source); changedSource.sheets[0].hatchDrawings[0].trianglesTopLeftPt[0][0][0] += 1;
    expect((await validateDillonStructuralRoofPacket(packet, { source: changedSource, floorModel, slopedCalibration })).issues.map((entry) => entry.code)).toContain('DILLON_STRUCTURAL_ROOF_SOURCE_MISMATCH');
    expect((await validateDillonStructuralRoofPacket(packet, { source, floorModel: { ...floorModel, receiptSha256: '0'.repeat(64) }, slopedCalibration })).issues.map((entry) => entry.code)).toContain('DILLON_STRUCTURAL_ROOF_FLOOR_MODEL_MISMATCH');
    expect((await validateDillonStructuralRoofPacket(packet, { source, floorModel, slopedCalibration: { ...slopedCalibration, evidenceReceiptSha256: '0'.repeat(64) } })).issues.map((entry) => entry.code)).toContain('DILLON_STRUCTURAL_ROOF_SLOPE_CALIBRATION_MISMATCH');
  });
});
