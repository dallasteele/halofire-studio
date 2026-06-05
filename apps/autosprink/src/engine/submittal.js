/**
 * HaloFire submittal package + PDF report (internal alpha, best-effort).
 *
 * buildSubmittal({project, bid, cadModel, hydraulics?, compliance?}) assembles a
 * structured submittal package — project header, head schedule, pipe schedule,
 * hydraulic summary, bill of materials, and gate status — as plain, deterministic
 * data. It is browser-free and calls no binaries.
 *
 * renderSubmittalPdf(pkg, {invoker}) builds the args for OpenClaw's
 * generate_pdf_report tool and calls an INJECTED async invoker. There is no
 * hardcoded network here; production wires the GX10 OpenClaw bridge as the
 * invoker and tests inject a mock. If the invoker is missing/not callable or
 * throws (gateway unreachable), it degrades gracefully — { ok:false, skipped:true,
 * reason } — and never throws.
 *
 * HONESTY / fail-closed: this is a BEST-EFFORT internal alpha package. It is NOT a
 * stamped/sealed submittal, NOT AHJ-approved, NOT PE-reviewed, NOT permit-ready,
 * and NOT AutoSprink/AutoCAD parity. The AUTOSPRINK_PARITY gate stays blocked; a
 * generated package NEVER reads as an approved submittal.
 */

import {
  AUTOSPRINK_PARITY_GATE,
  parityGateStatus,
  buildParityInventory,
} from '../components/registry.js';

export const SUBMITTAL_DISCLAIMER =
  'best-effort internal alpha submittal package — head/pipe schedules, hydraulic '
  + 'summary and bill of materials are estimates for internal review only. This is '
  + 'NOT a stamped/sealed submittal, NOT AHJ-approved, NOT PE-reviewed, NOT '
  + 'permit-ready, NOT manufacturer-approved, NOT fabrication-ready, and NOT '
  + 'AutoSprink/AutoCAD parity. Professional review and approval are required.';

/** Round to 3 decimals, EPSILON-safe. */
function round(n) {
  return Math.round((Number(n) + Number.EPSILON) * 1000) / 1000;
}

/** Pipe segment length in feet from a {from:[x,y,z], to:[x,y,z]} solid. */
function pipeLengthFt(pipe) {
  const a = pipe.from || [0, 0, 0];
  const b = pipe.to || [0, 0, 0];
  const dx = (b[0] ?? 0) - (a[0] ?? 0);
  const dy = (b[1] ?? 0) - (a[1] ?? 0);
  const dz = (b[2] ?? 0) - (a[2] ?? 0);
  return Math.hypot(dx, dy, dz);
}

/** Group sprinkler heads by orientation into a schedule of {orientation, count}. */
function buildHeadSchedule(solids) {
  const byOrientation = new Map();
  for (const s of solids) {
    if (s.kind !== 'head') continue;
    const o = s.orientation || 'pendent';
    byOrientation.set(o, (byOrientation.get(o) || 0) + 1);
  }
  return [...byOrientation.entries()]
    .sort((p, q) => (p[0] < q[0] ? -1 : 1))
    .map(([orientation, count]) => ({ orientation, count }));
}

/**
 * Group pipe solids by nominal diameter into a schedule of
 * {diameterIn, count, totalLengthFt}. Ordered by diameter ascending.
 */
function buildPipeSchedule(solids) {
  const byDia = new Map();
  for (const s of solids) {
    if (s.kind !== 'pipe') continue;
    const dia = round(s.diameterIn ?? 1);
    const entry = byDia.get(dia) || { diameterIn: dia, count: 0, totalLengthFt: 0 };
    entry.count += 1;
    entry.totalLengthFt += pipeLengthFt(s);
    byDia.set(dia, entry);
  }
  return [...byDia.values()]
    .map((e) => ({ ...e, totalLengthFt: round(e.totalLengthFt) }))
    .sort((p, q) => p.diameterIn - q.diameterIn);
}

