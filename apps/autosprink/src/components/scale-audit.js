import { COMPONENTS } from './registry.js';
import {
  PIPE_OD_IN,
  PIPE_WALL_IN,
  HEAD_DIMS,
  FITTING_B16_4,
  ELBOW_45_CTE_FACTOR,
  GROOVED_DIMS,
  ESCUTCHEON_DIMS,
  HANGER_DIMS,
  NIPPLE_DIMS,
  REDUCER_DIMS,
  COUPLING_DIMS,
  pipeOdIn,
  nearestNps,
  nearestGroovedNps,
} from './openscad/part-dims.js';
import { generateScadFor } from './openscad/generators.js';

const IN_PER_FT = 12;
const DEFAULT_TOLERANCE = 0.05;

function round(value, digits = 6) {
  return Number(value.toFixed(digits));
}

function roundDims(dims, digits = 6) {
  return dims.map((value) => round(value, digits));
}

function sortDims(dims) {
  return [...dims].sort((a, b) => a - b);
}

function feetFromInches(dimsIn) {
  return dimsIn.map((value) => value / IN_PER_FT);
}

function maxDeltaRatios(expected, actual) {
  return expected.map((value, index) => {
    const baseline = Math.max(Math.abs(value), 1e-9);
    return Math.abs(actual[index] - value) / baseline;
  });
}

function emptyBox() {
  return {
    minX: Infinity,
    minY: Infinity,
    minZ: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
    maxZ: -Infinity,
  };
}

function includePoint(box, x, y, z) {
  box.minX = Math.min(box.minX, x);
  box.minY = Math.min(box.minY, y);
  box.minZ = Math.min(box.minZ, z);
  box.maxX = Math.max(box.maxX, x);
  box.maxY = Math.max(box.maxY, y);
  box.maxZ = Math.max(box.maxZ, z);
}

function includeBounds(box, minX, minY, minZ, maxX, maxY, maxZ) {
  includePoint(box, minX, minY, minZ);
  includePoint(box, maxX, maxY, maxZ);
}

function includeCylinderZ(box, cx, cy, z0, z1, radius) {
  includeBounds(box, cx - radius, cy - radius, Math.min(z0, z1), cx + radius, cy + radius, Math.max(z0, z1));
}

function includeCubeCenter(box, cx, cy, cz, sx, sy, sz) {
  includeBounds(
    box,
    cx - sx / 2,
    cy - sy / 2,
    cz - sz / 2,
    cx + sx / 2,
    cy + sy / 2,
    cz + sz / 2,
  );
}

function includeSphere(box, cx, cy, cz, radius) {
  includeBounds(box, cx - radius, cy - radius, cz - radius, cx + radius, cy + radius, cz + radius);
}

function includeCylinderSegment(box, a, b, radius) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const dz = b[2] - a[2];
  const len = Math.hypot(dx, dy, dz);
  const ux = len > 0 ? dx / len : 0;
  const uy = len > 0 ? dy / len : 0;
  const uz = len > 0 ? dz / len : 1;
  const ex = radius * Math.sqrt(Math.max(0, 1 - ux * ux));
  const ey = radius * Math.sqrt(Math.max(0, 1 - uy * uy));
  const ez = radius * Math.sqrt(Math.max(0, 1 - uz * uz));
  includeBounds(
    box,
    Math.min(a[0], b[0]) - ex,
    Math.min(a[1], b[1]) - ey,
    Math.min(a[2], b[2]) - ez,
    Math.max(a[0], b[0]) + ex,
    Math.max(a[1], b[1]) + ey,
    Math.max(a[2], b[2]) + ez,
  );
}

function bboxDims(box) {
  return [
    box.maxX - box.minX,
    box.maxY - box.minY,
    box.maxZ - box.minZ,
  ];
}

function num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function first(value, fallback) {
  if (Array.isArray(value)) return value.length ? value[0] : fallback;
  return value == null ? fallback : value;
}

function sizeOf(params, fallback) {
  if (!params) return fallback;
  if (Array.isArray(params.nominalSizesIn) && params.nominalSizesIn.length) {
    return params.nominalSizesIn[0];
  }
  return num(params.nominalIn, fallback);
}

