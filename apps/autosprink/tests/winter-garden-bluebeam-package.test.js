import { describe, expect, it } from 'vitest';
import evidence from '../src/data/winter-garden-ceiling-elevation-evidence.json';
import registration from '../src/data/winter-garden-grid-registration.json';
import heads from '../src/data/winter-garden-fp3-head-evidence.json';
import pipeEvidence from '../src/data/winter-garden-fp2-pipe-evidence.json';
import { buildWinterGardenCeilingModel3d } from '../src/engine/winter-garden-ceiling-elevation.js';
import { buildWinterGardenChapelPipeNetwork } from '../src/engine/fp2-pipe-registration.js';
import { buildWinterGardenBluebeamPackage } from '../src/engine/winter-garden-bluebeam-package.js';

describe('Winter Garden Bluebeam top/elevation envelope', () => {
  it('emits a deterministic two-page layered vector PDF without claiming exact Z', async () => {
    const [model3dEnvelope, network] = await Promise.all([buildWinterGardenCeilingModel3d(evidence, registration, heads), buildWinterGardenChapelPipeNetwork(pipeEvidence, registration, heads)]);
    const input = { model3dEnvelope, pipeNetwork: network.segments, pipeRegistrationDeltaPx: pipeEvidence.registration.meanDeltaPx, evidenceReceiptSha256: evidence.receiptSha256 };
    const result = buildWinterGardenBluebeamPackage(input); const replay = buildWinterGardenBluebeamPackage(input);
    expect(result.status).toBe('passed');
    expect(result.buffer.subarray(0, 8).toString('ascii')).toBe('%PDF-1.7');
    expect(result.manifest).toMatchObject({ pageCount: 2, vector: true, bluebeamCompatiblePdfVersion: '1.7', ceilingSurfaceElevationReady: true, exactDeflectorElevationReady: false, pipeElevationReady: false, fabricationReady: false, complianceReady: false });
    expect(result.manifest.sha256).toBe(replay.manifest.sha256);
    const raw = result.buffer.toString('latin1');
    expect(raw).toContain('/Type /OCG /Name (SOURCE_CEILING_EVIDENCE)');
    expect(raw).toContain('/Type /OCG /Name (COMPLETED_HEAD_PIPE_LAYOUT)');
    expect(raw).toContain('/Type /OCG /Name (ELEVATION_UNCERTAINTY)');
    expect(raw).toContain('DEFLECTOR + PIPE ELEVATION: UNRESOLVED');
  });

  it('rejects any input that promotes exact or compliance elevation', async () => {
    const model3dEnvelope = await buildWinterGardenCeilingModel3d(evidence, registration, heads); model3dEnvelope.absoluteDeflectorDatumReady = true;
    const network = await buildWinterGardenChapelPipeNetwork(pipeEvidence, registration, heads);
    expect(buildWinterGardenBluebeamPackage({ model3dEnvelope, pipeNetwork: network.segments, pipeRegistrationDeltaPx: pipeEvidence.registration.meanDeltaPx, evidenceReceiptSha256: evidence.receiptSha256 }).status).toBe('blocked');
  });
});
