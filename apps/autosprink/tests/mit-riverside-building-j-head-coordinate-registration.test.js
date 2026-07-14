import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildMitRiversideBuildingJHeadCoordinateRegistration, renderMitRiversideBuildingJHeadRegistrationViews, validateMitRiversideBuildingJHeadCoordinateEvidence, validateMitRiversideBuildingJHeadCoordinateRegistration, verifyMitRiversideBuildingJHeadRegistrationAdversarialLoop } from '../src/engine/mit-riverside-building-j-head-coordinate-registration.js';

const read = (name) => JSON.parse(fs.readFileSync(new URL(`../src/data/${name}`, import.meta.url), 'utf8'));
const answerCalibration = read('mit-riverside-building-j-pitched-layout-calibration.json');
const headEvidence = read('mit-riverside-building-j-head-coordinate-evidence.json');
const dependencies = { answerCalibration, headEvidence };

describe('MIT Riverside Building J exact completed-bid head XY registration', () => {
  it('classifies 69 vector circles into 53 upright, 15 pendent, and one excluded crossed valve', async () => {
    expect(await validateMitRiversideBuildingJHeadCoordinateEvidence(headEvidence)).toMatchObject({ status: 'passed', exactAnswerHeadCoordinatesReady: true, headElevationsReady: false, complianceReady: false });
    expect(headEvidence.extraction).toMatchObject({ candidateOuterCircleCount: 69, excludedCrossedValveCount: 1, pendentCenteredCircleCount: 13, uprightCenteredCircleCount: 1, approvedAsBuiltVectorSymbolsIdentical: true, approvedAsBuiltMaximumCoordinateDeltaPt: 0 });
    expect(headEvidence.counts).toEqual({ pendent: 15, upright: 53, total: 68 });
  });

  it('registers every head inside the 76 ft 4 in by 100 ft 2 in answer/RCP-local envelope', async () => {
    const packet = await buildMitRiversideBuildingJHeadCoordinateRegistration(answerCalibration, headEvidence);
    expect(await validateMitRiversideBuildingJHeadCoordinateRegistration(packet, dependencies)).toMatchObject({ status: 'passed', exactAnswerHeadCoordinatesReady: true, headElevationsReady: false, sourceGeneratedPitchedPlacementVerified: false, complianceReady: false });
    expect(packet.heads).toHaveLength(68);
    expect(new Set(packet.heads.map((head) => head.id)).size).toBe(68);
    expect(packet.heads.every((head) => head.localFt.x >= 0 && head.localFt.x <= 76.333333 && head.localFt.y >= 0 && head.localFt.y <= 100.166667)).toBe(true);
  });

  it('keeps every Z and source protection-plane assignment fail-closed', async () => {
    const packet = await buildMitRiversideBuildingJHeadCoordinateRegistration(answerCalibration, headEvidence);
    expect(packet.heads.every((head) => head.zFt === null && head.sourceProtectionPlaneId === null)).toBe(true);
    expect(packet).toMatchObject({ headElevationsReady: false, wholeRoofHeadPlaneAssignmentReady: false, branchPipeTopologyReady: false, sourceGeneratedPitchedPlacementVerified: false, complianceReady: false, fabricationReady: false, fieldReleaseReady: false });
  });

  it('renders exact top-view XY while refusing false elevation and 3D head proof', async () => {
    const packet = await buildMitRiversideBuildingJHeadCoordinateRegistration(answerCalibration, headEvidence);
    const views = renderMitRiversideBuildingJHeadRegistrationViews(packet);
    expect((views.topSvg.match(/<circle /g) || [])).toHaveLength(68);
    expect(views.topSvg).toContain('EXACT COMPLETED-BID XY');
    expect(views.elevationSvg).toContain('individual Z');
    expect(views.model3dSvg).toContain('No 3D heads fabricated');
  });

  it('rejects receipt, order, count, valve, coordinate, class, Z, plane, pipe, compliance, and release attacks', async () => {
    const packet = await buildMitRiversideBuildingJHeadCoordinateRegistration(answerCalibration, headEvidence);
    const result = await verifyMitRiversideBuildingJHeadRegistrationAdversarialLoop(packet, dependencies);
    expect(result).toMatchObject({ status: 'passed', attemptedCases: 19, headElevationsReady: false, complianceReady: false });
    expect(result.rejectedCases).toHaveLength(19);
  });
});
