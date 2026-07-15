import fs from 'node:fs';
import path from 'node:path';

import { Dwg_File_Type, LibreDwg } from '@mlightcad/libredwg-web';

const round = (value, precision = 9) => Number(value.toFixed(precision));

function solveRigid(source, target) {
  const sourceCenter = source.reduce((sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }), { x: 0, y: 0 });
  const targetCenter = target.reduce((sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }), { x: 0, y: 0 });
  sourceCenter.x /= source.length;
  sourceCenter.y /= source.length;
  targetCenter.x /= target.length;
  targetCenter.y /= target.length;
  let dot = 0;
  let cross = 0;
  let sourceEnergy = 0;
  let targetEnergy = 0;
  for (let index = 0; index < source.length; index += 1) {
    const sx = source[index].x - sourceCenter.x;
    const sy = source[index].y - sourceCenter.y;
    const tx = target[index].x - targetCenter.x;
    const ty = target[index].y - targetCenter.y;
    dot += sx * tx + sy * ty;
    cross += sx * ty - sy * tx;
    sourceEnergy += sx ** 2 + sy ** 2;
    targetEnergy += tx ** 2 + ty ** 2;
  }
  const rotationRadians = Math.atan2(cross, dot);
  const scale = Math.sqrt(targetEnergy / sourceEnergy);
  const cosine = Math.cos(rotationRadians);
  const sine = Math.sin(rotationRadians);
  const transform = (point) => ({
    x: targetCenter.x + scale * (cosine * (point.x - sourceCenter.x) - sine * (point.y - sourceCenter.y)),
    y: targetCenter.y + scale * (sine * (point.x - sourceCenter.x) + cosine * (point.y - sourceCenter.y)),
  });
  const residuals = source.map((point, index) => Math.hypot(
    transform(point).x - target[index].x,
    transform(point).y - target[index].y,
  ));
  return {
    scale,
    rotationRadians,
    rotationDegrees: rotationRadians * 180 / Math.PI,
    translation: transform({ x: 0, y: 0 }),
    maximumResidualInches: Math.max(...residuals),
    rootMeanSquareResidualInches: Math.sqrt(residuals.reduce((sum, value) => sum + value ** 2, 0) / residuals.length),
    transform,
  };
}

function solveCyclicRigid(source, target) {
  let best = null;
  let secondBest = null;
  for (const reversed of [false, true]) {
    const values = reversed ? [...target].reverse() : target;
    for (let offset = 0; offset < values.length; offset += 1) {
      const aligned = source.map((_point, index) => values[(index + offset) % values.length]);
      const solved = solveRigid(source, aligned);
      const candidate = { ...solved, reversed, cyclicOffset: offset };
      if (!best || candidate.rootMeanSquareResidualInches < best.rootMeanSquareResidualInches) {
        secondBest = best;
        best = candidate;
      } else if (!secondBest || candidate.rootMeanSquareResidualInches < secondBest.rootMeanSquareResidualInches) {
        secondBest = candidate;
      }
    }
  }
  return {
    ...best,
    secondBestRootMeanSquareResidualInches: secondBest?.rootMeanSquareResidualInches ?? null,
  };
}

export async function registerPolarisSiteSource({ sitePlanPath, sourceCandidatePath }) {
  const sourceCandidate = JSON.parse(fs.readFileSync(sourceCandidatePath, 'utf8'));
  const localOutlineInches = sourceCandidate.buildingModel.levels[0].footprintPolygonFt
    .map(([x, y]) => ({ x: x * 12, y: y * 12 }));
  const wasmRoot = path.resolve('node_modules/@mlightcad/libredwg-web/wasm/').replaceAll('\\', '/');
  const libredwg = await LibreDwg.create(`${wasmRoot}/`);
  const raw = libredwg.dwg_read_data(fs.readFileSync(sitePlanPath), Dwg_File_Type.DWG);
  const converted = libredwg.convertEx(raw);
  const siteOutline = converted.database.entities.find((entity) => entity.type === 'LWPOLYLINE'
    && entity.layer === 'PDF_PLAN$A-SITE-BLDG-OTLN'
    && entity.vertices?.length === 73);
  if (!siteOutline) throw new Error('POLARIS_SITE_73_VERTEX_OUTLINE_MISSING');
  const solved = solveCyclicRigid(localOutlineInches, siteOutline.vertices);
  const transform = (pointFt) => solved.transform({ x: pointFt.x * 12, y: pointFt.y * 12 });
  const result = {
    siteOutlineHandle: String(siteOutline.handle),
    matchedVertexCount: siteOutline.vertices.length,
    cyclicOffset: solved.cyclicOffset,
    reversed: solved.reversed,
    scale: round(solved.scale, 12),
    rotationRadians: round(solved.rotationRadians, 12),
    rotationDegrees: round(solved.rotationDegrees, 9),
    localOriginInSiteInches: {
      x: round(solved.translation.x),
      y: round(solved.translation.y),
    },
    maximumResidualInches: round(solved.maximumResidualInches),
    rootMeanSquareResidualInches: round(solved.rootMeanSquareResidualInches),
    secondBestRootMeanSquareResidualInches: round(solved.secondBestRootMeanSquareResidualInches),
    rigidRegistrationUniquenessMarginInches: round(
      solved.secondBestRootMeanSquareResidualInches - solved.rootMeanSquareResidualInches,
    ),
    sprinklerRiserInSiteInches: Object.fromEntries([
      ['node116', { x: 177.598713214, y: 39.666666667 }],
      ['node13', { x: 174.208333333, y: 39.666666667 }],
    ].map(([key, point]) => {
      const value = transform(point);
      return [key, { x: round(value.x), y: round(value.y) }];
    })),
    parserUnknownEntityCount: converted.stats.unknownEntityCount,
  };
  libredwg.dwg_free(raw);
  return result;
}

if (import.meta.url === `file:///${process.argv[1]?.replaceAll('\\', '/')}`) {
  const [sitePlanPath, sourceCandidatePath] = process.argv.slice(2);
  if (!sourceCandidatePath) throw new Error('USAGE: register-polaris-site-source.mjs <site-plan.dwg> <source-candidate.json>');
  process.stdout.write(`${JSON.stringify(await registerPolarisSiteSource({ sitePlanPath, sourceCandidatePath }), null, 2)}\n`);
}
