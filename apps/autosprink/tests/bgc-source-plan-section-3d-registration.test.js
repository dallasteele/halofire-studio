import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateBgcSourcePlanSection3dRegistration, verifyBgcSourcePlanSection3dAdversarialLoop } from '../src/engine/bgc-source-plan-section-3d-registration.js';

const packet = JSON.parse(fs.readFileSync(new URL('../src/data/bgc-source-plan-section-3d-registration.json', import.meta.url), 'utf8'));
const proof = (name) => new URL(`../src/data/proofs/bgc-source-plan-section-3d-registration/${name}`, import.meta.url);

describe('BGC actual-PDF plan, section, and 3D registration', () => {
  it('closes a 64-head source graph across real as-built, approved, and A301 PDFs', async () => {
    const result = await validateBgcSourcePlanSection3dRegistration(packet);
    expect(result).toMatchObject({ status: 'passed', sourcePlanCoordinatesVerified: true, sourceBranchHalfAdjacencyVerified: true, roofSurfaceTargetProjectionVerified: true, exactInstalledPipeElevationVerified: false, pipeGradeVerified: false, complianceReady: false, fabricationReady: false, fieldReleaseReady: false, vpsReleaseReady: false });
    expect(packet.geometryGraph).toMatchObject({ nodeCount: 64, edgeCount: 48 });
    expect(packet.registration.plan.branchHalfOffset.meanOffsetPt).toBeCloseTo(4.162476, 6);
    expect(packet.detectors).toMatchObject({ asBuilt: { guardedUprightCount: 64 }, ahjApproved: { guardedUprightCount: 64 }, approvedToAsBuiltParity: { coordinateParityClaimed: false } });
  });

  it('binds all three views to one graph and actual source images', () => {
    const digest = packet.geometryGraph.digestSha256;
    expect(Object.values(packet.viewBindings).every((view) => view.geometryGraphSha256 === digest)).toBe(true);
    for (const name of ['bgc-plan-source.png', 'bgc-plan-overlay.png', 'bgc-section-source.png', 'bgc-section-overlay.png', 'bgc-source-registered-3d.png', 'bgc-source-registered-3d.blend', 'bgc-source-registered-3d.glb', 'index.html']) {
      expect(fs.statSync(proof(name)).size).toBeGreaterThan(1000);
    }
    const html = fs.readFileSync(proof('index.html'), 'utf8');
    expect(html).toContain('This replaces the old synthetic 8 × 8 dot diagram');
    expect(html).toContain('exact installed Z + grade held closed');
  });

  it('rejects every source, geometry, view, and false-promotion mutation internally', async () => {
    const result = await verifyBgcSourcePlanSection3dAdversarialLoop(packet);
    expect(result.status).toBe('passed');
    expect(result.rejectedCases).toHaveLength(result.attemptedCases);
    expect(result).toMatchObject({ attemptedCases: 16, sourcePlanCoordinatesVerified: true, exactInstalledPipeElevationVerified: false, pipeGradeVerified: false, complianceReady: false, vpsReleaseReady: false });
  });
});