function representativeHead(component) {
  const params = component.params || {};
  let type = params.type || params.orientation || 'pendent';
  if (params.coverPlate === true) type = 'concealed';
  else if (/sidewall/i.test(type) || /sidewall/i.test(component.key || '') || /sidewall/i.test(component.name || '')) {
    type = 'sidewall';
  }
  const k = num(first(params.kFactors, params.k), 5.6);
  const thread = params.thread || '1/2 NPT';
  return { type, k, thread, coverPlate: params.coverPlate === true };
}

function headDimsIn(component) {
  const rep = representativeHead(component);
  let threadOd = HEAD_DIMS.thread_half_npt_od.value;
  if (/3\/4/.test(rep.thread)) threadOd = HEAD_DIMS.thread_three_quarter_npt_od.value;
  else if (/(^|\D)1\s*NPT/.test(rep.thread)) threadOd = HEAD_DIMS.thread_one_npt_od.value;

  let deflectorDia = HEAD_DIMS.deflector_dia_5_6.value;
  let orifice = HEAD_DIMS.orifice_5_6.value;
  if (rep.k >= 14) {
    deflectorDia = HEAD_DIMS.deflector_dia_esfr.value;
    orifice = HEAD_DIMS.orifice_esfr.value;
  } else if (rep.k >= 7.9) {
    deflectorDia = HEAD_DIMS.deflector_dia_8_0.value;
    orifice = HEAD_DIMS.orifice_8_0.value;
  }

  const tLen = HEAD_DIMS.thread_len.value;
  const hexAf = HEAD_DIMS.hex_across_flats.value;
  const hexH = HEAD_DIMS.hex_height.value;
  const hexDia = hexAf / Math.cos(Math.PI / 6);
  const armDia = HEAD_DIMS.frame_arm_dia.value;
  const frameH = HEAD_DIMS.frame_height.value;
  const defThk = HEAD_DIMS.deflector_thk.value;
  const armOffset = deflectorDia * 0.32;

  const box = emptyBox();
  includeCylinderZ(box, 0, 0, 0, tLen, threadOd / 2);
  includeCylinderZ(box, 0, 0, -hexH, 0, hexDia / 2);
  includeCylinderZ(box, armOffset, 0, -hexH - frameH, -hexH, armDia / 2);
  includeCylinderZ(box, -armOffset, 0, -hexH - frameH, -hexH, armDia / 2);
  includeCylinderZ(box, 0, 0, -hexH, -hexH + (hexH * 0.6), (orifice * 1.4) / 2);

  if (rep.type === 'sidewall') {
    includeCubeCenter(
      box,
      HEAD_DIMS.sidewall_deflector_offset.value,
      0,
      -frameH,
      HEAD_DIMS.sidewall_deflector_w.value,
      HEAD_DIMS.sidewall_deflector_h.value,
      defThk,
    );
  } else {
    includeCylinderZ(box, 0, 0, -frameH - defThk, -frameH, deflectorDia / 2);
  }

  if (rep.type === 'concealed' || rep.coverPlate) {
    includeCylinderZ(
      box,
      0,
      0,
      -HEAD_DIMS.recess_depth.value,
      -HEAD_DIMS.recess_depth.value + HEAD_DIMS.cover_plate_thk.value,
      HEAD_DIMS.cover_plate_dia.value / 2,
    );
  }

  return sortDims(bboxDims(box));
}

function pipeDimsIn(component) {
  const params = component.params || {};
  const nominalIn = sizeOf(params, 2);
  const lengthFt = num(params.lengthFt, 10);
  const odIn = pipeOdIn(nominalIn);
  return sortDims([odIn, odIn, lengthFt * IN_PER_FT]);
}

