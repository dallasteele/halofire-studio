import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  buildBlossomRockExposedSlopeHoldoutScore,
  validateBlossomRockExposedSlopeHoldoutScore,
  verifyBlossomRockScoreAdversarialLoop,
} from '../src/engine/blossom-rock-exposed-slope-holdout-score.js';
import { auditExposedSlopeSourceRegistration, buildSourceTopologyPlacementCandidate } from '../src/engine/source-topology-placement-policy.js';

const read = (name) => JSON.parse(fs.readFileSync(new URL(`../src/data/${name}`, import.meta.url), 'utf8'));
const source = read('blossom-rock-exposed-slope-source.json');
const candidate = read('blossom-rock-exposed-slope-candidate.json');
const answer = read('blossom-rock-exposed-slope-answer-evidence.json');
const score = read('blossom-rock-exposed-slope-holdout-score.json');

describe('Blossom Rock fresh exposed-slope answer-only score', () => {
  it('proves answer opening occurred after the immutable candidate push', () => {
    expect(answer.answerOpenedAfterCandidateCommit).toBe('c1d915a6');
    expect(candidate.receiptSha256).toBe('ddb18ae5fa26521084153583f0ea50ea5ed9bc1946e20be4586b914a045e2947');
    expect(answer.primaryAnswer.sha256).toBe('df8624f88afc39842a208636676479208aef058ba7a59f8fca4aedd3dd1308b4');
  });

  it('records the failed holdout without retuning the sealed candidate', async () => {
    expect(await buildBlossomRockExposedSlopeHoldoutScore(candidate, answer)).toEqual(score);
    expect(await validateBlossomRockExposedSlopeHoldoutScore(score, candidate, answer, source)).toMatchObject({ status: 'passed', freshProjectPlacementVerified: false, complianceReady: false });
    expect(score.candidateCounts).toEqual({ total: 6, pendent: 0, upright: 0, unresolved: 6 });
    expect(score.completedCounts).toEqual({ total: 8, pendent: 0, upright: 8, unresolved: 0 });
    expect(score.delta).toEqual({ total: -2, pendent: 0, upright: -8, unresolved: 6 });
    expect(score.acceptance).toMatchObject({ sourceFeatureRegistrationValid: false, countParity: false, kindParity: false, xyScoreAvailable: false, elevationScoreAvailable: false, accepted: false });
    expect(score.failureAnalysis).toMatchObject({ classification: 'fresh-holdout-failed-cross-sheet-feature-registration', candidateRetunedAfterAnswer: false });
  });

  it('quarantines the cross-registered source packet in normal production generation', async () => {
    expect(auditExposedSlopeSourceRegistration(source)).toMatchObject({ status: 'blocked', issues: [{ code: 'SOURCE_EXPOSED_SLOPE_REGISTRATION_MISSING', sourceVolumeId: 'lake-pump-room-exposed-single-slope' }] });
    await expect(buildSourceTopologyPlacementCandidate(source)).rejects.toThrow('SOURCE_EXPOSED_SLOPE_REGISTRATION_BLOCKED');
  });

  it('rejects all score and false-promotion attacks', async () => {
    const result = await verifyBlossomRockScoreAdversarialLoop(score, candidate, answer, source);
    expect(result).toMatchObject({ status: 'passed', attemptedCases: 20, complianceReady: false });
    expect(result.rejectedCases).toHaveLength(20);
  });

  it('binds the browser-inspected actual-PDF and diagnostic 3D proof to the failed score', () => {
    const proofRoot = new URL('../src/data/proofs/blossom-rock-exposed-slope-holdout/', import.meta.url);
    const proof = JSON.parse(fs.readFileSync(new URL('proof.json', proofRoot), 'utf8'));
    const digest = (name) => createHash('sha256').update(fs.readFileSync(new URL(name, proofRoot))).digest('hex');
    expect(proof.visualReview).toMatchObject({ browserInspected: true, decodedImageCount: 7, brokenImageCount: 0, normalZoomLayoutReadable: true, horizontalOverflow: false, actualPdfUnderlaysPresent: true, approvedAnswerCropPresent: true, failureVisiblyDisclosed: true, threeDimensionalFailureReadable: true });
    expect(proof.acceptance).toMatchObject({ sourceFeatureRegistrationValid: false, countParity: false, kindParity: false, xyScoreAvailable: false, elevationScoreAvailable: false, accepted: false });
    expect(proof.claimBoundary).toMatchObject({ freshProjectPlacementVerified: false, obstructionClearanceReady: false, hydraulicCalculationReady: false, complianceReady: false, fabricationReady: false, fieldReleaseReady: false });
    expect(proof.files).toHaveLength(7);
    for (const entry of proof.files) expect(digest(entry.file)).toBe(entry.sha256);
    const html = fs.readFileSync(new URL('index.html', proofRoot), 'utf8');
    expect(html).toContain('Actual A3.2 PDF underlay');
    expect(html).toContain('Actual AHJ-approved FP2 answer');
    expect(html).toContain('SOURCE_EXPOSED_SLOPE_REGISTRATION_BLOCKED');
  });
});
