/**
 * Part-mesh build CLI (R1).
 *
 * Constructs a REAL scadRunner from the external OpenSCAD CLI and drives
 * buildPartManifest to write parts/<key>.stl + parts/parts-manifest.json under
 * the repo root (web-reachable via the existing static mount).
 *
 * HONESTY / fail-closed:
 *   - The openscad binary is best-effort. If it is absent (or any render
 *     fails), NO STL is fabricated: those parts come back 'missing' and the
 *     script still succeeds, producing an all-'missing' (or partial) manifest.
 *   - Generated meshes are real geometry but NOT manufacturer-exact. The
 *     AUTOSPRINK_PARITY gate stays blocked regardless.
 *
 * Usage: node scripts/build-parts.mjs   (npm run build:parts)
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { buildPartManifest } from '../src/components/part-mesh.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(REPO_ROOT, 'parts');
const MANIFEST_PATH = path.join(OUT_DIR, 'parts-manifest.json');

/** True only when the openscad CLI answers --version cleanly. */
function openscadInstalled() {
  try {
    const result = spawnSync('openscad', ['--version'], { timeout: 4000, stdio: 'ignore' });
    return result.status === 0 || (!result.error && result.status === null);
  } catch {
    return false;
  }
}

/**
 * Build a real scadRunner that shells out to `openscad -o out.stl in.scad`.
 * Returns null when the binary is absent (caller treats every part as missing).
 * Never fabricates STL: a non-zero exit / missing output throws so the part is
 * marked missing by renderScadToStl's catch.
 */
function makeOpenscadRunner() {
  if (!openscadInstalled()) return null;
  return async (scad) => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'halofire-scad-'));
    const inPath = path.join(tmp, 'in.scad');
    const outPath = path.join(tmp, 'out.stl');
    try {
      fs.writeFileSync(inPath, scad);
      const result = spawnSync('openscad', ['-o', outPath, inPath], {
        timeout: 60000,
        stdio: 'ignore',
      });
      if (result.status !== 0 || result.error || !fs.existsSync(outPath)) {
        throw new Error('openscad render failed');
      }
      return { stl: fs.readFileSync(outPath, 'utf8') };
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  };
}

async function main() {
  const installed = openscadInstalled();
  const scadRunner = makeOpenscadRunner();
  if (!scadRunner) {
    // eslint-disable-next-line no-console
    console.warn(
      '[build-parts] openscad CLI not found on PATH — producing an all-missing ' +
        'manifest (no STL fabricated). Install OpenSCAD to render real meshes.',
    );
  }

  const manifest = await buildPartManifest({ scadRunner, outDir: OUT_DIR, write: true });

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const out = {
    generatedAt: new Date().toISOString(),
    openscadInstalled: installed,
    manufacturerExact: false, // ALWAYS false for this pipeline
    ...manifest,
  };
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(out, null, 2));

  // eslint-disable-next-line no-console
  console.log(
    `[build-parts] wrote ${MANIFEST_PATH}\n` +
      `  generated=${manifest.generatedCount} missing=${manifest.missingCount} ` +
      `manufacturerExact=${manifest.manufacturerExactCount} ` +
      `parityGate=${manifest.parityGateStatus} openscadInstalled=${installed}`,
  );
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[build-parts] failed:', err);
  process.exitCode = 1;
});
