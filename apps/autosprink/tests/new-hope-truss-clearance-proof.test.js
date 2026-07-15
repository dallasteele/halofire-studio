import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const proof = new URL('../src/data/proofs/new-hope-truss-clearance/', import.meta.url);
const read = (name) => fs.readFileSync(new URL(name, proof), 'utf8');

describe('New Hope PDF-bound visual proof', () => {
  it('keeps the actual structural and approved PDF renders beneath the overlays', () => {
    const html = read('index.html');
    expect(html).toContain('s102-roof-framing-underlay.png');
    expect(html).toContain('approved-ridge-branch-underlay.png');
    expect(html).toContain('approved-dry-pipe-note.png');
    expect(html).toContain('approved-fp20-full-underlay.png');
    for (const image of ['s102-roof-framing-underlay.png', 'approved-ridge-branch-underlay.png', 'approved-dry-pipe-note.png', 'approved-fp20-full-underlay.png']) expect(fs.statSync(new URL(image, proof)).size).toBeGreaterThan(30_000);
  });

  it('states the missing pipe-layout facts instead of presenting a connector as a design', () => {
    const html = read('index.html');
    expect(html).toContain('NOT A PROPER WHOLE-SYSTEM PIPE LAYOUT');
    expect(html).toContain('properPipeLayoutReady=false');
    expect(html).toContain('branchGradeDirectionReady=false');
    expect(html).toContain('endpointElevationsReady=false');
    expect(html).toContain('drainDestinationReady=false');
  });

  it('loads the sealed calibration and generates the S102 overlay from data', () => {
    const script = read('proof.js');
    expect(script).toContain('../../new-hope-truss-clearance-calibration.json');
    expect(script).toContain('../../new-hope-approved-fp20-pipe-vectors.json');
    expect(script).toContain('calibration.trussLattice.centerlines');
    expect(script).toContain('calibration.branch.nodes');
    expect(script).toContain('pipeVectors.pipeSegments');
    expect(script).toContain('pipeVectors.sprinklers');
    expect(script).toContain('evaluateApprovedFp20PipeVectors');
    expect(script).toContain("dataset.proofReady = 'true'");
    expect(script).toContain('dataset.pipeVectorStatus = vectorAcceptance.status');
    expect(script).toContain('evaluateProperPitchedPipeGraph');
    expect(script).toContain('dataset.pipeGraphStatus = acceptance.status');
  });
});
