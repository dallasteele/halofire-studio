// HaloFire Studio — manufacturer-CAD IMPORT LANE (T54).
//
// Scans public/parts/manufacturer-incoming/<slug>/ for *.stp / *.step files,
// copies each to public/parts/manufacturer-step/<slug>.stp, computes the REAL
// sha256, and UPSERTS an entry into public/parts/manufacturer-step.json.
//
// This is how a REAL downloaded, licensed manufacturer STEP enters the studio at
// the TOP provenance tier (manufacturer_verified / engineeringAccurate). The
// manifest JSON is committed; the licensed STEP binaries are gitignored (see
// .gitignore) and are NEVER redistributed — they are served locally for the demo.
//
// HONESTY (hard, fail-closed):
//   - An entry is written ONLY when a real STEP file was copied and its sha256
//     computed over the real bytes. No file -> the folder is SKIPPED honestly
//     (logged, never upserted).
//   - manufacturerExact:true is written, but the downstream honesty gate
//     (isOperatorVerified) still REQUIRES a real stepUrl + sha256 — the flag alone
//     never grants the tier.
//   - manufacturer / productCode / category come from a sidecar (meta.json) when
//     present, else from a small known-folder table, else honest fallbacks derived
//     from the slug. NOTHING about accuracy is invented.
//   - "manufacturer_verified" means dimensionally-accurate manufacturer CAD — it is
//     explicitly NOT AHJ / PE / sealed / permit / for-construction.
//
// Idempotent: re-running with the same inputs yields the same manifest (entries are
// upserted by slug; the JSON is sorted by slug; identical bytes -> identical sha256).
//
// Run from apps/studio:  node scripts/import-manufacturer-step.mjs

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, extname, join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Default to the studio's public/parts; tests may override via env to run the
// SAME logic against a temp fixture dir (no special test path in the code).
const PUBLIC_PARTS =
  typeof process.env.HF_IMPORT_PUBLIC_PARTS === 'string' &&
  process.env.HF_IMPORT_PUBLIC_PARTS.trim().length > 0
    ? resolvePath(process.env.HF_IMPORT_PUBLIC_PARTS)
    : resolvePath(__dirname, '../public/parts');
const INCOMING_DIR = join(PUBLIC_PARTS, 'manufacturer-incoming');
const STAGED_DIR = join(PUBLIC_PARTS, 'manufacturer-step');
const MANIFEST_PATH = join(PUBLIC_PARTS, 'manufacturer-step.json');

const LICENSE = 'CADENAS 3Dfindit terms-of-use';

// Known-folder metadata (used when a folder has no meta.json sidecar). Keep this
// table small + explicit — we only assert what we actually know about the part.
const KNOWN = {
  'ksb-etanorm-fxe-125-100-200-2a': {
    manufacturer: 'KSB SE & Co. KGaA',
    productCode: 'Etanorm FXE 125-100-200-2a',
    category: 'pump',
    sourceUrl: 'https://www.ksb.com/',
  },
};

/** True for a STEP file by extension (.stp / .step, any case). */
function isStepFile(name) {
  const ext = extname(name).toLowerCase();
  return ext === '.stp' || ext === '.step';
}

/** sha256 (uppercase hex) over the real file bytes. */
function sha256Of(filePath) {
  const buf = readFileSync(filePath);
  return createHash('sha256').update(buf).digest('hex').toUpperCase();
}

