import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  buildNewHopePitchedHoldoutScore,
  sealNewHopePitchedAnswerEvidence,
  validateNewHopePitchedAnswerEvidence,
  validateNewHopePitchedHoldoutScore,
  verifyNewHopePitchedScoreAdversarialLoop,
} from '../src/engine/new-hope-pitched-holdout-score.js';

const read = (name) => JSON.parse(fs.readFileSync(new URL(`../src/data/${name}`, import.meta.url), 'utf8'));
const source = read('new-hope-pitched-holdout-source.json');
const candidate = read('new-hope-pitched-holdout-candidate.json');
const answer = read('new-hope-pitched-holdout-answer-evidence.json');
const score = read('new-hope-pitched-holdout-score.json');

describe('New Hope fresh pitched-roof holdout score', () => {
  it('proves approved, field, and as-built answers were opened only after the frozen candidate commit', async () => {
    expect(await sealNewHopePitchedAnswerEvidence(answer)).toEqual(answer);
    expect(await validateNewHopePitchedAnswerEvidence(answer, candidate)).toMatchObject({ status: 'passed', answerEvidenceReady: true, freshProjectPlacementVerified: false, complianceReady: false });
    expect(answer.sequence).toEqual({ answerExposedAfterCandidateCommit: true, candidateCommitBeforeAnswerOpen: '58afdc14', candidateReceiptSha256: candidate.receiptSha256, candidateRetunedAfterAnswer: false });
  });

  it('records the 24-grid versus seven-ridge-head failure without retuning or promotion', async () => {
    expect(await buildNewHopePitchedHoldoutScore(candidate, source, answer)).toEqual(score);
    expect(await validateNewHopePitchedHoldoutScore(score, candidate, source, answer)).toMatchObject({ status: 'passed', accepted: false, freshProjectPlacementVerified: false, complianceReady: false });
    expect(score.score).toMatchObject({ candidateTargets: 24, approvedTargets: 7, truePositiveTargets: 0, falsePositiveTargets: 24, falseNegativeTargets: 7, precision: 0, recall: 0, exactCountMatch: false, exactXyMatch: false, topologyMatch: false });
    expect(score.acceptance).toMatchObject({ accepted: false, classification: 'fresh-holdout-failed-area-grid-instead-of-ridge-line-topology' });
  });

  it('uses system-owned primary, cross-source, and adversarial loops without an independent-review gate', () => {
    expect(score.internalVerification).toMatchObject({ primary: { status: 'passed' }, crossSource: { status: 'passed' }, adversarial: { status: 'passed' } });
    expect(score.internalVerification).not.toHaveProperty('independent');
  });

  it('rejects every score, sequence, topology, answer, and false-promotion mutation', async () => {
    const result = await verifyNewHopePitchedScoreAdversarialLoop(score, candidate, source, answer);
    expect(result).toMatchObject({ status: 'passed', attemptedCases: 19, complianceReady: false });
    expect(result.rejectedCases).toHaveLength(19);
  });

  it('binds browser-inspected actual source and approved PDF underlays', () => {
    const proofRoot = new URL('../src/data/proofs/new-hope-pitched-holdout/', import.meta.url);
    const proof = JSON.parse(fs.readFileSync(new URL('proof.json', proofRoot), 'utf8'));
    const digest = (name) => createHash('sha256').update(fs.readFileSync(new URL(name, proofRoot))).digest('hex');
    expect(proof).toMatchObject({ candidateCommitBeforeAnswerOpen: '58afdc14', scoreReceiptSha256: score.receiptSha256, approvedAnswerSha256: answer.approvedAnswer.sha256, comparison: { candidateTargets: 24, approvedTargets: 7, falsePositiveTargets: 24, falseNegativeTargets: 7, accepted: false }, visualReview: { actualPdfUnderlaysPresent: true, browserInspected: true, decodedImageCount: 4, brokenImageCount: 0, horizontalOverflow: false }, claimBoundary: { freshProjectPlacementVerified: false, complianceReady: false, fieldReleaseReady: false } });
    expect(proof.files).toHaveLength(4);
    for (const entry of proof.files) expect(digest(entry.file)).toBe(entry.sha256);
    const html = fs.readFileSync(new URL('index.html', proofRoot), 'utf8');
    expect(html).toContain('The actual PDFs reject the 24-head area grid');
    expect(html).toContain('Actual A103 roof-plan PDF with frozen candidate');
    expect(html).toContain('Actual approved FP2.0 with answer and candidate overlay');
    expect(html).toContain('freshProjectPlacementVerified=false');
  });
});
