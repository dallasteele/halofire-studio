import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildPolarisSourceOnlyAtticCandidate, renderPolarisSourceCandidateViews, validatePolarisSourceOnlyAtticCandidate, validatePolarisSourceSeal, verifyPolarisSourceCandidateAdversarialLoop } from '../src/engine/polaris-academy-source-only-attic-holdout.js';

const read = (name) => JSON.parse(fs.readFileSync(new URL(`../src/data/${name}`, import.meta.url), 'utf8'));
const sourceSeal = read('polaris-academy-unseen-pitched-attic-holdout.json');
const v5Corpus = read('pitched-placement-calibration-corpus-v5.json');
const v4Corpus = read('pitched-placement-calibration-corpus-v4.json');
const dependencies = { sourceSeal, v5Corpus, v4Corpus };

describe('Polaris Academy source-only pitched attic holdout', () => {
  it('seals all architectural sources while denying fire-sprinkler CAD and completed plans', async () => {
    expect(await validatePolarisSourceSeal(sourceSeal)).toMatchObject({ status: 'passed', sourceSealReady: true, complianceReady: false });
    expect(sourceSeal.sources).toHaveLength(4);
    expect(sourceSeal.answerKeyDenylist).toHaveLength(5);
    expect(sourceSeal.answerKeyDenylist.every((entry) => entry.openedBeforeSourceSeal === false)).toBe(true);
  });

  it('replays the exact scaled floor extrusion and rejects the wrong occupied-vault domain', async () => {
    const packet = await buildPolarisSourceOnlyAtticCandidate(sourceSeal, v5Corpus, v4Corpus);
    expect(await validatePolarisSourceOnlyAtticCandidate(packet, dependencies)).toMatchObject({ status: 'passed', sourceBuildingModelReady: true, candidatePlacementReady: false, complianceReady: false });
    expect(packet.buildingModel.levels).toHaveLength(1);
    expect(packet.buildingModel.levels[0].footprintPolygonFt).toHaveLength(73);
    expect(packet.buildingModel.levels[0].footprintAreaSqFt).toBe(10655.197497);
    expect(packet.buildingModel.boundsFt).toMatchObject({ width: 178.041667, depth: 68.75 });
    expect(packet.buildingModel.pitchedAtticSection).toMatchObject({ pitch: { riseIn: 4, runIn: 12 }, relativeRidgeElevationFt: 11.458333, absoluteDatumReady: false, representativeSectionOnly: true });
    expect(packet.selectorGuard).toMatchObject({ status: 'passed', rejectionCode: 'PITCHED_SELECTOR_V5_UNCALIBRATED_GEOMETRY' });
    expect(packet.heads3d).toHaveLength(0);
    expect(packet.pitchedAtticHeadLayoutReady).toBe(false);
  });

  it('renders top, elevation, and 3D proof directly from the source model', async () => {
    const packet = await buildPolarisSourceOnlyAtticCandidate(sourceSeal, v5Corpus, v4Corpus);
    const views = renderPolarisSourceCandidateViews(packet);
    expect(views.status).toBe('passed');
    expect(views.topSvg).toContain('exact 73-vertex RCP-DWG outline');
    expect(views.elevationSvg).toContain('4:12 pitched attic');
    expect(views.model3dSvg).toContain('one exact floor footprint extruded');
    expect(views.candidatePlacementReady).toBe(false);
  });

  it('rejects provenance, leakage, geometry, wrong-domain, head fabrication, and promotion attacks', async () => {
    const packet = await buildPolarisSourceOnlyAtticCandidate(sourceSeal, v5Corpus, v4Corpus);
    const result = await verifyPolarisSourceCandidateAdversarialLoop(packet, dependencies);
    expect(result).toMatchObject({ status: 'passed', attemptedCases: 13, candidatePlacementReady: false, complianceReady: false });
    expect(result.rejectedCases).toHaveLength(13);
  });
});
