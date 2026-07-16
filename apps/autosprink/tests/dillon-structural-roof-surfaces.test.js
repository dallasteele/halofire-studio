import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { buildDillonStructuralRoofModel, buildDillonStructuralRoofPacket, renderDillonStructuralRoofTopView, validateDillonStructuralRoofPacket } from '../src/engine/dillon-structural-roof-surfaces.js';
import { sha256Hex } from '../src/engine/elevation-datums.js';

const read = (name) => JSON.parse(fs.readFileSync(new URL(`../src/data/${name}`, import.meta.url), 'utf8'));
const source = read('dillon-structural-framing-roof-source.json');
const floorModel = read('dillon-floor-by-floor-model.json');
const slopedCalibration = read('submitted-sloped-ceiling-calibration.dillon.json');
const underlayManifest = JSON.parse(fs.readFileSync(new URL('../public/plan-underlays/dillon-structural-roof/manifest.json', import.meta.url), 'utf8'));
let packet; let validation;

async function reseal(value) {
  const { receiptSha256: _receipt, ...draft } = value;
  value.receiptSha256 = await sha256Hex(draft);
  return value;
}

beforeAll(async () => {
  packet = await buildDillonStructuralRoofPacket(source, floorModel, slopedCalibration);
  validation = await validateDillonStructuralRoofPacket(packet, { source, floorModel, slopedCalibration });
});