/** Title-case fallback from a slug, e.g. "acme-foo-bar" -> "Acme Foo Bar". */
function titleFromSlug(slug) {
  return slug
    .split(/[-_]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * Resolve part metadata for a folder. Priority: meta.json sidecar -> KNOWN table
 * -> honest slug-derived fallbacks. Returns null only when a folder is unusable.
 */
function resolveMeta(slug, folderPath) {
  const sidecarPath = join(folderPath, 'meta.json');
  let sidecar = {};
  if (existsSync(sidecarPath)) {
    try {
      sidecar = JSON.parse(readFileSync(sidecarPath, 'utf8')) ?? {};
    } catch {
      sidecar = {};
    }
  }
  const known = KNOWN[slug] ?? {};
  const manufacturer =
    str(sidecar.manufacturer) ?? str(known.manufacturer) ?? titleFromSlug(slug.split('-')[0] ?? slug);
  const productCode = str(sidecar.productCode) ?? str(known.productCode) ?? titleFromSlug(slug);
  const category = str(sidecar.category) ?? str(known.category) ?? null;
  const sourceUrl = str(sidecar.sourceUrl) ?? str(known.sourceUrl) ?? null;
  return { manufacturer, productCode, category, sourceUrl };
}

function str(v) {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
}

/** Load the existing manifest (fail-soft to an empty one). */
function loadManifest() {
  if (!existsSync(MANIFEST_PATH)) return { entries: [] };
  try {
    const json = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
    if (json && typeof json === 'object' && Array.isArray(json.entries)) {
      return { entries: json.entries };
    }
  } catch {
    /* fall through to empty */
  }
  return { entries: [] };
}

function main() {
  if (!existsSync(INCOMING_DIR)) {
    console.log(`[import-manufacturer-step] no incoming dir at ${INCOMING_DIR} — nothing to import.`);
    return;
  }

  mkdirSync(STAGED_DIR, { recursive: true });

  const manifest = loadManifest();
  // Index existing entries by slug (or key) so we UPSERT rather than duplicate.
  const bySlug = new Map();
  for (const e of manifest.entries) {
    const id = str(e?.slug) ?? str(e?.key);
    if (id) bySlug.set(id, e);
  }

  const folders = readdirSync(INCOMING_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  let ingested = 0;
  const skipped = [];

  for (const slug of folders) {
    const folderPath = join(INCOMING_DIR, slug);
    const stepName = readdirSync(folderPath).find(isStepFile);
    if (!stepName) {
      skipped.push(`${slug} (no .stp/.step file)`);
      continue;
    }
    const srcStep = join(folderPath, stepName);
    if (!statSync(srcStep).isFile()) {
      skipped.push(`${slug} (STEP path is not a file)`);
      continue;
    }

    const destStep = join(STAGED_DIR, `${slug}.stp`);
    copyFileSync(srcStep, destStep);
    const sha256 = sha256Of(destStep);
    const meta = resolveMeta(slug, folderPath);

    const entry = {
      // `key` doubles as the catalog-upgrade key; for standalone imports it equals slug.
      key: slug,
      slug,
      manufacturer: meta.manufacturer,
      productCode: meta.productCode,
      modelName: meta.productCode,
      category: meta.category ?? undefined,
      stepUrl: `/parts/manufacturer-step/${slug}.stp`,
      stepFile: `/parts/manufacturer-step/${slug}.stp`,
      sha256,
      manufacturerExact: true,
      sourceUrl: meta.sourceUrl ?? undefined,
      license: LICENSE,
      ingestedFrom: `public/parts/manufacturer-incoming/${slug}/${stepName}`,
    };

    bySlug.set(slug, { ...(bySlug.get(slug) ?? {}), ...entry });
    ingested += 1;
    console.log(`[import-manufacturer-step] ingested ${slug}: sha256=${sha256}`);
  }

  // Stable, sorted-by-slug output for idempotent diffs.
  const entries = [...bySlug.values()].sort((a, b) => {
    const ka = str(a.slug) ?? str(a.key) ?? '';
    const kb = str(b.slug) ?? str(b.key) ?? '';
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });

  writeFileSync(MANIFEST_PATH, JSON.stringify({ entries }, null, 2) + '\n', 'utf8');

  console.log(`[import-manufacturer-step] ingested ${ingested} manufacturer part(s).`);
  console.log(`[import-manufacturer-step] manifest now has ${entries.length} entr(y/ies): ${MANIFEST_PATH}`);
  if (skipped.length) {
    console.log(`[import-manufacturer-step] skipped: ${skipped.join('; ')}`);
  }
}

main();
