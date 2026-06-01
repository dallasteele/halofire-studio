import { describe, expect, it } from 'vitest';

import {
  summarizeExportArtifact,
  buildExportProofMessage,
} from '../src/ui/export-proof.js';

describe('export proof helpers', () => {
  it('summarizes text exports with deterministic bytes and sha256', async () => {
    const proof = await summarizeExportArtifact('step', 'ABC\n', { text: true, registered: 12 });

    expect(proof.format).toBe('step');
    expect(proof.registered).toBe(12);
    expect(proof.byteLength).toBe(4);
    expect(proof.sha256).toBe('8470d56547eea6236d7c81a644ce74670ca0bbda998e13c629ef6bb3f0d60b69');
    expect(proof.downloadName).toBe('halofire-cad.step');
    expect(proof.mimeType).toBe('text/plain');
    expect(proof.preview).toBe('ABC');
  });

  it('summarizes binary exports without pretending they are text', async () => {
    const proof = await summarizeExportArtifact('stl', new Uint8Array([0, 255, 16, 32]), { text: false, registered: 3 });

    expect(proof.format).toBe('stl');
    expect(proof.byteLength).toBe(4);
    expect(proof.mimeType).toBe('application/octet-stream');
    expect(proof.preview).toBe(null);
    expect(proof.sha256).toBe('4033e6f229164922f1600f00a2dacd22e9b9bbdad58f82dd95095b0bb648eb83');
  });

  it('builds a concise proof message for the studio status area', async () => {
    const proof = await summarizeExportArtifact('ifc', 'ISO-10303-21;', { text: true, registered: 19 });

    expect(buildExportProofMessage(proof)).toBe(
      'IFC proof: 13 bytes · sha256 f173fe44447b57a79ca85a732c31c5fb5fca41fcef440054a099df01e02a037b · shapes 19'
    );
  });
});
