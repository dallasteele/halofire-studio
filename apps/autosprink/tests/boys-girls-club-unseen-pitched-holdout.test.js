import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildBoysGirlsClubSourceOnlyCandidate,
  renderBoysGirlsClubSourceCandidateViews,
  validateBoysGirlsClubSourceOnlyCandidate,
  validateBoysGirlsClubSourceSeal,
  verifyBoysGirlsClubAdversarialLoop,
} from '../src/engine/boys-girls-club-unseen-pitched-holdout.js';

const read = (name) => JSON.parse(fs.readFileSync(new URL(`../src/data/${name}`, import.meta.url), 'utf8'));
const sourceSeal = read('boys-girls-club-unseen-pitched-holdout.json');
const v4Corpus = read('pitched-placement-calibration-corpus-v4.json');
const dependencies = { sourceSeal, v4Corpus };

describe('Boys and Girls Club unseen pitched holdout', () => {
  it('seals both completed answers out of the source-only prediction', async () => {
    expect(await validateBoysGirlsClubSourceSeal(sourceSeal)).toMatchObject({ status: 'passed', sourceSealReady: true, complianceReady: false });
    expect(sourceSeal.answerKeyDenylist).toHaveLength(2);
    expect(sourceSeal.answerKeyDenylist.every((answer) => answer.openedBeforeSourceSeal === false)).toBe(true);
    expect(sourceSeal.selection.priorImplementationSearchHits).toBe(0);
  });

  it('records the blind v4 hypothesis but blocks out-of-envelope placement promotion', async () => {
    const packet = await buildBoysGirlsClubSourceOnlyCandidate(sourceSeal, v4Corpus);
    expect(await validateBoysGirlsClubSourceOnlyCandidate(packet, dependencies)).toMatchObject({ status: 'passed', blindTopologyRecorded: true, candidatePlacementReady: false, complianceReady: false });
    expect(packet.geometry.room).toMatchObject({ name: 'GYMNASIUM 106', lengthFt: 104, widthFt: 89.5, areaSqFt: 9308 });
    expect(packet.geometry.ceiling).toMatchObject({ pitch: { riseIn: 2, runIn: 12 }, springElevationFt: 25, ridgeElevationFt: 32.458333, halfRunFt: 44.75 });
    expect(packet.selectorResult).toMatchObject({ selectedProjectId: 'viviano-clubhouse-saratoga-springs-ut', distance: 30.887227, answerExposedPriorOnly: true, codeLimit: false });
    expect(packet.blindPrediction).toMatchObject({ alongRidgeStations: 3, acrossSlopeStations: 4, headCount: 12 });
    expect(packet.heads3d).toHaveLength(12);
    expect(packet.selectorApplicability).toMatchObject({ outOfEnvelope: true, productionPromotionAllowed: false, distanceThresholdDefinedByV4: false });
    expect(packet.answerKeyOpened).toBe(false);
    expect(packet.candidatePlacementReady).toBe(false);
    expect(packet.complianceReady).toBe(false);
  });

  it('renders top and elevation proof directly from the sealed geometry', async () => {
    const packet = await buildBoysGirlsClubSourceOnlyCandidate(sourceSeal, v4Corpus);
    const views = renderBoysGirlsClubSourceCandidateViews(packet);
    expect(views.status).toBe('passed');
    expect(views.topSvg).toContain('3 x 4 stations');
    expect(views.elevationSvg).toContain('2:12 - +25.00 ft eaves - +32.458 ft ridge');
    expect(views.candidatePlacementReady).toBe(false);
  });

  it('rejects provenance, leakage, geometry, tally, envelope, receipt, and false promotions', async () => {
    const packet = await buildBoysGirlsClubSourceOnlyCandidate(sourceSeal, v4Corpus);
    const result = await verifyBoysGirlsClubAdversarialLoop(packet, dependencies);
    expect(result).toMatchObject({ status: 'passed', attemptedCases: 12, candidatePlacementReady: false, complianceReady: false });
    expect(result.rejectedCases).toHaveLength(12);
  });
});
