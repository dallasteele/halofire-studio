import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { classifyPitchedProtectionVolume } from '../src/engine/pitched-protection-volume.js';
import { buildSagewoodPitchedAtticCalibration, buildSagewoodPitchedAtticCalibrationViews, sealSagewoodPitchedAtticCalibration, validateSagewoodPitchedAtticCalibration, verifySagewoodPitchedAtticCalibrationAdversarialLoop } from '../src/engine/sagewood-pitched-attic-calibration.js';

const read = (path) => JSON.parse(fs.readFileSync(new URL(path, import.meta.url), 'utf8'));
const sourceCandidate = read('../src/data/sagewood-source-only-pitched-candidate.json');
const classificationEvidence = read('../src/data/sagewood-pitched-protection-volume-calibration.json');
const heldoutComparison = read('../src/data/sagewood-pitched-heldout-comparison.json');
const packet = read('../src/data/sagewood-pitched-attic-calibration.json');

describe('Sagewood answer-exposed pitched-attic calibration', () => {
  it('uses the generic classifier but prevents answer-exposed production promotion', async () => {
    expect(await classifyPitchedProtectionVolume(classificationEvidence)).toMatchObject({ status: 'passed', classification: 'pitched-attic', answerExposed: true, productionPlacementEligible: false, complianceReady: false });
  });

  it('deterministically replays five by six topology on source-only envelope controls', async () => {
    const replay = await buildSagewoodPitchedAtticCalibration({ sourceCandidate, classificationEvidence, heldoutComparison });
    replay.internalVerification.adversarial = packet.internalVerification.adversarial;
    const sealed = await sealSagewoodPitchedAtticCalibration(replay);
    expect(sealed).toEqual(packet);
    expect(await validateSagewoodPitchedAtticCalibration(packet)).toMatchObject({ status: 'passed', answerExposedTopologyCalibrationReady: true, freshHoldoutRequired: true, unseenProjectPlacementVerified: false, complianceReady: false });
    expect(packet.heads3d).toHaveLength(30);
    expect(new Set(packet.heads3d.map((head) => head.columnIndex)).size).toBe(5);
    expect(new Set(packet.heads3d.map((head) => head.rowIndex)).size).toBe(6);
    expect(packet.heads3d.every((head) => head.deflectorElevationFt === null)).toBe(true);
  });

  it('renders distinct top, elevation, and partial 3D proof surfaces', () => {
    const views = buildSagewoodPitchedAtticCalibrationViews(packet);
    expect(views.topSvg.match(/<circle /g)).toHaveLength(30);
    expect(views.elevationSvg.match(/<circle /g)).toHaveLength(5);
    expect(views.model3dSvg.match(/<circle /g)).toHaveLength(30);
    expect(views.model3dSvg.match(/<polygon /g)).toHaveLength(2);
    expect(views.model3dSvg).toContain('Two 3:12 roof planes');
    expect(views.elevationSvg).toContain('not accepted deflector elevations');
  });

  it('rejects eight adversarial topology, evidence, and false-promotion mutations', async () => {
    expect(await verifySagewoodPitchedAtticCalibrationAdversarialLoop(packet)).toEqual({ status: 'passed', rejectedCases: ['source-receipt', 'classification-receipt', 'classification', 'columns', 'head', 'deflector', 'fresh-pass', 'compliance-pass'], totalCases: 8 });
  });
});
