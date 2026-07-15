import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  buildBlossomRockRegisteredCalibration,
  sealBlossomRockRegisteredCalibrationSource,
  validateBlossomRockRegisteredCalibration,
  validateBlossomRockRegisteredCalibrationSource,
  verifyBlossomRockRegisteredCalibrationAdversarialLoop,
} from '../src/engine/blossom-rock-registered-slope-calibration.js';

const read = (name) => JSON.parse(fs.readFileSync(new URL(`../src/data/${name}`, import.meta.url), 'utf8'));
const source = read('blossom-rock-registered-slope-calibration-input.json');
const model = read('blossom-rock-registered-slope-calibration.json');

describe('Blossom Rock answer-exposed registered slope calibration', () => {
  it('binds one feature identity across plan, roof, RCP, section, structure, and answer disclosure', async () => {
    expect(await sealBlossomRockRegisteredCalibrationSource(source)).toEqual(source);
    expect(await validateBlossomRockRegisteredCalibrationSource(source)).toMatchObject({ status: 'passed', sourceRegistrationReady: true, freshHoldoutEligible: false, complianceReady: false });
  });

  it('generates the completed four-by-two upright pattern on the exact A3.2 transform', async () => {
    expect(await buildBlossomRockRegisteredCalibration(source)).toEqual(model);
    expect(await validateBlossomRockRegisteredCalibration(model, source)).toMatchObject({ status: 'passed', registeredSourceModelReady: true, freshProjectPlacementVerified: false, complianceReady: false });
    expect(model.registrationAudit).toMatchObject({ status: 'passed', registeredVolumeIds: ['lake-pump-room-roof-3'] });
    expect(model.counts).toEqual({ total: 8, pendent: 0, upright: 8, unresolved: 0 });
    expect(model.exposedSlopedAudit[0]).toMatchObject({ columns: 4, rows: 2, widthFt: 39.944444, heightFt: 25.055556 });
    expect(model.internalVerification).toMatchObject({ primary: { status: 'passed' }, crossSource: { status: 'passed' }, adversarial: { status: 'passed' } });
    expect(model.internalVerification).not.toHaveProperty('independent');
  });

  it('keeps protection-plane, installed-head, clearance, hydraulics, compliance, and release elevations fail closed', () => {
    expect(model.targets.map((target) => target.sourceRoofSurfaceZFt)).toEqual([18.817709, 18.817709, 18.817709, 18.817709, 20.383681, 20.383681, 20.383681, 20.383681]);
    expect(model.targets.every((target) => target.sourceProtectionPlaneZFt === null && target.headInstallationZFt === null && target.sourceVerticalDatumStatus === 'unresolved-roof-assembly-purlin-and-branch-line-offset')).toBe(true);
    expect(model).toMatchObject({ registeredSourceModelReady: true, topViewReady: true, roofSurfaceElevationViewReady: true, threeDimensionalEnvelopeReady: true, answerExposedCalibrationReady: true, freshProjectPlacementVerified: false, exactHeadElevationReady: false, obstructionClearanceReady: false, hydraulicCalculationReady: false, complianceReady: false, fabricationReady: false, fieldReleaseReady: false });
  });

  it('rejects all registration, geometry, elevation, disclosure, and false-promotion mutations', async () => {
    const result = await verifyBlossomRockRegisteredCalibrationAdversarialLoop(model, source);
    expect(result).toMatchObject({ status: 'passed', attemptedCases: 18, complianceReady: false });
    expect(result.rejectedCases).toHaveLength(18);
  });

  it('binds browser-inspected actual-PDF top, roof, RCP, elevation, structure, answer, and 3D proof', () => {
    const proofRoot = new URL('../src/data/proofs/blossom-rock-registered-slope-calibration/', import.meta.url);
    const proof = JSON.parse(fs.readFileSync(new URL('proof.json', proofRoot), 'utf8'));
    const digest = (name) => createHash('sha256').update(fs.readFileSync(new URL(name, proofRoot))).digest('hex');
    expect(proof.modelReceiptSha256).toBe(model.receiptSha256);
    expect(proof.visualReview).toMatchObject({ browserInspected: true, decodedImageCount: 8, brokenImageCount: 0, normalZoomLayoutReadable: true, horizontalOverflow: false, actualPdfUnderlaysPresent: true, topViewReadable: true, roofPlanReadable: true, rcpViewReadable: true, elevationViewReadable: true, structuralMemberEvidenceReadable: true, threeDimensionalEnvelopeReadable: true, unresolvedElevationVisiblyDisclosed: true });
    expect(proof.calibration).toMatchObject({ registeredInteriorFt: { width: 39.944444, depth: 25.055556 }, roofSlope: '1.5:12', candidatePattern: { columns: 4, rows: 2, upright: 8 }, completedPattern: { columns: 4, rows: 2, upright: 8 }, countParity: true, kindParity: true, normalizedPatternParity: true, exactXyScoreAvailable: false, exactHeadElevationReady: false });
    expect(proof.claimBoundary).toMatchObject({ registeredSourceModelReady: true, topViewReady: true, roofSurfaceElevationViewReady: true, threeDimensionalEnvelopeReady: true, freshProjectPlacementVerified: false, exactHeadElevationReady: false, obstructionClearanceReady: false, hydraulicCalculationReady: false, complianceReady: false, fabricationReady: false, fieldReleaseReady: false });
    expect(proof.files).toHaveLength(8);
    for (const entry of proof.files) expect(digest(entry.file)).toBe(entry.sha256);
    const html = fs.readFileSync(new URL('index.html', proofRoot), 'utf8');
    expect(html).toContain('The corrected model now sits on the actual PDFs');
    expect(html).toContain('Top view on the actual A3.2 PDF.');
    expect(html).toContain('Elevation view on the actual A8.1 section.');
    expect(html).toContain('freshProjectPlacementVerified=false');
  });
});
