import { z } from 'zod';
import { extractElevationDatums, sha256Hex } from './elevation-datums.js';
import { polygonArea, polygonBounds, validateLevelFootprintPacket } from './source-bound-footprint.js';

const SHA = z.string().regex(/^[0-9a-f]{64}$/);
const Point = z.tuple([z.number().finite(), z.number().finite()]);
const Level = z.object({
  id: z.enum(['level-01', 'level-02-tower']),
  label: z.string().min(1),
  sourceSheetId: z.enum(['A110', 'A131.1']),
  coordinateFrame: z.literal('A110 plan feet'),
  floorElevationFt: z.number().finite(),
  modelElevationFt: z.number().nonnegative(),
  topElevationFt: z.number().finite(),
  extrusionHeightFt: z.number().positive(),
  areaSqft: z.number().positive(),
  polygonPlanFt: z.array(Point).min(3),
  derivation: z.record(z.unknown()),
}).strict();
const Registration = z.object({
  source: z.string(), target: z.string(), colControls: z.array(z.string()).min(2), rowControls: z.array(z.string()).min(3),
  translateXFt: z.number().finite(), translateYFt: z.number().finite(), rmsXFt: z.number().nonnegative(), rmsYFt: z.number().nonnegative(),
}).strict();
const Draft = z.object({
  artifactType: z.literal('halofire.nashville-floor-by-floor-model.v1'),
  projectName: z.literal('LDS Temple - Nashville TN'),
  footprintEvidenceReceiptSha256: SHA,
  elevationEvidenceReceiptSha256: SHA,
  coordinateFrame: z.literal('A110 plan feet'),
  levels: z.array(Level).length(2),
  sectionControls: z.array(z.object({ id: z.string(), label: z.string(), elevationFt: z.number() }).strict()).length(4),
  registrations: z.array(Registration).length(3),
  counts: z.object({ levels: z.literal(2), extrusionSolids: z.literal(2), independentlyRegisteredPlanViews: z.literal(5) }).strict(),
  geometryGrounded: z.literal(true),
  complianceReady: z.literal(false),
  approvalReady: z.literal(false),
  claimStatus: z.literal('source-grounded-floor-by-floor-geometry-not-sprinkler-code-compliance-or-approval'),
}).strict();
const Packet = Draft.extend({ receiptSha256: SHA }).strict();
const issue = (code, message) => ({ severity: 'blocking', code, message });
const near = (left, right, tolerance = 1e-6) => Math.abs(Number(left) - Number(right)) <= tolerance;

export async function buildNashvilleFloorByFloorModel({ footprints, elevations }) {
  const footprintValidation = await validateLevelFootprintPacket(footprints);
  const elevationValidation = await extractElevationDatums(elevations, { expectedSourcePdfSha256: footprints?.sourcePdfSha256 });
  if (footprintValidation.status !== 'passed') throw new Error(`NASHVILLE_FOOTPRINTS_BLOCKED:${footprintValidation.issues.map((entry) => entry.code).join(',')}`);
  if (elevationValidation.status !== 'passed') throw new Error(`NASHVILLE_ELEVATIONS_BLOCKED:${elevationValidation.issues.map((entry) => entry.code).join(',')}`);
  if (footprints.elevationEvidenceReceiptSha256 !== elevations.receiptSha256) throw new Error('NASHVILLE_VERTICAL_RECEIPT_MISMATCH');

  const datum = (id) => elevationValidation.datums.find((entry) => entry.id === id);
  const level1 = footprintValidation.levels.find((entry) => entry.level === 1);
  const level2 = footprintValidation.levels.find((entry) => entry.level === 2);
  const level1Top = datum('mezzanine-a').elevationFt;
  const level2Top = datum('parapet-2').elevationFt;
  const modelLevels = [
    {
      id: 'level-01', label: 'Level 01', sourceSheetId: 'A110', coordinateFrame: 'A110 plan feet',
      floorElevationFt: datum('level-01').elevationFt, modelElevationFt: 0, topElevationFt: level1Top,
      extrusionHeightFt: level1Top - datum('level-01').elevationFt, areaSqft: level1.areaSqft,
      polygonPlanFt: level1.polygonPlanFt, derivation: level1.derivation,
    },
    {
      id: 'level-02-tower', label: 'Level 02 / tower', sourceSheetId: 'A131.1', coordinateFrame: 'A110 plan feet',
      floorElevationFt: datum('mezzanine-a').elevationFt,
      modelElevationFt: datum('mezzanine-a').elevationFt - datum('level-01').elevationFt,
      topElevationFt: level2Top, extrusionHeightFt: level2Top - datum('mezzanine-a').elevationFt,
      areaSqft: level2.areaSqft, polygonPlanFt: level2.polygonPlanFt, derivation: level2.derivation,
    },
  ];
  const level2Registration = level2.derivation.registration;
  const f102Registration = level2.derivation.level02FireProtectionPlanRegistration;
  const asBuiltRegistration = level1.derivation.completedAsBuiltGridRegistration;
  const registration = (source, target, value) => ({
    source, target, colControls: value.colControls, rowControls: value.rowControls,
    translateXFt: value.translateXFt, translateYFt: value.translateYFt,
    rmsXFt: value.rmsXFt, rmsYFt: value.rmsYFt,
  });
  const draft = Draft.parse({
    artifactType: 'halofire.nashville-floor-by-floor-model.v1',
    projectName: 'LDS Temple - Nashville TN',
    footprintEvidenceReceiptSha256: footprints.evidenceReceiptSha256,
    elevationEvidenceReceiptSha256: elevations.receiptSha256,
    coordinateFrame: 'A110 plan feet',
    levels: modelLevels,
    sectionControls: elevationValidation.datums.map(({ id, label, elevationFt }) => ({ id, label, elevationFt })),
    registrations: [
      registration('A131.1 dimension view', 'A110 plan feet', level2Registration),
      registration('A131.1 dimension view', 'F102 Level 02 fire-protection plan', f102Registration),
      {
        source: 'A110 architectural grid', target: 'as-built FP2 main-level grid',
        colControls: asBuiltRegistration.x.controls.map((entry) => entry.label),
        rowControls: asBuiltRegistration.y.controls.map((entry) => entry.label),
        translateXFt: asBuiltRegistration.x.meanDeltaFt, translateYFt: asBuiltRegistration.y.meanDeltaFt,
        rmsXFt: asBuiltRegistration.x.rmsResidualFt, rmsYFt: asBuiltRegistration.y.rmsResidualFt,
      },
    ],
    counts: { levels: 2, extrusionSolids: 2, independentlyRegisteredPlanViews: 5 },
    geometryGrounded: true, complianceReady: false, approvalReady: false,
    claimStatus: 'source-grounded-floor-by-floor-geometry-not-sprinkler-code-compliance-or-approval',
  });
  return { ...draft, receiptSha256: await sha256Hex(draft) };
}

