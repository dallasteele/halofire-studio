/**
 * HaloFire NFPA-13 hydraulic calculation engine (internal alpha, best-effort).
 *
 * Pure, deterministic Node module. Implements the public NFPA-13 hydraulic
 * relations used to sanity-check a schedule-pipe-sized layout:
 *   - Hazen-Williams friction loss (psi/ft),
 *   - remote-area (density × area-of-operation) demand,
 *   - required pressure at the riser for the hydraulically-remote head, and
 *   - schedule-adequacy warnings (over-velocity / implausible loss).
 *
 * HONESTY / fail-closed: these are textbook public formulae with representative
 * NFPA-13 density/area values for sanity checking ONLY. This is NOT a full
 * node-by-node hydraulic balance, NOT AutoSprink, NOT PE-stamped, and NOT
 * AHJ-approved. It walks one representative remote path; it does not solve the
 * whole network simultaneously. Treat results as an internal-alpha estimate that
 * a licensed professional must review. No claim gate is cleared by this module.
 *
 * Units: gpm (flow), inches (pipe diameter), feet (length/elevation), psi.
 */

import { submittalData } from './submittal.js';
import { balanceNetwork } from './hydraulic-network.js';

/**
 * Hazen-Williams friction loss, psi per foot of pipe.
 *   p = 4.52 * Q^1.852 / (C^1.852 * d^4.8704)
 * @param {number} gpm flow rate (gallons per minute)
 * @param {number} diameterIn internal pipe diameter (inches)
 * @param {number} [C=120] Hazen-Williams roughness coefficient
 * @returns {number} psi/ft (0 when flow is 0)
 */
export function hazenWilliamsLossPsiPerFt(gpm, diameterIn, C = 120) {
  if (!(diameterIn > 0)) throw new Error('diameterIn must be > 0');
  if (!(C > 0)) throw new Error('C must be > 0');
  const Q = Math.max(0, Number(gpm) || 0);
  if (Q === 0) return 0;
  return (4.52 * Math.pow(Q, 1.852)) / (Math.pow(C, 1.852) * Math.pow(diameterIn, 4.8704));
}

/**
 * Flow velocity in a round pipe, feet per second.
 *   v = 0.4085 * Q / d^2
 * @param {number} gpm flow (gpm)
 * @param {number} diameterIn internal diameter (inches)
 */
export function velocityFps(gpm, diameterIn) {
  if (!(diameterIn > 0)) throw new Error('diameterIn must be > 0');
  return (0.4085 * (Number(gpm) || 0)) / (diameterIn * diameterIn);
}

// Representative public NFPA-13 density / area-of-operation values by hazard.
// density in gpm/ft^2, design area in ft^2. Sanity-check values, not a lookup
// of the full density/area curve.
const REMOTE_AREA = Object.freeze({
  light: { densityGpmPerSqft: 0.10, designAreaSqft: 1500 },
  ordinary: { densityGpmPerSqft: 0.18, designAreaSqft: 1500 },
  extra: { densityGpmPerSqft: 0.30, designAreaSqft: 2500 },
});

/**
 * NFPA-13 remote-area demand for a hazard class.
 * @param {string} hazard 'light' | 'ordinary' | 'extra' (unknown -> ordinary)
 * @returns {{densityGpmPerSqft:number, designAreaSqft:number, requiredFlowGpm:number}}
 */
export function remoteAreaDemand(hazard) {
  const key = String(hazard || 'ordinary').toLowerCase();
  const rule = REMOTE_AREA[key] || REMOTE_AREA.ordinary;
  return {
    densityGpmPerSqft: rule.densityGpmPerSqft,
    designAreaSqft: rule.designAreaSqft,
    requiredFlowGpm: round(rule.densityGpmPerSqft * rule.designAreaSqft),
  };
}

const ELEVATION_PSI_PER_FT = 0.433; // water column
const DEFAULT_MIN_HEAD_PRESSURE_PSI = 7;
const DEFAULT_C = 120;

/** Pull the network object out of either a raw network or a cadModel/room cad. */
function resolveNetwork(arg) {
  if (!arg) throw new Error('requiredPressureAtRiser needs { cadModel } or { network }');
  // A cadModel (buildRoomCad result) exposes its piping under .network.
  if (arg.cadModel && arg.cadModel.network) return arg.cadModel.network;
  if (arg.network) return arg.network;
  if (Array.isArray(arg.branchLines)) return arg; // already a network
  throw new Error('could not find a piping network (need .cadModel, .network, or .branchLines)');
}

