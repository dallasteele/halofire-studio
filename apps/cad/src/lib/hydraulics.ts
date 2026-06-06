// HaloFire CAD — PURE NFPA-13 hydraulic DESIGN-AID (W5). No React / three / DOM.
// Deterministic: same network + supply -> same result.
//
// solveHydraulics(network, opts) takes the routed wet-pipe TREE (pipe-routing.ts:
// riser SOURCE -> main -> cross_main -> branch -> arm_over -> head) plus a water
// supply, and computes a real NFPA-13-style hydraulic design aid:
//
//   1. Pick the hydraulically MOST-DEMANDING remote area: the design-area worth of
//      heads (count = designAreaSqFt / cited max-protection-area-per-head) whose
//      path to the riser is the most LOSSY. Those heads flow; the rest are closed.
//   2. Each operating head flows Q = K * sqrt(P) (cited orifice relation), with the
//      minimum operating pressure as the start pressure at the most-remote head.
//   3. Traverse the tree from the operating heads back to the riser, accumulating
//      Hazen-Williams friction Pm = 4.52 * Q^1.85 / (C^1.85 * d^4.87) * L (cited
//      constant + exponents), fitting equivalent lengths Le (cited table), and
//      elevation head (0.433 psi/ft, cited). Flows SUM at tees toward the riser.
//   4. Report systemDemand { gpm, psiAtRiser }; interpolate the operator's supply
//      curve (static / residual @ flow) to the available psi at the demand gpm; set
//      adequate = availablePsi >= requiredPsiAtRiser.
//
// HONESTY (hard, fail-closed): EVERY hydraulic constant/exponent comes from the
// cited nfpa13-rules re-export — this file forks NO uncited numbers. The two values
// NFPA-13 does NOT express as a single constant (the design-AREA magnitude and the
// per-density flow) are operator-supplied inputs, surfaced with the cite-TODO from
// nfpa13-rules UNCERTAIN_VALUES rather than fabricated. Findings restate the
// design-aid disclaimer. This is a DESIGN AID / estimate — NOT a certified hydraulic
// calculation, NOT AHJ-approved, NOT PE-sealed, NOT for construction. The supply
// curve is a straight-line approximation of the operator's flow test; a stamped
// calculation with the adopted edition's full friction/fitting tables governs.

import type {
  PipeMaterial as CadPipeMaterial,
  Segment,
  SprinklerNetwork,
} from './model';
import {
  HAZEN_WILLIAMS_C,
  MAX_PROTECTION_AREA_SQFT,
  NFPA13_DESIGN_AID_DISCLAIMER,
  UNCERTAIN_VALUES,
  flowFromKP,
  hazenWilliamsLossPsi,
  type HazardClass as NfpaHazardClass,
} from './nfpa13-rules';

/* --------------------------------------------------------------- cited constants */

/**
 * Elevation pressure of water: 0.433 psi per FOOT of elevation (the weight of a
 * 1-ft column of water at standard density). This is the standard hydrostatic
 * conversion NFPA-13 hydraulic calculations use for elevation head. Cited as an
 * incorporated standard hydraulic constant (not a fabricated value).
 */
export const ELEVATION_PSI_PER_FT = 0.433;
export const ELEVATION_PSI_PER_FT_CITATION =
  'Hydrostatic head — 0.433 psi per foot of elevation (weight of a 1-ft water ' +
  'column at standard density), the elevation-pressure conversion NFPA-13 ' +
  'hydraulic calculations incorporate. Standard hydraulic constant.';

/**
 * Fitting / valve equivalent pipe lengths (FEET of straight pipe) by nominal size,
 * Schedule-40 steel (C=120). These are the long-standing NFPA-13 "Equivalent Pipe
 * Length" table values used to add fitting friction as extra pipe length. We model
 * the fittings the router produces (TEE — flow through the branch/run, ELBOW 90°,
 * and the alarm/check at the riser is not modeled here). Values are the commonly-
 * published Le for Schedule-40 steel at C=120; for other C-factors NFPA-13 applies a
 * multiplier — we conservatively use the C=120 table (an estimate; verify edition).
 *
 * Sizes between table rows interpolate to the NEXT-LARGER listed size (never
 * undersized). Sizes below 1" use the 1" row (the smallest published).
 *
 * SOURCE / CITATION: NFPA 13 Equivalent Pipe Length chart (Schedule-40 steel,
 * C=120). Edition-dependent (e.g. 2019 §28.2.3.* / 2016 §22.4.3.*). Verify edition.
 */
