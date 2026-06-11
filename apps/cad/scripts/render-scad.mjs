/**
 * Headless OpenSCAD STL render harness (W13B).
 *
 * Renders an OpenSCAD source string to a binary STL via the OpenSCAD CLI.
 * Fail-closed: a render only "succeeds" with exit 0 AND a real STL on disk —
 * never a fabricated success. Resolves the binary from OPENSCAD_BIN, else
 * `openscad` on PATH, else the well-known Windows install path.
 */
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, stat, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

const WINDOWS_DEFAULT = 'C:\\Program Files\\OpenSCAD\\openscad.exe';

/** Resolves the OpenSCAD binary path, or null when none is available. */
export function resolveOpenscadBin() {
  if (process.env.OPENSCAD_BIN) return process.env.OPENSCAD_BIN;
  if (existsSync(WINDOWS_DEFAULT)) return WINDOWS_DEFAULT;
  // PATH fallback — spawn resolves `openscad` itself; probing here would be
  // racy, so we return the bare name and let a failed spawn surface honestly.
  return 'openscad';
}

/** Binary STL triangle count: little-endian uint32 at byte offset 80. */
export function stlTriangleCount(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 84) {
    throw new Error('not a binary STL buffer');
  }
  return buffer.readUInt32LE(80);
}

/**
 * Renders OpenSCAD source to a binary STL at outPath. Resolves to
 * { triangles, bytes } on success; rejects with the captured stderr tail
 * otherwise. Never resolves on a failed/empty render.
 */
export async function renderScadToStl(scadSource, outPath) {
  const bin = resolveOpenscadBin();
  const dir = await mkdtemp(join(tmpdir(), 'halofire-scad-'));
  const scadPath = join(dir, 'part.scad');
  await writeFile(scadPath, scadSource, 'utf8');

  const stderr = await new Promise((resolve, reject) => {
    let captured = '';
    let proc;
    try {
      proc = spawn(bin, ['-o', outPath, scadPath]);
    } catch (err) {
      reject(new Error(`failed to spawn OpenSCAD (${bin}): ${err.message}`));
      return;
    }
    proc.stderr?.on('data', (d) => {
      captured += d.toString();
    });
    proc.on('error', (err) => reject(new Error(`OpenSCAD spawn error (${bin}): ${err.message}`)));
    proc.on('close', (code) => {
      if (code === 0) resolve(captured);
      else reject(new Error(`OpenSCAD exited ${code}: ${captured.trim().slice(-400)}`));
    });
  }).finally(() => {});

  // Fail-closed: confirm a real STL exists and carries a binary header.
  let st;
  try {
    st = await stat(outPath);
  } catch {
    await rm(dir, { recursive: true, force: true });
    throw new Error(`OpenSCAD reported success but wrote no STL: ${stderr.trim().slice(-400)}`);
  }
  if (st.size <= 84) {
    await rm(dir, { recursive: true, force: true });
    throw new Error(`OpenSCAD wrote an empty STL (${st.size} bytes)`);
  }
  const buf = await readFile(outPath);
  await rm(dir, { recursive: true, force: true });
  return { triangles: stlTriangleCount(buf), bytes: st.size };
}