export async function validateNashvilleFloorByFloorModel(input, { footprints, elevations } = {}) {
  const parsed = Packet.safeParse(input);
  if (!parsed.success) return { status: 'blocked', model: null, issues: [issue('NASHVILLE_MODEL_SCHEMA_INVALID', parsed.error.issues.map((entry) => entry.message).join('; '))], complianceReady: false };
  const model = parsed.data;
  const { receiptSha256, ...draft } = model;
  const issues = [];
  if (await sha256Hex(draft) !== receiptSha256) issues.push(issue('NASHVILLE_MODEL_RECEIPT_MISMATCH', 'Model content does not match its immutable receipt.'));
  if (footprints?.evidenceReceiptSha256 !== model.footprintEvidenceReceiptSha256) issues.push(issue('NASHVILLE_MODEL_FOOTPRINT_SOURCE_MISMATCH', 'Footprint evidence receipt mismatch.'));
  if (elevations?.receiptSha256 !== model.elevationEvidenceReceiptSha256) issues.push(issue('NASHVILLE_MODEL_ELEVATION_SOURCE_MISMATCH', 'Elevation evidence receipt mismatch.'));
  for (const level of model.levels) {
    if (!near(polygonArea(level.polygonPlanFt), level.areaSqft, Math.max(0.01, level.areaSqft * 0.001))) issues.push(issue('NASHVILLE_MODEL_AREA_DRIFT', `${level.id} polygon area drifted.`));
    if (!near(level.topElevationFt - level.floorElevationFt, level.extrusionHeightFt)) issues.push(issue('NASHVILLE_MODEL_EXTRUSION_HEIGHT_DRIFT', `${level.id} extrusion height drifted.`));
  }
  if (!near(model.levels[1].modelElevationFt, model.levels[0].extrusionHeightFt)) issues.push(issue('NASHVILLE_MODEL_LEVEL_STACK_DRIFT', 'Level 02 does not start at the A301 mezzanine datum.'));
  if (footprints?.levels) {
    for (let index = 0; index < model.levels.length; index += 1) {
      const expected = footprints.levels[index]; const actual = model.levels[index];
      if (!expected || actual.sourceSheetId !== expected.sheetId
        || !near(actual.floorElevationFt, expected.elevationFt)
        || !near(actual.areaSqft, expected.areaSqft)
        || JSON.stringify(actual.polygonPlanFt) !== JSON.stringify(expected.polygonPlanFt)) {
        issues.push(issue('NASHVILLE_MODEL_LEVEL_SOURCE_DRIFT', `${actual.id} no longer matches its sealed source footprint.`));
      }
    }
  }
  if (elevations) {
    const vertical = await extractElevationDatums(elevations, { expectedSourcePdfSha256: footprints?.sourcePdfSha256 });
    if (vertical.status !== 'passed' || JSON.stringify(model.sectionControls)
      !== JSON.stringify(vertical.datums.map(({ id, label, elevationFt }) => ({ id, label, elevationFt })))) {
      issues.push(issue('NASHVILLE_MODEL_SECTION_SOURCE_DRIFT', 'A301 section controls no longer match the sealed elevation packet.'));
    }
  }
  for (const registration of model.registrations) {
    if (registration.rmsXFt > 0.5 || registration.rmsYFt > 0.05) issues.push(issue('NASHVILLE_MODEL_REGISTRATION_RESIDUAL_EXCEEDED', `${registration.source} to ${registration.target} exceeds the sealed residual bound.`));
  }
  return {
    status: issues.length ? 'blocked' : 'passed', issues, model: issues.length ? null : model,
    counts: model.counts, geometryGrounded: !issues.length, complianceReady: false, approvalReady: false,
    claimStatus: model.claimStatus,
  };
}