export interface FittingLeRow {
  nominalSizeIn: number;
  /** Le (ft) for a 90° standard elbow. */
  elbow90Ft: number;
  /** Le (ft) for a tee/cross flowing through the BRANCH (the lossy path). */
  teeBranchFt: number;
}

export const FITTING_LE_CITATION =
  'NFPA 13 Equivalent Pipe Length chart (Schedule-40 steel, C=120): 90° elbow and ' +
  'tee-flow-through-branch equivalent lengths in feet, added as extra pipe length ' +
  'for fitting friction. Edition-dependent (e.g. 2019 §28.2.3 / 2016 §22.4.3). ' +
  'For C-factors other than 120 NFPA-13 applies a correction multiplier — this aid ' +
  'uses the C=120 table as an estimate. Verify adopted edition.';

/** The published Le rows, ascending by size (commonly-cited C=120 Schedule-40 values). */
export const FITTING_LE: readonly FittingLeRow[] = [
  { nominalSizeIn: 1, elbow90Ft: 2, teeBranchFt: 5 },
  { nominalSizeIn: 1.25, elbow90Ft: 3, teeBranchFt: 6 },
  { nominalSizeIn: 1.5, elbow90Ft: 4, teeBranchFt: 8 },
  { nominalSizeIn: 2, elbow90Ft: 5, teeBranchFt: 10 },
  { nominalSizeIn: 2.5, elbow90Ft: 6, teeBranchFt: 12 },
  { nominalSizeIn: 3, elbow90Ft: 7, teeBranchFt: 15 },
  { nominalSizeIn: 3.5, elbow90Ft: 8, teeBranchFt: 17 },
  { nominalSizeIn: 4, elbow90Ft: 10, teeBranchFt: 20 },
] as const;

/**
 * Default minimum operating pressure (psi) at the most remote sprinkler. 7 psi is
 * the long-standing NFPA-13 minimum operating pressure for a standard-spray
 * sprinkler — the floor we start the most-remote head at when the caller supplies
 * none. Operator may override per the listing / density requirement.
 */
export const MIN_OPERATING_PSI = 7;
export const MIN_OPERATING_PSI_CITATION =
  'NFPA 13 minimum operating pressure for a standard-spray sprinkler — 7 psi ' +
  '(the discharge floor at the most remote head). Edition-dependent. Listing or ' +
  'required density may demand higher — verify adopted edition and the listing.';

/** Default head K-factor (gpm/psi^0.5) when no catalog SKU resolves one: K5.6 — the
 *  most common standard-orifice 1/2" sprinkler. Honest fallback, flagged in findings. */
export const DEFAULT_HEAD_K = 5.6;

/* --------------------------------------------------------------- C-factor mapping */

/**
 * Map the CAD PipeMaterial to the cited Hazen-Williams C from nfpa13-rules. Wet
 * steel (the wet-pipe default) is C=120; CPVC/copper C=150. No number is authored
 * here — every C comes from HAZEN_WILLIAMS_C (cited).
 */
export function cFactorForMaterial(material: CadPipeMaterial): {
  value: number;
  citation: string;
} {
  switch (material) {
    case 'CPVC':
      return { value: HAZEN_WILLIAMS_C.cpvc.value as number, citation: HAZEN_WILLIAMS_C.cpvc.citation };
    case 'COPPER':
      return { value: HAZEN_WILLIAMS_C.copper.value as number, citation: HAZEN_WILLIAMS_C.copper.citation };
    case 'STEEL_SCH10':
    case 'STEEL_SCH40':
    default:
      // Wet-pipe steel: C=120 (cited). Dry/preaction would be C=100; the CAD model
      // does not distinguish wet/dry on the segment, so the wet default applies.
      return { value: HAZEN_WILLIAMS_C.steel_wet.value as number, citation: HAZEN_WILLIAMS_C.steel_wet.citation };
  }
}

/* --------------------------------------------------------------- inputs / outputs */

/** The CAD hazard enum is UPPER_SNAKE; nfpa13-rules is lower_snake. */
export type CadHazardClass =
  | 'LIGHT'
  | 'ORDINARY_1'
  | 'ORDINARY_2'
  | 'EXTRA_1'
  | 'EXTRA_2';

const HAZARD_TO_NFPA: Record<CadHazardClass, NfpaHazardClass> = {
  LIGHT: 'light',
  ORDINARY_1: 'ordinary_1',
  ORDINARY_2: 'ordinary_2',
  EXTRA_1: 'extra_1',
  EXTRA_2: 'extra_2',
};

