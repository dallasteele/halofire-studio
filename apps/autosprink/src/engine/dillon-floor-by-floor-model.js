import { z } from 'zod';
import { canonicalJson, sha256Hex } from './elevation-datums.js';

const SHA256 = z.string().regex(/^[0-9a-f]{64}$/);
const Point = z.tuple([z.number().finite(), z.number().finite()]);
const Bounds = z.object({
  minX: z.number().finite(), minY: z.number().finite(), maxX: z.number().finite(), maxY: z.number().finite(),
  widthFt: z.number().positive(), depthFt: z.number().positive(),
}).strict();
const Level = z.object({
  id: z.string().min(1), label: z.string().min(1), coordinateFrame: z.string().min(1), sourceId: z.string().min(1),
  sourceSha256: SHA256, sourceUnits: z.literal('inch'), outputUnits: z.literal('ft'), sourceScaleInPerFt: z.literal(12),
  modelElevationFt: z.number().finite(), projectFloorElevationFt: z.number().finite(), nominalWallTopElevationFt: z.number().finite(),
  boundsFt: Bounds, wallPolygonsFt: z.array(z.array(Point).min(3)).min(1),
  counts: z.object({ wallHatches: z.number().int().positive(), wallPolygons: z.number().int().positive(), openingClosureSegments: z.number().int().nonnegative(), sourceEntities: z.number().int().positive() }).strict(),
  verticalEvidence: z.array(z.string().min(1)).min(1), ceilingControlsFt: z.array(z.number().positive()).min(1),
}).strict();

export const DillonFloorModelDraftSchema = z.object({
  artifactType: z.literal('halofire.dillon-floor-by-floor-model.v1'), projectName: z.literal('Dillon Residence'),
  sourceGeometrySha256: SHA256, generatedAtPolicy: z.literal('deterministic-no-timestamp'),
  scaleEvidence: z.object({ dwgSourceUnits: z.literal('inch'), dwgSourceInchesPerFoot: z.literal(12), architecturalPdfPrintedScale: z.literal('3/16\" = 1\'-0\"'), architecturalPdfPointsPerFoot: z.literal(13.5) }).strict(),
  datumEvidence: z.object({ projectDatumOffsetFt: z.literal(1424.5), derivation: z.literal("1537.00' - 112'-6\" = 1424.50'"), mainProjectFloorFt: z.literal(1524.5), upperProjectFloorFt: z.literal(1537), toyProjectFloorFt: z.literal(1503) }).strict(),
  levels: z.array(Level).length(3),
  roofControls: z.array(z.object({ sourceId: z.string(), sourceText: z.string(), riseIn: z.number().positive(), runIn: z.number().positive() }).strict()).min(1),
  limitations: z.array(z.string().min(1)).min(1), geometryGrounded: z.literal(true), complianceReady: z.literal(false), approvalReady: z.literal(false),
  claimStatus: z.literal('source-grounded-floor-by-floor-geometry-not-code-compliance-or-approval'),
}).strict();
export const DillonFloorModelSchema = DillonFloorModelDraftSchema.extend({ receiptSha256: SHA256 }).strict();

const LEVEL_CONFIG = {
  'main-house-main': { label: 'Main house — main level', z: 0, project: 1524.5, top: 12.5, ceilings: [8, 9, 10, 11.5], evidence: ["Main plan floor datum 100'-0\"", "Upper dual datum fixes the next floor at +12'-6\""] },
  'main-house-upper': { label: 'Main house — upper level', z: 12.5, project: 1537, top: 22.5, ceilings: [9, 10], evidence: ["Upper F.F. @ 1537.00'", "Upper local floor datum (112'-6\")"] },
  'toy-garage': { label: 'Toy garage — local horizontal frame', z: -21.5, project: 1503, top: -11.5, ceilings: [7.9583, 8.5, 9, 10, 15.1667, 16.5, 16.8333], evidence: ["Toy garage F.F. @ 1503.00'", "Horizontal registration to the main-house frame is not supplied"] },
};

function sourceFor(packet, id) { return packet.sources.find((entry) => entry.id === id); }

