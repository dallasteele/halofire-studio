import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildMvcBarrelSourceOnlyCandidate,
  sealMvcBarrelHoldoutSource,
  validateMvcBarrelHoldoutSource,
  validateMvcBarrelSourceOnlyCandidate,
  verifyMvcBarrelCandidateAdversarialLoop,
} from '../src/engine/mvc-2plex-barrel-holdout.js';

const read = (name) => JSON.parse(fs.readFileSync(new URL(`../src/data/${name}`, import.meta.url), 'utf8'));
const source = read('mvc-2plex-barrel-holdout-source.json');
const candidate = read('mvc-2plex-barrel-holdout-candidate.json');

describe('MVC 2-Plex fresh cylindrical barrel-roof holdout', () => {
  it('seals the untouched architectural source while every completed answer stays unopened and unhashed', async () => {
    expect(await sealMvcBarrelHoldoutSource(source)).toEqual(source);
    expect(await validateMvcBarrelHoldoutSource(source)).toMatchObject({ status: 'passed', sourceRegistrationReady: true, freshProjectPlacementVerified: false, complianceReady: false });
    expect(source.answerKeyDenylist).toHaveLength(4);
    expect(source.answerKeyDenylist.every((entry) => entry.sha256 === null && entry.openedBeforeCandidateCommit === false)).toBe(true);
  });

  it('binds one 30 by 8 foot feature across A107, A109, A110, A302, and S1.3', () => {
    expect(source.curvedCeilingVolume.sourceRegistration).toMatchObject({ featureId: source.curvedCeilingVolume.id, plan: { page: 'A110', widthFt: 30, heightFt: 8, pdfBoundsPt: { width: 270, height: 72 } }, roof: { page: 'A109' }, rcp: { page: 'A110' }, section: { page: 'A302' }, structure: { page: 'S1.3', radiusIn: 462, chordIn: 414, arcLengthIn: 428, roofTrussSpacingIn: 24 } });
    expect(source.curvedCeilingVolume).toMatchObject({ radiusFt: 38.5, structuralChordFt: 34.5, interiorChordFt: 30, interiorCrownRiseFt: 3.042279 });
  });

  it('replays two symmetric source-only XY targets with curve normals and no invented installed elevation', async () => {
    expect(await buildMvcBarrelSourceOnlyCandidate(source)).toEqual(candidate);
    expect(await validateMvcBarrelSourceOnlyCandidate(candidate, source)).toMatchObject({ status: 'passed', sourceXyCandidateReady: true, freshProjectPlacementVerified: false, complianceReady: false });
    expect(candidate.gridAudit).toEqual({ widthFt: 30, depthFt: 8, areaSqFt: 240, columns: 2, rows: 1, targetCount: 2, maxAreaSqFt: 130, maxSpacingFt: 15 });
    expect(candidate.targets.map((target) => target.localFt)).toEqual([{ x: 7.5, y: 4 }, { x: 22.5, y: 4 }]);
    expect(candidate.targets.map((target) => target.sourceRoofSurfaceRelativeZFt)).toEqual([2.304694, 2.304694]);
    expect(candidate.targets.every((target) => target.kind === 'orientation-unresolved' && target.sourceProtectionPlaneZFt === null && target.headInstallationZFt === null)).toBe(true);
    expect(candidate.internalVerification).toMatchObject({ primary: { status: 'passed' }, crossSource: { status: 'passed' }, adversarial: { status: 'passed' } });
    expect(candidate.internalVerification).not.toHaveProperty('independent');
  });

  it('rejects every source, isolation, curve, placement, elevation, and false-promotion mutation', async () => {
    const result = await verifyMvcBarrelCandidateAdversarialLoop(candidate, source);
    expect(result).toMatchObject({ status: 'passed', attemptedCases: 17, complianceReady: false });
    expect(result.rejectedCases).toHaveLength(17);
  });
});
