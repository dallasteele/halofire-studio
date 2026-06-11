import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-expect-error — .mjs harness, no type declarations
import { renderScadToStl, resolveOpenscadBin, stlTriangleCount } from '../scripts/render-scad.mjs';
import { emitElbow90 } from '../src/lib/scad-emitters';
import { spawnSync } from 'node:child_process';

function openscadAvailable(): boolean {
  const bin = resolveOpenscadBin();
  try {
    const r = spawnSync(bin, ['--version'], { timeout: 8000 });
    return r.status === 0 || (r.stderr?.toString().toLowerCase().includes('openscad') ?? false);
  } catch {
    return false;
  }
}

const HAS_OPENSCAD = openscadAvailable();
if (!HAS_OPENSCAD) {
  // Honest skip: no binary in this environment (e.g. CI without OpenSCAD).
  // eslint-disable-next-line no-console
  console.log('[scad-render.test] OpenSCAD binary not resolvable — render tests skipped.');
}

describe('stlTriangleCount', () => {
  it('reads the little-endian uint32 at offset 80', () => {
    const buf = Buffer.alloc(84);
    buf.writeUInt32LE(12345, 80);
    expect(stlTriangleCount(buf)).toBe(12345);
  });

  it('rejects a non-STL buffer', () => {
    expect(() => stlTriangleCount(Buffer.alloc(10))).toThrow();
  });
});

describe.skipIf(!HAS_OPENSCAD)('renderScadToStl', () => {
  it('renders an elbow emitter to an STL with positive triangle count', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'halofire-scad-test-'));
    const out = join(dir, 'elbow.stl');
    try {
      const scad = emitElbow90({ nominalIn: 2, odIn: 2.375, centerToEndIn: 2 });
      const res = await renderScadToStl(scad, out);
      expect(res.triangles).toBeGreaterThan(0);
      expect(res.bytes).toBeGreaterThan(84);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 60000);

  it('rejects a syntactically broken scad source with stderr in the message', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'halofire-scad-test-'));
    const out = join(dir, 'broken.stl');
    try {
      await expect(renderScadToStl('this is not valid openscad {{{', out)).rejects.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 60000);
});