/**
 * Best-effort bill of materials (takeoff) from the CAD model: one head line, one
 * line per pipe diameter (footage), and a fitting estimate. Quantities are
 * estimates for internal review — NOT a manufacturer-quoted material list.
 */
function buildBillOfMaterials(solids, headSchedule, pipeSchedule) {
  const lines = [];
  for (const h of headSchedule) {
    lines.push({
      item: `Sprinkler head (${h.orientation})`,
      qty: h.count,
      unit: 'ea',
      basis: 'count',
      estimate: true,
    });
  }
  for (const p of pipeSchedule) {
    lines.push({
      item: `Pipe ${p.diameterIn}" (sch. estimate)`,
      qty: p.totalLengthFt,
      unit: 'ft',
      basis: 'length',
      estimate: true,
    });
    // One coupling/fitting estimate per pipe run end is a rough takeoff aid only.
    lines.push({
      item: `Fittings ${p.diameterIn}" (est.)`,
      qty: p.count,
      unit: 'ea',
      basis: 'pipe-run-estimate',
      estimate: true,
    });
  }
  return lines;
}

/**
 * Compact hydraulic summary from a balanceNetwork() result. Returns null when no
 * hydraulics were supplied (graceful — the package still assembles).
 */
function buildHydraulicSummary(hydraulics) {
  if (!hydraulics) return null;
  return {
    estimate: true,
    requiredSourcePsi: hydraulics.requiredSourcePsi ?? null,
    totalDemandGpm: hydraulics.totalDemandGpm ?? null,
    frictionLossPsi: hydraulics.frictionLossPsi ?? null,
    elevationPsi: hydraulics.elevationPsi ?? null,
    kFactor: hydraulics.kFactor ?? null,
    hazard: hydraulics.hazard ?? null,
    balanced: hydraulics.balanced ?? null,
    sourcePsi: hydraulics.sourcePsi ?? null,
    sourceMargin: hydraulics.sourceMargin ?? null,
    note: hydraulics.disclaimer ?? null,
  };
}

/**
 * Compute the gate status block. The AUTOSPRINK_PARITY gate is fail-closed: with
 * no real-evidence inventory it stays 'blocked', so submittalReady is always
 * false here — a best-effort package is NEVER an approved/stamped submittal.
 */
function buildGateStatus(compliance) {
  // No model-status map is supplied to a submittal, so the inventory is empty and
  // parity is necessarily incomplete -> blocked (fail-closed).
  const inventory = buildParityInventory({});
  const autosprinkParity = parityGateStatus(inventory);

  const blockedGates = [];
  if (autosprinkParity !== 'clear') {
    blockedGates.push({
      code: AUTOSPRINK_PARITY_GATE.code,
      severity: AUTOSPRINK_PARITY_GATE.severity,
      status: 'blocked',
      reason: AUTOSPRINK_PARITY_GATE.reason,
    });
  }

  const compliancePassed = compliance ? compliance.passed === true : null;
  if (compliance && compliance.passed === false) {
    blockedGates.push({
      code: 'NFPA13_COMPLIANCE_FAILED',
      severity: 'blocking',
      status: 'blocked',
      reason: 'NFPA-13 geometric compliance check reported one or more failures.',
    });
  }

  return {
    autosprinkParity,
    compliancePassed,
    blockedGates,
    // A best-effort package can never satisfy a regulated submittal gate.
    submittalReady: false,
  };
}

/**
 * Assemble a structured submittal package from the project + bid + CAD model and
 * (optionally) the hydraulic balance and compliance results.
 *
 * @param {{project:object, bid?:object, cadModel:object, hydraulics?:object, compliance?:object}} input
 * @returns {{header, headSchedule, pipeSchedule, hydraulicSummary, billOfMaterials, gateStatus, disclaimer}}
 */
