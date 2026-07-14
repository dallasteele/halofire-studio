import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildPolarisSourceRoofAtticTopology, renderPolarisSourceRoofTopologyViews, resolvePolarisAtticCompartment, resolvePolarisSourceRoofFace, validatePolarisSourceRoofAtticTopology, verifyPolarisSourceRoofTopologyAdversarialLoop } from '../src/engine/polaris-academy-source-roof-attic-topology.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (name) => JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'data', name), 'utf8'));
const blindCandidate = read('polaris-academy-source-only-pitched-attic-candidate.json');
const sourceDependencies = { sourceSeal: read('polaris-academy-unseen-pitched-attic-holdout.json'), v5Corpus: read('pitched-placement-calibration-corpus-v5.json'), v4Corpus: read('pitched-placement-calibration-corpus-v4.json') };
const dependencies = { blindCandidate, sourceDependencies };

describe('Polaris source-only roof faces and attic compartments', () => {
  it('replays seven source roof masses into 28 four-in-twelve faces with complete footprint coverage', async () => {
    const topology = await buildPolarisSourceRoofAtticTopology(blindCandidate, sourceDependencies);
    expect(topology.planRegistration.pixelsPerFoot).toBe(10);
    expect(topology.planRegistration.maxResidualPx).toBeLessThanOrEqual(0.75);
    expect(topology.roofModel.massCount).toBe(7);
    expect(topology.roofModel.faceCount).toBe(28);
    expect(topology.roofModel.allFacesFourInTwelve).toBe(true);
    expect(topology.roofModel.coverage.coverageRatio).toBe(1);
    expect(topology.roofModel.continuousAtHalfFootResolution).toBe(true);
    expect(topology.wholeRoofFaceTopologyReady).toBe(false);
    expect(topology.absoluteRoofElevationReady).toBe(false);
    expect(topology.buildingExtrusion.sideViewsUsed).toEqual(['A4 physical page 9 building sections', 'A5 physical page 10 building sections']);
  });

  it('clips three draft-stop compartments that close exactly to the source footprint', async () => {
    const topology = await buildPolarisSourceRoofAtticTopology(blindCandidate, sourceDependencies);
    expect(topology.atticModel.draftStops.map((stop) => stop.xFt)).toEqual([52, 106.6]);
    expect(topology.atticModel.compartmentCount).toBe(3);
    expect(topology.atticModel.areaClosureResidualSqFt).toBeLessThanOrEqual(0.000002);
    expect(topology.atticCompartmentTopologyReady).toBe(true);
  });

  it('resolves immutable source roof faces and attic compartments without answer coordinates', async () => {
    const topology = await buildPolarisSourceRoofAtticTopology(blindCandidate, sourceDependencies);
    expect(resolvePolarisSourceRoofFace(topology, [20, 50])).toMatchObject({ massId: 'west-north', massKind: 'lower-hip' });
    expect(resolvePolarisAtticCompartment(topology, [20, 50])).toMatchObject({ id: 'attic-west' });
    expect(resolvePolarisSourceRoofFace(topology, [-1, -1])).toBeNull();
    expect(resolvePolarisAtticCompartment(topology, [-1, -1])).toBeNull();
    expect(resolvePolarisSourceRoofFace(topology, ['20', 50])).toBeNull();
  });

  it('keeps every sprinkler and downstream gate fail-closed', async () => {
    const topology = await buildPolarisSourceRoofAtticTopology(blindCandidate, sourceDependencies);
    expect(topology.sourceOnlyHeads3d).toEqual([]);
    expect(topology.sourceOnlyPipes3d).toEqual([]);
    expect(topology.answerKeyUsedForGeometry).toBe(false);
    expect(topology.sourceOnlyAtticPlacementReady).toBe(false);
    expect(topology.wholeRoofModelReady).toBe(false);
    expect(topology.freshProjectPlacementVerified).toBe(false);
    expect(topology.hydraulicCalculationReady).toBe(false);
    expect(topology.complianceReady).toBe(false);
    expect(topology.fabricationReady).toBe(false);
    expect(topology.fieldReleaseReady).toBe(false);
  });

  it('matches the committed generated artifact and renders top, elevation, and 3D proof', async () => {
    const generated = await buildPolarisSourceRoofAtticTopology(blindCandidate, sourceDependencies);
    const saved = read('polaris-academy-source-roof-attic-topology.json');
    expect(saved).toEqual(generated);
    expect((await validatePolarisSourceRoofAtticTopology(saved, dependencies)).status).toBe('passed');
    const views = renderPolarisSourceRoofTopologyViews(saved);
    expect(views.renderedFaceCount).toBe(28);
    expect(views.renderedCompartmentCount).toBe(3);
    expect(views.topSvg).toContain('No sprinkler coordinates used');
    expect(views.elevationSvg).toContain('lower bearing 10 ft');
    expect(views.model3dSvg).toContain('0 generated heads');
  });

  it('rejects all source, registration, topology, leakage, and false-promotion attacks', async () => {
    const topology = await buildPolarisSourceRoofAtticTopology(blindCandidate, sourceDependencies);
    const adversarial = await verifyPolarisSourceRoofTopologyAdversarialLoop(topology, dependencies);
    expect(adversarial.status).toBe('passed');
    expect(adversarial.rejectedCases).toHaveLength(adversarial.attemptedCases);
    expect(adversarial.attemptedCases).toBe(18);
  }, 30_000);

  it('does not import or read any sprinkler answer artifact in the source-only generator', () => {
    const engine = fs.readFileSync(path.join(ROOT, 'src', 'engine', 'polaris-academy-source-roof-attic-topology.js'), 'utf8');
    const generator = fs.readFileSync(path.join(ROOT, 'scripts', 'build-polaris-source-roof-attic-topology.mjs'), 'utf8');
    expect(engine).not.toMatch(/polaris-answer-extracted-evidence|polaris-pitched-attic-heldout-comparison|Fire Sprinkler CAD/i);
    expect(generator).not.toMatch(/polaris-answer-extracted-evidence|polaris-pitched-attic-heldout-comparison|Fire Sprinkler CAD/i);
  });
});
