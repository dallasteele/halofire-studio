import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildMitRiversideBuildingJSourceCandidate, renderMitRiversideBuildingJSourceViews, validateMitRiversideBuildingJSource, validateMitRiversideBuildingJSourceCandidate, verifyMitRiversideBuildingJAdversarialLoop } from '../src/engine/mit-riverside-building-j-source-only-pitched-candidate.js';

const read = (name) => JSON.parse(fs.readFileSync(new URL(`../src/data/${name}`, import.meta.url), 'utf8'));
const sourceSeal = read('mit-riverside-building-j-source-seal.json');

describe('MIT Riverside Building J source-only pitched candidate', () => {
  it('binds independent source CAD while isolating prior Dugout H answer work and Building J answers', async () => {
    expect(await validateMitRiversideBuildingJSource(sourceSeal)).toMatchObject({ status: 'passed', sourceSealReady: true, pitchedHeadPlacementReady: false, complianceReady: false });
    expect(sourceSeal.sources).toHaveLength(8);
    expect(sourceSeal.answerKeyDenylist).toHaveLength(2);
    expect(sourceSeal.answerKeyDenylist.every((entry) => entry.openedForBuildingJBeforeSourceSeal === false)).toBe(true);
    expect(sourceSeal.sameProjectPriorScope).toMatchObject({ answerDerivedArtifactsExist: true, buildingJCoordinatesPresent: false });
  });

  it('replays the one-level scaled envelope, three source pitch regimes, and side-view datums', async () => {
    const packet = await buildMitRiversideBuildingJSourceCandidate(sourceSeal);
    expect(await validateMitRiversideBuildingJSourceCandidate(packet, sourceSeal)).toMatchObject({ status: 'passed', sourceCalibrationTargetReady: true, pitchedHeadPlacementReady: false, complianceReady: false });
    expect(packet.buildingModel.levels[0].scaledEnvelopeFt).toEqual({ width: 76.333333, depth: 100.166667 });
    expect(packet.buildingModel.roofPlanes.map((plane) => plane.riseInPer12)).toEqual([1.25, 0.5, 0.375]);
    expect(packet.buildingModel.roofPlanes[0].sourceDatumsFt).toEqual([17.083333, 19.916667, 23.333333]);
    expect(packet.exactFloorFootprintReady).toBe(false);
    expect(packet.heads3d).toHaveLength(0);
  });

  it('renders explicit top, elevation, and partial 3D source-only proof', async () => {
    const packet = await buildMitRiversideBuildingJSourceCandidate(sourceSeal);
    const views = renderMitRiversideBuildingJSourceViews(packet);
    expect(views.status).toBe('passed');
    expect(views.topSvg).toContain('1.25:12');
    expect(views.elevationSvg).toContain("17'-1, 19'-11, and 23'-4");
    expect(views.model3dSvg).toContain('connected sloped masses');
    expect(views.pitchedHeadPlacementReady).toBe(false);
  });

  it('rejects provenance, prior-scope leakage, geometry, head, and false-promotion attacks', async () => {
    const packet = await buildMitRiversideBuildingJSourceCandidate(sourceSeal);
    const result = await verifyMitRiversideBuildingJAdversarialLoop(packet, sourceSeal);
    expect(result).toMatchObject({ status: 'passed', attemptedCases: 16, pitchedHeadPlacementReady: false, complianceReady: false });
    expect(result.rejectedCases).toHaveLength(16);
  });

  it('does not import or read any MIT sprinkler answer artifact in the source-only generator', () => {
    const script = fs.readFileSync(new URL('../scripts/build-mit-riverside-building-j-source-only-pitched-candidate.mjs', import.meta.url), 'utf8');
    expect(script).not.toMatch(/approved-plan-set|as-built|hydraulic-registration|field-plan/i);
  });
});
