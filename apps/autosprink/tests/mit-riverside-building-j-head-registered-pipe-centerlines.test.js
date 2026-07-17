import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const dataRoot = path.resolve(import.meta.dirname, '../src/data');
const proofRoot = path.join(dataRoot, 'proofs/mit-riverside-building-j-head-registered-pipe-centerlines');
const artifact = JSON.parse(fs.readFileSync(path.join(dataRoot, 'mit-riverside-building-j-head-registered-pipe-centerlines.json'), 'utf8'));

describe('MIT Riverside Building J source-registered FP-2 pipe centerlines', () => {
  it('requires immutable head registration and approved/as-built identical source vectors, not a color-only line selection', () => {
    expect(artifact).toMatchObject({
      artifactType: 'halofire.mit-riverside-building-j-head-registered-pipe-centerlines.v1',
      status: 'passed-source-registered-centerlines-only',
      sources: { approved: { physicalPage: 2, sha256: '6da51cbd5bdbf34861502630311f8d0e3d4c8e3dcb61896ba614ff634fde8421' }, asBuilt: { physicalPage: 2, sha256: 'b7a8c3c2faceacba6c41437f773af650cdcc84eddc44cc5a88e1e563ac052207' } },
      selection: { colorOnlySelectionAllowed: false, approvedAsBuiltEligibleVectorCandidatesIdentical: true, eligibleCandidateCount: 420, headContactSeedCount: 63, acceptedCenterlineCount: 77, unselectedEligibleCandidateCount: 343, coveredImmutableHeadCount: 68 },
      claims: { sourceRegisteredPipeCenterlinesReady: true, allImmutableHeadsCovered: true, semanticPipeNetworkExtracted: false, pipeRolesExtracted: false, pipeSizesAndFittingsExtracted: false, pipeElevationsExtracted: false, drainsAndRisersExtracted: false, hydraulicNetworkReady: false, codeComplianceReady: false, fabricationReady: false, employeeUseReady: false, vpsReleaseReady: false },
    });
    expect(artifact.centerlines).toHaveLength(77);
    expect(new Set(artifact.centerlines.map((entry) => entry.id)).size).toBe(77);
    expect(artifact.centerlines.every((entry) => entry.role === 'unknown-source-registered-centerline' && entry.pipeSize === null && entry.elevation === null)).toBe(true);
    expect(artifact.centerlines.some((entry) => entry.selection === 'head-contact-seed')).toBe(true);
    expect(artifact.centerlines.some((entry) => entry.selection === 'geometric-connector-to-head-registered-network')).toBe(true);
  });

  it('keeps the approved PDF as the visible underlay and binds the proof image hash', () => {
    const proof = JSON.parse(fs.readFileSync(path.join(proofRoot, 'proof.json'), 'utf8'));
    const image = fs.readFileSync(path.join(proofRoot, proof.image.file));
    const html = fs.readFileSync(path.join(proofRoot, 'index.html'), 'utf8');
    expect(proof.selection.acceptedCenterlineCount).toBe(77);
    expect(crypto.createHash('sha256').update(image).digest('hex')).toBe(proof.image.sha256);
    expect(html).toContain('backdrop-filter:blur');
    expect(html).toContain('77 accepted source centerlines');
    expect(html).toContain('Pipe roles, sizes, elevations, hydraulics held');
  });
});