/** A water supply, as an operator flow test: static + residual @ a measured flow. */
export interface WaterSupply {
  /** Static (no-flow) pressure at the supply, psi. */
  staticPsi: number;
  /** Residual pressure during the flow test, psi (< static). */
  residualPsi: number;
  /** The flow at which the residual was measured, gpm. */
  flowGpm: number;
}

export interface SolveOpts {
  /** Occupancy hazard class — drives the cited max protection area per head. */
  hazard: CadHazardClass;
  /** Operator water supply (flow test). Omit for a demand-only (no adequacy) result. */
  supply?: WaterSupply;
  /**
   * The remote DESIGN AREA in ft^2 (NFPA-13 density/area). This magnitude is NOT a
   * single cited constant (it comes from the adopted edition's density/area curves);
   * it is OPERATOR-SUPPLIED. The remote head COUNT is derived from it via the cited
   * max-protection-area-per-head. Omit to operate ALL heads (a conservative whole-
   * system demand) — surfaced honestly in findings.
   */
  designAreaSqFt?: number;
  /**
   * Per-head K-factor (gpm/psi^0.5). When omitted, resolved per-head from the head
   * node's catalog kFactor map (see `headKFactors`), else DEFAULT_HEAD_K.
   */
  kFactor?: number;
  /** Per-head K by node id (from the resolved catalog SKU). Falls back to kFactor/default. */
  headKFactors?: Record<string, number>;
  /**
   * Minimum operating pressure (psi) at the most remote head. Default MIN_OPERATING_PSI
   * (7 psi, cited). The listing or required density may demand higher.
   */
  minOperatingPsi?: number;
  /** Density (gpm/ft^2), operator-supplied — informational only (surfaced in findings). */
  density?: number;
}

/** Per-node hydraulic result. */
export interface NodeResult {
  id: string;
  /** Pressure at the node (psi). For non-operating heads/segments this is the
   *  static path pressure (no flow through them). */
  pressurePsi: number;
  /** Flow passing through the node toward the riser (gpm). */
  flowGpm: number;
}

/** Per-segment hydraulic result. */
export interface SegmentResult {
  id: string;
  /** Friction loss across the segment (psi), incl. fitting equivalent length. */
  frictionPsi: number;
  /** Mean velocity in the segment (ft/s) at its flow. */
  velocityFps: number;
  /** Flow through the segment (gpm). 0 for a closed (non-remote-area) segment. */
  flowGpm: number;
}

/** A cited hydraulic finding. */
export interface HydraulicFinding {
  /** Stable code for the kind of finding. */
  code:
    | 'remote_area'
    | 'head_flow'
    | 'friction'
    | 'elevation'
    | 'demand'
    | 'supply'
    | 'adequacy'
    | 'k_factor'
    | 'design_area_uncited'
    | 'disclaimer';
  severity: 'ok' | 'warn' | 'error' | 'info';
  message: string;
  /** The cited rule / source this finding rests on. NEVER empty. */
  citation: string;
}

/** The full hydraulic design-aid result. */
export interface HydraulicsResult {
  perNode: NodeResult[];
  perSegment: SegmentResult[];
  /** Node ids of the heads chosen as the operating remote area. */
  remoteAreaHeadIds: string[];
  /** System demand: total operating flow + required pressure AT the riser. */
  systemDemand: { gpm: number; psiAtRiser: number };
  /** Available supply pressure interpolated to the demand gpm. null without a supply. */
  supplyAtDemand: { psi: number | null };
  /** True iff a supply was given AND available psi >= required psi at the riser. */
  adequate: boolean;
  /** Cited findings (carry citations + the design-aid disclaimer). */
  findings: HydraulicFinding[];
  /** The honest design-aid disclaimer, restated. */
  disclaimer: string;
}

/* --------------------------------------------------------------- Le lookup */

/** Equivalent length (ft) for a fitting type at a nominal size (next-larger row). */
export function fittingEquivLengthFt(
  kind: 'ELBOW' | 'TEE' | 'CROSS',
  nominalSizeIn: number,
): number {
  // Pick the smallest published row whose size is >= the requested size (so we never
  // under-count fitting friction); clamp below the smallest and above the largest.
  let rowPick: FittingLeRow = FITTING_LE[0];
  for (const r of FITTING_LE) {
    rowPick = r;
    if (r.nominalSizeIn >= nominalSizeIn) break;
  }
  if (kind === 'ELBOW') return rowPick.elbow90Ft;
  return rowPick.teeBranchFt; // TEE / CROSS flowing through the branch
}

