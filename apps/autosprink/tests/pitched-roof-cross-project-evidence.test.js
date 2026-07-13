import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildSlopedCeilingModel3d, verifySlopedCeilingModel3d } from '../src/engine/sloped-ceiling-model3d.js';
import { buildPitchedRoofCalibrationCases, sealPitchedRoofCrossProjectEvidence, validatePitchedRoofCrossProjectEvidence } from '../src/engine/pitched-roof-cross-project-evidence.js';

const packet = JSON.parse(fs.readFileSync(new URL('../src/data/pitched-roof-cross-project-evidence.json', import.meta.url), 'utf8'));

const reseal = async (change) => {
  const draft = structuredClone(packet);
  delete draft.receiptSha256;
  change(draft);
  return sealPitchedRoofCrossProjectEvidence(draft);
};

describe('cross-project pitched-roof evidence', () => {
  it('requires Dillon vector controls, independent Dallas steep-roof sections, and Tallahassee level/elevation cross-checks', async () => {
    const validation = await validatePitchedRoofCrossProjectEvidence(packet);
    expect(validation.status).toBe('passed');
    expect(validation.metrics).toMatchObject({ projectCount: 3, pitchedProjectCount: 2, dallasPitchMeanInPer12: 8.5195, dallasSectionRiseFt: 12.84375 });
    expect(validation.metrics.dallasPitchSpreadInPer12).toBeLessThan(.1);
    expect(validation.complianceReady).toBe(false);
  });

  it('replays both the 3:12 vector case and the independent 8.5195:12 scanned-section case through the same 3D plane engine', async () => {
    const cases = buildPitchedRoofCalibrationCases(await validatePitchedRoofCrossProjectEvidence(packet));
    expect(cases.status).toBe('passed');
    expect(cases.cases).toHaveLength(2);
    const normals = [];
    for (const calibration of cases.cases) {
      const scale = 12;
      const region = { id: calibration.id, polygonSubmittedPt: [[0, 0], [120, 0], [120, calibration.spanFt * scale], [0, calibration.spanFt * scale]], slopeAxis: 'y', downhillDirection: 'positive-y', riseIn: calibration.riseIn, runIn: calibration.runIn, shouldProtect: false, elevationDatum: { datumPointSubmittedPt: [0, 0], projectElevationFt: calibration.uphillElevationFt, slopeDirection: 'positive-y-down', sourceText: calibration.sourceMode } };
      const input = { artifactType: 'halofire.sloped-ceiling-model3d-input.v1', printedScalePtPerFt: scale, regions: [region], hydraulicDatumJoin: { projectDatumOffsetFt: 0, activeNodes: [{ report: calibration.id, nodeId: 'datum', hydraulicLocalElevationFt: calibration.uphillElevationFt, projectElevationFt: calibration.uphillElevationFt }], protectedRegionHeadNodeMappingReady: false } };
      const layout = { status: 'passed', heads: [] };
      const model = buildSlopedCeilingModel3d(layout, input);
      const proof = verifySlopedCeilingModel3d(model, layout, input);
      expect(proof.status).toBe('passed');
      expect(model.surfaces[0].elevationProfile.uphill.elevationFt).toBeCloseTo(calibration.uphillElevationFt, 8);
      expect(model.surfaces[0].elevationProfile.downhill.elevationFt).toBeCloseTo(calibration.downhillElevationFt, 8);
      normals.push(model.surfaces[0].normalUnit);
    }
    expect(normals[0]).not.toEqual(normals[1]);
  });

  it('adversarially rejects resealed source substitution, section-pitch drift, and elevation-datum drift', async () => {
    const badSource = await reseal((draft) => { draft.projects.find((project) => project.projectId === 'dallas-temple').sources[0].sha256 = 'f'.repeat(64); });
    expect((await validatePitchedRoofCrossProjectEvidence(badSource)).issues.map((entry) => entry.code)).toContain('PITCHED_ROOF_CROSS_PROJECT_SOURCE_DRIFT');
    const badPitch = await reseal((draft) => { draft.projects.find((project) => project.projectId === 'dallas-temple').pitchObservations[0].riseIn = 7; });
    expect((await validatePitchedRoofCrossProjectEvidence(badPitch)).issues.map((entry) => entry.code)).toContain('PITCHED_ROOF_DALLAS_SECTION_DISAGREEMENT');
    const badDatum = await reseal((draft) => { draft.projects.find((project) => project.projectId === 'dallas-temple').datumObservations.find((entry) => entry.id === 'a10-ridge').elevationFt += 1; });
    expect((await validatePitchedRoofCrossProjectEvidence(badDatum)).issues.map((entry) => entry.code)).toContain('PITCHED_ROOF_DALLAS_DATUM_DRIFT');
  });
});