/**
 * Walk riser -> cross-main -> one representative branch to the hydraulically-
 * remote head, summing Hazen-Williams friction loss over the pipe
 * diameters/lengths already in the CAD model, add elevation head and a minimum
 * operating pressure.
 *
 * Representative path (single-path estimate, NOT a full network balance):
 *   system riser (floor -> main elevation, full demand flow) ->
 *   cross-main run (full demand flow) ->
 *   the longest branch line (branch flow ~ demand × branchHeads/totalHeads) ->
 *   plus elevation from floor to the remote head deflector.
 *
 * @param {{cadModel?:object, network?:object, hazard?:string,
 *   C?:number, minHeadPressurePsi?:number}} arg
 * @returns {{requiredFlowGpm:number, frictionLossPsi:number, elevationPsi:number,
 *   requiredPressurePsi:number, segments:Array}}
 */
export function requiredPressureAtRiser(arg) {
  const network = resolveNetwork(arg);
  const hazard = arg.hazard || 'ordinary';
  const C = arg.C || DEFAULT_C;
  const minHead = arg.minHeadPressurePsi != null ? arg.minHeadPressurePsi : DEFAULT_MIN_HEAD_PRESSURE_PSI;

  const demand = remoteAreaDemand(hazard);
  const Qtotal = demand.requiredFlowGpm;

  const branches = Array.isArray(network.branchLines) ? network.branchLines : [];
  const totalHeads = network.totalHeads
    || branches.reduce((n, b) => n + (b.headCount || b.heads || 0), 0)
    || 1;

  const mainZ = num(network.mainZ);
  const branchZ = num(network.branchZ, mainZ);
  const headZ = num(network.headZ, branchZ);
  const mainX = num(network.mainX);

  const segments = [];
  let frictionLossPsi = 0;
  const addSeg = (name, diameterIn, lengthFt, flowGpm) => {
    const dia = num(diameterIn, 1);
    const len = Math.max(0, num(lengthFt));
    const lossPerFt = hazenWilliamsLossPsiPerFt(flowGpm, dia, C);
    const lossPsi = round(lossPerFt * len);
    frictionLossPsi += lossPsi;
    segments.push({
      name,
      diameterIn: dia,
      lengthFt: round(len),
      flowGpm: round(flowGpm),
      velocityFps: round(velocityFps(flowGpm, dia)),
      lossPsiPerFt: round6(lossPerFt),
      lossPsi,
    });
  };

  // Pick the hydraulically-remote branch: the longest run carries the path.
  let remote = null;
  let remoteLen = -1;
  for (const b of branches) {
    const len = Math.abs(num(b.endX) - num(b.startX));
    if (len > remoteLen) { remoteLen = len; remote = b; }
  }

  // System riser: floor -> cross-main elevation, full system demand flow.
  const mainDia = remote ? num(remote.diameterIn, 1) : 1;
  const riserDia = num(network.mainDiameterIn, mainDia);
  if (mainZ > 0) addSeg('system-riser', riserDia, mainZ, Qtotal);

  if (remote) {
    // Cross-main: from the riser tie at branch y0 to the remote branch.
    const ys = branches.map((b) => num(b.y));
    const mainRun = ys.length ? Math.abs(num(remote.y) - Math.min(...ys)) : 0;
    addSeg('cross-main', riserDia, mainRun, Qtotal);

    // Tie-down from main elevation to branch elevation, full demand.
    if (mainZ > branchZ) addSeg('main-tie', riserDia, mainZ - branchZ, Qtotal);

    // Remote branch line: flow proportional to the heads it serves.
    const branchHeads = num(remote.headCount, num(remote.heads, 1));
    const branchFlow = Qtotal * (branchHeads / totalHeads);
    addSeg('branch', num(remote.diameterIn, 1), remoteLen, branchFlow);
  }

  // Elevation head: floor up to the remote head deflector.
  const elevationPsi = round(ELEVATION_PSI_PER_FT * Math.max(0, headZ));
  void mainX; // mainX retained on segments path for future node addressing

  const requiredPressurePsi = round(frictionLossPsi + elevationPsi + minHead);

  return {
    requiredFlowGpm: Qtotal,
    frictionLossPsi: round(frictionLossPsi),
    elevationPsi,
    minHeadPressurePsi: minHead,
    requiredPressurePsi,
    hazard,
    segments,
    disclaimer: 'best-effort single-path hydraulic estimate — NOT a full network '
      + 'balance, NOT PE-reviewed, NOT AHJ-approved, NOT AutoSprink parity.',
  };
}

