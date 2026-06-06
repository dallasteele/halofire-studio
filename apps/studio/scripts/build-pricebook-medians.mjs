// HaloFire Studio — REAL pricebook median generator.
//
// Opens the autosprink seeded sqlite (the imported Victaulic/ARGCO/FFF pricebook,
// ~7,208 rows), applies the SAME PRICE_BANDS keyword + band-median logic as
// apps/autosprink/src/engine/pricebook-pricing.js for each BOM key, and writes
// apps/studio/public/parts/pricebook-medians.json. Each emitted unitPrice is a
// REAL in-band median over real pricebook rows — never a hand-picked constant.
//
// HONESTY: this script DOES NOT fabricate prices. If the sqlite is missing it
// fails loudly (exit 1) rather than emitting fake data. The medians are a
// representative pricebook-derived price, NOT a live per-line manufacturer quote.
//
// Run from apps/studio:  node scripts/build-pricebook-medians.mjs

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { PRICE_BANDS, median } from '../../autosprink/src/engine/pricebook-pricing.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// better-sqlite3 lives in apps/autosprink (it owns the seeded pricebook db), not
// in apps/studio. Resolve + load it from the autosprink workspace so this
// generator works without adding a heavy native dep to the studio app.
const AUTOSPRINK_DIR = resolvePath(__dirname, '../../autosprink');
const autosprinkRequire = createRequire(pathToFileURL(resolvePath(AUTOSPRINK_DIR, 'package.json')));
const Database = autosprinkRequire('better-sqlite3');

const DB_PATH = resolvePath(__dirname, '../../autosprink/data/halofire.db');
const OUT_PATH = resolvePath(__dirname, '../public/parts/pricebook-medians.json');

// BOM keys the studio bid prices, mapped to the autosprink PRICE_BANDS keys and
// to a unit of measure. These are the keys for which the autosprink resolver
// returns a real non-null in-band median against the seeded pricebook.
const BOM_KEYS = Object.freeze({
  sprinkler_head: 'EA',
  esfr_head: 'EA',
  branch_pipe: 'FT',
  cross_main_pipe: 'FT',
  feed_main_pipe: 'FT',
  fitting: 'EA',
  hanger: 'EA',
  escutcheon: 'EA',
  drop_armover: 'EA',
  underground_main: 'FT',
});

if (!existsSync(DB_PATH)) {
  console.error(`[build-pricebook-medians] FATAL: sqlite not found at ${DB_PATH}`);
  console.error('Re-seed it from apps/autosprink with: node src/db/seed.js');
  console.error('(env HALOFIRE_ALLOW_DEV_DEFAULTS=1 HALOFIRE_ADMIN_PASSWORD=x JWT_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx)');
  process.exit(1);
}

const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });

const sourceRowCount = db.prepare('SELECT COUNT(*) AS c FROM pricebook').get().c;
if (!(sourceRowCount > 0)) {
  console.error('[build-pricebook-medians] FATAL: pricebook table is empty.');
  process.exit(1);
}

// Apply the SAME band + keyword + median logic as pricebook-pricing.js, but also
// capture the matched-row count so the JSON is self-documenting.
function resolveBand(key) {
  const band = PRICE_BANDS[key];
  if (!band) return null;
  const like = band.keywords.map(() => 'LOWER(item) LIKE ?').join(' OR ');
  const params = band.keywords.map((kw) => `%${kw.toLowerCase()}%`);
  const rows = db
    .prepare(`SELECT item, price FROM pricebook WHERE price >= ? AND price <= ? AND (${like})`)
    .all(band.min, band.max, ...params);
  const prices = rows.map((r) => r.price).filter((p) => p > 0);
  const m = median(prices);
  return { unitPrice: m, matchedRows: prices.length, band: [band.min, band.max] };
}

const medians = {};
const skipped = [];
for (const [key, unit] of Object.entries(BOM_KEYS)) {
  const r = resolveBand(key);
  if (r == null || r.unitPrice == null || !(r.unitPrice > 0) || r.matchedRows < 1) {
    skipped.push(key);
    continue;
  }
  medians[key] = {
    unitPrice: r.unitPrice,
    unit,
    matchedRows: r.matchedRows,
    band: r.band,
  };
}

if (Object.keys(medians).length === 0) {
  console.error('[build-pricebook-medians] FATAL: no BOM key resolved a real median.');
  process.exit(1);
}

const out = {
  generatedAt: new Date().toISOString(),
  sourceRowCount,
  currency: 'USD',
  source: 'apps/autosprink/data/halofire.db pricebook (imported Victaulic/ARGCO/FFF rows)',
  note:
    'Each unitPrice is a REAL in-band median over real imported pricebook rows ' +
    '(same PRICE_BANDS logic as apps/autosprink/src/engine/pricebook-pricing.js). ' +
    'Representative pricebook-derived price, NOT a live per-line manufacturer quote.',
  medians,
};

mkdirSync(dirname(OUT_PATH), { recursive: true });
writeFileSync(OUT_PATH, JSON.stringify(out, null, 2) + '\n', 'utf8');

console.log(`[build-pricebook-medians] sourceRowCount=${sourceRowCount}`);
console.log(`[build-pricebook-medians] wrote ${Object.keys(medians).length} medians to ${OUT_PATH}`);
for (const [k, v] of Object.entries(medians)) {
  console.log(`  ${k}: $${v.unitPrice}/${v.unit} (matchedRows=${v.matchedRows}, band=${v.band[0]}..${v.band[1]})`);
}
if (skipped.length) console.log(`[build-pricebook-medians] skipped (no real median): ${skipped.join(', ')}`);