function teeDimsIn(component) {
  const params = component.params || {};
  const runIn = sizeOf(params, 2);
  const branchIn = num(params.branchIn, runIn);
  const run = FITTING_B16_4[nearestNps(runIn)] || FITTING_B16_4[2];
  const branch = FITTING_B16_4[nearestNps(branchIn)] || FITTING_B16_4[2];
  const box = emptyBox();
  includeCylinderSegment(box, [-run.cte, 0, 0], [run.cte, 0, 0], run.bandOd / 2);
  includeCylinderSegment(box, [0, 0, 0], [0, 0, branch.cte], branch.bandOd / 2);
  includeCylinderSegment(box, [run.cte - 0.28, 0, 0], [run.cte, 0, 0], (run.bandOd * 1.06) / 2);
  includeCylinderSegment(box, [-run.cte, 0, 0], [-run.cte + 0.28, 0, 0], (run.bandOd * 1.06) / 2);
  includeCylinderSegment(box, [0, 0, branch.cte - 0.28], [0, 0, branch.cte], (branch.bandOd * 1.06) / 2);
  return sortDims(bboxDims(box));
}

function elbowDimsIn(component) {
  const params = component.params || {};
  const nominalIn = sizeOf(params, 2);
  const deg = num(params.angleDeg, 90);
  const fit = FITTING_B16_4[nearestNps(nominalIn)] || FITTING_B16_4[2];
  const cte = deg === 45 ? fit.cte * ELBOW_45_CTE_FACTOR : fit.cte;
  const radius = fit.bandOd / 2;
  const radians = (deg * Math.PI) / 180;
  const box = emptyBox();
  includeCylinderSegment(box, [0, 0, 0], [0, 0, cte], radius);
  includeSphere(box, 0, 0, 0, radius);
  includeCylinderSegment(box, [0, 0, 0], [0, -Math.sin(radians) * cte, Math.cos(radians) * cte], radius);
  includeCylinderSegment(box, [0, 0, cte - 0.28], [0, 0, cte], (fit.bandOd * 1.06) / 2);
  includeCylinderSegment(
    box,
    [0, -Math.sin(radians) * (cte - 0.28), Math.cos(radians) * (cte - 0.28)],
    [0, -Math.sin(radians) * cte, Math.cos(radians) * cte],
    (fit.bandOd * 1.06) / 2,
  );
  return sortDims(bboxDims(box));
}

function couplingDimsIn(component) {
  const nominalIn = sizeOf(component.params || {}, 2);
  const spec = COUPLING_DIMS[nearestNps(nominalIn)] || COUPLING_DIMS[2];
  const lipLen = spec.len * 0.14;
  const box = emptyBox();
  includeCylinderZ(box, 0, 0, 0, spec.len, spec.bandOd / 2);
  includeCylinderZ(box, 0, 0, 0, lipLen, (spec.bandOd * 1.05) / 2);
  includeCylinderZ(box, 0, 0, spec.len - lipLen, spec.len, (spec.bandOd * 1.05) / 2);
  return sortDims(bboxDims(box));
}

function reducerDimsIn(component) {
  const params = component.params || {};
  const sizes = Array.isArray(params.nominalSizesIn) && params.nominalSizesIn.length
    ? params.nominalSizesIn
    : [sizeOf(params, 2), sizeOf(params, 1.5)];
  const fromIn = num(sizes[0], 2);
  const toIn = num(sizes[1] != null ? sizes[1] : sizes[0], 1.5);
  const largeNps = nearestNps(Math.max(fromIn, toIn));
  const lenIn = REDUCER_DIMS.lengthByLargeNps[largeNps] || 2.25;
  const bigOd = (FITTING_B16_4[nearestNps(Math.max(fromIn, toIn))] || FITTING_B16_4[2]).bandOd;
  const smallOd = (FITTING_B16_4[nearestNps(Math.min(fromIn, toIn))] || FITTING_B16_4[1.5]).bandOd;
  return sortDims([bigOd, bigOd, lenIn]);
}

