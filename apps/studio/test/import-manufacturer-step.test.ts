import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(HERE, '../scripts/import-manufacturer-step.mjs');

interface ManifestEntry {
  key: string;
  slug?: string;
  manufacturer: string;
  productCode: string;
  category?: string;
  stepUrl: string;
  stepFile?: string;
  sha256: string;
  manufacturerExact?: boolean;
  sourceUrl?: string;
  license?: string;
  ingestedFrom?: string;
}

let workDir: string;

/** Run the REAL import script against a temp public/parts via env override. */
function runImport(publicParts: string): string {
  return execFileSync(process.execPath, [SCRIPT], {
    env: { ...process.env, HF_IMPORT_PUBLIC_PARTS: publicParts },
    encoding: 'utf8',
  });
}

function readManifest(publicParts: string): { entries: ManifestEntry[] } {
  return JSON.parse(readFileSync(join(publicParts, 'manufacturer-step.json'), 'utf8'));
}

/** Stage an incoming folder with a STEP file of given bytes. */
function stageFolder(publicParts: string, slug: string, stepName: string, bytes: Buffer): void {
  const folder = join(publicParts, 'manufacturer-incoming', slug);
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, stepName), bytes);
}

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'hf-import-'));
  mkdirSync(join(workDir, 'manufacturer-incoming'), { recursive: true });
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe('import-manufacturer-step lane', () => {
  it('ingests a STEP folder: real sha256 + stepFile + manufacturerExact:true', () => {
    const bytes = Buffer.from('ISO-10303-21; fake step content', 'utf8');
    const expectedSha = createHash('sha256').update(bytes).digest('hex').toUpperCase();
    stageFolder(workDir, 'acme-pump-1', 'Acme_Pump.stp', bytes);

    runImport(workDir);

    const manifest = readManifest(workDir);
    expect(manifest.entries).toHaveLength(1);
    const e = manifest.entries[0];
    expect(e.slug).toBe('acme-pump-1');
    expect(e.sha256).toBe(expectedSha);
    expect(e.stepFile).toBe('/parts/manufacturer-step/acme-pump-1.stp');
    expect(e.stepUrl).toBe('/parts/manufacturer-step/acme-pump-1.stp');
    expect(e.manufacturerExact).toBe(true);
    expect(e.license).toBe('CADENAS 3Dfindit terms-of-use');
    // The staged binary was actually copied.
    expect(existsSync(join(workDir, 'manufacturer-step', 'acme-pump-1.stp'))).toBe(true);
  });

  it('is idempotent: re-running yields an identical manifest (upsert, no dupes)', () => {
    const bytes = Buffer.from('step-bytes-A', 'utf8');
    stageFolder(workDir, 'acme-pump-1', 'p.step', bytes);

    runImport(workDir);
    const first = readFileSync(join(workDir, 'manufacturer-step.json'), 'utf8');
    runImport(workDir);
    const second = readFileSync(join(workDir, 'manufacturer-step.json'), 'utf8');

    expect(second).toBe(first);
    expect(readManifest(workDir).entries).toHaveLength(1);
  });

  it('scans MULTIPLE folders generically, sorted by slug', () => {
    stageFolder(workDir, 'zeta-valve', 'v.stp', Buffer.from('z', 'utf8'));
    stageFolder(workDir, 'alpha-head', 'h.step', Buffer.from('a', 'utf8'));

    runImport(workDir);

    const entries = readManifest(workDir).entries;
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.slug)).toEqual(['alpha-head', 'zeta-valve']);
  });

  it('SKIPS a folder honestly when it has no .stp/.step file (no fabricated entry)', () => {
    const folder = join(workDir, 'manufacturer-incoming', 'no-cad-here');
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, 'readme.txt'), 'no cad', 'utf8');

    const out = runImport(workDir);

    expect(readManifest(workDir).entries).toHaveLength(0);
    expect(out).toMatch(/skipped/i);
    expect(out).toMatch(/no-cad-here/);
  });

  it('reads manufacturer/productCode/category from a meta.json sidecar', () => {
    stageFolder(workDir, 'beta-fitting', 'f.stp', Buffer.from('b', 'utf8'));
    writeFileSync(
      join(workDir, 'manufacturer-incoming', 'beta-fitting', 'meta.json'),
      JSON.stringify({
        manufacturer: 'Beta Mfg Inc.',
        productCode: 'BF-200',
        category: 'fitting',
        sourceUrl: 'https://beta.example.com/bf-200',
      }),
      'utf8',
    );

    runImport(workDir);

    const e = readManifest(workDir).entries[0];
    expect(e.manufacturer).toBe('Beta Mfg Inc.');
    expect(e.productCode).toBe('BF-200');
    expect(e.category).toBe('fitting');
    expect(e.sourceUrl).toBe('https://beta.example.com/bf-200');
  });

  it('a new folder added later is upserted alongside existing entries', () => {
    stageFolder(workDir, 'first-part', 'a.stp', Buffer.from('1', 'utf8'));
    runImport(workDir);
    expect(readManifest(workDir).entries).toHaveLength(1);

    stageFolder(workDir, 'second-part', 'b.stp', Buffer.from('2', 'utf8'));
    runImport(workDir);
    const entries = readManifest(workDir).entries;
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.slug)).toEqual(['first-part', 'second-part']);
  });
});
