import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const dataRoot = path.resolve(import.meta.dirname, '../src/data');
const proofRoot = path.join(dataRoot, 'proofs/mit-riverside-building-j-hydraulic-riser-trace');

describe('MIT Riverside Building J hydraulic riser trace', () => {
  it('retains calculated TOR/BOR/underground topology without promoting it to field geometry', () => {
    const artifact = JSON.parse(fs.readFileSync(path.join(dataRoot, 'mit-riverside-building-j-hydraulic-riser-trace.json'), 'utf8'));
    expect(artifact).toMatchObject({
      status: 'passed-calculation-topology-only',
      approvedAsBuiltFp2CalloutIdentical: true,
      calculatedTrace: {
        calculationOnly: true,
        demand: { sprinklerGpm: 327.4, withHoseGpm: 577.4, borPressurePsi: 48.9 },
      },
      claims: { calculatedHydraulicRiserTraceReady: true, installedRiserGeometryReady: false, fieldDrainRouteReady: false, fabricationReady: false, employeeUseReady: false, vpsReleaseReady: false },
    });
    expect(artifact.calculatedTrace.nodes).toEqual(expect.arrayContaining([expect.objectContaining({ tag: 'TOR', elevationFt: 11, pressurePsi: 41.7 }), expect.objectContaining({ tag: 'BOR', elevationFt: 1, pressurePsi: 48.9 }), expect.objectContaining({ tag: 'UG', elevationFt: -3, pressurePsi: 51.1 })]));
  });

  it('binds the visual evidence and exposes the no-drain/no-installed-geometry hold', () => {
    const proof = JSON.parse(fs.readFileSync(path.join(proofRoot, 'proof.json'), 'utf8'));
    const image = fs.readFileSync(path.join(proofRoot, proof.image.file));
    const html = fs.readFileSync(path.join(proofRoot, 'index.html'), 'utf8');
    expect(crypto.createHash('sha256').update(image).digest('hex')).toBe(proof.image.sha256);
    expect(proof.limitation ?? proof.limitations).toBeDefined();
    expect(html).toContain('Field geometry and drains held');
  });
});
