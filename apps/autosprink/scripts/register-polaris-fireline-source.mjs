import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

import { Dwg_File_Type, LibreDwg } from '@mlightcad/libredwg-web';

import { registerPolarisSiteSource } from './register-polaris-site-source.mjs';

const round = (value, precision = 9) => Number(value.toFixed(precision));

function nearestPointOnSegment(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1,
    ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
  const nearest = { x: start.x + t * dx, y: start.y + t * dy };
  return { nearest, distance: Math.hypot(point.x - nearest.x, point.y - nearest.y) };
}

async function readDwg(filePath) {
  const wasmRoot = path.resolve('node_modules/@mlightcad/libredwg-web/wasm/').replaceAll('\\', '/');
  const libredwg = await LibreDwg.create(`${wasmRoot}/`);
  const bytes = fs.readFileSync(filePath);
  const raw = libredwg.dwg_read_data(bytes, Dwg_File_Type.DWG);
  const converted = libredwg.convertEx(raw);
  return {
    libredwg,
    raw,
    converted,
    source: {
      fileName: path.basename(filePath),
      byteLength: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex').toUpperCase(),
    },
  };
}

function polylineSignature(entity) {
  const first = entity.vertices[0];
  return JSON.stringify(entity.vertices.map((point) => [
    round(point.x - first.x, 6),
    round(point.y - first.y, 6),
    round(point.bulge ?? 0, 6),
  ]));
}

function translationClusters(siteEntities, fireEntities, { includeLayer = true } = {}) {
  const siteBySignature = new Map();
  for (const entity of siteEntities) {
    const signature = `${includeLayer ? entity.layer : '*'}|${polylineSignature(entity)}`;
    const values = siteBySignature.get(signature) ?? [];
    values.push(entity);
    siteBySignature.set(signature, values);
  }
  const candidates = [];
  for (const fireEntity of fireEntities) {
    const matches = siteBySignature.get(`${includeLayer ? fireEntity.layer : '*'}|${polylineSignature(fireEntity)}`) ?? [];
    for (const siteEntity of matches) {
      candidates.push({
        layer: fireEntity.layer,
        siteHandle: String(siteEntity.handle),
        fireLineHandle: String(fireEntity.handle),
        x: fireEntity.vertices[0].x - siteEntity.vertices[0].x,
        y: fireEntity.vertices[0].y - siteEntity.vertices[0].y,
      });
    }
  }
  const clusters = new Map();
  for (const value of candidates) {
    const key = `${round(value.x, 5)}|${round(value.y, 5)}`;
    const values = clusters.get(key) ?? [];
    values.push(value);
    clusters.set(key, values);
  }
  return {
    candidates,
    clusters: [...clusters.entries()].sort((left, right) => right[1].length - left[1].length),
  };
}

