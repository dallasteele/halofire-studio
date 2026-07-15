import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  buildMvcBarrelHoldoutScore,
  sealMvcBarrelAnswerEvidence,
  validateMvcBarrelAnswerEvidence,
  validateMvcBarrelHoldoutScore,
  verifyMvcBarrelScoreAdversarialLoop,
} from '../src/engine/mvc-2plex-barrel-holdout-score.js';

const read = (name) => JSON.parse(fs.readFileSync(new URL(`../src/data/${name}`, import.meta.url), 'utf8'));
const source = read('mvc-2plex-barrel-holdout-source.json');
const candidate = read('mvc-2plex-barrel-holdout-candidate.json');
const answer = read('mvc-2plex-barrel-holdout-answer-evidence.json');
const score = read('mvc-2plex-barrel-holdout-score.json');

describe('MVC 2-Plex fresh barrel-roof holdout score', () => {
  it('proves the approved answer was opened only after the frozen candidate commit', async () => {
    expect(await sealMvcBarrelAnswerEvidence(answer)).toEqual(answer);
    expect(await validateMvcBarrelAnswerEvidence(answer, candidate)).toMatchObject({ status: 'passed', answerEvidenceReady: true, freshProjectPlacementVerified: false, complianceReady: false });
    expect(answer.sequence).toEqual({ answerExposedAfterCandidateCommit: true, candidateCommitBeforeAnswerOpen: '3e824883', candidateReceiptSha256: candidate.receiptSha256, candidateRetunedAfterAnswer: false });
  });

  it('records the two-target false positive without retuning or promoting acceptance', async () => {
    expect(await buildMvcBarrelHoldoutScore(candidate, source, answer)).toEqual(score);
    expect(await validateMvcBarrelHoldoutScore(score, candidate, source, answer)).toMatchObject({ status: 'passed', accepted: false, freshProjectPlacementVerified: false, complianceReady: false });
    expect(score.score).toEqual({ candidateTargets: 2, approvedTargets: 0, truePositiveTargets: 0, falsePositiveTargets: 2, falseNegativeTargets: 0, precision: 0, recall: null, exactCountMatch: false, exactXyMatch: false, kindMatch: false });
    expect(score.acceptance).toMatchObject({ accepted: false, classification: 'fresh-holdout-failed-unprotected-barrel-roof-projection' });
    expect(score.failureAnalysis).toMatchObject({ residualClass: 'roof-projection-misclassified-as-protected-occupied-volume', sourceObservableBeforeAnswer: true, candidateRetunedAfterAnswer: false });
  });

  it('uses system-owned replay, cross-source, and adversarial loops without an independent-review gate', () => {
    expect(score.internalVerification).toMatchObject({ primary: { status: 'passed' }, crossSource: { status: 'passed' }, adversarial: { status: 'passed' } });
    expect(score.internalVerification).not.toHaveProperty('independent');
  });

  it('rejects every score, sequence, count, and false-promotion mutation', async () => {
    const result = await verifyMvcBarrelScoreAdversarialLoop(score, candidate, source, answer);
    expect(result).toMatchObject({ status: 'passed', attemptedCases: 15, complianceReady: false });
    expect(result.rejectedCases).toHaveLength(15);
  });

  it('binds browser-inspected actual A109, A110, A302, and approved FP2 underlays', () => {
    const proofRoot = new URL('../src/data/proofs/mvc-2plex-barrel-holdout/', import.meta.url);
    const proof = JSON.parse(fs.readFileSync(new URL('proof.json', proofRoot), 'utf8'));
    const digest = (name) => createHash('sha256').update(fs.readFileSync(new URL(name, proofRoot))).digest('hex');
    expect(proof).toMatchObject({ candidateCommitBeforeAnswerOpen: '3e824883', scoreReceiptSha256: score.receiptSha256, approvedAnswerSha256: answer.approvedAnswer.sha256, comparison: { candidateTargets: 2, approvedTargets: 0, falsePositiveTargets: 2, accepted: false }, visualReview: { actualPdfUnderlaysPresent: true, browserInspected: true, decodedImageCount: 4, brokenImageCount: 0, horizontalOverflow: false }, claimBoundary: { freshProjectPlacementVerified: false, complianceReady: false, fieldReleaseReady: false } });
    expect(proof.files).toHaveLength(4);
    for (const entry of proof.files) expect(digest(entry.file)).toBe(entry.sha256);
    const html = fs.readFileSync(new URL('index.html', proofRoot), 'utf8');
    expect(html).toContain('The actual PDFs caught two false sprinkler targets');
    expect(html).toContain('Actual A110 reflected ceiling PDF');
    expect(html).toContain('Actual approved FP2 fire sprinkler plan');
    expect(html).toContain('freshProjectPlacementVerified=false');
  });
});