export function buildSubmittal(input = {}) {
  const { project = {}, bid = null, cadModel, hydraulics = null, compliance = null } = input;
  if (!cadModel || !Array.isArray(cadModel.solids)) {
    throw new Error('buildSubmittal requires a cad model with a solids array');
  }
  const solids = cadModel.solids;

  const header = {
    project: project.name ?? cadModel.name ?? null,
    client: project.client ?? null,
    address: project.address ?? null,
    units: cadModel.units || 'ft',
    generatedBy: 'halofire-submittal',
    generatedAt: project.generatedAt ?? null,
    // Explicit honesty flags — this package asserts none of these.
    stamped: false,
    ahjApproved: false,
    peReviewed: false,
    permitReady: false,
    label: 'best-effort internal alpha — NOT a stamped submittal',
  };

  const headSchedule = buildHeadSchedule(solids);
  const pipeSchedule = buildPipeSchedule(solids);
  const billOfMaterials = buildBillOfMaterials(solids, headSchedule, pipeSchedule);
  const hydraulicSummary = buildHydraulicSummary(hydraulics);
  const gateStatus = buildGateStatus(compliance);

  return {
    header,
    headSchedule,
    pipeSchedule,
    hydraulicSummary,
    billOfMaterials,
    gateStatus,
    // Carry the bid total as context when supplied (estimate only).
    bidSummary: bid
      ? {
        estimate: true,
        total: bid.total ?? bid.fullScopeTotal ?? bid.bareMaterialsTotal ?? null,
        anyEstimated: bid.anyEstimated ?? null,
      }
      : null,
    disclaimer: SUBMITTAL_DISCLAIMER,
  };
}

/**
 * Build the args for OpenClaw's generate_pdf_report tool from a submittal package.
 * Pure + deterministic: package -> plain-object report payload (title + ordered
 * sections + the fail-closed disclaimer).
 */
export function buildPdfReportPayload(pkg) {
  const title = `HaloFire Submittal (best-effort) — ${pkg?.header?.project ?? 'Project'}`;
  const sections = [
    { heading: 'Project', body: pkg.header },
    { heading: 'Head Schedule', body: pkg.headSchedule },
    { heading: 'Pipe Schedule', body: pkg.pipeSchedule },
    { heading: 'Hydraulic Summary', body: pkg.hydraulicSummary },
    { heading: 'Bill of Materials', body: pkg.billOfMaterials },
    { heading: 'Gate Status', body: pkg.gateStatus },
  ];
  if (pkg.bidSummary) sections.push({ heading: 'Bid Summary', body: pkg.bidSummary });
  return {
    tool: 'generate_pdf_report',
    title,
    sections,
    disclaimer: pkg.disclaimer,
  };
}

/**
 * Render the submittal package to a PDF via OpenClaw's generate_pdf_report tool
 * using an INJECTED async invoker. Never throws: on success returns
 * { ok:true, result }; if the invoker is missing/not callable or throws
 * (e.g. GX10 gateway unreachable) returns { ok:false, skipped:true, reason }.
 *
 * The invoker may accept either (toolName, payload) or a single (payload) arg —
 * both are supported.
 *
 * @param {object} pkg - output of buildSubmittal().
 * @param {{invoker?: function}} [opts]
 * @returns {Promise<{ok:boolean, result?:any, skipped?:boolean, reason?:string}>}
 */
export async function renderSubmittalPdf(pkg, opts = {}) {
  const invoker = opts && opts.invoker;
  if (typeof invoker !== 'function') {
    return {
      ok: false,
      skipped: true,
      reason: 'PDF invoker not provided — OpenClaw generate_pdf_report not wired; skipping.',
    };
  }
  let payload;
  try {
    payload = buildPdfReportPayload(pkg);
  } catch (err) {
    const reason = err && err.message ? err.message : String(err);
    return { ok: false, skipped: true, reason };
  }
  try {
    // Support both (toolName, payload) and (payload) invoker signatures.
    const result = invoker.length >= 2
      ? await invoker('generate_pdf_report', payload)
      : await invoker(payload);
    return { ok: true, result };
  } catch (err) {
    const reason = err && err.message ? err.message : String(err);
    return { ok: false, skipped: true, reason };
  }
}
