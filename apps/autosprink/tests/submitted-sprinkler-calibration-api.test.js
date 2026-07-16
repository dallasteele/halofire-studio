import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { COOPERATIVE_1881_PROJECT_NAME } from '../src/data/floorplans.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 3297;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const PROJECT_PATH = `/api/projects/${encodeURIComponent(COOPERATIVE_1881_PROJECT_NAME)}`;
let server;
let tempDir;

function request(pathname, options = {}) {
  return fetch(`${BASE_URL}${pathname}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
}

async function waitForHealth() {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 10_000) {
    try {
      const response = await request('/api/health');
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('HaloFire API did not become healthy for submitted calibration tests');
}

async function tokenForAdmin() {
  const response = await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'calibration-admin', password: 'calibration-password' }),
  });
  expect(response.status).toBe(200);
  return (await response.json()).token;
}

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'halofire-submitted-calibration-api-'));
  server = spawn(process.execPath, ['src/api/server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      NODE_ENV: 'test',
      HALOFIRE_DB_PATH: path.join(tempDir, 'halofire.db'),
      JWT_SECRET: 'submitted-calibration-test-secret-over-32-chars',
      HALOFIRE_ADMIN_USER: 'calibration-admin',
      HALOFIRE_ADMIN_PASSWORD: 'calibration-password',
      HALOFIRE_ALLOW_DEV_DEFAULTS: '0',
      HALOFIRE_CORS_ORIGINS: 'http://allowed.test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForHealth();
});

afterAll(async () => {
  if (server && !server.killed) {
    server.kill();
    await new Promise((resolve) => server.once('exit', resolve));
  }
  fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe('AutoBid submitted sprinkler calibration API', () => {
  it('requires authentication', async () => {
    expect((await request(`${PROJECT_PATH}/submitted-sprinkler-calibration`)).status).toBe(401);
    expect((await request('/api/projects/Dillon%20Residence/submitted-sloped-ceiling-bluebeam.pdf')).status).toBe(401);
    expect((await request('/api/projects/Dillon%20Residence/submitted-sloped-ceiling-bluebeam.fdf')).status).toBe(401);
    expect((await request('/api/projects/Dillon%20Residence/floor-by-floor-model')).status).toBe(401);
    expect((await request('/api/projects/LDS%20Temple%20-%20Nashville%20TN/floor-by-floor-model')).status).toBe(401);
    expect((await request('/api/projects/Dillon%20Residence/completed-bid-geometry')).status).toBe(401);
    expect((await request('/api/projects/Dillon%20Residence/vertical-registration')).status).toBe(401);
    expect((await request('/api/projects/Dillon%20Residence/structural-roof-surfaces')).status).toBe(401);
    expect((await request('/api/evidence/completed-hydraulic-network-vertical')).status).toBe(401);
    expect((await request('/api/evidence/completed-active-hydraulic-plan-registration')).status).toBe(401);
    expect((await request('/api/evidence/completed-hydraulic-routed-plan-registration')).status).toBe(401);
    expect((await request('/api/evidence/completed-hydraulic-sized-3d-registration')).status).toBe(401);
    expect((await request('/api/evidence/winter-garden-pitched-hydraulic-registration')).status).toBe(401);
    expect((await request('/api/evidence/completed-pitched-hydraulic-registration')).status).toBe(401);
    expect((await request('/api/projects/LDS%20Meeting%20House%20-%20Winter%20Garden%20FL/pitched-roof-pipe-calibration')).status).toBe(401);
    expect((await request('/api/projects/LDS%20Meeting%20House%20-%20Winter%20Garden%20FL/pitched-roof-pipe-calibration-bluebeam.pdf')).status).toBe(401);
    expect((await request('/api/projects/TCOJC%20Temple%20-%20Dallas%20TX/completed-pitched-attic-bluebeam.fdf')).status).toBe(401);
  });

  it('serves a deterministic Bluebeam FDF overlay for the sealed Dallas FP-1.4 subset', async () => {
    const token = await tokenForAdmin();
    const response = await request('/api/projects/TCOJC%20Temple%20-%20Dallas%20TX/completed-pitched-attic-bluebeam.fdf', { headers: { Authorization: `Bearer ${token}` } });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/vnd.fdf');
    expect(response.headers.get('x-halofire-artifact-sha256')).toMatch(/^[0-9a-f]{64}$/);
    expect(response.headers.get('x-halofire-evidence-receipt-sha256')).toBe('12c7bdc2292c736b20c50b54ca23e3d37df28c168c81a0dd31feb8160738c7cd');
    const raw = await response.text();
    expect(raw.startsWith('%FDF-1.2')).toBe(true);
    expect((raw.match(/\/Subj \(Registered operating sprinkler\)/g) || [])).toHaveLength(9);
    expect((raw.match(/\/Subj \(Registered 2 inch pitched-attic branch\)/g) || [])).toHaveLength(8);
  });

  it('serves the two-project completed hydraulic-network vertical calibration', async () => {
    const token = await tokenForAdmin();
    const response = await request('/api/evidence/completed-hydraulic-network-vertical', { headers: { Authorization: `Bearer ${token}` } });
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result).toMatchObject({
      status: 'passed', projectCount: 2,
      counts: { nodes: 99, pipes: 98, activeSprinklerNodes: 34, planMappedNodes: 24 },
      featurePromotion: { hydraulic_network_vertical_geometry: { ready: true, projectCount: 2, projects: ['mit-riverside-dugout-h', 'nashville-tn-temple'] } },
      planNodeCoordinateMappingReady: false,
      wholeBuildingNetworkElevationReady: false,
      exactAsBuiltDeflectorElevationReady: false,
      fabricationReady: false,
      complianceReady: false,
    });
    expect(result.projects).toHaveLength(2);
    expect(result.projects[0].nodes).toHaveLength(31);
    expect(result.projects[0].pipes).toHaveLength(30);
    expect(result.projects[0].elevationViewSvg).toContain('report Z exact; X topological');
  });

  it('serves the two-project active hydraulic sprinkler plan registration', async () => {
    const token = await tokenForAdmin();
    const response = await request('/api/evidence/completed-active-hydraulic-plan-registration', { headers: { Authorization: `Bearer ${token}` } });
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result).toMatchObject({
      status: 'passed', projectCount: 2,
      counts: { activeSprinklerNodes: 26, runChecks: 19 },
      featurePromotion: { active_hydraulic_sprinkler_plan_registration: { ready: true, projectCount: 2, projects: ['mit-riverside-dugout-h', 'sierra-marana-di-mezzanine'] } },
      fullHydraulicPlanRegistrationReady: false,
      wholeBuildingNetworkElevationReady: false,
      exactAsBuiltDeflectorElevationReady: false,
      fabricationReady: false,
      complianceReady: false,
    });
    expect(result.projects[0].nodes).toHaveLength(15);
    expect(result.projects[1].nodes).toHaveLength(11);
    expect(result.projects[0].views.planSvg).toContain('exact plan anchors');
  });

  it('serves two-project inactive junction and routed branch-plan registration', async () => {
    const token = await tokenForAdmin();
    const response = await request('/api/evidence/completed-hydraulic-routed-plan-registration', { headers: { Authorization: `Bearer ${token}` } });
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result).toMatchObject({
      status: 'passed', projectCount: 2,
      counts: { registeredNodes: 40, inactiveJunctions: 14, registeredPipes: 38, scaledLengthChecks: 31, topologyOnlyPipes: 4, samePlanAnchorVerticalPipes: 3 },
      featurePromotion: { on_plan_hydraulic_routed_registration: { ready: true, projectCount: 2, projects: ['mit-riverside-dugout-h', 'sierra-marana-di-mezzanine'] } },
      fullHydraulicPlanRegistrationReady: false, wholeBuildingNetworkElevationReady: false,
      exactAsBuiltDeflectorElevationReady: false, fabricationReady: false, complianceReady: false,
    });
    expect(result.projects[0].nodes).toHaveLength(21);
    expect(result.projects[1].nodes).toHaveLength(19);
    expect(result.projects[0].pipes).toHaveLength(20);
    expect(result.projects[1].pipes).toHaveLength(18);
    expect(result.adversarialLoops.every((loop) => loop.status === 'passed')).toBe(true);
  });

  it('serves two-project hydraulic inside-diameter 3D edge registration', async () => {
    const token = await tokenForAdmin();
    const response = await request('/api/evidence/completed-hydraulic-sized-3d-registration', { headers: { Authorization: `Bearer ${token}` } });
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result).toMatchObject({
      status: 'passed', projectCount: 2,
      counts: { registeredNodes: 26, registeredEdges: 23, verticalEdges: 3, diameterObservations: 23 },
      featurePromotion: { hydraulic_inside_diameter_3d_edge_registration: { ready: true, projectCount: 2, projects: ['mit-riverside-dugout-h', 'gmr-ambulance-center-payson'] } },
      nominalPipeSizeReady: false, fullHydraulicPlanRegistrationReady: false, fabricationCutLengthReady: false,
      wholeBuildingNetworkElevationReady: false, exactAsBuiltDeflectorElevationReady: false, complianceReady: false,
    });
    expect(result.projects[0].edges).toHaveLength(20);
    expect(result.projects[1].edges).toHaveLength(3);
    expect(result.projects[1].diameterClasses).toEqual([1.101, 1.598]);
    expect(result.projects[0].views.sideSvg).toContain('not nominal size');
    expect(result.adversarialLoops.every((loop) => loop.status === 'passed')).toBe(true);
  });

  it('serves the completed Winter Garden pitched-row hydraulic registration', async () => {
    const token = await tokenForAdmin();
    const response = await request('/api/evidence/winter-garden-pitched-hydraulic-registration', { headers: { Authorization: `Bearer ${token}` } });
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result).toMatchObject({
      status: 'passed', projectId: 'winter-garden-meetinghouse',
      counts: { pitchedRows: 3, completedChapelHeads: 15, fabricationMappedHeads: 15, operatingHydraulicSprinklers: 17, hydraulicInsideDiameterClasses: 6 },
      acceptanceLoops: { primary: { status: 'passed' }, independent: { status: 'passed' }, adversarial: { status: 'passed' } },
      pitchedRowHydraulicDatumRegistrationReady: true, operatingSprinklerHydraulicEvidenceReady: true, hydraulicInsideDiameterReportEvidenceReady: true,
      perHeadHydraulicIdentityReady: false, nominalPipeSizeReady: false, fullNetworkPipeElevationReady: false,
      exactAsBuiltDeflectorElevationReady: false, fabricationReady: false, complianceReady: false,
    });
    expect(result.maximumRowElevationResidualIn).toBeCloseTo(0.04, 8);
    expect(result.operatingSprinklers).toHaveLength(17);
    expect(result.branchPipes3d).toHaveLength(3);
    expect(result.views.hydraulicDatumSvg).toContain('no per-head node identity');
    expect(Object.entries(result.acceptanceLoops.adversarial).filter(([name]) => name !== 'status').every(([, rejected]) => rejected)).toBe(true);
  });

  it('serves the two-project pitched-hydraulic portfolio without promoting Dallas-only claims', async () => {
    const token = await tokenForAdmin();
    const response = await request('/api/evidence/completed-pitched-hydraulic-registration', { headers: { Authorization: `Bearer ${token}` } });
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result).toMatchObject({
      status: 'passed', projectCount: 2, projectIds: ['dallas-temple-pitched-attic', 'winter-garden-meetinghouse'],
      featurePromotion: {
        pitched_hydraulic_geometry_registration: { ready: true, projectCount: 2 },
        completed_pitched_hydraulic_reference: { ready: true, projectCount: 2 },
        per_head_pitched_hydraulic_identity: { ready: false, projectCount: 1 },
        mapped_pitched_branch_nominal_size: { ready: false, projectCount: 1 },
        generated_pitched_design_compliance: { ready: false, projectCount: 0 },
      },
      acceptanceLoops: { primary: { status: 'passed' }, independent: { status: 'passed' }, adversarial: { status: 'passed' } },
      generatedDesignComplianceReady: false, complianceReady: false,
    });
    expect(result.projects[0].counts).toEqual({ mappedActiveHeads: 9, mappedBranchPipes: 8, elevationClasses: 2 });
    expect(result.projects[0].maximumPlanToReportLengthResidualFt).toBe(0);
    expect(result.projects[0].historicalReview.reviewedForApplicableCodesAndStandards).toBe(true);
    expect(result.projects[0].model3d.heads3d).toHaveLength(9);
    expect(result.projects[0].views.topSvg).toContain('A9');
    expect(Object.entries(result.acceptanceLoops.adversarial).filter(([name]) => name !== 'status').every(([, rejected]) => rejected)).toBe(true);
  });

  it('serves registered speckled roof contours without inventing 3D planes', async () => {
    const token = await tokenForAdmin();
    const response = await request('/api/projects/Dillon%20Residence/structural-roof-surfaces', { headers: { Authorization: `Bearer ${token}` } });
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.status).toBe('passed');
    expect(result.counts).toMatchObject({ rejectedRecessFloorTriangles: 48, sourceSpeckleStrokes: 63267, sourceSpeckleContours: 15, registeredRoofFacePatches: 11, registeredPitchLinkedRoofContours: 0, structurallyResolvedPlanes: 0 });
    expect(result.model.footprints).toHaveLength(11);
    expect(result.model.footprints.every((footprint) => footprint.render3d === false && footprint.datumAssociationStatus === 'unlinked')).toBe(true);
    expect(result.model.surfaces3d).toEqual([]);
    expect(result.topView.svg).toContain('11 registered speckled slope-roof contours');
    expect(result.sourceControls[0].slopeRoofLegendText).toBe('HATCH AREA INDICATES SLOPE ROOF');
    expect(result.completeRoofPlanes).toBe(false);
    expect(result.complianceReady).toBe(false);
  });

  it('serves only source-supported 3D sprinkler Z and omits unresolved elements', async () => {
    const token = await tokenForAdmin();
    const response = await request('/api/projects/Dillon%20Residence/vertical-registration', { headers: { Authorization: `Bearer ${token}` } });
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.status).toBe('passed');
    expect(result.counts).toEqual({ totalHeads: 76, sourceAssignedHeads: 5, unresolvedHeads: 71, totalPipeSegments: 67, sourceAssignedPipeSegments: 3, unresolvedPipeSegments: 64 });
    expect(result.model3d.heads).toHaveLength(5);
    expect(result.model3d.pipes).toHaveLength(3);
    expect(result.limitations.join(' ')).toContain('annotation proximity alone is rejected');
    expect(result.elevationView.svg).toContain('unresolved elements are omitted');
    expect(result.complete).toBe(false);
    expect(result.complianceReady).toBe(false);
  });

  it('serves per-sheet completed bid heads and pipe vectors registered to the actual DWGs', async () => {
    const token = await tokenForAdmin();
    const response = await request('/api/projects/Dillon%20Residence/completed-bid-geometry', { headers: { Authorization: `Bearer ${token}` } });
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.status).toBe('passed');
    expect(result.counts).toEqual({ declaredHeads: 77, detectedHeads: 76, unresolvedHeads: 1, pipeSegments: 67 });
    expect(result.sheets[0].schedule).toMatchObject({ declaredTotal: 52, detected: { total: 51 }, complete: false, unresolvedCount: 1 });
    expect(result.sheets[1].schedule).toMatchObject({ declaredTotal: 25, detected: { total: 25 }, complete: true, unresolvedCount: 0 });
    expect(result.views.planViews[0].svg).toContain('51/52 heads');
    expect(result.views.planViews[1].svg).toContain('25/25 heads');
    expect(result.verticalGeometryReady).toBe(false);
    expect(result.complianceReady).toBe(false);
  });

  it('serves the sealed source-DWG floor-by-floor model and views', async () => {
    const token = await tokenForAdmin();
    const response = await request('/api/projects/Dillon%20Residence/floor-by-floor-model', { headers: { Authorization: `Bearer ${token}` } });
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.status).toBe('passed');
    expect(result.receiptSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.counts).toEqual({ levels: 3, wallSolids: 563, sourceEntities: 13225 });
    expect(result.model.levels.map((level) => level.projectFloorElevationFt)).toEqual([1524.5, 1537, 1503]);
    expect(result.model.levels[2].coordinateFrame).toBe('toy-garage-local');
    expect(result.views.topViews).toHaveLength(3);
    expect(result.views.elevationSvg).toContain('exterior elevation sheet absent');
    expect(result.views.isometricSvg).toContain('extruded floor by floor');
    expect(result.geometryGrounded).toBe(true);
    expect(result.complianceReady).toBe(false);
  });

  it('serves the Nashville A110/A131.1 floor-by-floor model registered to A301 and sprinkler outputs', async () => {
    const token = await tokenForAdmin();
    const response = await request('/api/projects/LDS%20Temple%20-%20Nashville%20TN/floor-by-floor-model', { headers: { Authorization: `Bearer ${token}` } });
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.status).toBe('passed');
    expect(result.receiptSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.counts).toEqual({ levels: 2, extrusionSolids: 2, independentlyRegisteredPlanViews: 5 });
    expect(result.model.levels.map((level) => [level.sourceSheetId, level.floorElevationFt])).toEqual([
      ['A110', 100],
      ['A131.1', 108.78125],
    ]);
    expect(result.extrusion.solids).toHaveLength(2);
    expect(result.views.isometricSvg).toContain('2 sealed extrusion solids');
    expect(result.views.elevationSvg).toContain('A301 section-controlled stack');
    expect(result.model.registrations.map((entry) => entry.target)).toEqual([
      'A110 plan feet',
      'F102 Level 02 fire-protection plan',
      'as-built FP2 main-level grid',
    ]);
    expect(result.geometryGrounded).toBe(true);
    expect(result.complianceReady).toBe(false);
  });

  it('returns registered FP-8 top/elevation evidence with a non-roof protection basis', async () => {
    const token = await tokenForAdmin();
    const response = await request(`${PROJECT_PATH}/submitted-sprinkler-calibration`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.status).toBe('passed');
    expect(result.counts).toEqual({ heads: 297, pipeSegments: 254, hydraulicNodes: 17, pitchedRoofNodes: 0 });
    expect(result.protectionBasis).toMatchObject({
      roofForm: 'source-bound-pitched-roof',
      submittedLevel8Mode: 'flat-ceiling-and-sky-balcony-reference',
      projectLevel8LayoutMayBeBlindlyProjectedToRoof: false,
      atticSprinklerRequirementEstablished: false,
    });
    expect(result.roofRelations).toHaveLength(17);
    expect(result.views.topSvg).toContain('Submitted FP-8 registered top view');
    expect(result.views.elevationSvg).toContain('Submitted DA-3 registered elevation view');
    expect(result.complianceReady).toBe(false);
    expect(result.claimStatus).toBe('completed-bid-calibration-validated-not-code-compliance-or-approval');
  });

  it('does not substitute another project into the Cooperative calibration', async () => {
    const token = await tokenForAdmin();
    const response = await request('/api/projects/Unknown/submitted-sprinkler-calibration', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(response.status).toBe(404);
    expect((await response.json()).error).toBe('submitted_calibration_not_found');
  });

  it('serves the authenticated Dillon 3:12 completed-bid calibration without claiming compliance', async () => {
    const token = await tokenForAdmin();
    const response = await request('/api/projects/Dillon%20Residence/submitted-sloped-ceiling-calibration', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.status).toBe('passed');
    expect(result.counts.submittedScheduleHeads).toBe(52);
    expect(result.counts).toMatchObject({ vectorCandidates: 51, fp1VectorCandidates: 51, fp2ContinuationCandidates: 0, unresolvedHeadSymbols: 1 });
    expect(result.coverage.complete).toBe(false);
    expect(result.coverage.detectedVectorCandidates).toBe(51);
    expect(result.coverage.unresolved[0]).toContain('FP-2 is a separate 25-head upper-level schedule');
    expect(result.continuationHeads).toEqual([]);
    expect(result.counts.positiveAnnotationProximityMatches).toBeGreaterThanOrEqual(3);
    expect(result.slopeEvidenceReady).toBe(true);
    expect(result.fullSlopeSurfaceRegistrationReady).toBe(true);
    expect(result.generatedLayoutParityReady).toBe(true);
    expect(result.parityMetrics).toMatchObject({ precision: 1, recall: 1 });
    expect(result.generatedHeads).toHaveLength(2);
    expect(result.model3dVerification).toMatchObject({ status: 'passed', geometryGrounded: true, absoluteElevationReady: true, complianceReady: false });
    expect(result.parityMetrics.maxPlanErrorFt).toBeLessThanOrEqual(3);
    expect(result.model3dVerification.counts).toEqual({ surfaces: 4, heads: 2, pipes: 1, nonFlatHeadElevations: 2, hydraulicNodesJoined: 5 });
    expect(result.model3dVerification).toMatchObject({ hydraulicDatumJoined: true, protectedRegionHeadNodeMappingReady: false });
    expect(result.crossProjectEvidence.receiptSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.crossProjectEvidence.metrics).toMatchObject({ projectCount: 4, pitchedProjectCount: 3, dallasPitchMeanInPer12: 8.5195, dallasSectionRiseFt: 12.84375, winterGardenPitchInPer12: 4.5 });
    expect(result.crossProjectEvidence.calibrationCases).toHaveLength(3);
    expect(result.crossProjectEvidence.calibrationCases.map((entry) => entry.id)).toEqual(['dillon-vector-3-12', 'dallas-scanned-section-steep-roof', 'winter-garden-vector-4.5-12']);
    expect(result.hydraulicDatumJoin.activeNodes).toHaveLength(5);
    expect(result.complianceReady).toBe(false);
    expect(result.view.submittedTopSvg).toContain('Dillon submitted FP-1 heads registered to RCP 3:12 annotation screens');
    expect(result.view.generatedTopSvg).toContain('Generated Dillon slope-aware top view');
    expect(result.view.generatedElevationSvg).toContain('Generated Dillon 3:12 absolute project elevation view');
    expect(result.view.generatedElevationSvg).toContain('source-bound-project-elevation');
  });

  it('serves the Winter Garden completed-bid pitched-roof head and connected pipe topology through AutoBid', async () => {
    const token = await tokenForAdmin();
    const response = await request('/api/projects/LDS%20Meeting%20House%20-%20Winter%20Garden%20FL/pitched-roof-pipe-calibration', { headers: { Authorization: `Bearer ${token}` } });
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.status).toBe('passed');
    expect(result.evidenceReceipts).toMatchObject({ crossProject: expect.stringMatching(/^[0-9a-f]{64}$/), heads: expect.stringMatching(/^[0-9a-f]{64}$/), roofRegistration: expect.stringMatching(/^[0-9a-f]{64}$/), pipeRegistration: expect.stringMatching(/^[0-9a-f]{64}$/), ceilingElevation: expect.stringMatching(/^[0-9a-f]{64}$/), fabricationPlanMapping: expect.stringMatching(/^[0-9a-f]{64}$/), pitchedHydraulicRegistration: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(result.acceptanceLoops).toMatchObject({ primary: { status: 'passed', headCount: 159 }, independent: { status: 'passed', headCount: 158 }, activeHydraulicPlan: { status: 'passed', projectCount: 2, activeNodeCount: 26, independentRunChecks: 19, scope: 'active-calculation-sprinklers-only' }, hydraulicRoutedPlan: { status: 'passed', projectCount: 2, registeredNodeCount: 40, inactiveJunctionCount: 14, registeredPipeCount: 38, independentLengthChecks: 31, topologyOnlyPipeCount: 4, scope: 'hydraulically-calculated-floor-plan-branch-graph-only' }, adversarial: { status: 'passed', centerRemovedTemplateRejected: true, sourceSubstitutionRejected: true, archiveProjectSubstitutionRejected: true, duplicateProjectSubstitutionRejected: true, spatialMappingReceiptDriftRejected: true, crossProjectFlatRoofSubstitutionRejected: true, hydraulicElevationResealRejected: true, hydraulicTopologyDisconnectRejected: true, activeHydraulicPlanReceiptDriftRejected: true, duplicateActiveHydraulicProjectRejected: true, inactiveNodePromotionRejected: true, verifiedInactiveJunctionPromotionAccepted: true, routedPlanReceiptDriftRejected: true, routedPlanRouteEndpointDriftRejected: true, routedPlanTopologyAsLengthSubstitutionRejected: true, registrationDriftRejected: true, disconnectedTopologyRejected: true, wrongOutletFamilyRejected: true, outletSequenceSubstitutionRejected: true, manufacturerCutSheetDriftRejected: true } });
    expect(result.acceptanceLoops.activeHydraulicPlan.maximumResidualFt).toBeLessThanOrEqual(0.75);
    expect(result.crossProjectEvidence.metrics).toMatchObject({ projectCount: 4, pitchedProjectCount: 3, winterGardenPitchInPer12: 4.5 });
    expect(result.completedProjectEvidencePortfolio).toMatchObject({
      status: 'passed',
      projectCount: 4,
      projectIds: ['dallas-tx-temple', 'nashville-tn-temple', 'tallahassee-fl-temple', 'winter-garden-fl-meetinghouse'],
      featurePromotion: {
        as_built_feedback_loop: { ready: true, projectCount: 3 },
        completed_output_to_fabrication: { ready: true, projectCount: 3 },
        manufacturer_family_trace: { ready: true, projectCount: 3 },
        roof_structure_coordination: { ready: true, projectCount: 2 },
        multi_floor_completed_output: { ready: true, projectCount: 2 },
        source_to_completed_sprinkler_layout: { ready: true, projectCount: 2 },
        pitched_roof_fabrication_spatial_mapping: { ready: true, projectCount: 2, projects: ['winter-garden-fl-meetinghouse', 'dallas-tx-temple'] },
      },
    });
    expect(result.completedHydraulicNetworkVerticalPortfolio).toMatchObject({
      status: 'passed', projectCount: 2,
      counts: { nodes: 99, pipes: 98, activeSprinklerNodes: 34, planMappedNodes: 24 },
      featurePromotion: { hydraulic_network_vertical_geometry: { ready: true, projectCount: 2, projects: ['mit-riverside-dugout-h', 'nashville-tn-temple'] } },
      planNodeCoordinateMappingReady: false,
      wholeBuildingNetworkElevationReady: false,
      exactAsBuiltDeflectorElevationReady: false,
    });
    expect(result.completedActiveHydraulicPlanPortfolio).toMatchObject({
      status: 'passed', projectCount: 2,
      counts: { activeSprinklerNodes: 26, runChecks: 19 },
      featurePromotion: { active_hydraulic_sprinkler_plan_registration: { ready: true, projectCount: 2, projects: ['mit-riverside-dugout-h', 'sierra-marana-di-mezzanine'] } },
      fullHydraulicPlanRegistrationReady: false,
      wholeBuildingNetworkElevationReady: false,
      exactAsBuiltDeflectorElevationReady: false,
    });
    expect(result.completedHydraulicRoutedPlanPortfolio).toMatchObject({
      status: 'passed', projectCount: 2,
      counts: { registeredNodes: 40, inactiveJunctions: 14, registeredPipes: 38, scaledLengthChecks: 31, topologyOnlyPipes: 4, samePlanAnchorVerticalPipes: 3 },
      featurePromotion: { on_plan_hydraulic_routed_registration: { ready: true, projectCount: 2, projects: ['mit-riverside-dugout-h', 'sierra-marana-di-mezzanine'] } },
      fullHydraulicPlanRegistrationReady: false,
      wholeBuildingNetworkElevationReady: false,
      exactAsBuiltDeflectorElevationReady: false,
    });
    expect(result.counts).toEqual({ completedBidFp3Heads: 159, chapelHeads: 15, chapelBranches: 3, chapelArmOvers: 15, networkSegments: 23, absoluteCeilingSurfaces: 2, headElevationEnvelopes: 15, fabricationMappedHeads: 15, exactBranchRowPipes: 3, pitchedHydraulicRows: 3, operatingHydraulicSprinklers: 17, hydraulicInsideDiameterClasses: 6 });
    expect(result.headPlaneAssignments).toHaveLength(15);
    expect(result.pipeNetwork).toHaveLength(23);
    expect(result.model3dEnvelope).toMatchObject({ status: 'passed', ceilingSurfaceElevationReady: true, fabricationPlanMappingReady: true, branchRowPipeElevationReady: true, manufacturerInstallationEnvelopeReady: true, exactAsBuiltDeflectorElevationReady: false, fullNetworkPipeElevationReady: false, model3dEnvelopeReady: true });
    expect(result.model3dEnvelope.ceilingSurfaces).toHaveLength(2);
    expect(result.model3dEnvelope.headEnvelopes).toHaveLength(15);
    expect(result.fabricationMappings).toHaveLength(15);
    expect(result.model3dEnvelope.branchPipes3d).toHaveLength(3);
    expect(result.views.topSvg).toContain('15 SprinkCad 1-inch takeoffs');
    expect(result.views.elevationSvg).toContain('TFP181 3/16-11/16 in');
    expect(result.views.hydraulicDatumSvg).toContain('no per-head node identity');
    expect(result.pitchedHydraulicRegistration.rowJoins).toHaveLength(3);
    expect(result.acceptanceLoops.pitchedHydraulicPrimary).toMatchObject({ status: 'passed', operatingSprinklerCount: 17 });
    expect(result.acceptanceLoops.pitchedHydraulicIndependent.status).toBe('passed');
    expect(result.acceptanceLoops.pitchedHydraulicAdversarial.status).toBe('passed');
    expect(result.ceilingSurfaceElevationReady).toBe(true);
    expect(result.model3dEnvelopeReady).toBe(true);
    expect(result.pitchedRowHydraulicDatumRegistrationReady).toBe(true);
    expect(result.operatingSprinklerHydraulicEvidenceReady).toBe(true);
    expect(result.hydraulicInsideDiameterReportEvidenceReady).toBe(true);
    expect(result.perHeadHydraulicIdentityReady).toBe(false);
    expect(result.fabricationPlanMappingReady).toBe(true);
    expect(result.branchRowPipeElevationReady).toBe(true);
    expect(result.manufacturerInstallationEnvelopeReady).toBe(true);
    expect(result.hydraulicNetworkVerticalGeometryReady).toBe(true);
    expect(result.activeHydraulicPlanRegistrationReady).toBe(true);
    expect(result.onPlanHydraulicRoutedRegistrationReady).toBe(true);
    expect(result.fullHydraulicPlanRegistrationReady).toBe(false);
    expect(result.pipeSizesReady).toBe(false);
    expect(result.absoluteDeflectorDatumReady).toBe(false);
    expect(result.projectionReady).toBe(false);
    expect(result.complianceReady).toBe(false);
  });

  it('downloads the Winter Garden two-page Bluebeam top/elevation envelope', async () => {
    const token = await tokenForAdmin();
    const response = await request('/api/projects/LDS%20Meeting%20House%20-%20Winter%20Garden%20FL/pitched-roof-pipe-calibration-bluebeam.pdf', { headers: { Authorization: `Bearer ${token}` } });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/pdf');
    expect(response.headers.get('content-disposition')).toContain('Winter-Garden-pitched-ceiling-envelope.pdf');
    expect(response.headers.get('x-halofire-artifact-sha256')).toMatch(/^[0-9a-f]{64}$/);
    expect(response.headers.get('x-halofire-exact-deflector-elevation')).toBe('manufacturer-range-3-16-to-11-16-in-below-ceiling-as-built-setpoint-unresolved');
    const buffer = Buffer.from(await response.arrayBuffer()); const raw = buffer.toString('latin1');
    expect(buffer.subarray(0, 8).toString('ascii')).toBe('%PDF-1.7');
    expect(raw).toContain('/Type /OCG /Name (SOURCE_CEILING_EVIDENCE)');
    expect(raw).toContain('/Type /OCG /Name (COMPLETED_HEAD_PIPE_LAYOUT)');
    expect(raw).toContain('/Type /OCG /Name (ELEVATION_UNCERTAINTY)');
  });

  it('downloads a layered two-page Bluebeam-compatible vector PDF', async () => {
    const token = await tokenForAdmin();
    const response = await request('/api/projects/Dillon%20Residence/submitted-sloped-ceiling-bluebeam.pdf', { headers: { Authorization: `Bearer ${token}` } });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/pdf');
    expect(response.headers.get('content-disposition')).toContain('Dillon-Residence-sloped-ceiling-calibration.pdf');
    expect(response.headers.get('x-halofire-artifact-sha256')).toMatch(/^[0-9a-f]{64}$/);
    const buffer = Buffer.from(await response.arrayBuffer());
    expect(buffer.subarray(0, 8).toString('ascii')).toBe('%PDF-1.7');
    const raw = buffer.toString('latin1');
    expect(raw).toContain('/Type /OCG /Name (SOURCE_GEOMETRY)');
    expect(raw).toContain('/Type /OCG /Name (GENERATED_LAYOUT)');
    expect(raw).toContain('/Type /OCG /Name (VERIFICATION_EVIDENCE)');
  });

  it('downloads a deterministic FDF overlay for the original FP-1 sheet', async () => {
    const token = await tokenForAdmin();
    const response = await request('/api/projects/Dillon%20Residence/submitted-sloped-ceiling-bluebeam.fdf', { headers: { Authorization: `Bearer ${token}` } });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/vnd.fdf');
    expect(response.headers.get('content-disposition')).toContain('Dillon-Residence-FP1-generated-slope-overlay.fdf');
    const buffer = Buffer.from(await response.arrayBuffer()); const raw = buffer.toString('ascii');
    expect(buffer.subarray(0, 8).toString('ascii')).toBe('%FDF-1.2');
    expect((raw.match(/\/Subtype \/PolyLine/g) || [])).toHaveLength(4);
    expect((raw.match(/\/Subj \(Generated sprinkler head\)/g) || [])).toHaveLength(2);
    expect(raw).toContain('/Subj (Generated slope-following branch)');
  });
});