describe('Dillon structural slope-roof footprints', () => {
  it('preserves the vector-speckle source contours and rejects the solid-gray fill by legend', () => {
    expect(validation.status).toBe('passed');
    expect(validation.counts).toEqual({
      sourceHatchDrawings: 35, sourceHatchTriangles: 48, rejectedRecessFloorDrawings: 35, rejectedRecessFloorTriangles: 48,
      sourceSpeckleStrokes: 63267, sourceSpeckleContours: 15, registeredRoofFacePatches: 11,
      sourcePitchLinkedRoofContours: 1, registeredPitchLinkedRoofContours: 0, structurallyResolvedPlanes: 0,
      existingCalibratedCeilingPlanes: 4, existingAbsoluteDatumCeilingPlanes: 1,
    });
    expect(packet.sheets.slice(0, 2).map((sheet) => sheet.registration.status)).toEqual(['registered', 'registered']);
    expect(packet.sheets.flatMap((sheet) => sheet.rejectedPatches).every((patch) => patch.classification === 'recess-floor-at-bathroom' && patch.roofCandidateStatus === 'rejected-by-legend')).toBe(true);
    expect(packet.sheets.flatMap((sheet) => sheet.roofContours)).toHaveLength(15);
    expect(packet.sheets.flatMap((sheet) => sheet.roofContours).every((contour) => contour.classification === 'slope-roof' && contour.reconstructionTolerancePt === 4)).toBe(true);
  });

  it('keeps unlinked plane directions and datums out of 3D', () => {
    const model = buildDillonStructuralRoofModel(validation);
    expect(model.status).toBe('passed');
    expect(model.footprints).toHaveLength(11);
    expect(model.footprints.every((footprint) => footprint.render3d === false && footprint.datumAssociationStatus === 'unlinked')).toBe(true);
    expect(model.surfaces3d).toEqual([]);
    expect(model.rejectedCandidates).toBe(48);
    const view = renderDillonStructuralRoofTopView(model, source, underlayManifest);
    expect(view.status).toBe('passed');
    expect(view.sourceCoordinateOverlay).toBe(true);
    expect(view.svg).toContain('Actual structural sheets');
    expect(view.svg).toContain('/public/plan-underlays/dillon-structural-roof/S-020-main-level-framing.png');
    expect(view.svg).toContain('/public/plan-underlays/dillon-structural-roof/S-021-upper-level-framing.png');
    expect(view.svg).toContain('0 structural 3D planes');
    expect(view.svg).toContain('48 gray recess-floor triangles rejected');
    expect(view.svg).toContain('orange = Roof-Hatch contour');
    for (const sheet of underlayManifest.sheets) {
      const png = fs.readFileSync(new URL(`../public/plan-underlays/dillon-structural-roof/${sheet.file}`, import.meta.url));
      expect(createHash('sha256').update(png).digest('hex')).toBe(sheet.pngSha256);
      expect(sheet.sourcePdfSha256).toBe(source.sheets.find((entry) => entry.sheetId === sheet.sheetId).sourceSha256);
    }
  });

  it('blocks blank, substituted, or unbound structural underlays', () => {
    const model = buildDillonStructuralRoofModel(validation);
    expect(renderDillonStructuralRoofTopView(model, source, null).status).toBe('blocked');
    const changed = structuredClone(underlayManifest);
    changed.sheets[0].sourcePdfSha256 = '0'.repeat(64);
    const result = renderDillonStructuralRoofTopView(model, source, changed);
    expect(result.status).toBe('blocked');
    expect(result.issues.map((entry) => entry.code)).toContain('DILLON_STRUCTURAL_ROOF_UNDERLAY_BINDING_INVALID');
  });

  it.each([
    ['source contour', (value) => { value.sheets[0].roofContours[0].sourcePolygonTopLeftPt[0][0] += 1; }],
    ['source contour hole', (value) => { value.sheets[2].roofContours[2].sourceHolesTopLeftPt[0][0][0] += 1; }],
    ['registration transform', (value) => { value.sheets[0].registration.translateXFt += 1; }],
    ['legend reclassification', (value) => { value.sheets[0].rejectedPatches[0].classification = 'slope-roof'; }],
    ['pitch association', (value) => { value.sheets[0].roofContours[0].pitchControlIds = ['invented-pitch']; value.sheets[0].roofContours[0].pitchAssociationStatus = 'source-arrow-linked'; }],
    ['datum promotion', (value) => { value.sheets[0].roofContours[0].datumAssociationStatus = 'linked'; value.sheets[0].roofContours[0].render3d = true; }],
    ['ambiguous toy promotion', (value) => { value.sheets[2].roofContours[0].registrationStatus = 'registered'; value.sheets[2].roofContours[0].polygonDwgFt = [[0, 0], [1, 0], [0, 1]]; value.sheets[2].roofContours[0].holesDwgFt = []; }],
    ['boundary tolerance', (value) => { value.sheets[0].roofContours[0].reconstructionTolerancePt = 40; }],
    ['count drift', (value) => { value.counts.rejectedRecessFloorTriangles -= 1; }],
  ])('blocks adversarial %s mutation', async (_label, mutate) => {
    const changed = structuredClone(packet); mutate(changed);
    expect((await validateDillonStructuralRoofPacket(await reseal(changed), { source, floorModel, slopedCalibration })).status).toBe('blocked');
  });

  it('blocks source, floor-model, and sloped-calibration substitutions', async () => {
    const changedSource = structuredClone(source); changedSource.sheets[0].hatchDrawings[0].trianglesTopLeftPt[0][0][0] += 1;
    expect((await validateDillonStructuralRoofPacket(packet, { source: changedSource, floorModel, slopedCalibration })).issues.map((entry) => entry.code)).toContain('DILLON_STRUCTURAL_ROOF_SOURCE_MISMATCH');
    expect((await validateDillonStructuralRoofPacket(packet, { source, floorModel: { ...floorModel, receiptSha256: '0'.repeat(64) }, slopedCalibration })).issues.map((entry) => entry.code)).toContain('DILLON_STRUCTURAL_ROOF_FLOOR_MODEL_MISMATCH');
    expect((await validateDillonStructuralRoofPacket(packet, { source, floorModel, slopedCalibration: { ...slopedCalibration, evidenceReceiptSha256: '0'.repeat(64) } })).issues.map((entry) => entry.code)).toContain('DILLON_STRUCTURAL_ROOF_SLOPE_CALIBRATION_MISMATCH');
  });
});