export async function registerPolarisFireLineSource({
  sitePlanPath,
  fireLinePath,
  sourceCandidatePath,
}) {
  const [siteRegistration, site, fireLine] = await Promise.all([
    registerPolarisSiteSource({ sitePlanPath, sourceCandidatePath }),
    readDwg(sitePlanPath),
    readDwg(fireLinePath),
  ]);
  const layer = 'PDF_A-ANNO-TEXT';
  const sitePolylines = site.converted.database.entities.filter((entity) => entity.type === 'LWPOLYLINE'
    && entity.layer === layer && entity.vertices?.length >= 2);
  const firePolylines = fireLine.converted.database.entities.filter((entity) => entity.type === 'LWPOLYLINE'
    && entity.layer === layer && entity.vertices?.length >= 2);
  const layerTranslations = translationClusters(sitePolylines, firePolylines);
  const allSitePolylines = site.converted.database.entities.filter((entity) => entity.type === 'LWPOLYLINE'
    && entity.vertices?.length >= 2);
  const allFirePolylines = fireLine.converted.database.entities.filter((entity) => entity.type === 'LWPOLYLINE'
    && entity.vertices?.length >= 2);
  const allTranslations = translationClusters(allSitePolylines, allFirePolylines);
  const embeddedSiteBlock = fireLine.converted.database.tables.BLOCK_RECORD.entries
    .find((block) => block.name === 'A$C2896eb2f');
  const embeddedSiteInsert = fireLine.converted.database.entities.find((entity) => entity.type === 'INSERT'
    && entity.name === embeddedSiteBlock?.name && entity.ownerBlockRecordSoftId === '1F');
  const embeddedSitePolylines = (embeddedSiteBlock?.entities ?? []).filter((entity) => entity.type === 'LWPOLYLINE'
    && entity.vertices?.length >= 2);
  const embeddedSiteTranslations = translationClusters(allSitePolylines, embeddedSitePolylines, { includeLayer: false });
  const translationCandidates = layerTranslations.candidates;
  const dominant = layerTranslations.clusters[0];
  if (!dominant) throw new Error('POLARIS_SITE_FIRELINE_SHARED_GEOMETRY_MISSING');
  const [translationKey, matches] = dominant;
  const [translationX, translationY] = translationKey.split('|').map(Number);
  const annotationTransformedRiser = Object.fromEntries(Object.entries(siteRegistration.sprinklerRiserInSiteInches)
    .map(([key, point]) => [key, {
      x: round(point.x + translationX),
      y: round(point.y + translationY),
    }]));
  const fireLineRisers = fireLine.converted.database.entities.filter((entity) => entity.type === 'INSERT'
    && entity.layer === 'pipefitt' && entity.name === 'RISER').map((entity) => ({
      id: `riser-${entity.handle}`,
      point: entity.insertionPoint,
    }));
  const dominantEmbeddedTranslation = embeddedSiteTranslations.clusters[0] ?? null;
  const [embeddedTranslationX, embeddedTranslationY] = dominantEmbeddedTranslation
    ? dominantEmbeddedTranslation[0].split('|').map(Number)
    : [Number.NaN, Number.NaN];
  const embeddedTransformReady = Boolean(dominantEmbeddedTranslation && embeddedSiteInsert);
  const transformThroughEmbeddedSiteBlock = (point) => {
    const localX = point.x + embeddedTranslationX - (embeddedSiteBlock?.basePoint?.x ?? 0);
    const localY = point.y + embeddedTranslationY - (embeddedSiteBlock?.basePoint?.y ?? 0);
    const scaleX = embeddedSiteInsert?.xScale ?? 1;
    const scaleY = embeddedSiteInsert?.yScale ?? 1;
    const rotation = embeddedSiteInsert?.rotation ?? 0;
    return {
      x: round((embeddedSiteInsert?.insertionPoint?.x ?? 0)
        + localX * scaleX * Math.cos(rotation) - localY * scaleY * Math.sin(rotation)),
      y: round((embeddedSiteInsert?.insertionPoint?.y ?? 0)
        + localX * scaleX * Math.sin(rotation) + localY * scaleY * Math.cos(rotation)),
    };
  };
  const transformedRiser = embeddedTransformReady
    ? Object.fromEntries(Object.entries(siteRegistration.sprinklerRiserInSiteInches)
      .map(([key, point]) => [key, transformThroughEmbeddedSiteBlock(point)]))
    : null;
  const siteOutline = allSitePolylines.find((entity) => String(entity.handle) === String(siteRegistration.siteOutlineHandle));
  const transformedSiteOutline = embeddedTransformReady && siteOutline
    ? siteOutline.vertices.map(transformThroughEmbeddedSiteBlock)
    : [];
  const fireLinePipeEntities = allFirePolylines.filter((entity) => entity.layer === 'red'
    && Number(entity.constantWidth) > 4.68 && Number(entity.constantWidth) < 4.70);
  const pipeEndpointBuildingOutlineBindings = fireLinePipeEntities.flatMap((entity) => [
    { pipeHandle: String(entity.handle), endpointIndex: 0, point: entity.vertices[0] },
    { pipeHandle: String(entity.handle), endpointIndex: entity.vertices.length - 1, point: entity.vertices.at(-1) },
  ]).map((endpoint) => {
    const segments = transformedSiteOutline.map((start, index) => ({
      start,
      end: transformedSiteOutline[(index + 1) % transformedSiteOutline.length],
      outlineSegmentIndex: index,
    }));
    const nearest = segments.reduce((best, segment) => {
      const candidate = nearestPointOnSegment(endpoint.point, segment.start, segment.end);
      return !best || candidate.distance < best.distance
        ? { ...candidate, outlineSegmentIndex: segment.outlineSegmentIndex }
        : best;
    }, null);
    return {
      ...endpoint,
      nearestOutlinePoint: nearest ? {
        x: round(nearest.nearest.x),
        y: round(nearest.nearest.y),
      } : null,
      outlineSegmentIndex: nearest?.outlineSegmentIndex ?? null,
      residualInches: nearest ? round(nearest.distance) : null,
    };
  }).sort((left, right) => left.residualInches - right.residualInches);
  const fireLinePipeEndpoints = fireLinePipeEntities.flatMap((entity) => [
    { pipeHandle: String(entity.handle), endpointIndex: 0, point: entity.vertices[0] },
    { pipeHandle: String(entity.handle), endpointIndex: entity.vertices.length - 1, point: entity.vertices.at(-1) },
  ]);
  const nearestFireLinePipeEndpointToNode116 = transformedRiser?.node116
    ? fireLinePipeEndpoints.map((endpoint) => ({
      ...endpoint,
      residualInches: round(Math.hypot(
        endpoint.point.x - transformedRiser.node116.x,
        endpoint.point.y - transformedRiser.node116.y,
      )),
    })).sort((left, right) => left.residualInches - right.residualInches)[0]
    : null;
  const transformedNode116 = transformedRiser?.node116;
  const nearestRiser = transformedNode116 ? fireLineRisers.reduce((best, riser) => {
    const residualInches = Math.hypot(riser.point.x - transformedNode116.x, riser.point.y - transformedNode116.y);
    return !best || residualInches < best.residualInches ? { ...riser, residualInches } : best;
  }, null) : null;
  const sourceCandidateBytes = fs.readFileSync(sourceCandidatePath);
  const siteOutlineEmbeddedMatches = embeddedSiteTranslations.candidates
    .filter((value) => value.siteHandle === String(siteRegistration.siteOutlineHandle))
    .map(({ siteHandle, fireLineHandle, layer: matchedLayer, x, y }) => ({
      siteHandle,
      embeddedHandle: fireLineHandle,
      embeddedLayer: matchedLayer,
      translationInches: [round(x, 5), round(y, 5)],
    }));
  const exactCoordinateRegistrationReady = (dominantEmbeddedTranslation?.[1].length ?? 0) >= 3
    && embeddedTransformReady
    && siteRegistration.maximumResidualInches <= 0.5
    && siteRegistration.rigidRegistrationUniquenessMarginInches >= 12
    && siteOutlineEmbeddedMatches.length === 1
    && siteOutlineEmbeddedMatches[0].translationInches[0] === round(embeddedTranslationX, 5)
    && siteOutlineEmbeddedMatches[0].translationInches[1] === round(embeddedTranslationY, 5);
  const result = {
    schema: 'halofire.polaris-fireline-registration.v1',
    sources: {
      sitePlan: site.source,
      fireLine: fireLine.source,
      sprinklerCandidate: {
        fileName: path.basename(sourceCandidatePath),
        byteLength: sourceCandidateBytes.length,
        sha256: createHash('sha256').update(sourceCandidateBytes).digest('hex').toUpperCase(),
      },
    },
    siteRegistration,
    sharedLayer: layer,
    sitePolylineCount: sitePolylines.length,
    fireLinePolylineCount: firePolylines.length,
    translationCandidateCount: translationCandidates.length,
    dominantExactTranslationMatchCount: matches.length,
    siteToFireLineTranslationInches: [translationX, translationY],
    dominantMatchHandles: matches.slice(0, 20).map(({ siteHandle, fireLineHandle }) => ({ siteHandle, fireLineHandle })),
    topSameLayerExactTranslationClusters: allTranslations.clusters.slice(0, 20).map(([key, values]) => ({
      translationInches: key.split('|').map(Number),
      matchCount: values.length,
      layerCounts: Object.fromEntries([...values.reduce((counts, value) => {
        counts.set(value.layer, (counts.get(value.layer) ?? 0) + 1);
        return counts;
      }, new Map())]),
      exampleHandles: values.slice(0, 5).map(({ siteHandle, fireLineHandle }) => ({ siteHandle, fireLineHandle })),
    })),
    rejectedAnnotationTransformedSprinklerRiserInFireLineInches: annotationTransformedRiser,
    embeddedSiteBlock: embeddedSiteBlock && embeddedSiteInsert ? {
      name: embeddedSiteBlock.name,
      handle: String(embeddedSiteBlock.handle),
      insertionPoint: embeddedSiteInsert.insertionPoint,
      scale: [embeddedSiteInsert.xScale, embeddedSiteInsert.yScale],
      rotationRadians: embeddedSiteInsert.rotation,
      polylineCount: embeddedSitePolylines.length,
    } : null,
    topEmbeddedSiteExactTranslationClusters: embeddedSiteTranslations.clusters.slice(0, 20).map(([key, values]) => ({
      translationInches: key.split('|').map(Number),
      matchCount: values.length,
      layerPairCounts: Object.fromEntries([...values.reduce((counts, value) => {
        const siteEntity = allSitePolylines.find((entity) => String(entity.handle) === value.siteHandle);
        const embeddedEntity = embeddedSitePolylines.find((entity) => String(entity.handle) === value.fireLineHandle);
        const layerPair = `${siteEntity?.layer ?? '?'} -> ${embeddedEntity?.layer ?? '?'}`;
        counts.set(layerPair, (counts.get(layerPair) ?? 0) + 1);
        return counts;
      }, new Map())]),
      exampleHandles: values.slice(0, 5).map(({ siteHandle, fireLineHandle }) => ({ siteHandle, fireLineHandle })),
    })),
    siteOutlineEmbeddedMatches,
    transformedSiteOutlineInFireLineInches: transformedSiteOutline,
    nearestFireLinePipeEndpointsToBuildingOutline: pipeEndpointBuildingOutlineBindings.slice(0, 12),
    nearestFireLinePipeEndpointToHydraulicNode116: nearestFireLinePipeEndpointToNode116,
    transformedSprinklerRiserInFireLineInches: transformedRiser,
    nearestFireLineRiser: nearestRiser ? {
      id: nearestRiser.id,
      point: nearestRiser.point,
      residualInches: round(nearestRiser.residualInches),
    } : null,
    fireLineRisers,
    claims: {
      rejectedAnnotationTranslationFound: matches.length >= 3,
      exactSharedGeometryTranslationReady: (dominantEmbeddedTranslation?.[1].length ?? 0) >= 3,
      sitePlanToFireLineCoordinateRegistrationReady: exactCoordinateRegistrationReady,
      sprinklerCadToFireLineCoordinateRegistrationReady: exactCoordinateRegistrationReady,
      hydraulicNodeToFireLinePipeBindingReady: nearestFireLinePipeEndpointToNode116?.residualInches <= 6,
      sprinklerRiserToFireLineRiserReady: nearestRiser?.residualInches <= 6,
    },
  };
  result.receiptSha256 = createHash('sha256').update(JSON.stringify(result)).digest('hex').toUpperCase();
  site.libredwg.dwg_free(site.raw);
  fireLine.libredwg.dwg_free(fireLine.raw);
  return result;
}

if (import.meta.url === `file:///${process.argv[1]?.replaceAll('\\', '/')}`) {
  const [sitePlanPath, fireLinePath, sourceCandidatePath] = process.argv.slice(2);
  if (!sourceCandidatePath) throw new Error('USAGE: register-polaris-fireline-source.mjs <site-plan.dwg> <fire-line.dwg> <source-candidate.json>');
  process.stdout.write(`${JSON.stringify(await registerPolarisFireLineSource({
    sitePlanPath,
    fireLinePath,
    sourceCandidatePath,
  }), null, 2)}\n`);
}
