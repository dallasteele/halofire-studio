/**
 * augment-wall-runs-recore.mjs — RECORE: add `wallRuns` + `wallRunsMeta` to each level of the
 * existing plan-levels.cooperative-1881.json, computed from that level's stored single-band
 * `walls` (the verified W0 cut-wall set). This does NOT re-extract the 173MB architectural PDF
 * and does NOT touch any verified W0/W2 field (footprint, walls, wallsFull, rooms, doors, etc.) —
 * it only ADDS the honest collinear-merged wall-run structure that replaces the over-inclusive
 * 41,784-segment `wallsFull` as the primary rendered walls.
 *
 * Usage: node scripts/augment-wall-runs-recore.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { buildWallRuns } from '../src/engine/plan-wall-runs.js';

const OUT = path.resolve(process.cwd(), 'src/data/plan-levels.cooperative-1881.json');
const raw = fs.readFileSync(OUT, 'utf8');
const data = JSON.parse(raw);

let touched = 0;
for (const lvl of (data.levels || [])) {
  const plan = lvl.plan;
  if (!plan || !Array.isArray(plan.walls)) continue;
  const { runs, meta } = buildWallRuns(plan.walls);
  plan.wallRuns = runs;
  plan.wallRunsMeta = meta;
  touched += 1;
  console.log(`L${lvl.level} ${lvl.sheet}: ${plan.walls.length} segs -> ${runs.length} wall runs ` +
    `(${meta.totalRunLengthFt.toFixed(0)} ft; dropped ${meta.diagonalDropped} diag, ${meta.shortRunsDropped} short)`);
}

data.recoreWallRunsNote = 'wallRuns = collinear-merged single-band cut-wall segments into real ' +
  'wall runs (envelope + partitions), non-wall ink (diagonals/dimension stubs) excluded. This is ' +
  'the honest primary structure; the 41,784-segment wallsFull lineweight-union is retained only ' +
  'as an off-by-default diagnostic overlay. needs-verification (NOT AHJ/PE/AutoSprink-parity).';

fs.writeFileSync(OUT, JSON.stringify(data));
console.log(`augmented ${touched} level(s) -> ${OUT} (${fs.statSync(OUT).size} bytes)`);
