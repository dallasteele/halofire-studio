import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateMitRiversideBuildingJSourceUnderlayVisualProof, verifyMitRiversideBuildingJSourceUnderlayVisualProofAdversarialLoop } from '../src/engine/mit-riverside-building-j-source-underlay-visual-proof.js';

const proof = JSON.parse(fs.readFileSync(new URL('../src/data/proofs/mit-riverside-building-j-roof-plane-elevation/proof.json', import.meta.url), 'utf8'));

describe('MIT Riverside Building J source-underlay visual proof gate', () => {
  it('requires the actual protected roof plan and E/F section underlays', () => {
    expect(validateMitRiversideBuildingJSourceUnderlayVisualProof(proof)).toMatchObject({ status: 'passed', sourcePdfUnderlaysVisible: true, registeredHeadCount: 68, sourceRegistered3dReady: true, installedHeadElevationReady: false, complianceReady: false });
    expect(proof.roofPlan).toMatchObject({ sourcePage: 106, sourcePageIndex: 105, actualProtectedPdfUnderlayVisible: true, registeredHeadCount: 68, registeredCricketFaceCount: 4 });
    expect(proof.sections).toMatchObject({ sourcePage: 110, sourcePageIndex: 109, actualProtectedPdfUnderlayVisible: true, sourceProfiles: 4 });
    expect(proof.model3d).toMatchObject({ sourcePdfPlanProjectedInto3d: true, registrationAnchorCount: 4, roofSurfaceCount: 3, sourceProtectionTargetCount: 53, pendingPendentXyCount: 15 });
    expect(proof.rcpCeilingEnvelope).toMatchObject({ sourcePage: 105, sourcePageIndex: 104, actualProtectedPdfUnderlayVisible: true, ceilingZoneCount: 20, pendentCeilingPlaneCount: 15, aboveFinishedCeilingUprightCount: 7, exactInstalledHeadZReady: false });
  });

  it('rejects blank schematics, missing underlays, raster downgrades, and false promotions', () => {
    expect(verifyMitRiversideBuildingJSourceUnderlayVisualProofAdversarialLoop(proof)).toMatchObject({ status: 'passed', attemptedCases: 30, sourcePdfUnderlaysVisible: true, sourceRegistered3dReady: true, installedHeadElevationReady: false, complianceReady: false });
  });
});
