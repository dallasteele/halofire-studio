import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildChollaCompletedLayoutRegistration,
  buildChollaCompletedLayoutView,
  sealChollaCompletedLayoutRegistration,
  validateChollaCompletedLayoutRegistration,
  verifyChollaCompletedLayoutAdversarialLoop,
} from '../src/engine/cholla-main-house-completed-layout-registration.js';

const packet = JSON.parse(fs.readFileSync(new URL('../src/data/cholla-main-house-completed-layout-registration.json', import.meta.url), 'utf8'));

describe('Cholla Main House completed-answer layout registration', () => {
  it('deterministically replays 45 approved/as-built head coordinates with two independent signatures', async () => {
    const replay = await buildChollaCompletedLayoutRegistration();
    replay.internalVerification.adversarial = packet.internalVerification.adversarial;
    expect(await sealChollaCompletedLayoutRegistration(replay)).toEqual(packet);
    expect(await validateChollaCompletedLayoutRegistration(packet)).toMatchObject({
      status: 'passed', answerExposedTopViewCalibrationReady: true, topViewReady: true,
      freshHoldoutRequired: true, unseenProjectPlacementVerified: false,
      exactDeflectorElevationReady: false, model3dReady: false, complianceReady: false,
    });
    expect(packet.heads).toHaveLength(45);
    expect(new Set(packet.heads.map((head) => `${head.xPt},${head.yPt}`)).size).toBe(45);
    expect(packet.headExtraction).toMatchObject({
      primary: { detected: 45 }, independent: { detected: 45 },
      thresholdStability: { '4.2-4.8': 45, '4.3-4.7': 45, '4.4-4.6': 45 },
      approvedAsBuiltMaximumResidualPt: 0,
    });
  });

  it('registers only head-connected pipe evidence and does not promote a fabrication topology', () => {
    expect(packet.pipeVectorEvidence.headConnectedSegments).toHaveLength(46);
    expect(packet.pipeVectorEvidence).toMatchObject({ coveredHeadCount: 45, maximumHeadToSegmentDistancePt: 4.441, completeNetworkTopologyReady: false });
    expect(packet.completePipeTopologyReady).toBe(false);
    expect(packet.fabricationReady).toBe(false);
  });

  it('preserves source-known 9/10 foot labels and leaves answer-exposed MAX surfaces unresolved', () => {
    expect(packet.ceilingEvidence.sourceDwgKnownLabels).toEqual([{ text: "10' CLG", count: 6 }, { text: "9' CLG", count: 2 }]);
    expect(packet.ceilingEvidence.completedAnswerAddedMaximumLabels.map((label) => label.text)).toEqual(["16' MAX CLG", "14' MAX CLG", "14' MAX CLG"]);
    expect(packet.ceilingEvidence).toMatchObject({ exactZoneBoundariesReady: false, exactCeilingSurfaceReady: false, exactDeflectorElevationReady: false });
    expect(packet.heads.every((head) => head.zFt === null && head.ceilingZoneId === null)).toBe(true);
  });

  it('renders the completed top-view registration while labeling Z as unresolved', () => {
    const view = buildChollaCompletedLayoutView(packet);
    expect(view.match(/<circle /g)).toHaveLength(45);
    expect(view.match(/<line /g)).toHaveLength(46);
    expect(view).toContain('Z unresolved');
    expect(view).toContain("16' MAX CLG");
  });

  it('rejects twelve evidence, geometry, topology, and false-promotion mutations', async () => {
    expect(await verifyChollaCompletedLayoutAdversarialLoop(packet)).toEqual({
      status: 'passed',
      rejectedCases: ['source-receipt', 'answer-identity', 'head-count', 'head-coordinate', 'independent-count', 'pipe-coverage', 'pipe-topology', 'ceiling-surface', 'deflector-elevation', 'fresh-placement', 'model3d', 'compliance'],
      totalCases: 12,
    });
  });
});
