import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  buildIronwoodPitchedHoldoutScore,
  validateIronwoodPitchedHoldoutScore,
  verifyIronwoodPitchedHoldoutScoreAdversarialLoop,
} from '../src/engine/ironwood-seminary-pitched-holdout-score.js';

const read = (name) => JSON.parse(fs.readFileSync(new URL(`../src/data/${name}`, import.meta.url), 'utf8'));
const candidate = read('ironwood-seminary-pitched-holdout-candidate.json');
const answer = read('ironwood-seminary-pitched-holdout-answer-evidence.json');
const score = read('ironwood-seminary-pitched-holdout-score.json');

describe('Ironwood fresh pitched-roof answer-only score', () => {
  it('proves answer opening occurred after the immutable candidate commit', () => {
    expect(answer.answerOpenedAfterCandidateCommit).toBe('cb697e5e');
    expect(candidate.receiptSha256).toBe('fb6f897b20f58fead2ea34235f398c7d08d111fd229d1cd54d4018407ff741c4');
  });

  it('records the failed holdout without retuning the source candidate', async () => {
    expect(await buildIronwoodPitchedHoldoutScore(candidate, answer)).toEqual(score);
    expect(await validateIronwoodPitchedHoldoutScore(score, candidate, answer)).toMatchObject({ status: 'passed', freshProjectPlacementVerified: false, complianceReady: false });
    expect(score.candidateCounts).toEqual({ total: 10, pendent: 6, upright: 4 });
    expect(score.completedCounts).toEqual({ total: 12, pendent: 6, upright: 6 });
    expect(score.delta).toEqual({ total: -2, pendent: 0, upright: -2 });
    expect(score.acceptance).toEqual({ countParity: false, kindParity: false, xyWithin2FtAtLeast90Pct: false, xyScoreAvailable: false, accepted: false });
    expect(score.failureAnalysis).toMatchObject({ classification: 'fresh-holdout-failed-missed-connector-attic-volume', missingUprightAtticTargets: 2, candidateRetunedAfterAnswer: false });
  });

  it('rejects all score and false-promotion attacks', async () => {
    const result = await verifyIronwoodPitchedHoldoutScoreAdversarialLoop(score, candidate, answer);
    expect(result).toMatchObject({ status: 'passed', attemptedCases: 16, complianceReady: false });
    expect(result.rejectedCases).toHaveLength(16);
  });

  it('binds browser-inspected actual-PDF and 3D visual evidence to the failed score', () => {
    const proofRoot = new URL('../src/data/proofs/ironwood-seminary-pitched-holdout/', import.meta.url);
    const proof = JSON.parse(fs.readFileSync(new URL('proof.json', proofRoot), 'utf8'));
    const digest = (name) => createHash('sha256').update(fs.readFileSync(new URL(name, proofRoot))).digest('hex');
    expect(proof.visualReview).toMatchObject({ browserInspected: true, decodedImageCount: 5, brokenImageCount: 0, normalZoomLayoutReadable: true, actualPdfUnderlaysPresent: true, failureVisiblyDisclosed: true, threeDimensionalConnectorMassReadable: true });
    expect(proof.acceptance).toMatchObject({ countParity: false, kindParity: false, xyScoreAvailable: false, accepted: false });
    expect(proof.claimBoundary).toMatchObject({ freshProjectPlacementVerified: false, complianceReady: false, fabricationReady: false, fieldReleaseReady: false });
    expect(proof.files).toHaveLength(5);
    for (const entry of proof.files) expect(digest(entry.file)).toBe(entry.sha256);
    const html = fs.readFileSync(new URL('index.html', proofRoot), 'utf8');
    expect(html).toContain('Actual A101 / A102 / A201 PDF underlays');
    expect(html).toContain('FRESH HOLDOUT FAILED');
    expect(html).toContain('4 / 6');
  });
});