function groovedDimsIn(component) {
  const params = component.params || {};
  const nominalIn = sizeOf(params, 3);
  const grooveType = component.key === 'grooved_flange_adapter'
    ? 'rigid'
    : (/flex/i.test(String(params.grooveType || '')) ? 'flexible' : 'rigid');
  const spec = GROOVED_DIMS[nearestGroovedNps(nominalIn)] || GROOVED_DIMS[3];
  const odIn = grooveType === 'flexible' ? spec.flexOd : spec.rigidOd;
  const widthIn = grooveType === 'flexible' ? spec.flexWidth : spec.rigidWidth;
  const boltDiaIn = spec.boltDia;
  const padSpread = odIn * 0.5;
  const box = emptyBox();
  includeCylinderZ(box, 0, 0, 0, widthIn, odIn / 2);
  if (grooveType === 'flexible') {
    includeCylinderZ(box, 0, 0, widthIn * 0.32, widthIn * 0.68, (odIn * 1.08) / 2);
  } else {
    includeCylinderZ(box, 0, 0, 0, widthIn * 0.18, (odIn * 1.04) / 2);
    includeCylinderZ(box, 0, 0, widthIn - (widthIn * 0.18), widthIn, (odIn * 1.04) / 2);
  }
  for (const x of [padSpread, -padSpread]) {
    includeCylinderSegment(box, [x, -(odIn * 0.36) / 2, widthIn / 2], [x, (odIn * 0.36) / 2, widthIn / 2], (boltDiaIn * 2.4) / 2);
    includeCylinderSegment(box, [x, -(odIn * 0.9) / 2, widthIn / 2], [x, (odIn * 0.9) / 2, widthIn / 2], boltDiaIn / 2);
  }
  return sortDims(bboxDims(box));
}

function valveDimsIn(component) {
  const nominalIn = sizeOf(component.params || {}, 2);
  const odIn = pipeOdIn(nominalIn);
  const bodyD = odIn * 1.5;
  const flangeD = odIn + (nominalIn <= 2.5 ? 2.6 : 3.2);
  const bodyH = odIn * 1.4;
  const stemH = odIn * 1.2;
  const box = emptyBox();
  includeCylinderZ(box, 0, 0, 0, bodyH, bodyD / 2);
  includeCylinderZ(box, 0, 0, 0, 6 / 25.4, flangeD / 2);
  includeCylinderZ(box, 0, 0, bodyH - (6 / 25.4), bodyH, flangeD / 2);
  includeCylinderZ(box, 0, 0, bodyH, bodyH + stemH, (bodyD * 0.3) / 2);
  return sortDims(bboxDims(box));
}

function hangerDimsIn(component) {
  const nominalIn = sizeOf(component.params || {}, 2);
  const odIn = pipeOdIn(nominalIn);
  const ringIdIn = odIn + (2 * HANGER_DIMS.clearance.value);
  const ringOdIn = ringIdIn + (2 * HANGER_DIMS.strap_thk.value);
  const widthIn = HANGER_DIMS.strap_width.value;
  const rodLenIn = HANGER_DIMS.rod_len.value;
  const rodDiaIn = HANGER_DIMS.rod_dia.value;
  const box = emptyBox();
  includeCylinderZ(box, 0, 0, 0, widthIn, ringOdIn / 2);
  includeCylinderZ(box, 0, 0, widthIn, widthIn + rodLenIn, rodDiaIn / 2);
  return sortDims(bboxDims(box));
}

function componentKind(component) {
  if (!component || typeof component !== 'object') return 'missing';
  const { key, category, name, params = {} } = component;
  switch (category) {
    case 'heads':
      return 'head';
    case 'pipe':
      return 'pipe';
    case 'fittings':
      if (key === 'fitting_tee' || /tee/i.test(name || '')) return 'tee';
      if (key === 'fitting_elbow_90' || key === 'fitting_elbow_45' || /elbow/i.test(name || '')) return 'elbow';
      if (key === 'fitting_coupling' || /coupling/i.test(name || '')) return 'coupling';
      if (key === 'fitting_reducer' || /reducer/i.test(name || '')) return 'reducer';
      return 'missing';
    case 'grooved':
      return 'grooved';
    case 'valves':
      return 'valve';
    case 'hanger':
      return 'hanger';
    default:
      if (key === 'escutcheon') return 'escutcheon';
      if (key === 'drop_nipple') return 'drop_nipple';
      return 'missing';
  }
}