export async function buildDillonFloorByFloorModel(sourceGeometry) {
  if (!sourceGeometry || sourceGeometry.artifactType !== 'halofire.dillon-dwg-source-geometry.v1') throw new Error('DILLON_SOURCE_GEOMETRY_INVALID');
  const sourceGeometrySha256 = await sha256Hex(sourceGeometry);
  const levels = sourceGeometry.levels.map((sourceLevel) => {
    const config = LEVEL_CONFIG[sourceLevel.id];
    const source = sourceFor(sourceGeometry, sourceLevel.sourceId);
    if (!config || !source) throw new Error(`DILLON_LEVEL_SOURCE_UNBOUND:${sourceLevel.id}`);
    return {
      id: sourceLevel.id, label: config.label, coordinateFrame: sourceLevel.coordinateFrame, sourceId: sourceLevel.sourceId,
      sourceSha256: source.sha256, sourceUnits: 'inch', outputUnits: 'ft', sourceScaleInPerFt: 12,
      modelElevationFt: config.z, projectFloorElevationFt: config.project, nominalWallTopElevationFt: config.top,
      boundsFt: sourceLevel.boundsFt, wallPolygonsFt: sourceLevel.wallPolygonsFt, counts: sourceLevel.counts,
      verticalEvidence: config.evidence, ceilingControlsFt: config.ceilings,
    };
  });
  const draft = DillonFloorModelDraftSchema.parse({
    artifactType: 'halofire.dillon-floor-by-floor-model.v1', projectName: 'Dillon Residence', sourceGeometrySha256,
    generatedAtPolicy: 'deterministic-no-timestamp',
    scaleEvidence: { dwgSourceUnits: 'inch', dwgSourceInchesPerFoot: 12, architecturalPdfPrintedScale: '3/16\" = 1\'-0\"', architecturalPdfPointsPerFoot: 13.5 },
    datumEvidence: { projectDatumOffsetFt: 1424.5, derivation: "1537.00' - 112'-6\" = 1424.50'", mainProjectFloorFt: 1524.5, upperProjectFloorFt: 1537, toyProjectFloorFt: 1503 },
    levels,
    roofControls: [
      { sourceId: 'main-framing-pdf', sourceText: '3:12 SLOPE', riseIn: 3, runIn: 12 },
      { sourceId: 'toy-framing-pdf', sourceText: "B.O.B. 108'-6\" / T.O.PLATE 108'-6\" / T.O.MASS 121'-0\" / B.O.B. 115'-6\"; 3:12", riseIn: 3, runIn: 12 },
    ],
    limitations: [
      'No dedicated exterior-elevation sheet was present in the supplied client archive; elevation view uses source floor, ceiling, beam, plate, mass, and slope annotations.',
      'Toy-garage horizontal registration to the main-house coordinate frame is absent, so the toy garage remains in its own local horizontal frame.',
      'Roof controls do not bound every roof face; this artifact does not invent a complete roof surface.',
      'Mechanical/electrical penetrations and feature-specific obstruction clearances remain required before code-compliance or fabrication claims.',
    ],
    geometryGrounded: true, complianceReady: false, approvalReady: false,
    claimStatus: 'source-grounded-floor-by-floor-geometry-not-code-compliance-or-approval',
  });
  return { ...draft, receiptSha256: await sha256Hex(draft) };
}

export async function validateDillonFloorByFloorModel(input, expectedSourceGeometry = null) {
  const parsed = DillonFloorModelSchema.safeParse(input);
  if (!parsed.success) return { status: 'blocked', issues: [{ code: 'DILLON_MODEL_SCHEMA_INVALID', message: parsed.error.issues.map((x) => x.message).join('; ') }], complianceReady: false };
  const model = parsed.data;
  const { receiptSha256, ...draft } = model;
  const issues = [];
  if (await sha256Hex(draft) !== receiptSha256) issues.push({ code: 'DILLON_MODEL_RECEIPT_MISMATCH', message: 'Model content does not match its receipt.' });
  if (expectedSourceGeometry && await sha256Hex(expectedSourceGeometry) !== model.sourceGeometrySha256) issues.push({ code: 'DILLON_SOURCE_GEOMETRY_MISMATCH', message: 'Model is not bound to the supplied neutral DWG geometry.' });
  const byId = new Map(model.levels.map((level) => [level.id, level]));
  if (byId.get('main-house-upper')?.modelElevationFt - byId.get('main-house-main')?.modelElevationFt !== 12.5) issues.push({ code: 'DILLON_MAIN_UPPER_STACK_INVALID', message: 'Main-to-upper floor stack must be 12.5 ft.' });
  if (byId.get('toy-garage')?.coordinateFrame === 'main-house') issues.push({ code: 'DILLON_TOY_FRAME_FABRICATED', message: 'Toy garage cannot be horizontally registered without source evidence.' });
  return { status: issues.length ? 'blocked' : 'passed', issues, model: issues.length ? null : model, counts: { levels: 3, wallSolids: model.levels.reduce((n, x) => n + x.wallPolygonsFt.length, 0), sourceEntities: model.levels.reduce((n, x) => n + x.counts.sourceEntities, 0) }, geometryGrounded: !issues.length, complianceReady: false };
}

