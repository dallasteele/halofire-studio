import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  buildMitRiversideBuildingJSourceGeneratedPlacement,
  validateMitRiversideBuildingJSourceGeneratedPlacement,
  validateMitRiversideBuildingJSourcePlacementInputs,
  verifyMitRiversideBuildingJSourceGeneratedPlacementAdversarialLoop,
} from '../src/engine/mit-riverside-building-j-source-generated-placement.js';
import {
  buildMitRiversideBuildingJSourceGeneratedPlacementScore,
  validateMitRiversideBuildingJSourceGeneratedPlacementScore,
  verifyMitRiversideBuildingJSourceGeneratedPlacementScoreAdversarialLoop,
} from '../src/engine/mit-riverside-building-j-source-generated-placement-score.js';

const read = (name) => JSON.parse(fs.readFileSync(new URL(`../src/data/${name}`, import.meta.url), 'utf8'));
const inputs = read('mit-riverside-building-j-source-placement-inputs.json');
const candidate = read('mit-riverside-building-j-source-generated-placement.json');
const answer = read('mit-riverside-building-j-head-coordinate-registration.json');
const targets = read('mit-riverside-building-j-ceiling-installation-envelope.json');
const score = read('mit-riverside-building-j-source-generated-placement-score.json');

describe('MIT Riverside Building J source-generated placement', () => {
  it('accepts only the sanitized protected architectural input packet', async () => {
    expect(await validateMitRiversideBuildingJSourcePlacementInputs(inputs)).toMatchObject({
      status: 'passed', sourceInputsReady: true, answerArtifactRead: false, complianceReady: false,
    });
    expect(inputs.ceilingZones).toHaveLength(20);
    expect(inputs.ceilingControls).toHaveLength(8);
    expect(JSON.stringify(inputs)).not.toMatch(/headAssignments|heads3d|registeredAnswer|approvedFp|asBuiltPlan/);
  });

  it('replays 69 empirical candidates before answer access', async () => {
    const replay = await buildMitRiversideBuildingJSourceGeneratedPlacement(inputs);
    expect(replay).toEqual(candidate);
    expect(await validateMitRiversideBuildingJSourceGeneratedPlacement(candidate, inputs)).toMatchObject({
      status: 'passed', sourceGeneratedCandidateReady: true, sourceGeneratedPlacementVerified: false, complianceReady: false,
    });
    expect(candidate.counts).toMatchObject({ total: 69, upright: 54, pendent: 15, mainOpenStructure: 36, membraneOpenStructure: 18 });
    expect(candidate.sequence).toMatchObject({ answerArtifactRead: false, completedLayoutRead: false, freshProjectHoldoutRequired: true });
    expect(candidate.heads.every((head) => head.headInstallationZFt === null && !head.obstructionClearanceVerified && !head.hydraulicNodeAssigned)).toBe(true);
  });

  it('rejects all source-generator mutation attacks', async () => {
    const result = await verifyMitRiversideBuildingJSourceGeneratedPlacementAdversarialLoop(candidate, inputs);
    expect(result).toMatchObject({ status: 'passed', attemptedCases: 20, complianceReady: false });
    expect(result.rejectedCases).toHaveLength(20);
  });

  it('keeps completed-answer files out of the generator build path', () => {
    const generator = fs.readFileSync(new URL('../scripts/build-mit-riverside-building-j-source-generated-placement.mjs', import.meta.url), 'utf8');
    const extractor = fs.readFileSync(new URL('../scripts/extract-mit-riverside-building-j-source-placement-inputs.py', import.meta.url), 'utf8');
    expect(generator).not.toMatch(/head-coordinate-registration|ceiling-installation-envelope|approved-plan|as-built|answer-evidence/);
    expect(generator).not.toMatch(/source-generated-placement-score/);
    expect(extractor).not.toMatch(/parser\.add_argument\("--(?:approved|heads|answer|as-built)/);
  });

  it('scores only after sealing and preserves all failed acceptance gates', async () => {
    const candidateSnapshot = JSON.stringify(candidate);
    const replay = await buildMitRiversideBuildingJSourceGeneratedPlacementScore(candidate, answer, targets);
    expect(replay).toEqual(score);
    expect(JSON.stringify(candidate)).toBe(candidateSnapshot);
    expect(await validateMitRiversideBuildingJSourceGeneratedPlacementScore(score, candidate, answer, targets)).toMatchObject({
      status: 'passed', buildingJCalibrationScored: true, sourceGeneratedPlacementVerified: false, complianceReady: false,
    });
    expect(score.counts).toMatchObject({ deltaTotal: 1, deltaUpright: 1, deltaPendent: 0 });
    expect(score.xyScore.thresholdMatches).toEqual([
      { thresholdFt: 1, matched: 16, answerRecallPct: 23.529 },
      { thresholdFt: 2, matched: 42, answerRecallPct: 61.765 },
      { thresholdFt: 4, matched: 62, answerRecallPct: 91.176 },
      { thresholdFt: 6, matched: 66, answerRecallPct: 97.059 },
    ]);
    expect(score.xyScore.unmatchedGeneratedIds).toEqual(['MIT-J-G-U-049']);
    expect(score.xyScore.unmatchedAnswerIds).toEqual([]);
    expect(score.sourceTargetZScore.withinHalfFoot).toBe(68);
    expect(score.acceptance).toMatchObject({ countParity: false, kindParity: false, xyWithin2FtAtLeast90Pct: false, noUnmatchedAnswer: true, accepted: false });
  });

  it('rejects all scorer mutation and false-promotion attacks', async () => {
    const result = await verifyMitRiversideBuildingJSourceGeneratedPlacementScoreAdversarialLoop(score, candidate, answer, targets);
    expect(result).toMatchObject({ status: 'passed', attemptedCases: 18, complianceReady: false });
    expect(result.rejectedCases).toHaveLength(18);
  });

  it('binds four browser-inspected protected-underlay proof panels', () => {
    const proofUrl = new URL('../src/data/proofs/mit-riverside-building-j-source-generated-placement/', import.meta.url);
    const proof = JSON.parse(fs.readFileSync(new URL('proof.json', proofUrl), 'utf8'));
    const digest = (name) => createHash('sha256').update(fs.readFileSync(new URL(name, proofUrl))).digest('hex');
    expect(proof.visualReview).toMatchObject({ browserInspected: true, decodedImageCount: 4, consoleErrors: 0, normalZoomLayoutReadable: true, protectedUnderlaysVisiblyPresent: true, calibrationFailureVisiblyDisclosed: true });
    expect(proof.claimBoundary).toMatchObject({ buildingJCalibrationScored: true, sourceGeneratedPlacementVerified: false, complianceReady: false, fabricationReady: false, fieldReleaseReady: false });
    expect(digest(proof.roofPlan.file)).toBe(proof.roofPlan.sha256);
    expect(digest(proof.rcp.file)).toBe(proof.rcp.sha256);
    expect(digest(proof.elevation.file)).toBe(proof.elevation.sha256);
    expect(digest(proof.model3d.file)).toBe(proof.model3d.sha256);
    const html = fs.readFileSync(new URL('index.html', proofUrl), 'utf8');
    expect(html).toContain('CALIBRATION REJECTED');
    expect(html).toContain('Protected architectural PDF underlay');
  });
});