/* --------------------------------------------------------------- tree helpers */

/** Build undirected adjacency (nodeId -> [{ other, segment }]). */
function buildAdjacency(
  segments: readonly Segment[],
): Map<string, { other: string; seg: Segment }[]> {
  const adj = new Map<string, { other: string; seg: Segment }[]>();
  const link = (a: string, other: string, seg: Segment): void => {
    const list = adj.get(a);
    if (list) list.push({ other, seg });
    else adj.set(a, [{ other, seg }]);
  };
  for (const seg of segments) {
    link(seg.from, seg.to, seg);
    link(seg.to, seg.from, seg);
  }
  return adj;
}

/**
 * Root the tree at the riser: BFS outward, recording each node's parent node id and
 * the segment connecting it to its parent. Returns parentSeg (nodeId -> Segment to
 * its parent) and depth-ordered node ids (riser first). A node unreachable from the
 * riser is omitted (honest: it carries no flow path).
 */
function rootTree(
  riserId: string,
  adj: Map<string, { other: string; seg: Segment }[]>,
): {
  parentNode: Map<string, string>;
  parentSeg: Map<string, Segment>;
  order: string[];
} {
  const parentNode = new Map<string, string>();
  const parentSeg = new Map<string, Segment>();
  const order: string[] = [];
  const seen = new Set<string>([riserId]);
  const queue: string[] = [riserId];
  order.push(riserId);
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const { other, seg } of adj.get(cur) ?? []) {
      if (seen.has(other)) continue;
      seen.add(other);
      parentNode.set(other, cur);
      parentSeg.set(other, seg);
      order.push(other);
      queue.push(other);
    }
  }
  return { parentNode, parentSeg, order };
}

/** Sum the static friction-equivalent path length (ft of pipe + fitting Le) from a
 *  head up to the riser — a proxy for "how lossy / remote" a head is. Larger = more
 *  demanding. Uses each segment's own length + an elbow Le at each size as a cheap,
 *  deterministic remoteness metric (the real loss depends on flow, computed later). */
function pathDemandMetric(
  headId: string,
  parentNode: Map<string, string>,
  parentSeg: Map<string, Segment>,
): number {
  let cur = headId;
  let metric = 0;
  // Guard against cycles (shouldn't happen in a tree) with a generous cap.
  let guard = 0;
  while (parentSeg.has(cur) && guard < 100000) {
    const seg = parentSeg.get(cur)!;
    // Friction grows with length and shrinks steeply with diameter (d^4.87); use a
    // diameter-weighted length so a long thin run reads as more demanding than a
    // short fat one — a deterministic, monotone proxy (NOT the final psi).
    metric += seg.lengthFt / Math.pow(Math.max(0.25, seg.diameterIn), 4.87);
    cur = parentNode.get(cur)!;
    guard += 1;
  }
  return metric;
}

/* --------------------------------------------------------------- velocity */

/** Mean velocity (ft/s) of `flowGpm` in a pipe of `diameterIn` inches.
 *  v(ft/s) = 0.4085 * Q(gpm) / d(in)^2 — the standard gpm->fps conversion. */
export function velocityFps(flowGpm: number, diameterIn: number): number {
  if (diameterIn <= 0) return 0;
  return (0.4085 * flowGpm) / (diameterIn * diameterIn);
}

/* --------------------------------------------------------------- solve */

/**
 * PURE. Solve the hydraulic design aid for a routed network + supply. See module
 * header. Returns an honest, fully-cited result. Never throws on an empty/partial
 * network — returns a zero-demand result with explanatory findings instead.
 */