function esc(value) { return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function points(poly, bounds, width, height, pad = 28) {
  const sx = (width - 2 * pad) / bounds.widthFt; const sy = (height - 2 * pad) / bounds.depthFt; const s = Math.min(sx, sy);
  return poly.map(([x, y]) => `${(pad + (x - bounds.minX) * s).toFixed(2)},${(height - pad - (y - bounds.minY) * s).toFixed(2)}`).join(' ');
}
function topSvg(level) {
  const w = 760, h = 470;
  const shapes = level.wallPolygonsFt.map((p) => `<polygon points="${points(p, level.boundsFt, w, h)}" fill="#0f766e" fill-opacity=".55" stroke="#0f172a" stroke-width=".45"/>`).join('');
  return `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(level.label)} source DWG top view" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#f8fafc"/>${shapes}<text x="18" y="22" font-family="monospace" font-size="13" fill="#0f172a">${esc(level.label)} · ${level.counts.wallPolygons} exact Wall-Hatch polygons · DWG inches ÷ 12</text></svg>`;
}
function elevationSvg(model) {
  const minZ = -22, maxZ = 24, w = 760, h = 360, zY = (z) => h - 38 - ((z - minZ) / (maxZ - minZ)) * (h - 76);
  const bands = model.levels.map((l, i) => { const x = 55 + i * 225; const width = Math.min(190, l.boundsFt.widthFt * 1.35); return `<rect x="${x}" y="${zY(l.nominalWallTopElevationFt)}" width="${width}" height="${zY(l.modelElevationFt) - zY(l.nominalWallTopElevationFt)}" fill="${i === 2 ? '#7c3aed' : '#0284c7'}" fill-opacity=".26" stroke="#0f172a"/><text x="${x}" y="${zY(l.modelElevationFt) - 5}" font-family="monospace" font-size="11">${esc(l.label)} · ${l.projectFloorElevationFt.toFixed(1)}'</text>`; }).join('');
  return `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Dillon source datum elevation view" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#f8fafc"/>${bands}<text x="18" y="22" font-family="monospace" font-size="13">Source-bound side/elevation controls · exterior elevation sheet absent</text></svg>`;
}
function isometricSvg(model) {
  const w = 820, h = 520, project = ([x, y], z, ox) => [410 + ox + (x - y) * 2.15, 400 + (x + y) * .72 - z * 7.2];
  const paths = [];
  for (const level of model.levels) {
    const ox = level.coordinateFrame === 'main-house' ? 0 : 260;
    for (const poly of level.wallPolygonsFt) {
      const base = poly.map((p) => project(p, level.modelElevationFt, ox)); const top = poly.map((p) => project(p, level.nominalWallTopElevationFt, ox));
      paths.push(`<polygon points="${top.map((p) => p.map((v) => v.toFixed(1)).join(',')).join(' ')}" fill="#67e8f9" fill-opacity=".28" stroke="#0e7490" stroke-width=".5"/>`);
      for (let i = 0; i < Math.min(poly.length, 8); i += 1) paths.push(`<line x1="${base[i][0].toFixed(1)}" y1="${base[i][1].toFixed(1)}" x2="${top[i][0].toFixed(1)}" y2="${top[i][1].toFixed(1)}" stroke="#155e75" stroke-width=".45"/>`);
    }
  }
  return `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Dillon source-grounded isometric wall extrusion" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#07111f"/>${paths.join('')}<text x="18" y="25" fill="#e0f2fe" font-family="monospace" font-size="13">563 DWG wall polygons extruded floor by floor · toy horizontal frame intentionally separated</text></svg>`;
}

export function renderDillonFloorByFloorViews(validation) {
  if (!validation || validation.status !== 'passed' || !validation.model) return { status: 'blocked', issues: [{ code: 'DILLON_MODEL_NOT_VALIDATED' }] };
  return { status: 'passed', topViews: validation.model.levels.map((level) => ({ levelId: level.id, svg: topSvg(level) })), elevationSvg: elevationSvg(validation.model), isometricSvg: isometricSvg(validation.model) };
}

export function dillonModelCanonicalJson(model) { return canonicalJson(model); }
