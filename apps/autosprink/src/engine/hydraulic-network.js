/**
 * HaloFire hydraulic NETWORK balance (internal alpha, best-effort estimate).
 *
 * Pure, deterministic Node module. Extends the T2 single-path estimate in
 * hydraulics.js with a node-by-node flow accumulation across the remote design
 * area:
 *   - K-factor head discharge: Q = K * sqrt(P)  (kFactorFlow),
 *   - balanceNetwork(): walks the remote design-area heads -> drops -> branch
 *     lines -> cross-main -> riser/source, accumulating flow node-by-node. Each
 *     head discharges Q = K*sqrt(P) at its node pressure; each downstream node's
 *     pressure = the upstream node pressure minus Hazen-Williams friction over
 *     the segment carrying the accumulated flow, minus elevation change.
 *
 * HONESTY / fail-closed: this is a best-effort ITERATIVE engineering estimate,
 * NOT a sealed Hardy-Cross loop solve, NOT AutoSprink, NOT a stamped hydraulic
 * calculation, NOT PE-reviewed, NOT AHJ-approved, NOT manufacturer-verified.
 * It walks the most-remote branch outward-to-inward summing flow and friction;
 * it does not iterate looped mains to convergence. A licensed professional must
 * perform and stamp the real hydraulic calc. No claim gate is cleared here.
 *
 * Units: gpm (flow), inches (pipe diameter), feet (length/elevation), psi.
 */

import { hazenWilliamsLossPsiPerFt, remoteAreaDemand } from './hydraulics.js';

const ELEVATION_PSI_PER_FT = 0.433; // water column
const DEFAULT_MIN_HEAD_PRESSURE_PSI = 7;
const DEFAULT_C = 120;
const DEFAULT_K_FACTOR = 5.6; // standard 1/2" orifice spray head

const DISCLAIMER =
  'best-effort ITERATIVE hydraulic NETWORK estimate (Q=K√P node accumulation over '
  + 'the remote branch) — NOT a sealed Hardy-Cross solve, NOT a stamped hydraulic '
  + 'calculation, NOT PE-reviewed, NOT AHJ-approved, NOT AutoSprink parity.';

/**
 * K-factor sprinkler head discharge: Q = K * sqrt(P).
 * @param {number} k discharge coefficient (gpm/psi^0.5)
 * @param {number} psi node pressure (psi)
 * @returns {number} flow (gpm); 0 when pressure <= 0
 */
export function kFactorFlow(k, psi) {
  if (!(k > 0)) throw new Error('kFactor must be > 0');
  const p = Number(psi);
  if (!(p > 0)) return 0;
  return k * Math.sqrt(p);
}

/** Pull the network object out of either a raw network or a cadModel/room cad. */
function resolveNetwork(arg) {
  if (!arg) throw new Error('balanceNetwork needs { cadModel } or { network }');
  if (arg.cadModel && arg.cadModel.network) return arg.cadModel.network;
  if (arg.network) return arg.network;
  if (Array.isArray(arg.branchLines)) return arg; // already a network
  throw new Error('could not find a piping network (need .cadModel, .network, or .branchLines)');
}

/**
 * Best-effort hydraulic network balance over the remote design area.
 *
 * Algorithm (single remote branch, outward-to-inward accumulation):
 *   1. Pick the hydraulically-remote branch line (longest run).
 *   2. Order its heads from most-remote (far end) to the branch tie.
 *   3. Seed the most-remote head at the minimum operating pressure.
 *   4. Walk inward head-by-head: each head discharges Q=K√P at its node
 *      pressure; accumulate the flow; the next (upstream) node pressure is the
 *      current node pressure PLUS the friction the accumulated flow loses over
 *      the inter-head segment (i.e. upstream must be higher to push the flow).
 *   5. From the branch tie, add the cross-main + riser friction (full
 *      accumulated branch demand) and the elevation lift to reach the source.
 *
 * @param {{network?:object, cadModel?:object, hazard?:string, kFactor?:number,
 *   C?:number, sourcePsi?:number, minHeadPressurePsi?:number}} arg
 * @returns {{heads:Array<{node:string,pressurePsi:number,flowGpm:number}>,
 *   totalDemandGpm:number, requiredSourcePsi:number, segments:Array,
 *   balanced:boolean, hazard:string, disclaimer:string, sourcePsi?:number,
 *   sourceMargin?:number}}
 */