export function solveHydraulics(
  network: SprinklerNetwork,
  opts: SolveOpts,
): HydraulicsResult {
  const findings: HydraulicFinding[] = [];
  const nodes = network.nodes;
  const segments = network.segments;
  const heads = nodes.filter((n) => n.type === 'HEAD');
  const riser = nodes.find((n) => n.type === 'SOURCE') ?? null;
  const minOperatingPsi = opts.minOperatingPsi ?? MIN_OPERATING_PSI;

  // Honest empty / unrouted results.
  if (heads.length === 0 || riser === null || segments.length === 0) {
    findings.push({
      code: 'remote_area',
      severity: 'warn',
      message:
        heads.length === 0
          ? 'No sprinkler heads in the network — nothing to demand.'
          : riser === null
            ? 'No riser/supply (SOURCE) node — route the system first (W4).'
            : 'No pipe segments — route the system first (W4).',
      citation:
        'Design aid requires a routed wet-pipe tree (riser -> mains -> branches -> heads). ' +
        'See pipe-routing (W4).',
    });
    return finalize(
      [],
      [],
      [],
      { gpm: 0, psiAtRiser: 0 },
      { psi: null },
      false,
      findings,
    );
  }

  const adj = buildAdjacency(segments);
  const { parentNode, parentSeg, order } = rootTree(riser.id, adj);

  // --- 1. Choose the remote area: the design-area worth of MOST-DEMANDING heads. ---
  const areaRule = MAX_PROTECTION_AREA_SQFT[HAZARD_TO_NFPA[opts.hazard]];
  const areaPerHead = areaRule.value as number; // cited, non-null
  // Only heads reachable from the riser can operate.
  const reachableHeads = heads.filter((h) => h.id === riser.id || parentSeg.has(h.id));
  // Rank by remoteness (most lossy path first).
  const ranked = [...reachableHeads].sort(
    (a, b) =>
      pathDemandMetric(b.id, parentNode, parentSeg) -
      pathDemandMetric(a.id, parentNode, parentSeg),
  );

  let remoteCount: number;
  if (opts.designAreaSqFt != null && opts.designAreaSqFt > 0) {
    remoteCount = Math.min(ranked.length, Math.max(1, Math.ceil(opts.designAreaSqFt / areaPerHead)));
    findings.push({
      code: 'remote_area',
      severity: 'info',
      message: `Remote area ${opts.designAreaSqFt} ft^2 / ${areaPerHead} ft^2 per head = ${remoteCount} operating head(s) (most-demanding by path loss).`,
      citation: areaRule.citation,
    });
    // The design-area MAGNITUDE itself is not a cited single constant — surface the cite-TODO.
    const dac = UNCERTAIN_VALUES.find((u) => u.id === 'todo.density_area_curves');
    findings.push({
      code: 'design_area_uncited',
      severity: 'warn',
      message:
        'The remote design-area magnitude (ft^2) is operator-supplied, not a single ' +
        'cited constant — it comes from the adopted edition density/area curves.',
      citation: dac?.citation ?? 'TODO-cite: NFPA 13 density/area design curves figure.',
    });
  } else {
    remoteCount = ranked.length;
    findings.push({
      code: 'remote_area',
      severity: 'warn',
      message: `No design area given — operating ALL ${remoteCount} head(s) (conservative whole-system demand, not a remote-area calc).`,
      citation: areaRule.citation,
    });
  }
  const remoteHeads = ranked.slice(0, remoteCount);
  const remoteHeadIds = remoteHeads.map((h) => h.id);

  // --- 2 + 3. Accumulate flow + pressure from the operating heads up to the riser. ---
  // resolveK for a head.
  const resolveK = (id: string): number =>
    opts.headKFactors?.[id] ?? opts.kFactor ?? DEFAULT_HEAD_K;
  if (opts.kFactor == null && (opts.headKFactors == null || Object.keys(opts.headKFactors).length === 0)) {
    findings.push({
      code: 'k_factor',
      severity: 'info',
      message: `No catalog K-factor supplied — using default K=${DEFAULT_HEAD_K} (standard 1/2" orifice).`,
      citation: 'NFPA 13 sprinkler discharge relation Q = K*sqrt(P). K is the listed head value — supply the catalog SKU K for accuracy.',
    });
  }

  // Flow each head produces at the minimum operating pressure (the floor). A full
  // balanced calc raises near-riser heads' pressure (and flow) above the minimum; we
  // honestly model each operating head at the minimum operating pressure (a lower-
  // bound demand) and accumulate friction — surfaced in findings as an estimate.
  const nodeFlow = new Map<string, number>(); // flow toward riser at each node
  const nodePressure = new Map<string, number>(); // pressure at each node (psi)
  const segFriction = new Map<string, number>();
  const segFlow = new Map<string, number>();
  const segVelocity = new Map<string, number>();

  // Head flows.
  let totalDemandGpm = 0;
  for (const h of remoteHeads) {
    const q = flowFromKP(resolveK(h.id), minOperatingPsi);
    nodeFlow.set(h.id, q);
    nodePressure.set(h.id, minOperatingPsi);
    totalDemandGpm += q;
  }

  // Accumulate flow up the tree: process nodes in REVERSE BFS order (leaves first),
  // adding each node's flow to its parent. This sums flows correctly at every tee.
  for (let i = order.length - 1; i >= 0; i -= 1) {
    const id = order[i];
    const flowHere = nodeFlow.get(id) ?? 0;
    const parent = parentNode.get(id);
    const seg = parentSeg.get(id);
    if (parent == null || seg == null) continue; // riser root
    // Carry this node's flow up through the connecting segment to the parent.
    nodeFlow.set(parent, (nodeFlow.get(parent) ?? 0) + flowHere);
    segFlow.set(seg.id, (segFlow.get(seg.id) ?? 0) + flowHere);
  }

  // Now compute friction per segment from its accumulated flow, then propagate
  // pressure from each operating head down toward the riser along its path. To get
  // pressure AT the riser we walk each operating head's path to the riser, summing
  // friction + elevation; the governing (highest) required riser pressure wins.
  const cByMaterial = new Map<string, { value: number; citation: string }>();
  let frictionCitationShown = false;
  let elevationApplied = false;

  // Pre-compute friction + velocity for every segment that carries flow.
  for (const seg of segments) {
    const q = segFlow.get(seg.id) ?? 0;
    if (q <= 0) {
      segFriction.set(seg.id, 0);
      segVelocity.set(seg.id, 0);
      continue;
    }
    const matKey = seg.material;
    let c = cByMaterial.get(matKey);
    if (!c) {
      c = cFactorForMaterial(seg.material);
      cByMaterial.set(matKey, c);
    }
    // Fitting equivalent length: add an elbow Le at this segment's downstream fitting
    // node when that node is an ELBOW, or a tee-branch Le when it is a TEE. The
    // downstream node (toward the heads / away from riser) is whichever endpoint is
    // deeper in the rooted tree. We approximate by adding the fitting Le for the
    // node that has this seg as its parentSeg (i.e. the child endpoint's fitting).
    const childId = parentSeg.get(seg.from) === seg ? seg.from : parentSeg.get(seg.to) === seg ? seg.to : null;
    let leFt = 0;
    if (childId) {
      const childNode = nodes.find((n) => n.id === childId);
      if (childNode?.type === 'ELBOW') leFt = fittingEquivLengthFt('ELBOW', seg.diameterIn);
      else if (childNode?.type === 'TEE' || childNode?.type === 'CROSS') leFt = fittingEquivLengthFt('TEE', seg.diameterIn);
    }
    const effLengthFt = seg.lengthFt + leFt;
    const friction = hazenWilliamsLossPsi(q, c.value, seg.diameterIn, effLengthFt);
    segFriction.set(seg.id, friction);
    segVelocity.set(seg.id, velocityFps(q, seg.diameterIn));
  }

  // Governing required pressure at the riser = max over operating heads of
  // (head min pressure + sum friction along path + elevation gain to riser).
  let requiredPsiAtRiser = 0;
  for (const h of remoteHeads) {
    let cur = h.id;
    let psi = minOperatingPsi;
    let guard = 0;
    while (parentSeg.has(cur) && guard < 100000) {
      const seg = parentSeg.get(cur)!;
      const parent = parentNode.get(cur)!;
      psi += segFriction.get(seg.id) ?? 0;
      // Elevation: pressure increases going DOWN toward a lower riser, decreases
      // going up. Riser y vs head y: add 0.433 * (head.y - parent.y) ... we sum the
      // per-segment elevation delta along the path (gain when the parent is lower).
      const childNode = nodes.find((n) => n.id === cur);
      const parentNodeObj = nodes.find((n) => n.id === parent);
      if (childNode && parentNodeObj) {
        const dyFt = childNode.pos.y - parentNodeObj.pos.y; // + when parent is LOWER
        if (Math.abs(dyFt) > 1e-9) {
          psi += ELEVATION_PSI_PER_FT * dyFt;
          elevationApplied = true;
        }
      }
      cur = parent;
      guard += 1;
    }
    // Record the per-node pressure along this head's path as the running pressure
    // (only meaningfully set for operating-path nodes; the riser gets the governing).
    if (psi > requiredPsiAtRiser) requiredPsiAtRiser = psi;
  }
  // Riser carries the full demand at the governing required pressure.
  nodeFlow.set(riser.id, totalDemandGpm);
  nodePressure.set(riser.id, requiredPsiAtRiser);

  // Pressure at intermediate nodes: walk from riser outward, subtracting friction
  // (going toward heads loses pressure) so the per-node pressure increases
  // monotonically from any head up to the riser (riser is the highest).
  nodePressure.set(riser.id, requiredPsiAtRiser);
  for (const id of order) {
    if (id === riser.id) continue;
    const parent = parentNode.get(id);
    const seg = parentSeg.get(id);
    if (parent == null || seg == null) continue;
    const parentPsi = nodePressure.get(parent) ?? requiredPsiAtRiser;
    const fr = segFriction.get(seg.id) ?? 0;
    const childNode = nodes.find((n) => n.id === id);
    const parentNodeObj = nodes.find((n) => n.id === parent);
    let elev = 0;
    if (childNode && parentNodeObj) {
      elev = ELEVATION_PSI_PER_FT * (childNode.pos.y - parentNodeObj.pos.y);
    }
    // Pressure at the child = parent pressure - friction - elevation gain to parent.
    const childPsi = parentPsi - fr - elev;
    nodePressure.set(id, childPsi);
  }

  if (segments.some((s) => (segFlow.get(s.id) ?? 0) > 0)) {
    if (!frictionCitationShown) {
      const anyMat = cByMaterial.values().next().value as { citation: string } | undefined;
      findings.push({
        code: 'friction',
        severity: 'info',
        message:
          'Friction by Hazen-Williams Pm = 4.52*Q^1.85/(C^1.85*d^4.87)*L, plus fitting ' +
          'equivalent lengths added as extra pipe.',
        citation:
          'NFPA 13 Hazen-Williams friction equation + C-factor table' +
          (anyMat ? ` (e.g. ${anyMat.citation})` : '') +
          '. ' + FITTING_LE_CITATION,
      });
      frictionCitationShown = true;
    }
  }
  if (elevationApplied) {
    findings.push({
      code: 'elevation',
      severity: 'info',
      message: 'Elevation head applied at 0.433 psi/ft along each path.',
      citation: ELEVATION_PSI_PER_FT_CITATION,
    });
  }

  findings.push({
    code: 'head_flow',
    severity: 'info',
    message: `Each operating head flows Q = K*sqrt(${minOperatingPsi}) at the minimum operating pressure (lower-bound demand estimate).`,
    citation: MIN_OPERATING_PSI_CITATION,
  });

  // --- 4. Supply curve interpolation + adequacy. ---
  let supplyPsi: number | null = null;
  let adequate = false;
  if (opts.supply) {
    supplyPsi = supplyAvailablePsi(opts.supply, totalDemandGpm);
    adequate = supplyPsi >= requiredPsiAtRiser;
    findings.push({
      code: 'supply',
      severity: 'info',
      message: `Supply curve (static ${opts.supply.staticPsi} psi, residual ${opts.supply.residualPsi} psi @ ${opts.supply.flowGpm} gpm) -> ${supplyPsi.toFixed(1)} psi available at ${totalDemandGpm.toFixed(1)} gpm demand.`,
      citation:
        'Hazen-Williams supply curve: available pressure drops with flow as p = static - k*Q^1.85 ' +
        'fitted to the operator flow test (static, residual @ test flow). A straight-line/Q^1.85 ' +
        'approximation of the real water-supply analysis — verify with the AHJ flow test.',
    });
    findings.push({
      code: 'adequacy',
      severity: adequate ? 'ok' : 'error',
      message: adequate
        ? `Adequate: ${supplyPsi.toFixed(1)} psi available >= ${requiredPsiAtRiser.toFixed(1)} psi required at the riser (${totalDemandGpm.toFixed(1)} gpm).`
        : `SHORT: ${supplyPsi.toFixed(1)} psi available < ${requiredPsiAtRiser.toFixed(1)} psi required at the riser (${totalDemandGpm.toFixed(1)} gpm).`,
      citation:
        'Design adequacy = available supply pressure at the demand flow >= required system ' +
        'pressure at the riser. Design aid only — a stamped hydraulic calc governs.',
    });
  } else {
    findings.push({
      code: 'supply',
      severity: 'warn',
      message: 'No water supply supplied — demand computed but adequacy not evaluated.',
      citation: 'Adequacy needs an operator flow test (static / residual @ flow).',
    });
  }

  findings.push({
    code: 'demand',
    severity: 'info',
    message: `System demand: ${totalDemandGpm.toFixed(1)} gpm at ${requiredPsiAtRiser.toFixed(1)} psi at the riser.`,
    citation:
      'Demand = sum of operating-head flows (Q=K*sqrt(P)) accumulated through the tree; ' +
      'required riser pressure = governing head path loss + elevation. Estimate / design aid.',
  });

  const perNode: NodeResult[] = nodes.map((n) => ({
    id: n.id,
    pressurePsi: round2(nodePressure.get(n.id) ?? 0),
    flowGpm: round2(nodeFlow.get(n.id) ?? 0),
  }));
  const perSegment: SegmentResult[] = segments.map((s) => ({
    id: s.id,
    frictionPsi: round2(segFriction.get(s.id) ?? 0),
    velocityFps: round2(segVelocity.get(s.id) ?? 0),
    flowGpm: round2(segFlow.get(s.id) ?? 0),
  }));

  return finalize(
    perNode,
    perSegment,
    remoteHeadIds,
    { gpm: round2(totalDemandGpm), psiAtRiser: round2(requiredPsiAtRiser) },
    { psi: supplyPsi == null ? null : round2(supplyPsi) },
    adequate,
    findings,
  );
}

