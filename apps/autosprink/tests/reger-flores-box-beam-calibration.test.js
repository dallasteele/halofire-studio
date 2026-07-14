import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { renderRegerFloresBoxBeamCalibrationViews, replayRegerFloresBoxBeamCalibration, sealRegerFloresBoxBeamCalibration, validateRegerFloresBoxBeamCalibration, verifyRegerFloresBoxBeamCalibrationAdversarialLoop } from '../src/engine/reger-flores-box-beam-calibration.js';

const packet = JSON.parse(fs.readFileSync(new URL('../src/data/reger-flores-box-beam-calibration.json', import.meta.url), 'utf8'));

describe('Reger-Flores answer-exposed box-beam calibration', () => {
  it('corrects the source vault to three eight-foot beam bays', async () => {
    const result = await validateRegerFloresBoxBeamCalibration(packet); const replay = replayRegerFloresBoxBeamCalibration(packet);
    expect(result.status).toBe('passed'); expect(replay.status).toBe('passed'); expect(replay.heads).toHaveLength(6);
    expect(replay.regions.map((region) => region.partitionCells.length)).toEqual([3, 3]);
    expect(replay.heads.map((head) => head.pointPt[1])).toEqual([4, 12, 20, 4, 12, 20]);
  });

  it('matches completed topology but cannot claim fresh or exact placement acceptance', async () => {
    expect(packet.answerEvidence).toMatchObject({ roomLabel: 'LOUNGE VAULTED', headCount: 6, slopeColumnCount: 2, ridgeDirectionRowsPerColumn: 3 });
    expect(packet.calibrationResult).toMatchObject({ status: 'passed', generatedHeadCount: 6, topologyParityPassed: true, exactPlanPlacementClaimed: false });
    expect(await validateRegerFloresBoxBeamCalibration(packet)).toMatchObject({ freshHoldoutRequired: true, unseenProjectPlacementVerified: false, complianceReady: false });
  });

  it('rejects seven adversarial attempts to hide source, beam, sequence, or acceptance drift', async () => {
    const result = await verifyRegerFloresBoxBeamCalibrationAdversarialLoop(packet);
    expect(result.status).toBe('passed'); expect(result.rejectedCases).toEqual(packet.internalVerification.adversarial.rejectedCases); expect(result.totalCases).toBe(7);
  });

  it('rejects a resealed false fresh-holdout claim', async () => {
    const changed = structuredClone(packet); changed.unseenProjectPlacementVerified = true;
    expect((await validateRegerFloresBoxBeamCalibration(await sealRegerFloresBoxBeamCalibration(changed))).issues.map((entry) => entry.code)).toContain('REGER_BEAM_FALSE_PROMOTION');
  });

  it('renders six-head top, source-datum elevation, and partial 3D proof without promoting readiness', () => {
    const proof = renderRegerFloresBoxBeamCalibrationViews(packet);
    expect(proof.status).toBe('passed');
    expect(proof.counts).toEqual({ heads: 6, ceilingPlanes: 2, beamPartitions: 2, protectionCells: 6 });
    expect(proof.topSvg.match(/data-head-id=/g)).toHaveLength(6);
    expect(proof.topSvg.match(/data-box-beam=/g)).toHaveLength(2);
    expect(proof.elevationSvg).toContain('4:12 vault');
    expect(proof.model3dSvg).toContain('Partial-room calibration model');
    expect(proof).toMatchObject({ freshHoldoutRequired: true, complianceReady: false });
  });
});
