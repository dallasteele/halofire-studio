import { describe, expect, it } from 'vitest';
import evidence from '../src/data/winter-garden-ceiling-elevation-evidence.json';
import registration from '../src/data/winter-garden-grid-registration.json';
import heads from '../src/data/winter-garden-fp3-head-evidence.json';
import pipeEvidence from '../src/data/winter-garden-fp2-pipe-evidence.json';
import mapping from '../src/data/winter-garden-fabrication-plan-mapping.json';
import { buildWinterGardenFabricationRegisteredModel } from '../src/engine/winter-garden-fabrication-plan-mapping.js';
import { buildWinterGardenChapelPipeNetwork } from '../src/engine/fp2-pipe-registration.js';
import { buildWinterGardenBluebeamPackage } from '../src/engine/winter-garden-bluebeam-package.js';

describe('Winter Garden Bluebeam top/elevation envelope', () => {
  it('emits a deterministic two-page layered vector PDF with mapped branch Z and manufacturer envelope', async () => {
    const [model3dEnvelope, network] = await Promise.all([buildWinterGardenFabricationRegisteredModel(mapping, evidence, registration, heads), buildWinterGardenChapelPipeNetwork(pipeEvidence, registration, heads)]);
    const input = { model3dEnvelope, pipeNetwork: network.segments, pipeRegistrationDeltaPx: pipeEvidence.registration.meanDeltaPx, evidenceReceiptSha256: mapping.receiptSha256 };
    const result = buildWinterGardenBluebeamPackage(input); const replay = buildWinterGardenBluebeamPackage(input);
    expect(result.status).toBe('passed');
    expect(result.buffer.subarray(0, 8).toString('ascii')).toBe('%PDF-1.7');
    expect(result.manifest).toMatchObject({ pageCount: 2, vector: true, bluebeamCompatiblePdfVersion: '1.7', ceilingSurfaceElevationReady: true, fabricationPlanMappingReady: true, branchRowPipeElevationReady: true, manufacturerInstallationEnvelopeReady: true, exactAsBuiltDeflectorElevationReady: false, fullNetworkPipeElevationReady: false, fabricationReady: false, complianceReady: false });
    expect(result.manifest.sha256).toBe(replay.manifest.sha256);
    const raw = result.buffer.toString('latin1');
    expect(raw).toContain('/Type /OCG /Name (SOURCE_CEILING_EVIDENCE)');
    expect(raw).toContain('/Type /OCG /Name (COMPLETED_HEAD_PIPE_LAYOUT)');
    expect(raw).toContain('/Type /OCG /Name (ELEVATION_UNCERTAINTY)');
    expect(raw).toContain('15 TYL TAKEOFFS + 3 FP2 BRANCH Z: SOURCE-BOUND');
    expect(raw).toContain('TFP181 3/16 IN TO 11/16 IN BELOW CEILING');
  });

  it('rejects any input that promotes exact or compliance elevation', async () => {
    const model3dEnvelope = await buildWinterGardenFabricationRegisteredModel(mapping, evidence, registration, heads); model3dEnvelope.absoluteDeflectorDatumReady = true;
    const network = await buildWinterGardenChapelPipeNetwork(pipeEvidence, registration, heads);
    expect(buildWinterGardenBluebeamPackage({ model3dEnvelope, pipeNetwork: network.segments, pipeRegistrationDeltaPx: pipeEvidence.registration.meanDeltaPx, evidenceReceiptSha256: mapping.receiptSha256 }).status).toBe('blocked');
  });
});
