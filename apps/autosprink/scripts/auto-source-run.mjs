/**
 * S5 — autonomous part-sourcing run (production wiring).
 *
 * Wires the VPS HaloFire stack to OpenClaw (GX10) through the governed bridge and
 * runs the S3 auto-source loop. Intended to be invoked on a schedule (cron, handled
 * separately on the VPS). FAIL-SOFT + OBSERVABLE:
 *
 *   - Reads OPENCLAW_BRIDGE_URL + OPENSCAD_BIN from the environment.
 *   - Builds a real spawnSync OpenSCAD scadRunner (degrades to none when absent).
 *   - Builds the bridge invoker (makeBridgeInvoker) over globalThis.fetch and wires
 *     catalog (S1) + sam/gen3d (S2) sourcers from auto-source.js.
 *   - Probes the bridge for reachability observability.
 *   - Runs runAutoSource inside try/catch and ALWAYS writes out/auto-source-status.json.
 *
 * It NEVER throws to the shell (always exits 0) and NEVER fabricates a found
 * model/license: when the bridge is down the catalog/sam sourcers fail soft to null
 * and the run degrades to the OpenSCAD generator path (or all-missing). The status
 * object FORCES parityGateStatus 'blocked' + manufacturerExactCount 0 — auto-sourced
 * parts never clear AUTOSPRINK / AHJ / PE / manufacturer parity.
 *
 * Usage: node scripts/auto-source-run.mjs   (npm run auto-source)
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  runAutoSource,
  makeCatalogSourcer,
  makeImageReconstructSourcer,
} from '../src/components/auto-source.js';
import {
  makeBridgeInvoker,
  probeBridge,
  buildAutoSourceStatus,
} from '../src/components/auto-source-runner.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(REPO_ROOT, 'out');
const STATUS_PATH = path.join(OUT_DIR, 'auto-source-status.json');
const PARTS_DIR = path.join(REPO_ROOT, 'parts');

const OPENCLAW_BRIDGE_URL = process.env.OPENCLAW_BRIDGE_URL || null;
const OPENSCAD_BIN = process.env.OPENSCAD_BIN || 'openscad';

/** True only when the openscad CLI answers --version cleanly. */
function openscadInstalled() {
  try {
    const result = spawnSync(OPENSCAD_BIN, ['--version'], { timeout: 4000, stdio: 'ignore' });
    return result.status === 0 || (!result.error && result.status === null);
  } catch {
    return false;
  }
}

/**
 * Build a real scadRunner that shells out to `openscad -o out.stl in.scad`.
 * Returns null when the binary is absent (degrade: no OpenSCAD geometry). Never
 * fabricates STL — a non-zero exit / missing output throws so renderScadToStl's
 * catch marks the part missing.
 */
function makeOpenscadRunner() {
  if (!openscadInstalled()) return null;
  return async (scad) => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'halofire-autosource-scad-'));
    const inPath = path.join(tmp, 'in.scad');
    const outPath = path.join(tmp, 'out.stl');
    try {
      fs.writeFileSync(inPath, scad);
      const result = spawnSync(OPENSCAD_BIN, ['-o', outPath, inPath], {
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
  const startedAtMs = Date.now();

  // --- Bridge wiring (injected fetch; no network at import time) ---
  const fetchImpl = globalThis.fetch;
  const invoker = OPENCLAW_BRIDGE_URL
    ? makeBridgeInvoker({ bridgeUrl: OPENCLAW_BRIDGE_URL, fetchImpl })
    : null;

  // Sourcers: catalog (S1, web_cad_search) + sam/gen3d (S2). All fail soft to null
  // when the bridge is down or no invoker is wired.
  const catalog = invoker ? makeCatalogSourcer({ invoker }) : undefined;
  const sam = invoker
    ? makeImageReconstructSourcer({ invoker, gen3dInvoker: (payload) => invoker('generate_3d_model', payload) })
    : undefined;

  // OpenSCAD degraded path.
  const scadRunner = makeOpenscadRunner();

  // --- Reachability observability (fail-soft probe) ---
  let bridge = { bridgeUrl: OPENCLAW_BRIDGE_URL, reachable: false, openclaw: null };
  if (OPENCLAW_BRIDGE_URL && typeof fetchImpl === 'function') {
    try {
      const probe = probeBridge({ bridgeUrl: OPENCLAW_BRIDGE_URL, fetchImpl });
      const probed = await probe();
      bridge = { bridgeUrl: OPENCLAW_BRIDGE_URL, reachable: probed.reachable, openclaw: probed.openclaw };
    } catch {
      bridge = { bridgeUrl: OPENCLAW_BRIDGE_URL, reachable: false, openclaw: null };
    }
  }

  // --- Run the loop (fail-soft; never throws to the shell) ---
  let runResult;
  try {
    fs.mkdirSync(PARTS_DIR, { recursive: true });
    runResult = await runAutoSource({
      sourcers: { catalog, sam },
      scadRunner,
      outDir: PARTS_DIR,
      write: true,
      recorder: (entry) => {
        // eslint-disable-next-line no-console
        console.log(`[auto-source] ${entry.key} -> ${entry.bucket} (source=${entry.source})`);
      },
    });
  } catch (err) {
    // Defensive: runAutoSource is itself fail-soft, but never let the shell see a throw.
    // eslint-disable-next-line no-console
    console.error(`[auto-source] run degraded after error: ${err && err.message ? err.message : err}`);
    runResult = {
      report: { foundCount: 0, createdCount: 0, generatedCount: 0, missingCount: 0 },
      functionalCoverage: { present: 0, total: 0, complete: false },
      manufacturerExactCount: 0,
      parityGateStatus: 'blocked',
      disclaimer:
        'Auto-source run errored and degraded to an empty result; NOT manufacturer-exact; parity stays blocked.',
    };
  }

  const finishedAtMs = Date.now();

  // --- Build + write the observable status (FORCES blocked / 0) ---
  const status = buildAutoSourceStatus({ runResult, bridge, startedAtMs, finishedAtMs });
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(STATUS_PATH, JSON.stringify(status, null, 2));

  const r = status.report;
  // eslint-disable-next-line no-console
  console.log(
    `[auto-source] wrote ${STATUS_PATH}\n` +
      `  openclawReachable=${status.openclawReachable} openclawStatus=${status.openclawStatus} ` +
      `found=${r.foundCount} created=${r.createdCount} generated=${r.generatedCount} missing=${r.missingCount} ` +
      `manufacturerExactCount=${status.manufacturerExactCount} parityGate=${status.parityGateStatus} ` +
      `durationMs=${status.durationMs}`,
  );
}

main()
  .then(() => { process.exitCode = 0; })
  .catch((err) => {
    // Last-resort guard: still exit 0 (fail-soft), but surface the reason.
    // eslint-disable-next-line no-console
    console.error('[auto-source] unexpected top-level error (exiting 0, fail-soft):', err);
    process.exitCode = 0;
  });