const MAX_VELOCITY_FPS = 32; // common practical ceiling; over this, schedule sizing is suspect
const MAX_LOSS_PSI_PER_FT = 1.0; // implausibly high friction gradient for a feed pipe

/**
 * Flag segments where the schedule-sized pipe looks inadequate vs the hazard
 * demand: computed velocity over ~32 fps, or an implausibly high loss gradient.
 * Returns an array of warnings (empty when the schedule looks fine).
 *
 * @param {object} networkOrCad a buildRoomCad() result or a raw network
 * @param {string} hazard hazard class for the demand flow
 * @returns {Array<{type:string, segment:string, ...}>}
 */
export function flagSchedule(networkOrCad, hazard) {
  const network = networkOrCad && networkOrCad.network ? networkOrCad.network : resolveNetwork(networkOrCad);
  const calc = requiredPressureAtRiser({ network, hazard });
  const warnings = [];
  for (const seg of calc.segments) {
    if (seg.velocityFps > MAX_VELOCITY_FPS) {
      warnings.push({
        type: 'velocity',
        segment: seg.name,
        diameterIn: seg.diameterIn,
        flowGpm: seg.flowGpm,
        velocityFps: seg.velocityFps,
        limitFps: MAX_VELOCITY_FPS,
        message: `${seg.name}: ${seg.velocityFps} fps exceeds ~${MAX_VELOCITY_FPS} fps `
          + `(${seg.diameterIn}" pipe at ${seg.flowGpm} gpm) — schedule size may be inadequate.`,
      });
    }
    if (seg.lossPsiPerFt > MAX_LOSS_PSI_PER_FT) {
      warnings.push({
        type: 'loss',
        segment: seg.name,
        diameterIn: seg.diameterIn,
        lossPsiPerFt: seg.lossPsiPerFt,
        limitPsiPerFt: MAX_LOSS_PSI_PER_FT,
        message: `${seg.name}: ${seg.lossPsiPerFt} psi/ft is implausibly high for a `
          + `${seg.diameterIn}" feed pipe — schedule size may be inadequate.`,
      });
    }
  }
  return warnings;
}

/**
 * Stable convenience entrypoint for callers that want the existing hydraulic
 * outputs plus a structured submittal-data export in one deterministic payload.
 *
 * @param {object} input
 * @returns {{hydraulicEstimate:object, hydraulicBalance:object, scheduleWarnings:Array,
 *   submittalData:object, hazard:string}}
 */
export function computeHydraulics(input = {}) {
  const cadModel = input.cadModel || input.model || null;
  const network = input.network || null;
  const hazard = input.hazard || 'ordinary';

  if (!cadModel && !network) {
    throw new Error('computeHydraulics needs { model|cadModel } or { network }');
  }

  const shared = {
    cadModel,
    network,
    hazard,
    C: input.C,
    minHeadPressurePsi: input.minHeadPressurePsi,
  };

  const hydraulicEstimate = requiredPressureAtRiser(shared);
  const hydraulicBalance = balanceNetwork({
    ...shared,
    kFactor: input.kFactor,
    sourcePsi: input.sourcePsi,
  });
  const scheduleWarnings = flagSchedule(cadModel || network, hazard);

  return {
    hazard,
    hydraulicEstimate,
    hydraulicBalance,
    scheduleWarnings,
    submittalData: submittalData({
      model: cadModel,
      bid: input.bid || null,
      hydraulicEstimate,
      hydraulicBalance,
      compliance: input.compliance || null,
    }),
  };
}

// Re-export the full hydraulic NETWORK balance (P1) so callers can import the
// K-factor head discharge + node-by-node balance from the same hydraulics entry
// point as the T2 single-path estimate. The network module is the source of
// truth; this is a convenience re-export and keeps the T2 API above untouched.
export { kFactorFlow, balanceNetwork } from './hydraulic-network.js';

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function round(n) {
  return Math.round((n + Number.EPSILON) * 1000) / 1000;
}

function round6(n) {
  return Math.round((n + Number.EPSILON) * 1e6) / 1e6;
}
