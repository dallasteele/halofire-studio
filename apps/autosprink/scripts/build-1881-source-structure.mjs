import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

import { deriveScaleFromText, extractStructureLayerFromPdf } from '../src/engine/structure-from-plan.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../..');
const ARCH_PDF = 'E:/ClaudeBot/data/halofire/golden/1881/input/GC - Bid Plans/1881 - Architecturals.pdf';
const STRUCT_PDF = 'E:/ClaudeBot/HaloFireBidDocs/1-Bid Documents/GC - Bid Plans/1881 - Structurals.pdf';
const ARCH_MANIFEST = path.join(REPO, 'services/halofire-cad/agents/00-intake/registered-geometry/1881-architecturals.json');
const OUTPUT = path.join(REPO, 'services/halofire-cad/agents/00-intake/registered-geometry/1881-structurals.json');
const PROOF_DATA = path.join(REPO, 'output/visual-proof/1881-structural-source-overlay-data.json');

const LEVELS = [
  { sheet: 'A-101', vertical: [9, 10], overhead: [22, 23], verticalName: 'S-111', overheadName: 'S-121' },
  { sheet: 'A-102', vertical: [22, 23], overhead: [31, 32], verticalName: 'S-121', overheadName: 'S-131' },
  { sheet: 'A-103', vertical: [31, 32], overhead: [40, 41], verticalName: 'S-131', overheadName: 'S-141' },
  { sheet: 'A-104', vertical: [40, 41], overhead: [51, 52], verticalName: 'S-141', overheadName: 'S-150' },
  { sheet: 'A-105', vertical: [51, 52], overhead: [54, 55], verticalName: 'S-150', overheadName: 'S-160' },
  { sheet: 'A-106', vertical: [54, 55], overhead: [57, 58], verticalName: 'S-160', overheadName: 'S-170' },
  { sheet: 'A-107', vertical: [57, 58], overhead: [60, 61], verticalName: 'S-170', overheadName: 'S-180' },
  { sheet: 'A-108', vertical: [60, 61], overhead: [63, 64], verticalName: 'S-180', overheadName: 'S-190' },
];

const round = (value, places = 5) => Number(Number(value).toFixed(places));
const median = (values) => {
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.floor(ordered.length / 2)];
};
const sha256 = async (filename) => createHash('sha256').update(await readFile(filename)).digest('hex');

function cleanArchitecturalGrid(textContent, viewport, pageHeightPt, architecturalScaleFtPerPt) {
  const [x0, y0, x1, y1] = viewport.source_bbox_pt;
  const expansionPt = 100;
  const candidates = textContent.items.filter((item) => {
    const xPt = item.transform[4];
    const renderYPt = pageHeightPt - item.transform[5];
    const fontPt = Math.hypot(item.transform[0], item.transform[1]);
    return xPt >= x0 - expansionPt && xPt <= x1 + expansionPt
      && renderYPt >= y0 - expansionPt && renderYPt <= y1 + expansionPt
      && Math.abs(fontPt - 12.34) < 0.5
      && Math.abs(item.transform[1]) < 0.2
      && Math.abs(item.transform[2]) < 0.2;
  });
  const columns = new Map();
  const rows = new Map();
  for (const item of candidates) {
    const label = item.str.trim();
    if (/^\d{1,2}$/.test(label)) {
      if (!columns.has(label)) columns.set(label, []);
      columns.get(label).push(item.transform[4] * architecturalScaleFtPerPt);
    }
    if (/^(?:[A-M]|L\.6)$/.test(label)) {
      if (!rows.has(label)) rows.set(label, []);
      rows.get(label).push(item.transform[5] * architecturalScaleFtPerPt);
    }
  }
  const colDatums = [...columns].map(([label, values]) => ({ label, coord: round(median(values)) }))
    .sort((a, b) => a.coord - b.coord);
  const rowDatums = [...rows].map(([label, values]) => ({ label, coord: round(median(values)) }))
    .sort((a, b) => a.coord - b.coord);
  if (colDatums.length < 10 || rowDatums.length < 10) {
    throw new Error(`architectural grid extraction incomplete for ${viewport.role}: ${colDatums.length}x${rowDatums.length}`);
  }
  return {
    xs: colDatums.map((datum) => datum.coord),
    ys: rowDatums.map((datum) => datum.coord),
    colDatums,
    rowDatums,
    labels: { cols: colDatums.map((datum) => datum.label), rows: rowDatums.map((datum) => datum.label) },
  };
}

