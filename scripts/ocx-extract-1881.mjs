import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const ARCH_PDF = '/opt/hal9000/halofire-studio/apps/autosprink/plans/cooperative-1881/1881-architecturals.pdf';
const PAGE_NUMBER = 8;

function resolveFromCandidates(specifier) {
  const candidates = [
    path.join(process.cwd(), 'package.json'),
    '/opt/hal9000/halofire-studio/package.json',
    '/opt/hal9000/apps/openclaw/package.json',
  ];
  for (const candidate of candidates) {
    try {
      const req = createRequire(candidate);
      return req.resolve(specifier);
    } catch {
      // Try the next anchor.
    }
  }
  throw new Error(`unable to resolve ${specifier} from cwd=${process.cwd()}`);
}

const pdfjs = await import(
  pathToFileURL(resolveFromCandidates('pdfjs-dist/legacy/build/pdf.mjs')).href
);
pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(
  resolveFromCandidates('pdfjs-dist/legacy/build/pdf.worker.mjs')
).href;

const { extractLevelPlanFromPdf } = await import(
  pathToFileURL('/opt/hal9000/halofire-studio/apps/autosprink/src/engine/plan-extract.js').href
);
const { extractStructureLayerFromPdf } = await import(
  pathToFileURL('/opt/hal9000/halofire-studio/apps/autosprink/src/engine/structure-from-plan.js').href
);

function round(n) {
  return Math.round((Number(n) + Number.EPSILON) * 1e4) / 1e4;
}

function computeBounds(points) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    const x = Number(point?.[0]);
    const y = Number(point?.[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  if (!Number.isFinite(minX)) return null;
  return [round(minX), round(minY), round(maxX), round(maxY)];
}

function summarizeBounds(bounds) {
  return bounds ? bounds.join(',') : 'none';
}

async function main() {
  const outputPath = process.argv[2];
  if (!outputPath) {
    throw new Error('usage: node /opt/hal9000/state/_ocx_extract_1881.mjs <output.json>');
  }

  const data = new Uint8Array(await fs.readFile(ARCH_PDF));
  const task = pdfjs.getDocument({
    data,
    useWorkerFetch: false,
    isEvalSupported: false,
    disableFontFace: true,
  });

  try {
    const doc = await task.promise;
    const page = await doc.getPage(PAGE_NUMBER);
    const levelPlan = await extractLevelPlanFromPdf(page);
    const structLayer = await extractStructureLayerFromPdf(page);

    const wallsSource = Array.isArray(levelPlan.wallsFt)
      ? levelPlan.wallsFt
      : Array.isArray(levelPlan.walls)
        ? levelPlan.walls
        : [];
    const walls = wallsSource
      .map((wall) => ({
        a: [round(wall?.a?.[0]), round(wall?.a?.[1])],
        b: [round(wall?.b?.[0]), round(wall?.b?.[1])],
      }))
      .filter((wall) => wall.a.every(Number.isFinite) && wall.b.every(Number.isFinite));

    const columns = (Array.isArray(structLayer.columns) ? structLayer.columns : [])
      .map((column) => ({
        x: round(column?.x),
        y: round(column?.y),
        size: column?.size ?? null,
      }))
      .filter((column) => Number.isFinite(column.x) && Number.isFinite(column.y));

    const bounds = computeBounds(Array.isArray(levelPlan.footprintFt) ? levelPlan.footprintFt : []);
    const payload = { walls, columns, bounds };

    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`);

    console.log(`walls=${walls.length} cols=${columns.length} bounds=${summarizeBounds(bounds)}`);
  } finally {
    try {
      await task.destroy();
    } catch {
      // pdfjs destroy is best-effort in node.
    }
  }
}

await main();
