import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildRegerFloresSourceOnlyCandidate, renderRegerFloresSourceCandidateViews, validateRegerFloresSourceOnlyCandidate, validateRegerFloresSourceSeal, verifyRegerFloresSourceCandidateAdversarialLoop } from '../src/engine/reger-flores-unseen-pitched-holdout.js';

const read = (name) => JSON.parse(fs.readFileSync(new URL(`../src/data/${name}`, import.meta.url), 'utf8'));
const sourceSeal = read('reger-flores-unseen-pitched-holdout.json'); const dillonPrior = read('dillon-pitched-placement-prior.json'); const dependencies = { sourceSeal, dillonPrior };

describe('Reger-Flores fresh unseen pitched holdout', () => {
  it('seals independent architecture and CAD while keeping the approved FP answer unopened', async () => {
    expect((await validateRegerFloresSourceSeal(sourceSeal)).status).toBe('passed');
    expect(sourceSeal.answerKeyDenylist[0].openedBeforeSourceSeal).toBe(false);
    expect(sourceSeal.selection).toMatchObject({ status: 'source-sealed-answer-unopened', priorImplementationSearchHits: 0 });
  });

  it('closes a two-plane vault from pitch, spring, peak, and plan dimensions', async () => {
    const packet = await buildRegerFloresSourceOnlyCandidate(sourceSeal, dillonPrior); const result = await validateRegerFloresSourceOnlyCandidate(packet, dependencies);
    expect(result.status).toBe('passed');
    expect(packet.geometry.room).toMatchObject({ widthFt: 18.5, lengthFt: 16, areaSqFt: 296 });
    expect(packet.geometry.ceiling).toMatchObject({ pitch: { riseIn: 4, runIn: 12 }, springElevationFt: 12.083333, peakElevationFt: 15.166667, halfRunFt: 9.25 });
    expect(packet.geometry.ceiling.dimensionClosure.roofPlaneUsedAsCeiling).toBe(false);
    expect(packet.heads3d).toHaveLength(2); expect(new Set(packet.heads3d.map((head) => head.surfaceId)).size).toBe(2);
    expect(packet.branchPipes3d).toEqual([]); expect(packet.branchPipeTopologyReady).toBe(false);
    expect(packet.answerKeyOpened).toBe(false); expect(packet.unseenProjectPlacementVerified).toBe(false); expect(packet.complianceReady).toBe(false);
  });

  it('renders top, dimensional elevation, and partial 3D proof before answer comparison', async () => {
    const views = renderRegerFloresSourceCandidateViews(await buildRegerFloresSourceOnlyCandidate(sourceSeal, dillonPrior));
    expect(views.topSvg).toContain("18'-6&quot; × 16'-0&quot;");
    expect(views.elevationSvg).toContain("12'-1&quot; spring · 15'-2&quot; peak · two 4:12 planes");
    expect(views.model3dSvg).toContain('partial building model');
  });

  it('rejects ten adversarial mutations including roof substitution and premature acceptance', async () => {
    const packet = await buildRegerFloresSourceOnlyCandidate(sourceSeal, dillonPrior); const result = await verifyRegerFloresSourceCandidateAdversarialLoop(packet, dependencies);
    expect(result.status).toBe('passed'); expect(result.rejectedCases).toHaveLength(11);
  });
});
