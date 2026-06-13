/**
 * Stream C smoke: numeric, true-scale validation of the generated part meshes
 * and the src/engine/part-meshes.js loader. NO server, NO browser, NO network —
 * reads parts/*.stl + parts/parts-manifest.json straight from disk and drives
 * the loader through injected fetchers.
 *
 * Checks (all numeric):
 *   1. Every manifest 'generated' part has a parseable STL with >0 triangles.
 *   2. Raw STL bbox (mm) matches the OpenSCAD emitter's expected envelope for
 *      the high-count parts (formula-derived expectations, tolerance 1.0 mm —
 *      $fn=48 facets undershoot a perfect circle slightly).
 *   3. Loader output is TRUE SCALE: bbox(ft) == bbox(mm)/304.8 (1 unit = 1 ft).
 *   4. Alias + fallback honesty: rigid/flexible coupling resolve to the grooved
 *      coupling mesh; drop_nipple/escutcheon fall back to primitive (null
 *      geometry) with needs-verification provenance. Nothing fabricated.
 *
 * Exit code 0 only when every check passes.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { createPartMeshLoader, MM_PER_FT } from '../src/engine/part-meshes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PARTS_DIR = path.join(ROOT, 'parts');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(PARTS_DIR, 'parts-manifest.json'), 'utf8'));

const IN = 25.4; // mm per inch
let failures = 0;
const rows = [];

function bboxOf(geo) {
  geo.computeBoundingBox();
  const { min, max } = geo.boundingBox;
  return { x: max.x - min.x, y: max.y - min.y, z: max.z - min.z };
}

function near(actual, expected, tol = 1.0) {
  return Math.abs(actual - expected) <= tol;
}

// Expected raw-STL envelopes (mm, OpenSCAD Z-up axes) derived from the exact
// formulas in src/components/openscad/generators.js at each part's default
// (first) registry size. These are the high-count Studio parts.
const EXPECTED_MM = {
  // sprinkler head (default pendent, K=5.6): deflector dia = (3+5.6*.6)*2.2*1.6
  // = 22.38mm wide; height = 2 (deflector below z0) + 16 body + 8 nipple = 26.
  head_pendent: { x: 22.39, y: 22.39, z: 26.0 },
  // grooved coupling, 2" default: OD = 2*25.4*1.25 = 63.5; len = 2*25.4*1.2 = 60.96.
  grooved_coupling: { x: 63.5, y: 63.5, z: 60.96 },
  // threaded coupling, 1" default: OD = 1*25.4*1.25 = 31.75; len = 30.48.
  fitting_coupling: { x: 31.75, y: 31.75, z: 30.48 },
  // hanger, 1" default: ring OD = 35.56 (x/y); z = 8 strap + 50.8 rod = 58.8.
  hanger: { x: 35.56, y: 35.56, z: 58.8 },
  // tee, 1" default: run along X = 76.2; branch dia 27.94 (y); z = branch 45.72
  // + run radius 13.97 = 59.69... run is centered at z=0 so z extent =
  // branchL + runD/2 = 45.72 + 13.97 = 59.69.
  fitting_tee: { x: 76.2, y: 27.94, z: 59.69 },
};

// ── 1+2: every generated STL parses; high-count parts match emitter dims ──
const generated = MANIFEST.components.filter((c) => c.present && c.format === 'stl');
for (const c of generated) {
  const file = path.join(ROOT, c.file);
  let geo;
  try {
    const buf = fs.readFileSync(file);
    geo = new STLLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  } catch (e) {
    failures++;
    rows.push({ key: c.key, ok: false, note: `STL parse failed: ${e.message}` });
    continue;
  }
  const verts = geo.getAttribute('position').count;
  const tris = verts / 3;
  const bb = bboxOf(geo);
  let ok = tris > 0;
  let note = '';
  const exp = EXPECTED_MM[c.key];
  if (exp) {
    const dimsOk = near(bb.x, exp.x) && near(bb.y, exp.y) && near(bb.z, exp.z);
    ok = ok && dimsOk;
    note = `expected mm [${exp.x}, ${exp.y}, ${exp.z}] ±1.0`;
    if (!dimsOk) note += ' — MISMATCH';
  }
  if (!ok) failures++;
  rows.push({
    key: c.key,
    ok,
    tris,
    verts,
    bboxMm: [bb.x.toFixed(2), bb.y.toFixed(2), bb.z.toFixed(2)].join(' x '),
    note,
  });
}

// ── 3+4: loader true-scale + alias/fallback honesty (offline injection) ──
const loader = createPartMeshLoader({
  fetchManifest: async () => MANIFEST,
  loadStlBuffer: async (file) => {
    const buf = fs.readFileSync(path.join(ROOT, file));
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  },
});

function check(name, cond, detail = '') {
  if (!cond) failures++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
}

const head = await loader.load('sprinkler_head');
{
  const ok = head.geometry != null;
  let detail = '';
  if (ok) {
    const bb = bboxOf(head.geometry);
    const expFt = { x: 22.39 / MM_PER_FT, y: 26.0 / MM_PER_FT, z: 22.39 / MM_PER_FT }; // Y-up swap
    const scaleOk =
      near(bb.x, expFt.x, 0.005) && near(bb.y, expFt.y, 0.005) && near(bb.z, expFt.z, 0.005);
    detail = `bbox ft [${bb.x.toFixed(4)}, ${bb.y.toFixed(4)}, ${bb.z.toFixed(4)}] vs expected [${expFt.x.toFixed(4)}, ${expFt.y.toFixed(4)}, ${expFt.z.toFixed(4)}] (true scale, Y-up)`;
    check('loader true-scale: sprinkler_head -> head_pendent ft bbox', scaleOk, detail);
    check(
      'provenance flags: generated + needs-verification + NOT manufacturer-exact',
      head.provenance.source === 'generated' &&
        head.provenance.needsVerification === true &&
        head.provenance.manufacturerExact === false,
    );
  } else {
    check('loader true-scale: sprinkler_head -> head_pendent ft bbox', false, 'no geometry');
  }
}

const rigid = await loader.load('rigid_coupling');
const flex = await loader.load('flexible_coupling');
check(
  'alias: rigid_coupling + flexible_coupling -> grooved_coupling mesh (shared, cached)',
  rigid.geometry != null && flex.geometry === rigid.geometry && rigid.provenance.key === 'grooved_coupling',
);
{
  const bb = rigid.geometry ? bboxOf(rigid.geometry) : { x: 0, y: 0, z: 0 };
  // 2" grooved coupling: OD 63.5mm = 0.2083 ft (x/z after Y-up), len 60.96mm = 0.2 ft (y).
  check(
    'true-scale: 2" grooved coupling OD 63.5mm -> 0.2083 ft',
    near(bb.x, 63.5 / MM_PER_FT, 0.005) && near(bb.y, 60.96 / MM_PER_FT, 0.005),
    `bbox ft [${bb.x.toFixed(4)}, ${bb.y.toFixed(4)}, ${bb.z.toFixed(4)}]`,
  );
}

const hanger = await loader.load('hanger');
check('hanger mesh loads', hanger.geometry != null && hanger.provenance.source === 'generated');
const tee = await loader.load('branch_tee');
check('alias: branch_tee -> fitting_tee mesh loads', tee.geometry != null && tee.provenance.key === 'fitting_tee');

const nipple = await loader.load('drop_nipple');
check(
  'honest fallback: drop_nipple -> primitive (null geometry, needs-verification note)',
  nipple.geometry === null && nipple.provenance.status === 'primitive' && nipple.provenance.needsVerification === true,
);
const esc = await loader.load('escutcheon');
check(
  'honest fallback: escutcheon -> primitive (null geometry)',
  esc.geometry === null && esc.provenance.status === 'primitive',
);
const missing = await loader.load('identification_sign'); // in registry, no generator
check(
  'honest fallback: identification_sign (manifest-missing) -> primitive',
  missing.geometry === null && missing.provenance.status === 'primitive',
);

// ── report ──
console.log('\nkey                      ok    tris    verts  bbox mm                    note');
for (const r of rows) {
  console.log(
    `${r.key.padEnd(24)} ${String(r.ok).padEnd(5)} ${String(r.tris ?? '-').padStart(6)} ${String(r.verts ?? '-').padStart(8)}  ${String(r.bboxMm ?? '-').padEnd(26)} ${r.note || ''}`,
  );
}
console.log(
  `\n[smoke-part-meshes] generated=${generated.length} checkedDims=${Object.keys(EXPECTED_MM).length} failures=${failures}`,
);
process.exitCode = failures === 0 ? 0 : 1;