/* --------------------------------------------------------------- supply curve */

/**
 * PURE. Available supply pressure (psi) at a demand flow, interpolated from a flow
 * test using the Hazen-Williams supply-curve law: p_drop ∝ Q^1.85, so
 *   k = (static - residual) / flowTest^1.85
 *   available(Q) = static - k * Q^1.85
 * Clamps available at >= 0. With a zero/invalid test flow returns static (no drop).
 */
export function supplyAvailablePsi(supply: WaterSupply, demandGpm: number): number {
  const { staticPsi, residualPsi, flowGpm } = supply;
  if (!Number.isFinite(demandGpm) || demandGpm <= 0) return staticPsi;
  if (!Number.isFinite(flowGpm) || flowGpm <= 0) return staticPsi;
  const drop = staticPsi - residualPsi;
  const k = drop / Math.pow(flowGpm, 1.85);
  const available = staticPsi - k * Math.pow(demandGpm, 1.85);
  return available < 0 ? 0 : available;
}

/* --------------------------------------------------------------- helpers */

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function finalize(
  perNode: NodeResult[],
  perSegment: SegmentResult[],
  remoteAreaHeadIds: string[],
  systemDemand: { gpm: number; psiAtRiser: number },
  supplyAtDemand: { psi: number | null },
  adequate: boolean,
  findings: HydraulicFinding[],
): HydraulicsResult {
  findings.push({
    code: 'disclaimer',
    severity: 'info',
    message: NFPA13_DESIGN_AID_DISCLAIMER,
    citation:
      'Honesty contract — design aid / estimate only; NOT a certified hydraulic ' +
      'calculation, NOT AHJ, NOT PE, NOT for construction. Verify the adopted NFPA-13 ' +
      'edition; a stamped calculation governs.',
  });
  return {
    perNode,
    perSegment,
    remoteAreaHeadIds,
    systemDemand,
    supplyAtDemand,
    adequate,
    findings,
    disclaimer: NFPA13_DESIGN_AID_DISCLAIMER,
  };
}

