import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

const readData = (name) => JSON.parse(fs.readFileSync(new URL(`../src/data/${name}`, import.meta.url), 'utf8'));
const proofRoot = new URL('../src/data/proofs/new-hope-pitched-calibration/', import.meta.url);
const readProof = (name) => JSON.parse(fs.readFileSync(new URL(name, proofRoot), 'utf8'));
const digest = (name) => createHash('sha256').update(fs.readFileSync(new URL(name, proofRoot))).digest('hex');
const calibration = readData('new-hope-attic-specific-application-calibration.json');
const proof = readProof('proof.json');
const model = readProof('model.json');

describe('New Hope pitched-roof visual calibration proof', () => {
  it('separates the rejected 24-head holdout from the clean employee-facing calibration', () => {
    const html = fs.readFileSync(new URL('index.html', proofRoot), 'utf8');
    expect(proof.presentationBoundary).toEqual({ employeeFacingCalibrationContainsFailedCandidate: false, failed24HeadCandidateRetainedAsInternalHoldoutEvidence: true, answerExposedCalibration: true });
    expect(html).not.toContain('source-a103-candidate-overlay.png');
    expect(html).not.toContain('approved-fp20-comparison-overlay.png');
    expect(html).toContain('No failed 24-head area grid is shown as a design.');
  });

  it('binds actual A103, A301 elevation, approved FP2.0, and the approved feature texture by digest', () => {
    expect(proof.visualReview).toMatchObject({ actualPdfUnderlaysPresent: true, sourceA103Present: true, sourceA301ElevationPresent: true, approvedFp20Present: true, approvedFp20TextureUsedBy3dModel: true, browserInspected: true, decodedDomImageCount: 3, brokenImageCount: 0, webglModelReady: true, browserErrorCount: 0, horizontalOverflow: false });
    expect(proof.files).toHaveLength(5);
    for (const entry of proof.files) {
      expect(fs.statSync(new URL(entry.file, proofRoot)).size).toBe(entry.bytes);
      expect(digest(entry.file)).toBe(entry.sha256);
    }
  });

  it('replays the same two roof planes and seven ridge heads in plan and 3D without inventing Z', () => {
    expect(model.underlay).toMatchObject({ role: 'approved-answer-calibration-only', sheet: 'FP2.0', pdfPageNumber: 5, pdfSha256: proof.approvedFp20PdfSha256, featureSizeFt: { width: 43, depth: 60.75 } });
    expect(model.roof).toMatchObject({ widthFt: 43, depthFt: 60.75, ridgeCoordinateFt: 30.375, pitch: { rise: 4, run: 12 }, eaveZFt: 11.083333, ridgeZFt: 21.208333 });
    expect(model.roof.planes).toHaveLength(2);
    expect(model.heads.map((head) => ({ id: head.id, x: head.xFt, y: head.yFt }))).toEqual(calibration.heads.map((head) => ({ id: head.id, x: head.localFt.x, y: head.localFt.y })));
    expect(model.heads.every((head) => head.installationZFt === null && head.permittedZFt.min === 19.375 && head.permittedZFt.max === 19.875)).toBe(true);
  });

  it('keeps every engineering and release gate fail-closed and uses system-owned loops', () => {
    expect(model.verification).toEqual({ primary: 'deterministic model replay matches seven-head calibration data', crossSource: 'A103 and approved FP2.0 are both shown; S102/S301 and TFP610 bind structure and manufacturer rules', adversarial: 'exact-Z, obstruction, hydraulics, compliance, fabrication, and release remain fail-closed' });
    expect(model.verification).not.toHaveProperty('independent');
    expect(model.claims).toMatchObject({ answerExposedCalibration: true, freshProjectPlacementVerified: false, exactHeadElevationReady: false, obstructionClearanceReady: false, hydraulicCalculationReady: false, complianceReady: false, fabricationReady: false, fieldReleaseReady: false });
    expect(proof.claimBoundary).toEqual({ freshProjectPlacementVerified: false, exactHeadElevationReady: false, obstructionClearanceReady: false, hydraulicCalculationReady: false, complianceReady: false, fabricationReady: false, fieldReleaseReady: false });
  });
});