const esc = (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const projectIso = ([x, y], z, bounds) => [430 + (x - bounds.minX - (y - bounds.minY)) * 2.25, 420 + (x - bounds.minX + y - bounds.minY) * 0.66 - z * 7.5];

export function buildNashvilleExtrusionModel(validation) {
  if (validation?.status !== 'passed' || !validation.model) return { status: 'blocked', solids: [], issues: [issue('NASHVILLE_MODEL_NOT_VALIDATED', 'A passed floor model is required.')] };
  const solids = validation.model.levels.map((level) => ({
    id: `${level.id}-extrusion`, levelId: level.id, polygonPlanFt: level.polygonPlanFt,
    baseElevationFt: level.modelElevationFt, topElevationFt: level.modelElevationFt + level.extrusionHeightFt,
    heightFt: level.extrusionHeightFt, areaSqft: level.areaSqft,
  }));
  return { status: 'passed', artifactType: 'halofire.nashville-scaled-extrusion-model.v1', solids, counts: validation.counts, geometryGrounded: true, complianceReady: false, claimStatus: validation.claimStatus };
}

export function renderNashvilleFloorByFloorViews(validation) {
  if (validation?.status !== 'passed' || !validation.model) return { status: 'blocked', issues: [issue('NASHVILLE_MODEL_NOT_VALIDATED', 'A passed floor model is required.')] };
  const model = validation.model;
  const allPoints = model.levels.flatMap((level) => level.polygonPlanFt);
  const bounds = polygonBounds(allPoints);
  const w = 900; const h = 520;
  const colors = ['#38bdf8', '#f59e0b'];
  const shapes = [];
  model.levels.forEach((level, levelIndex) => {
    const base = level.polygonPlanFt.map((point) => projectIso(point, level.modelElevationFt, bounds));
    const top = level.polygonPlanFt.map((point) => projectIso(point, level.modelElevationFt + level.extrusionHeightFt, bounds));
    shapes.push(`<polygon points="${top.map((point) => point.map((value) => value.toFixed(2)).join(',')).join(' ')}" fill="${colors[levelIndex]}" fill-opacity=".28" stroke="${colors[levelIndex]}" stroke-width="1.2"/>`);
    for (let index = 0; index < level.polygonPlanFt.length; index += 1) shapes.push(`<line x1="${base[index][0].toFixed(2)}" y1="${base[index][1].toFixed(2)}" x2="${top[index][0].toFixed(2)}" y2="${top[index][1].toFixed(2)}" stroke="${colors[levelIndex]}" stroke-opacity=".55" stroke-width=".65"/>`);
  });
  const isometricSvg = `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Nashville source-grounded floor-by-floor extrusion" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#07111f"/>${shapes.join('')}<text x="18" y="25" fill="#e0f2fe" font-family="monospace" font-size="13">A110 + A131.1 plan feet · A301 vertical datums · 2 sealed extrusion solids</text></svg>`;
  const minElevation = model.sectionControls[0].elevationFt;
  const maxElevation = Math.max(...model.sectionControls.map((entry) => entry.elevationFt));
  const y = (value) => 360 - 40 - ((value - minElevation) / (maxElevation - minElevation)) * 260;
  const bands = model.levels.map((level, index) => `<rect x="${60 + index * 380}" y="${y(level.topElevationFt)}" width="${Math.min(320, polygonBounds(level.polygonPlanFt).widthFt * 2)}" height="${y(level.floorElevationFt) - y(level.topElevationFt)}" fill="${colors[index]}" fill-opacity=".25" stroke="${colors[index]}"/><text x="${60 + index * 380}" y="${y(level.floorElevationFt) - 6}" fill="#0f172a" font-family="monospace" font-size="12">${esc(level.label)} · ${level.floorElevationFt.toFixed(3)}'</text>`).join('');
  const elevationSvg = `<svg viewBox="0 0 900 360" role="img" aria-label="Nashville A301 datum elevation" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#f8fafc"/>${bands}<text x="18" y="24" fill="#0f172a" font-family="monospace" font-size="13">A301 section-controlled stack · parapets 118.25' / 123.00'</text></svg>`;
  return { status: 'passed', isometricSvg, elevationSvg };
}