function cleanStructuralGrid(textContent, pageHeightPt, scaleFtPerPt) {
  const candidates = textContent.items.filter((item) => {
    const renderYPt = pageHeightPt - item.transform[5];
    const fontPt = Math.hypot(item.transform[0], item.transform[1]);
    return renderYPt >= 90 && renderYPt <= 1000
      && Math.abs(fontPt - 18.9) < 0.6
      && Math.abs(item.transform[1]) < 0.2
      && Math.abs(item.transform[2]) < 0.2;
  });
  const columns = new Map();
  const rows = new Map();
  for (const item of candidates) {
    const label = item.str.trim();
    if (/^\d{1,2}$/.test(label)) {
      if (!columns.has(label)) columns.set(label, []);
      columns.get(label).push(item.transform[4] * scaleFtPerPt);
    }
    if (/^(?:[A-M]|L\.6)$/.test(label)) {
      if (!rows.has(label)) rows.set(label, []);
      rows.get(label).push(item.transform[5] * scaleFtPerPt);
    }
  }
  const colDatums = [...columns].filter(([, values]) => values.length >= 2)
    .map(([label, values]) => ({ label, coord: round(median(values)) })).sort((a, b) => a.coord - b.coord);
  const rowDatums = [...rows].filter(([, values]) => values.length >= 2)
    .map(([label, values]) => ({ label, coord: round(median(values)) })).sort((a, b) => a.coord - b.coord);
  if (colDatums.length < 8 || rowDatums.length < 8) {
    throw new Error(`main-plan structural grid extraction incomplete: ${colDatums.length}x${rowDatums.length}`);
  }
  return {
    xs: colDatums.map((datum) => datum.coord), ys: rowDatums.map((datum) => datum.coord),
    colDatums, rowDatums,
    labels: { cols: colDatums.map((datum) => datum.label), rows: rowDatums.map((datum) => datum.label) },
  };
}

function projector(viewport, pageHeightPt, architecturalScaleFtPerPt) {
  const pixelsPerFoot = viewport.px_per_ft;
  const [tx, ty] = viewport.transform_ft;
  return ([rawXFt, rawYFt]) => [
    round(((rawXFt / architecturalScaleFtPerPt) - viewport.geometry_bbox_pt[0]) / pixelsPerFoot + tx),
    round((pageHeightPt - (rawYFt / architecturalScaleFtPerPt) - viewport.geometry_bbox_pt[1]) / pixelsPerFoot + ty),
  ];
}

function projectBounds(bounds, project) {
  const corners = [
    project([bounds.minX, bounds.minY]),
    project([bounds.maxX, bounds.minY]),
    project([bounds.maxX, bounds.maxY]),
    project([bounds.minX, bounds.maxY]),
  ];
  return corners;
}

function sourceBinding(pageNumber, sheetName, area, layer, structuralSha256) {
  return {
    pdf_sha256: structuralSha256,
    page_index: pageNumber - 1,
    page_number: pageNumber,
    sheet: `${sheetName}.${area}`,
    scale_text: layer.scaleText,
    scale_ft_per_pdf_point: layer.scaleFtPerUnit,
    scale_source: layer.scaleSource,
    registration: layer.gridMatch,
  };
}

function projectedLayer(layer, project, source) {
  const columns = layer.columns.map((column, index) => ({
    id: `${source.sheet}-column-${index + 1}`,
    kind: 'column',
    grid: column.grid,
    center_ft: project([column.x, column.y]),
    polygon_ft: projectBounds(column.markerBoundsFt, project),
    source_marker_segment_count: column.markerSegs,
    source_marker_width_ft: column.measuredWidthFt,
    source_marker_height_ft: column.measuredHeightFt,
    member: column.size,
    member_kind: column.kind,
    confidence: column.confidence,
    dimensional_status: 'conservative-vector-marker-envelope-needs-verification',
    source,
  }));
  const line = (member, kind, index) => ({
    id: `${source.sheet}-${kind}-${index + 1}`,
    kind,
    a_ft: project(member.a),
    b_ft: project(member.b),
    length_ft: member.lengthFt,
    member: member.member,
    member_kind: member.kind,
    confidence: member.confidence,
    dimensional_status: member.member ? 'member-tag-present-section-lookup-required' : 'centerline-only-member-dimension-missing',
    source,
  });
  return {
    columns,
    beams: layer.beams.map((member, index) => line(member, 'beam', index)),
    joists: layer.joists.map((member, index) => line(member, 'joist', index)),
    counts: layer.counts,
  };
}

