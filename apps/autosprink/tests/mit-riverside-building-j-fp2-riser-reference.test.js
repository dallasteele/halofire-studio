import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const dataRoot = path.resolve(import.meta.dirname, '../src/data');
const proofRoot = path.join(dataRoot, 'proofs/mit-riverside-building-j-fp2-riser-reference');

describe('MIT Riverside Building J FP-2 to FP-7 riser reference', () => {
  it('keeps the project callout and generic detail source-bound without merging their distinct pipe sizes', () => {
    const artifact = JSON.parse(fs.readFileSync(path.join(dataRoot, 'mit-riverside-building-j-fp2-riser-reference.json'), 'utf8'));
    expect(artifact).toMatchObject({
      status: 'passed-cross-sheet-reference-only',
      observedSourceReference: { fp2RiserNominalIn: 3, fp7GenericBasePipeIn: 4, approvedAsBuiltFp2CropIdentical: true, approvedAsBuiltFp7CropIdentical: true },
      claims: { fp2ToFp7RiserReferenceReady: true, installedRiserGeometryReady: false, installedRiserLocationBoundToCenterline: false, installedRiserElevationReady: false, fieldDrainRouteReady: false, hydraulicClosureReady: false, fabricationReady: false, employeeUseReady: false, vpsReleaseReady: false },
    });
  });

  it('binds the visual evidence hash and keeps the generic-detail warning visible to operators', () => {
    const proof = JSON.parse(fs.readFileSync(path.join(proofRoot, 'proof.json'), 'utf8'));
    const image = fs.readFileSync(path.join(proofRoot, proof.image.file));
    const html = fs.readFileSync(path.join(proofRoot, 'index.html'), 'utf8');
    expect(crypto.createHash('sha256').update(image).digest('hex')).toBe(proof.image.sha256);
    expect(html).toContain('generic 4 in base-pipe detail visibly distinct');
  });
});
