import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildMidvaleSourceOnlyCandidate,
  renderMidvaleSourceCandidateViews,
  validateMidvaleSourceOnlyCandidate,
  validateMidvaleSourceSeal,
  verifyMidvaleSourceCandidateAdversarialLoop,
} from '../src/engine/midvale-clubhouse-unseen-pitched-holdout.js';

const read = (name) => JSON.parse(fs.readFileSync(new URL(`../src/data/${name}`, import.meta.url), 'utf8'));
const sourceSeal = read('midvale-clubhouse-unseen-pitched-holdout.json');
const dillonPrior = read('dillon-pitched-placement-prior.json');
const candidate = read('midvale-clubhouse-source-only-pitched-candidate.json');
const dependencies = { sourceSeal, dillonPrior };

describe('Midvale Clubhouse fresh occupied-sloped-ceiling holdout', () => {
  it('seals four architectural sources while the stamped sprinkler answer remains unopened', async () => {
    expect(await validateMidvaleSourceSeal(sourceSeal)).toMatchObject({ status: 'passed', sourceSealReady: true, complianceReady: false });
    expect(sourceSeal.answerKeyDenylist).toHaveLength(1);
    expect(sourceSeal.answerKeyDenylist[0].openedBeforeSourceSeal).toBe(false);
    expect(sourceSeal.selection).toMatchObject({ status: 'source-sealed-answer-unopened', priorImplementationSearchHits: 0 });
  });

  it('distinguishes one dimension-closed Clubroom vault from unresolved sloped and flat-ceiling zones', async () => {
    expect(sourceSeal.sourceObservations.zoneRegistry.map((zone) => [zone.id, zone.classification, zone.placementEligible])).toEqual([
      ['clubroom-vault-zone', 'occupied-sloped-ceiling', true],
      ['community-work-room-sloped-zone', 'occupied-sloped-ceiling', false],
      ['gym-sloped-zone', 'occupied-sloped-ceiling', false],
      ['flat-admin-spa-support-zones', 'flat-occupied-ceilings', false],
    ]);
    expect(sourceSeal.sourceObservations.clubroomVault).toMatchObject({ riserRun: '6:12', springElevationFt: 12, peakElevationFt: 19.25, derivedWidthFt: 29, planWidthResidualIn: 0.75 });
  });

  it('replays the committed eight-head source-only candidate without pipes or downstream claims', async () => {
    expect(await buildMidvaleSourceOnlyCandidate(sourceSeal, dillonPrior)).toEqual(candidate);
    expect(await validateMidvaleSourceOnlyCandidate(candidate, dependencies)).toMatchObject({ status: 'passed', sourceCandidateReady: true, unseenProjectPlacementVerified: false, complianceReady: false });
    expect(candidate.geometry.ceiling).toMatchObject({ pitch: { riseIn: 6, runIn: 12 }, springElevationFt: 12, peakElevationFt: 19.25, halfRunFt: 14.5 });
    expect(candidate.heads3d).toHaveLength(8);
    expect(new Set(candidate.heads3d.map((head) => head.surfaceId)).size).toBe(2);
    expect(candidate.branchPipes3d).toEqual([]);
    expect(candidate.answerKeyOpened).toBe(false);
    expect(candidate.unseenProjectPlacementVerified).toBe(false);
    expect(candidate.complianceReady).toBe(false);
  });

  it('renders top, dimensional elevation, and partial 3D proof before answer comparison', () => {
    const views = renderMidvaleSourceCandidateViews(candidate);
    expect(views.topSvg).toContain("29'-0&quot; x 30'-0&quot;");
    expect(views.elevationSvg).toContain("12'-0&quot; springs; 19'-3&quot; ridge; two 6:12");
    expect(views.model3dSvg).toContain('partial 3D only');
  });

  it('rejects fourteen source, zone, roof, answer-leakage, and false-promotion mutations', async () => {
    const result = await verifyMidvaleSourceCandidateAdversarialLoop(candidate, dependencies);
    expect(result.status).toBe('passed');
    expect(result.rejectedCases).toHaveLength(14);
  });
});