function uniqueByGeometry(rows) {
  const seen = new Set();
  return rows.filter((row) => {
    const key = row.polygon_ft
      ? JSON.stringify(row.polygon_ft.map((point) => point.map((value) => round(value, 2))))
      : JSON.stringify([row.kind, row.a_ft.map((value) => round(value, 2)), row.b_ft.map((value) => round(value, 2))]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function main() {
  const [archBytes, structuralBytes, architecturalManifest] = await Promise.all([
    readFile(ARCH_PDF), readFile(STRUCT_PDF), readFile(ARCH_MANIFEST, 'utf8').then(JSON.parse),
  ]);
  const [architecturalSha256, structuralSha256] = await Promise.all([sha256(ARCH_PDF), sha256(STRUCT_PDF)]);
  if (architecturalSha256 !== architecturalManifest.source_pdf_sha256) {
    throw new Error('architectural source hash does not match the registered geometry manifest');
  }
  const [archDoc, structuralDoc] = await Promise.all([
    pdfjs.getDocument({ data: new Uint8Array(archBytes), disableWorker: true }).promise,
    pdfjs.getDocument({ data: new Uint8Array(structuralBytes), disableWorker: true }).promise,
  ]);
  const archPage = await archDoc.getPage(8);
  const archText = await archPage.getTextContent();
  const pageHeightPt = archPage.getViewport({ scale: 1 }).height;
  const architecturalScaleFtPerPt = 1 / 6.75;
  const viewports = architecturalManifest.sheets['A-101'].source_viewports;
  const views = {
    upper: {
      viewport: viewports.find((value) => value.role === 'upper'),
    },
    lower: {
      viewport: viewports.find((value) => value.role === 'lower'),
    },
  };
  for (const value of Object.values(views)) {
    value.grid = cleanArchitecturalGrid(archText, value.viewport, pageHeightPt, architecturalScaleFtPerPt);
    value.project = projector(value.viewport, pageHeightPt, architecturalScaleFtPerPt);
  }

  const cache = new Map();
  async function extract(pageNumber, role, sheetName, area) {
    const key = `${pageNumber}:${role}`;
    if (!cache.has(key)) {
      const page = await structuralDoc.getPage(pageNumber);
      const textContent = await page.getTextContent();
      const scale = deriveScaleFromText(textContent.items.map((item) => item.str).join(' '));
      if (!scale) throw new Error(`printed scale missing on structural page ${pageNumber}`);
      const gridOverride = cleanStructuralGrid(textContent, page.getViewport({ scale: 1 }).height, scale.feetPerUnit);
      const layer = await extractStructureLayerFromPdf(page, {
        archGrid: views[role].grid,
        gridAlign: true,
        gridOverride,
      });
      if (!layer.gridMatch || layer.gridMatch.medianErrFt > 0.1
        || layer.gridMatch.matchedCols < 8 || layer.gridMatch.matchedRows < 5
        || layer.gridMatch.matchedCols + layer.gridMatch.matchedRows < 15) {
        throw new Error(`structural registration gate failed on page ${pageNumber}: ${JSON.stringify(layer.gridMatch)}`);
      }
      cache.set(key, layer);
    }
    const layer = cache.get(key);
    const source = sourceBinding(pageNumber, sheetName, area, layer, structuralSha256);
    return { raw: layer, projected: projectedLayer(layer, views[role].project, source), source };
  }

  const levels = {};
  for (const spec of LEVELS) {
    const [verticalB, verticalC, overheadB, overheadC] = await Promise.all([
      extract(spec.vertical[0], 'upper', spec.verticalName, 'B'),
      extract(spec.vertical[1], 'lower', spec.verticalName, 'C'),
      extract(spec.overhead[0], 'upper', spec.overheadName, 'B'),
      extract(spec.overhead[1], 'lower', spec.overheadName, 'C'),
    ]);
    const columns = uniqueByGeometry([...verticalB.projected.columns, ...verticalC.projected.columns]);
    const beams = uniqueByGeometry([...overheadB.projected.beams, ...overheadC.projected.beams]);
    const joists = uniqueByGeometry([...overheadB.projected.joists, ...overheadC.projected.joists]);
    const lineRows = [...beams, ...joists];
    const exactLineSections = lineRows.filter((row) => row.member
      && /^(?:HSS|W\d|L\d|\(\d+\).+LVL)/i.test(row.member)).length;
    const dryStandardMinimumLineSections = lineRows.filter((row) => /^\d+X\d+$/i.test(row.member || '')).length;
    const unresolvedLineDimensions = lineRows.length - exactLineSections - dryStandardMinimumLineSections;
    levels[spec.sheet] = {
      architectural_page_index: architecturalManifest.sheets[spec.sheet].page_index,
      coordinate_frame: 'registered-architectural-plan-feet',
      vertical_sources: [verticalB.source, verticalC.source],
      overhead_sources: [overheadB.source, overheadC.source],
      columns,
      beams,
      joists,
      counts: { columns: columns.length, beams: beams.length, joists: joists.length },
      page_coverage_gate: {
        passed: true,
        areas: ['B', 'C'],
        max_registration_median_error_ft: round(Math.max(
          verticalB.raw.gridMatch.medianErrFt, verticalC.raw.gridMatch.medianErrFt,
          overheadB.raw.gridMatch.medianErrFt, overheadC.raw.gridMatch.medianErrFt,
        )),
      },
      dimensional_gate: {
        passed: false,
        column_geometry: 'source vector marker envelopes retained',
        exact_source_or_steel_database_beam_or_joist_sections: exactLineSections,
        dry_ps20_minimum_dressed_beam_or_joist_sections: dryStandardMinimumLineSections,
        unresolved_beam_or_joist_sections: unresolvedLineDimensions,
        reason: 'Untagged framing centerlines remain unresolved; dry PS20 sizes are minimum dressed dimensions, not field measurements.',
      },
    };
  }

  const payload = {
    artifact_type: 'halofire.registered-source-structure.v1',
    project_id: '1881-cooperative',
    answer_key_used: false,
    source_architectural_pdf_path: ARCH_PDF,
    source_architectural_pdf_sha256: architecturalSha256,
    source_structural_pdf_path: STRUCT_PDF,
    source_structural_pdf_sha256: structuralSha256,
    material_conditions: {
      wood_service_condition: 'dry',
      maximum_sawn_lumber_moisture_percent: 19,
      source: {
        pdf_sha256: structuralSha256,
        page_index: 2,
        page_number: 3,
        text: 'Dry service conditions assumed. Max moisture content of 19% for Sawn Lumber and Connections.',
      },
    },
    architectural_registration_manifest_sha256: await sha256(ARCH_MANIFEST),
    generator: 'apps/autosprink/scripts/build-1881-source-structure.mjs',
    claims: {
      source_geometry_extracted: true,
      source_registration_verified: true,
      ahj_approved: false,
      pe_verified: false,
      fabrication_ready: false,
      code_compliant: false,
    },
    levels,
  };
  await mkdir(path.dirname(OUTPUT), { recursive: true });
  await mkdir(path.dirname(PROOF_DATA), { recursive: true });
  await writeFile(OUTPUT, `${JSON.stringify(payload)}\n`);
  await writeFile(PROOF_DATA, `${JSON.stringify({
    artifact_type: 'halofire.1881-structural-overlay-data.v1',
    source_structural_pdf_path: STRUCT_PDF,
    source_structural_pdf_sha256: structuralSha256,
    pages: [...cache].map(([key, layer]) => ({
      page_number: Number(key.split(':')[0]), role: key.split(':')[1],
      grid_match: layer.gridMatch, columns: layer.columns, beams: layer.beams, joists: layer.joists,
      scale_ft_per_pdf_point: layer.scaleFtPerUnit,
    })),
  })}\n`);
  console.log(JSON.stringify({ output: OUTPUT, proofData: PROOF_DATA, levels: Object.fromEntries(
    Object.entries(levels).map(([key, value]) => [key, { ...value.counts, ...value.page_coverage_gate,
      unresolved: value.dimensional_gate.unresolved_beam_or_joist_sections }]),
  ) }, null, 2));
}

await main();
