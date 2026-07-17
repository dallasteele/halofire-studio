import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const proofRoot = path.resolve(import.meta.dirname, '../src/data/proofs/mit-riverside-building-j-approved-pipe-layout');

describe('MIT Riverside Building J approved FP-2 pipe-layout proof', () => {
  it('keeps the actual approved/as-built pipe plan under exact head XY, without promoting a semantic pipe graph', () => {
    const proof = JSON.parse(fs.readFileSync(path.join(proofRoot, 'proof.json'), 'utf8'));
    const image = fs.readFileSync(path.join(proofRoot, proof.image.file));
    expect(proof).toMatchObject({
      artifactType: 'halofire.mit-riverside-building-j-approved-pipe-layout-proof.v1',
      status: 'passed-source-underlay-only',
      sources: { approved: { physicalPage: 2, sha256: '6da51cbd5bdbf34861502630311f8d0e3d4c8e3dcb61896ba614ff634fde8421' }, asBuilt: { physicalPage: 2, sha256: 'b7a8c3c2faceacba6c41437f773af650cdcc84eddc44cc5a88e1e563ac052207' } },
      render: { approvedAsBuiltPixelsIdentical: true },
      headOverlay: { total: 68, upright: 53, pendent: 15, crossedValveExcluded: 1 },
      claims: { actualApprovedPipeworkVisible: true, approvedAsBuiltPipeUnderlayIdentical: true, exactHeadXyRegistered: true, semanticPipeNetworkExtracted: false, pipeSizesAndFittingsExtracted: false, pipeElevationsExtracted: false, hydraulicNetworkReady: false, codeComplianceReady: false, fabricationReady: false, employeeUseReady: false, vpsReleaseReady: false },
    });
    expect(crypto.createHash('sha256').update(image).digest('hex')).toBe(proof.image.sha256);
  });

  it('uses a client-inspectable glass proof page that calls out the non-generated routing boundary', () => {
    const html = fs.readFileSync(path.join(proofRoot, 'index.html'), 'utf8');
    expect(html).toContain('backdrop-filter:blur');
    expect(html).toContain('0 synthesized routes');
    expect(html.toLowerCase()).toContain('semantic pipe graph still held');
  });
});