export function balanceNetwork(arg) {
  const network = resolveNetwork(arg);
  const hazard = arg.hazard || 'ordinary';
  const C = arg.C > 0 ? arg.C : DEFAULT_C;
  const k = arg.kFactor > 0 ? arg.kFactor : DEFAULT_K_FACTOR;
  const minHead = arg.minHeadPressurePsi != null ? arg.minHeadPressurePsi : DEFAULT_MIN_HEAD_PRESSURE_PSI;

  const demand = remoteAreaDemand(hazard); // kept for context / reporting

  const branches = Array.isArray(network.branchLines) ? network.branchLines : [];

  const mainZ = num(network.mainZ);
  const branchZ = num(network.branchZ, mainZ);
  const headZ = num(network.headZ, branchZ);

  // 1. Pick the hydraulically-remote branch (longest horizontal run).
  let remote = null;
  let remoteLen = -1;
  for (const b of branches) {
    const len = Math.abs(num(b.endX) - num(b.startX));
    if (len > remoteLen) { remoteLen = len; remote = b; }
  }

  const segments = [];
  const heads = [];

  if (!remote) {
    // No piping to walk — return a degenerate-but-honest result.
    return {
      heads,
      totalDemandGpm: 0,
      requiredSourcePsi: round(minHead + ELEVATION_PSI_PER_FT * Math.max(0, headZ)),
      segments,
      balanced: true,
      hazard,
      demandContextGpm: demand.requiredFlowGpm,
      disclaimer: DISCLAIMER,
    };
  }

  const branchDia = num(remote.diameterIn, 1);

  // 2. Order heads most-remote first (descending |x - startX|).
  const tieX = num(remote.startX);
  const headList = (Array.isArray(remote.heads) && remote.heads.length
    ? remote.heads.map((h, i) => ({ x: num(h.x, tieX + i), y: num(h.y, num(remote.y)) }))
    : syntheticHeads(remote, tieX));
  headList.sort((a, b) => Math.abs(b.x - tieX) - Math.abs(a.x - tieX));

  // 3 + 4. Walk inward, accumulating flow and node pressures.
  let nodePsi = minHead; // most-remote head operates at the minimum head pressure
  let accumFlow = 0;
  let prevX = null;
  headList.forEach((h, i) => {
    if (i > 0) {
      // Friction over the inter-head segment carrying the flow accumulated SO
      // FAR (downstream of this node). Upstream node sits higher by that loss.
      const segLen = Math.abs(h.x - prevX);
      const lossPerFt = hazenWilliamsLossPsiPerFt(accumFlow, branchDia, C);
      const lossPsi = lossPerFt * segLen;
      nodePsi = nodePsi + lossPsi;
      segments.push(mkSeg(`branch-seg-${i}`, branchDia, segLen, accumFlow, lossPsi, C));
    }
    const q = kFactorFlow(k, nodePsi);
    accumFlow += q;
    heads.push({
      node: `head-${i + 1}`,
      x: round(h.x),
      y: round(h.y),
      pressurePsi: round(nodePsi),
      flowGpm: round(q),
    });
    prevX = h.x;
  });

  // 5. Cross-main + riser carry the full accumulated branch demand to the source.
  // Cross-main: from the riser tie (min branch y) to the remote branch.
  const ys = branches.map((b) => num(b.y));
  const mainRun = ys.length ? Math.abs(num(remote.y) - Math.min(...ys)) : 0;
  const mainDia = num(network.mainDiameterIn, branchDia);

  // pressure at the branch tie (most-upstream branch node) is nodePsi.
  let sourcePathPsi = nodePsi;

  if (mainRun > 0) {
    const lossPerFt = hazenWilliamsLossPsiPerFt(accumFlow, mainDia, C);
    const lossPsi = lossPerFt * mainRun;
    sourcePathPsi += lossPsi;
    segments.push(mkSeg('cross-main', mainDia, mainRun, accumFlow, lossPsi, C));
  }

  // Tie-down from main elevation to branch elevation (full demand).
  if (mainZ > branchZ) {
    const dz = mainZ - branchZ;
    const lossPerFt = hazenWilliamsLossPsiPerFt(accumFlow, mainDia, C);
    const lossPsi = lossPerFt * dz;
    sourcePathPsi += lossPsi;
    segments.push(mkSeg('main-tie', mainDia, dz, accumFlow, lossPsi, C));
  }

  // System riser: floor -> cross-main elevation, full demand.
  if (mainZ > 0) {
    const lossPerFt = hazenWilliamsLossPsiPerFt(accumFlow, mainDia, C);
    const lossPsi = lossPerFt * mainZ;
    sourcePathPsi += lossPsi;
    segments.push(mkSeg('system-riser', mainDia, mainZ, accumFlow, lossPsi, C));
  }

  // Elevation head: floor up to the remote head deflector.
  const elevationPsi = ELEVATION_PSI_PER_FT * Math.max(0, headZ);
  const requiredSourcePsi = round(sourcePathPsi + elevationPsi);

  const result = {
    heads,
    totalDemandGpm: round(accumFlow),
    requiredSourcePsi,
    elevationPsi: round(elevationPsi),
    frictionLossPsi: round(sourcePathPsi - nodePsi),
    minHeadPressurePsi: minHead,
    kFactor: k,
    hazard,
    demandContextGpm: demand.requiredFlowGpm,
    segments,
    balanced: true,
    disclaimer: DISCLAIMER,
  };

  // If a source pressure is supplied, report whether it covers the demand.
  if (arg.sourcePsi != null) {
    const sp = Number(arg.sourcePsi);
    result.sourcePsi = round(sp);
    result.sourceMargin = round(sp - requiredSourcePsi);
    result.balanced = sp >= requiredSourcePsi;
  }

  return result;
}

/** Build evenly-spaced synthetic head positions when a branch lacks .heads. */
function syntheticHeads(branch, tieX) {
  const n = Math.max(1, num(branch.headCount, num(branch.heads, 1)));
  const endX = num(branch.endX, tieX);
  const y = num(branch.y);
  const span = endX - tieX;
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const t = n === 1 ? 1 : (i + 1) / n;
    out.push({ x: tieX + span * t, y });
  }
  return out;
}

function mkSeg(name, diameterIn, lengthFt, flowGpm, lossPsi, C) {
  const dia = num(diameterIn, 1);
  return {
    name,
    diameterIn: dia,
    lengthFt: round(Math.max(0, lengthFt)),
    flowGpm: round(flowGpm),
    lossPsiPerFt: round6(hazenWilliamsLossPsiPerFt(flowGpm, dia, C)),
    lossPsi: round(lossPsi),
  };
}

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
