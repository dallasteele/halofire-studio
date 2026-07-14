import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildMitRiversideBuildingJPitchedLayoutCalibration, renderMitRiversideBuildingJCalibrationViews, validateMitRiversideBuildingJAnswerEvidence, validateMitRiversideBuildingJPitchedLayoutCalibration, verifyMitRiversideBuildingJCalibrationAdversarialLoop } from '../src/engine/mit-riverside-building-j-pitched-layout-calibration.js';

const read = (name) => JSON.parse(fs.readFileSync(new URL(`../src/data/${name}`, import.meta.url), 'utf8'));
const sourceSeal = read('mit-riverside-building-j-source-seal.json');
const sourceCandidate = read('mit-riverside-building-j-source-only-pitched-candidate.json');
const answerEvidence = read('mit-riverside-building-j-answer-evidence.json');
const dependencies = { sourceSeal, sourceCandidate, answerEvidence };

describe('MIT Riverside Building J completed-bid pitched layout calibration', () => {
  it('binds answers only after the pushed source commit and proves approved/as-built layout continuity', async () => {
    expect(await validateMitRiversideBuildingJAnswerEvidence(answerEvidence)).toMatchObject({ status: 'passed', answerRegistrationEvidenceReady: true, exactHeadCoordinatesReady: false, complianceReady: false });
    expect(answerEvidence.answerOpenedAfterSourceCommit).toBe('551c6081');
    expect(answerEvidence.approvedAsBuiltComparison).toMatchObject({ differentPixelsOutsideStampMask: 0, maxChannelDifferenceOutsideStampMask: 0, buildingJLayoutIdenticalOutsideStamp: true });
  });

  it('registers the answer grid to structural source within one pixel while preserving the four-inch source conflict', async () => {
    const packet = await buildMitRiversideBuildingJPitchedLayoutCalibration(sourceCandidate, sourceSeal, answerEvidence);
    expect(await validateMitRiversideBuildingJPitchedLayoutCalibration(packet, dependencies)).toMatchObject({ status: 'passed', answerRegistrationReady: true, exactHeadCoordinatesReady: false, sourceGeneratedPitchedPlacementVerified: false, complianceReady: false });
    expect(packet.registeredGrid).toMatchObject({ governingSource: 'structural-roof-framing-dwg', xAxisCount: 8, yAxisCount: 5, xMaxResidualPx: 0.798381, yMaxResidualPx: 0.655077 });
    expect(packet.sourceDiscrepancy).toMatchObject({ architecturalFloorOverallFt: 76.666667, structuralRoofOverallFt: 76.333333, differenceInches: 4 });
  });

  it('registers the completed schedule as 15 pendent plus 53 upright without inventing coordinates or elevations', async () => {
    const packet = await buildMitRiversideBuildingJPitchedLayoutCalibration(sourceCandidate, sourceSeal, answerEvidence);
    expect(packet.registeredAnswer).toMatchObject({ pendentCount: 15, uprightCount: 53, totalCount: 68, pitchedRoofBuildingPlanPresent: true, buildingSectionWithSprinklersAndPipePresent: true });
    expect(packet.headCoordinates).toEqual([]);
    expect(packet.headElevations).toEqual([]);
    expect(packet.roofPlaneAssignments).toEqual([]);
    expect(packet.sourceGeneratedPitchedPlacementVerified).toBe(false);
  });

  it('renders grid/count, section/datum, and fail-closed 3D calibration proof', async () => {
    const packet = await buildMitRiversideBuildingJPitchedLayoutCalibration(sourceCandidate, sourceSeal, answerEvidence);
    const views = renderMitRiversideBuildingJCalibrationViews(packet);
    expect(views.topSvg).toContain('53 upright + 15 pendent = 68');
    expect(views.topSvg).toContain('not extracted head coordinates');
    expect(views.elevationSvg).toContain("17'-1, 19'-11, 23'-4");
    expect(views.model3dSvg).toContain('No 3D heads shown');
    expect(views.complianceReady).toBe(false);
  });

  it('rejects source-order, answer, grid, count, discrepancy, coordinate, elevation, compliance, and release attacks', async () => {
    const packet = await buildMitRiversideBuildingJPitchedLayoutCalibration(sourceCandidate, sourceSeal, answerEvidence);
    const result = await verifyMitRiversideBuildingJCalibrationAdversarialLoop(packet, dependencies);
    expect(result).toMatchObject({ status: 'passed', attemptedCases: 19, exactHeadCoordinatesReady: false, complianceReady: false });
    expect(result.rejectedCases).toHaveLength(19);
  });
});