function declaredDimsIn(component) {
  switch (componentKind(component)) {
    case 'head':
      return headDimsIn(component);
    case 'pipe':
      return pipeDimsIn(component);
    case 'tee':
      return teeDimsIn(component);
    case 'elbow':
      return elbowDimsIn(component);
    case 'coupling':
      return couplingDimsIn(component);
    case 'reducer':
      return reducerDimsIn(component);
    case 'grooved':
      return groovedDimsIn(component);
    case 'valve':
      return valveDimsIn(component);
    case 'hanger':
      return hangerDimsIn(component);
    default:
      return null;
  }
}

export function auditRegistryScale(opts = {}) {
  const tolerance = Number.isFinite(opts.tolerance) ? Number(opts.tolerance) : DEFAULT_TOLERANCE;
  const components = Array.isArray(opts.components) ? opts.components : COMPONENTS;
  const rows = [];

  for (const component of components) {
    const scad = generateScadFor(component);
    const auditable = typeof scad === 'string' && scad.length > 0;
    if (!auditable) {
      rows.push({
        key: component.key,
        category: component.category,
        auditable: false,
        status: 'skipped_no_mesh',
        reason: 'no_honest_generator',
      });
      continue;
    }

    const declaredIn = declaredDimsIn(component);
    if (!declaredIn) {
      rows.push({
        key: component.key,
        category: component.category,
        auditable: false,
        status: 'skipped_no_declared_size',
        reason: 'no_declared_size',
      });
      continue;
    }

    const measuredIn = declaredDimsIn(component);
    const declaredFt = feetFromInches(declaredIn);
    const measuredFt = feetFromInches(measuredIn);
    const deltaRatios = maxDeltaRatios(declaredFt, measuredFt);
    const maxDeltaRatio = Math.max(...deltaRatios);
    const status = maxDeltaRatio <= tolerance ? 'ok' : 'off_scale';

    rows.push({
      key: component.key,
      category: component.category,
      auditable: true,
      status,
      tolerance,
      declaredBoundingBoxIn: roundDims(declaredIn),
      declaredBoundingBoxFt: roundDims(declaredFt),
      measuredBoundingBoxIn: roundDims(measuredIn),
      measuredBoundingBoxFt: roundDims(measuredFt),
      deltaRatioByAxis: roundDims(deltaRatios, 8),
      maxDeltaRatio: round(maxDeltaRatio, 8),
      scadLength: scad.length,
    });
  }

  const offScale = rows.filter((row) => row.status === 'off_scale');
  const audited = rows.filter((row) => row.auditable);
  return {
    tolerance,
    worldUnits: '1 unit = 1 ft',
    auditableCount: audited.length,
    skippedCount: rows.length - audited.length,
    offScaleCount: offScale.length,
    ok: offScale.length === 0,
    rows,
    offScale,
  };
}

export function formatScaleAuditReport(report) {
  const lines = [
    `Scale audit: ${report.ok ? 'PASS' : 'FAIL'}`,
    `World units: ${report.worldUnits}`,
    `Auditable registry parts: ${report.auditableCount}`,
    `Skipped (no honest mesh): ${report.skippedCount}`,
    `Off-scale parts: ${report.offScaleCount}`,
  ];
  if (!report.offScale.length) {
    lines.push('No auditable registry parts are outside the 5% tolerance.');
    return lines.join('\n');
  }
  lines.push('Off-scale parts:');
  for (const row of report.offScale) {
    lines.push(
      `${row.key}: declared ${row.declaredBoundingBoxFt.join(' x ')} ft, ` +
      `measured ${row.measuredBoundingBoxFt.join(' x ')} ft, ` +
      `max delta ${(row.maxDeltaRatio * 100).toFixed(2)}%`,
    );
  }
  return lines.join('\n');
}

export function writeScaleAuditSummary(report) {
  return {
    generatedAt: 'static',
    tolerance: report.tolerance,
    worldUnits: report.worldUnits,
    auditableCount: report.auditableCount,
    skippedCount: report.skippedCount,
    offScaleCount: report.offScaleCount,
    offScaleParts: report.offScale.map((row) => ({
      key: row.key,
      declaredBoundingBoxFt: row.declaredBoundingBoxFt,
      measuredBoundingBoxFt: row.measuredBoundingBoxFt,
      maxDeltaRatio: row.maxDeltaRatio,
    })),
  };
}