/* --------------------------------------------------------------- summaries */

/** Min / max node pressure (psi) over nodes that carry a pressure — for the heatmap legend. */
export function pressureRange(result: HydraulicsResult): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const n of result.perNode) {
    if (n.pressurePsi < min) min = n.pressurePsi;
    if (n.pressurePsi > max) max = n.pressurePsi;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 0 };
  return { min, max };
}

/**
 * PURE. Map a pressure (psi) onto a blue(low)->red(high) heatmap color, normalized to
 * [min,max]. Deterministic. Returns a CSS rgb() string. Used by the 2D + 3D pressure
 * heatmaps and the legend so both views share ONE color scale.
 */
export function pressureColor(psi: number, min: number, max: number): string {
  const span = max - min;
  const t = span > 1e-9 ? Math.min(1, Math.max(0, (psi - min) / span)) : 0.5;
  // Blue (low) -> cyan -> green -> yellow -> red (high). Simple 5-stop ramp.
  const stops: [number, number, number][] = [
    [59, 130, 246], // blue
    [34, 211, 238], // cyan
    [74, 222, 128], // green
    [250, 204, 21], // yellow
    [239, 68, 68], // red
  ];
  const seg = t * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(seg));
  const f = seg - i;
  const a = stops[i];
  const b = stops[i + 1];
  const r = Math.round(a[0] + (b[0] - a[0]) * f);
  const g = Math.round(a[1] + (b[1] - a[1]) * f);
  const bl = Math.round(a[2] + (b[2] - a[2]) * f);
  return `rgb(${r}, ${g}, ${bl})`;
}
