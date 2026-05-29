/**
 * HaloFire Scraper Skill — OpenClaw Integration
 *
 * Wraps the Python Scrapling engine for use by the skill runner
 * and Qwen AI agent via cron or ad-hoc calls.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const exec = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRAPER_PY = path.join(__dirname, 'scraper.py');
const REFS_DIR = path.join(__dirname, 'refs');
const CATALOG_FILE = path.join(REFS_DIR, 'template_catalog.json');

async function runPython(args) {
  const { stdout, stderr } = await exec('python3', [SCRAPER_PY, ...args], {
    timeout: 120000,
    cwd: __dirname,
  });
  if (stderr) console.warn('[scraper] stderr:', stderr);
  return stdout;
}

/**
 * Search ThemeForest for templates
 */
export async function search(ctx) {
  const { query = 'admin dashboard', framework, minRating = 4.0, maxPrice = 100, pages = 2 } = ctx.params;

  ctx.log.info(`Searching templates: "${query}" framework=${framework || 'any'}`);

  const args = ['search', '--query', query, '--min-rating', String(minRating), '--max-price', String(maxPrice), '--pages', String(pages)];
  if (framework) args.push('--framework', framework);

  const output = await runPython(args);

  try {
    const results = JSON.parse(output);
    ctx.saveState({ lastSearch: { query, framework, resultCount: results.length, at: new Date().toISOString() } });
    return { templates: results, count: results.length };
  } catch {
    return { raw: output };
  }
}

/**
 * Build curated catalog of top templates
 */
export async function catalog(ctx) {
  const { top = 20 } = ctx.params;
  ctx.log.info(`Building template catalog (top ${top})`);

  await runPython(['catalog', '--top', String(top)]);

  if (fs.existsSync(CATALOG_FILE)) {
    const catalog = JSON.parse(fs.readFileSync(CATALOG_FILE, 'utf8'));
    ctx.saveState({ catalogBuilt: new Date().toISOString(), templateCount: catalog.templates?.length || 0 });
    return catalog;
  }

  return { error: 'Catalog file not created' };
}

/**
 * Preview a specific template
 */
export async function preview(ctx) {
  const { url } = ctx.params;
  if (!url) throw new Error('URL is required for preview');

  ctx.log.info(`Previewing template: ${url}`);
  const output = await runPython(['preview', '--url', url]);

  try {
    return JSON.parse(output);
  } catch {
    return { raw: output };
  }
}

/**
 * Get HaloFire-specific recommendations
 */
export async function recommend(ctx) {
  ctx.log.info('Generating HaloFire template recommendations');
  const output = await runPython(['recommend']);

  // Also load catalog for structured data
  if (fs.existsSync(CATALOG_FILE)) {
    const catalog = JSON.parse(fs.readFileSync(CATALOG_FILE, 'utf8'));
    return {
      recommendations: catalog.templates?.slice(0, 5) || [],
      rawOutput: output
    };
  }

  return { rawOutput: output };
}

/**
 * Cron handler — periodic catalog refresh
 */
export async function cronRun(ctx) {
  ctx.log.info('Cron: refreshing template catalog');
  return catalog(ctx);
}

export default { search, catalog, preview, recommend, cronRun };
