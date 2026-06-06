// HaloFire CAD — PURE pipe-routing topology (W4). No React / three / DOM imports.
// Deterministic: same heads + opts -> same nodes + segments.
//
// routeSystem(network, opts) turns the laid-out sprinkler HEADS (head-layout.ts)
// into a REAL fire-sprinkler TREE system — the canonical NFPA-13 wet-pipe topology
// (system-model.ts: supply -> riser -> main -> cross_main -> branch_line -> head):
//
//   1. Heads are grouped into ROWS (branch lines) by colinear plan-Y (pos.z),
//      within a tolerance. Each row is ordered by plan-X (pos.x).
//   2. Consecutive heads on a row are joined by BRANCH segments; each head also
//      gets an ARM_OVER drop (the pipe from the branch line down to the head body).
//   3. Each branch line TAPS the cross-main at its start via a TEE.
//   4. A CROSS_MAIN spans all the branch taps (one TEE per tap).
//   5. A MAIN runs from the cross-main to the RISER / supply (default supply is an
//      edge point, or opts.supplyPoint).
//   6. Fittings carry REAL connectivity Ports: a TEE at each branch tap, an ELBOW
//      at every direction change, a REDUCER at every pipe-size step. Every fitting's
//      ports are asserted mate-able (arePortsCompatible) — a real reducer is placed
//      wherever the pipe size steps, and each reducer descends ONE schedule size at
//      a time so its transition is backed by a real adapter (no invented fittings).
//
// This is NOT a shortest-path Steiner tree: it follows the trade topology (heads on
// a line feed a branch; branches feed a cross-main; the cross-main feeds the riser).
//
// PIPE SIZING (schedule): each segment is sized by the number of heads DOWNSTREAM of
// it via a Schedule-40 NFPA-13 pipe-schedule table (see PIPE_SCHEDULE + its cited
// source). Because downstream head count only grows toward the riser, segment sizes
// are MONOTONIC NON-DECREASING toward the riser; reducers mark every step.
//
// HONESTY (hard, fail-closed): this is a DESIGN-AID routing + pipe-SCHEDULE sizing.
// It is NOT a hydraulically-calculated system (W5 adds hydraulics), NOT AHJ-approved,
// NOT PE-sealed, NOT code compliance, NOT for construction. The schedule table is the
// published NFPA-13 pipe-schedule design method (cited) — a sizing AID valid only
// within the limits the schedule method permits; a hydraulic calculation governs in
// general. Every segment endpoint references a REAL node in the returned list, and
// `routedOk` reflects ACTUAL graph connectivity from every head back to the riser —
// nothing is fabricated, and there are no orphan pipes.

import { arePortsCompatible, type Method, type Port } from './connectivity';
import {
  makeId,
  type Node,
  type PipeMaterial,
  type Point3,
  type Segment,
  type SegmentRole,
  type SprinklerNetwork,
} from './model';

/* --------------------------------------------------------------- pipe schedule */

/**
 * NFPA-13 PIPE-SCHEDULE sizing table (Schedule-40 steel branch-line method).
 *
 * SOURCE / CITATION: NFPA 13 "Pipe Schedules" — the schedule of pipe sizes for
 * Light- and Ordinary-hazard pipe-schedule systems. The branch-line progression
 * (number of sprinklers a given nominal pipe size may serve) is the long-standing
 * published schedule:
 *
 *   Ordinary hazard, Schedule-40 steel branch line:
 *     1"     -> up to 2 sprinklers
 *     1-1/4" -> up to 3 sprinklers
 *     1-1/2" -> up to 5 sprinklers
 *     2"     -> up to 10 sprinklers
 *     2-1/2" -> up to 20 sprinklers
 *     3"     -> up to 40 sprinklers
 *     3-1/2" -> up to 65 sprinklers
 *     4"     -> up to 100 sprinklers
 *
 * (NFPA 13 pipe-schedule tables — commonly cited as the 2019 §28.5 / 2016 §22.5
 * pipe-schedule schedules; edition-dependent and reorganized across editions.)
 *
 * HONESTY: this is the PIPE-SCHEDULE design method, a sizing AID. NFPA 13 limits
 * the pipe-schedule method to Light/Ordinary hazard within stated size/area limits;
 * a hydraulic calculation governs in general (W5). We pick the SMALLEST nominal
 * size whose published max-sprinkler count is >= the downstream head count, so a
 * segment is never undersized for the heads it serves. Verify the adopted edition.
 */
export interface PipeScheduleRow {
  /** Nominal pipe size in inches. */
  nominalSizeIn: number;
  /** Maximum number of sprinklers this size may serve under the schedule. */
  maxSprinklers: number;
}

export const PIPE_SCHEDULE_CITATION =
  'NFPA 13 pipe-schedule sizing (Schedule-40 steel, Light/Ordinary hazard). ' +
  'Branch-line schedule: 1" up to 2 heads, 1-1/4" up to 3, 1-1/2" up to 5, ' +
  '2" up to 10, 2-1/2" up to 20, 3" up to 40, 3-1/2" up to 65, 4" up to 100. ' +
  'Pipe-schedule method tables; edition-dependent (e.g. 2019 §28.5 / 2016 §22.5). ' +
  'Design aid only — a hydraulic calculation governs in general. Verify adopted edition.';

/** The published schedule rows, ascending by size. Smallest qualifying size wins. */
export const PIPE_SCHEDULE: readonly PipeScheduleRow[] = [
  { nominalSizeIn: 1, maxSprinklers: 2 },
  { nominalSizeIn: 1.25, maxSprinklers: 3 },
  { nominalSizeIn: 1.5, maxSprinklers: 5 },
  { nominalSizeIn: 2, maxSprinklers: 10 },
  { nominalSizeIn: 2.5, maxSprinklers: 20 },
  { nominalSizeIn: 3, maxSprinklers: 40 },
  { nominalSizeIn: 3.5, maxSprinklers: 65 },
  { nominalSizeIn: 4, maxSprinklers: 100 },
] as const;

/** The schedule's nominal sizes, ascending (for stepping reducers one size at a time). */
export const SCHEDULE_SIZES: readonly number[] = PIPE_SCHEDULE.map((r) => r.nominalSizeIn);

/**
 * PURE. The nominal pipe size (in) for a pipe carrying `headCount` sprinklers under
 * the cited schedule: the SMALLEST size whose published max-sprinkler count is >=
 * headCount. Counts above the largest published row clamp to the largest size (4")
 * — never undersized. A non-positive count returns the smallest size (1").
 */
export function sizeForHeadCount(headCount: number): number {
  const n = Math.max(1, Math.floor(headCount));
  for (const row of PIPE_SCHEDULE) {
    if (n <= row.maxSprinklers) return row.nominalSizeIn;
  }
  return PIPE_SCHEDULE[PIPE_SCHEDULE.length - 1].nominalSizeIn;
}

/**
 * The list of schedule sizes strictly between `larger` and `smaller` (exclusive),
 * descending — the intermediate sizes a real concentric-reducer chain steps through
 * when reducing from `larger` to `smaller` one nominal size at a time. Empty when
 * the two sizes are adjacent (or equal). Sizes outside the schedule (e.g. the 1/2"
 * head inlet below the 1" smallest branch) are handled by the caller's terminal step.
 */
export function intermediateSizes(larger: number, smaller: number): number[] {
  return SCHEDULE_SIZES.filter((s) => s < larger && s > smaller).sort((a, b) => b - a);
}

/* --------------------------------------------------------------- options */

/** A 2D supply point in the plan floor plane (feet): x = plan-X, y = plan-Y(=z). */
export interface SupplyPoint {
  x: number;
  y: number;
}

export interface RouteOpts {
  /**
   * Where the riser/supply enters, in plan FEET (x = plan-X, y = plan-Y/floor).
   * When omitted, the supply defaults to a point one branch-spacing to the LEFT of
   * the head bounding box, at mid-Z — an honest edge entry.
   */
  supplyPoint?: SupplyPoint;
  /**
   * Tolerance (ft) for grouping heads into the same colinear row (branch line).
   * Heads whose plan-Y differ by <= rowTolFt share a row. Default 1 ft.
   */
  rowTolFt?: number;
  /** Branch-line + arm-over material. Default STEEL_SCH40 (the schedule basis). */
  branchMaterial?: PipeMaterial;
  /** Cross-main / main material. Default STEEL_SCH40. */
  mainMaterial?: PipeMaterial;
  /** Ceiling height (ft) the cross-main/main/branch run at. Default: head Y (ceiling). */
  ceilingHt?: number;
  /** The head inlet method+size, for arm-over reducer assertion. Default 1/2" NPT. */
  headInlet?: Port;
}

/* --------------------------------------------------------------- result */

/** A fitting's resolved connectivity ports (for the inspector + mate assertion). */
export interface FittingPorts {
  /** Node id of the fitting. */
  nodeId: string;
  /** The fitting kind (TEE | ELBOW | REDUCER | SOURCE/riser). */
  kind: Node['type'];
  /** The inlet port (fed from the upstream/larger side). */
  inlet: Port;
  /** The outlet port(s) feeding downstream. */
  outlets: Port[];
  /** True iff every outlet mates the inlet directly or via a real adapter. */
  mated: boolean;
}

/** The routed system: heads (preserved) + fittings + sized segments. */
export interface RoutedSystem {
  /** All nodes: the original heads PLUS tees, elbows, reducers, and the riser. */
  nodes: Node[];
  /** All pipe segments (main, cross_main, branch, arm_over), each sized + roled. */
  segments: Segment[];
  /** Per-fitting resolved ports + mate-ability (tees/elbows/reducers/riser). */
  fittingPorts: FittingPorts[];
  /** The riser node id (the supply root all heads must reach). */
  riserId: string;
  /**
   * True iff EVERY head is connected to the riser through the tree (real graph
   * connectivity over the returned segments) AND every fitting's ports mate. False
   * when there are no heads, any head is unreachable, or any port does not mate.
   */
  routedOk: boolean;
  /** The cited pipe-schedule source used for sizing. */
  scheduleCitation: string;
  /** The honest design-aid disclaimer. */
  disclaimer: string;
}

export const PIPE_ROUTING_DISCLAIMER =
  'Design-aid pipe routing + NFPA-13 pipe-schedule sizing. NOT a hydraulically-' +
  'calculated system (W5 adds hydraulics), NOT AHJ-approved, NOT PE-sealed, NOT ' +
  'code compliance, NOT for construction. Schedule sizing is a design aid valid ' +
  'only within the pipe-schedule method limits; a hydraulic calculation governs. ' +
  'Verify the adopted NFPA-13 edition.';

/* --------------------------------------------------------------- internals */

const DEFAULT_HEAD_INLET: Port = {
  method: 'THREADED_NPT',
  nominalSizeIn: 0.5,
  role: 'INLET',
};

/** Map a CAD PipeMaterial to a connectivity joining Method (mechanical context). */
function methodForMaterial(material: PipeMaterial): Method {
  switch (material) {
    case 'CPVC':
      return 'PLAIN_END';
    case 'COPPER':
      return 'SOLDER';
    case 'STEEL_SCH40':
    case 'STEEL_SCH10':
    default:
      // Threaded NPT spans the modeled schedule sizes and keeps the reducer
      // transitions backed by REAL NPT reducing fittings (the adapter table).
      return 'THREADED_NPT';
  }
}

/** Round to 4 decimals for deterministic, stable feet values. */
function round(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

/** Euclidean distance in the plan floor plane (x, z) in feet. */
function planDist(a: Point3, b: Point3): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/** A grouped, ordered branch row. */
export interface BranchRow {
  /** The representative plan-Y (z) of the row. */
  z: number;
  /** Heads ordered ascending by plan-X. */
  heads: Node[];
}

/**
 * Group heads into rows by colinear plan-Y (pos.z) within tolerance, ordered by
 * plan-X within each row, rows ordered ascending by plan-Y. Deterministic.
 */
export function groupHeadRows(heads: readonly Node[], rowTolFt: number): BranchRow[] {
  const sorted = [...heads].sort((a, b) => a.pos.z - b.pos.z || a.pos.x - b.pos.x);
  const rows: BranchRow[] = [];
  for (const h of sorted) {
    const last = rows[rows.length - 1];
    if (last && Math.abs(h.pos.z - last.z) <= rowTolFt) {
      last.heads.push(h);
      const n = last.heads.length;
      last.z = round((last.z * (n - 1) + h.pos.z) / n);
    } else {
      rows.push({ z: round(h.pos.z), heads: [h] });
    }
  }
  for (const r of rows) r.heads.sort((a, b) => a.pos.x - b.pos.x);
  return rows;
}

/** Bounding box of head plan positions (feet). null when no heads. */
function headBounds(
  heads: readonly Node[],
): { minX: number; maxX: number; minZ: number; maxZ: number } | null {
  if (heads.length === 0) return null;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const h of heads) {
    if (h.pos.x < minX) minX = h.pos.x;
    if (h.pos.x > maxX) maxX = h.pos.x;
    if (h.pos.z < minZ) minZ = h.pos.z;
    if (h.pos.z > maxZ) maxZ = h.pos.z;
  }
  return { minX, maxX, minZ, maxZ };
}

/* ----------------------------------------------- the mutable routing builder */

/**
 * A small builder threading the shared output arrays + ports/material context so the
 * routing helpers stay readable. Holds a monotonic id counter for deterministic ids.
 */
class RouteBuilder {
  nodes: Node[] = [];
  segments: Segment[] = [];
  fittingPorts: FittingPorts[] = [];
  private seq = 0;

  constructor(
    readonly mainMethod: Method,
    readonly branchMethod: Method,
    readonly mainMaterial: PipeMaterial,
    readonly branchMaterial: PipeMaterial,
  ) {}

  id(prefix: string): string {
    this.seq += 1;
    return makeId(prefix, this.seq);
  }

  addNode(node: Node): Node {
    this.nodes.push(node);
    return node;
  }

  /** Add a pipe segment. Endpoints MUST already exist as nodes (asserted by caller). */
  run(
    from: string,
    to: string,
    role: SegmentRole,
    diameterIn: number,
    lengthFt: number,
    material: PipeMaterial,
  ): void {
    this.segments.push({
      id: this.id('seg'),
      from,
      to,
      diameterIn,
      lengthFt: round(Math.max(0, lengthFt)),
      role,
      material,
    });
  }

  /**
   * Record + assert a fitting's ports. `mated` is true iff the fitting's inlet feeds
   * each outlet through a real connection (direct same method+size, or a real adapter
   * in the connectivity ADAPTERS table). No invented fittings.
   */
  fitting(nodeId: string, kind: Node['type'], inlet: Port, outlets: Port[]): void {
    const mated = outlets.every((o) =>
      // inlet is fed by an upstream OUTLET of the inlet spec, AND the inlet->outlet
      // transition through the fitting is a real connection.
      arePortsCompatible(
        { method: inlet.method, nominalSizeIn: inlet.nominalSizeIn, role: 'OUTLET' },
        { method: o.method, nominalSizeIn: o.nominalSizeIn, role: 'INLET' },
      ),
    );
    this.fittingPorts.push({ nodeId, kind, inlet, outlets, mated });
  }
}

/**
 * Insert a REDUCER chain that steps from `fromSizeIn` DOWN to `toSizeIn`, ONE schedule
 * nominal size at a time, laid between `fromPos` and `toPos` along the run. Each
 * reducer node carries an inlet (the larger size) and outlet (the next-smaller size);
 * because every step is a single adjacent nominal size, its transition is backed by a
 * REAL reducing fitting in the connectivity adapter table (arePortsCompatible true).
 *
 * Returns the node id + size + pos of the DOWNSTREAM end of the chain (the smallest
 * reducer's outlet point) so the caller continues the run from there. When no step is
 * needed (sizes equal) it returns the input unchanged and adds nothing.
 */
function insertReducerChain(
  b: RouteBuilder,
  fromId: string,
  fromPos: Point3,
  fromSizeIn: number,
  toSizeIn: number,
  toPos: Point3,
  role: SegmentRole,
  method: Method,
  material: PipeMaterial,
): { id: string; pos: Point3; sizeIn: number } {
  if (toSizeIn >= fromSizeIn) return { id: fromId, pos: fromPos, sizeIn: fromSizeIn };

  // The descending sequence of sizes: fromSize -> [intermediates] -> toSize.
  // toSize may be below the schedule (e.g. 0.5" head inlet) — that final step is a
  // real reducing bushing (1" x 1/2" is in the adapter table).
  const steps = [...intermediateSizes(fromSizeIn, toSizeIn), toSizeIn];
  let curId = fromId;
  let curPos = fromPos;
  let curSize = fromSizeIn;
  const n = steps.length;
  for (let i = 0; i < n; i += 1) {
    const nextSize = steps[i];
    // Lerp the reducer position along the run for a stable, sensible placement.
    const t = (i + 1) / (n + 1);
    const reducer = b.addNode({
      id: b.id('reducer'),
      type: 'REDUCER',
      pos: {
        x: round(curPos.x + (toPos.x - curPos.x) * t),
        y: round(curPos.y + (toPos.y - curPos.y) * t),
        z: round(curPos.z + (toPos.z - curPos.z) * t),
      },
    });
    // Pipe run INTO the reducer at the current (larger) size.
    b.run(curId, reducer.id, role, curSize, planDist(curPos, reducer.pos), material);
    // Reducer ports: inlet (larger) -> outlet (next smaller), a real single-step reducer.
    b.fitting(
      reducer.id,
      'REDUCER',
      { method, nominalSizeIn: curSize, role: 'INLET' },
      [{ method, nominalSizeIn: nextSize, role: 'OUTLET' }],
    );
    curId = reducer.id;
    curPos = reducer.pos;
    curSize = nextSize;
  }
  return { id: curId, pos: curPos, sizeIn: curSize };
}

/* --------------------------------------------------------------- routeSystem */

/**
 * PURE. Route the network's HEADS into a real wet-pipe tree. Returns a fresh node
 * list (original heads + new fittings + riser) and the sized, roled segments.
 *
 * Topology (per the trade, not a Steiner tree):
 *   riser --MAIN--> elbow --CROSS_MAIN--> tee_0 --CROSS_MAIN--> tee_1 --> ...
 *   each tee_i taps a BRANCH that runs along row i's heads; each head hangs off the
 *   branch via an ARM_OVER drop. REDUCERs descend the pipe size one schedule step at
 *   a time wherever a run steps down. Sizes are monotonic non-decreasing toward the
 *   riser (each segment sized by its downstream head count via the cited schedule).
 */
export function routeSystem(
  network: SprinklerNetwork,
  opts: RouteOpts = {},
): RoutedSystem {
  const heads = network.nodes.filter((n) => n.type === 'HEAD');
  const rowTolFt = opts.rowTolFt && opts.rowTolFt > 0 ? opts.rowTolFt : 1;
  const branchMaterial: PipeMaterial = opts.branchMaterial ?? 'STEEL_SCH40';
  const mainMaterial: PipeMaterial = opts.mainMaterial ?? 'STEEL_SCH40';
  const headInlet = opts.headInlet ?? DEFAULT_HEAD_INLET;
  const branchMethod = methodForMaterial(branchMaterial);
  const mainMethod = methodForMaterial(mainMaterial);

  const b = new RouteBuilder(mainMethod, branchMethod, mainMaterial, branchMaterial);
  // Heads are PRESERVED verbatim as the leaves of the tree.
  for (const h of heads) b.addNode(h);

  // No heads -> nothing to route. Honest empty result (routedOk false).
  if (heads.length === 0) {
    return {
      nodes: b.nodes,
      segments: b.segments,
      fittingPorts: b.fittingPorts,
      riserId: '',
      routedOk: false,
      scheduleCitation: PIPE_SCHEDULE_CITATION,
      disclaimer: PIPE_ROUTING_DISCLAIMER,
    };
  }

  const ceilingHt = opts.ceilingHt ?? heads[0].pos.y;
  const bounds = headBounds(heads)!;
  const rows = groupHeadRows(heads, rowTolFt);

  // Cross-main runs along Z at a fixed X just to the LEFT of the leftmost head; each
  // branch taps it and runs +X across its row.
  const branchSpacing =
    rows.length > 1
      ? Math.abs(rows[1].z - rows[0].z)
      : Math.max(2, (bounds.maxX - bounds.minX) / Math.max(1, heads.length - 1));
  const span = Math.max(1, branchSpacing);
  const crossMainX = round(bounds.minX - span * 0.5);

  // --- Per-row tee taps on the cross main, ordered by Z. Built FIRST so the riser
  //     can align to the cross-main head and the feed main runs straight (orthogonal). ---
  interface RowPlan {
    row: BranchRow;
    teeId: string;
    tapPos: Point3;
    branchHeadCount: number;
    branchSizeIn: number;
  }
  const rowPlans: RowPlan[] = rows.map((row) => {
    const tee = b.addNode({
      id: b.id('tee'),
      type: 'TEE',
      pos: { x: crossMainX, y: ceilingHt, z: round(row.z) },
    });
    return {
      row,
      teeId: tee.id,
      tapPos: tee.pos,
      branchHeadCount: row.heads.length,
      branchSizeIn: sizeForHeadCount(row.heads.length),
    };
  });
  const firstTap = rowPlans[0];

  // --- Riser / supply (plan feet). The feed main enters the cross-main at its HEAD
  //     (firstTap Z) through a corner elbow. The DEFAULT supply sits on that same Z,
  //     one span to the side, so the feed main is a single STRAIGHT run. A custom
  //     off-axis supply is routed ORTHOGONALLY (an L via a corner) — never diagonal. ---
  const totalHeads = heads.length;
  const mainSizeIn = sizeForHeadCount(totalHeads);
  const supply: SupplyPoint =
    opts.supplyPoint ?? { x: round(crossMainX - span), y: firstTap.tapPos.z };
  const riser = b.addNode({
    id: b.id('riser'),
    type: 'SOURCE',
    pos: { x: round(supply.x), y: ceilingHt, z: round(supply.y) },
  });

  // Elbow at the cross-main head turns the X-running feed main into the Z cross-main.
  const elbowMain = b.addNode({
    id: b.id('elbow'),
    type: 'ELBOW',
    pos: { x: crossMainX, y: ceilingHt, z: firstTap.tapPos.z },
  });

  // --- MAIN: orthogonal. Straight when the riser shares the elbow's X or Z; otherwise
  //     an axis-aligned L through a corner elbow. NEVER a diagonal segment. ---
  const dxDiffers = Math.abs(riser.pos.x - elbowMain.pos.x) > 1e-6;
  const dzDiffers = Math.abs(riser.pos.z - elbowMain.pos.z) > 1e-6;
  if (dxDiffers && dzDiffers) {
    // Corner elbow: run in Z at the riser's X, then in X to the cross-main elbow.
    const corner = b.addNode({
      id: b.id('elbow'),
      type: 'ELBOW',
      pos: { x: riser.pos.x, y: ceilingHt, z: elbowMain.pos.z },
    });
    b.run(riser.id, corner.id, 'MAIN', mainSizeIn, planDist(riser.pos, corner.pos), mainMaterial);
    b.run(corner.id, elbowMain.id, 'MAIN', mainSizeIn, planDist(corner.pos, elbowMain.pos), mainMaterial);
    b.fitting(
      corner.id,
      'ELBOW',
      { method: mainMethod, nominalSizeIn: mainSizeIn, role: 'INLET' },
      [{ method: mainMethod, nominalSizeIn: mainSizeIn, role: 'OUTLET' }],
    );
  } else {
    b.run(riser.id, elbowMain.id, 'MAIN', mainSizeIn, planDist(riser.pos, elbowMain.pos), mainMaterial);
  }

  // Riser fitting: single OUTLET at the main size feeding the main.
  b.fitting(
    riser.id,
    'SOURCE',
    { method: mainMethod, nominalSizeIn: mainSizeIn, role: 'INLET' },
    [{ method: mainMethod, nominalSizeIn: mainSizeIn, role: 'OUTLET' }],
  );
  // Elbow: inlet from main, outlet to cross-main, same size -> direct mate.
  b.fitting(
    elbowMain.id,
    'ELBOW',
    { method: mainMethod, nominalSizeIn: mainSizeIn, role: 'INLET' },
    [{ method: mainMethod, nominalSizeIn: mainSizeIn, role: 'OUTLET' }],
  );

  // --- CROSS_MAIN: chain the tees in Z order. Each span carries this tap's heads
  //     plus every downstream tap's heads. Reducers descend where the size steps. ---
  let prevId = elbowMain.id;
  let prevPos: Point3 = elbowMain.pos;
  let prevSizeIn = mainSizeIn;
  for (let i = 0; i < rowPlans.length; i += 1) {
    const rp = rowPlans[i];
    // Heads carried by the cross-main FROM this tap onward.
    let downstreamHeads = 0;
    for (let j = i; j < rowPlans.length; j += 1) downstreamHeads += rowPlans[j].branchHeadCount;
    const spanSizeIn = sizeForHeadCount(downstreamHeads);

    // Reducer chain (single-step) if the cross-main steps down before this tap.
    const afterReducer = insertReducerChain(
      b,
      prevId,
      prevPos,
      prevSizeIn,
      spanSizeIn,
      rp.tapPos,
      'CROSS_MAIN',
      mainMethod,
      mainMaterial,
    );
    // Cross-main span into this tee.
    b.run(
      afterReducer.id,
      rp.teeId,
      'CROSS_MAIN',
      spanSizeIn,
      planDist(afterReducer.pos, rp.tapPos),
      mainMaterial,
    );

    // Tee ports. A reducing tee reduces at most one nominal step; any larger step
    // is taken by a REDUCER on the run AFTER the tee (insertReducerChain handles it).
    // So the tee advertises both outlets at its INLET size — the honest face of the
    // tee itself — and the downstream reducer chain does every size change. This
    // keeps each fitting's inlet->outlet transition a real (direct) connection.
    const nextDownstream = downstreamHeads - rp.branchHeadCount;
    b.fitting(
      rp.teeId,
      'TEE',
      { method: mainMethod, nominalSizeIn: spanSizeIn, role: 'INLET' },
      [
        { method: mainMethod, nominalSizeIn: spanSizeIn, role: 'OUTLET' },
        { method: branchMethod, nominalSizeIn: spanSizeIn, role: 'OUTLET' },
      ],
    );
    const afterTeeSizeIn = nextDownstream > 0 ? sizeForHeadCount(nextDownstream) : spanSizeIn;

    // --- Branch line off this tee. The branch outlet leaves the tee at the tee's
    //     inlet (span) size; the branch reduces down to its own size internally. ---
    buildBranch(b, rp, spanSizeIn, headInlet, ceilingHt);

    // The cross-main continues from the tee at the tee's outlet (span) size; the next
    // span's reducer chain steps it down to afterTeeSizeIn.
    void afterTeeSizeIn;
    prevId = rp.teeId;
    prevPos = rp.tapPos;
    prevSizeIn = spanSizeIn;
  }

  // --- Connectivity + mate check (real BFS over the segments). ---
  const reachable = reachableFrom(riser.id, b.segments);
  const allHeadsReached = heads.every((h) => reachable.has(h.id));
  const allMated = b.fittingPorts.every((f) => f.mated);
  const routedOk = heads.length > 0 && allHeadsReached && allMated;

  return {
    nodes: b.nodes,
    segments: b.segments,
    fittingPorts: b.fittingPorts,
    riserId: riser.id,
    routedOk,
    scheduleCitation: PIPE_SCHEDULE_CITATION,
    disclaimer: PIPE_ROUTING_DISCLAIMER,
  };
}

/* --------------------------------------------------------------- buildBranch */

/**
 * Build the branch line off one tee: an elbow into the branch run, a chain of branch
 * points (a TEE at each head except the last, an ELBOW at the last), the BRANCH
 * segments between them (sized by downstream head count, with single-step reducers),
 * and an ARM_OVER drop from each branch point down to its head (with a reducing
 * bushing to the head inlet).
 */
function buildBranch(
  b: RouteBuilder,
  rp: { row: BranchRow; teeId: string; tapPos: Point3; branchSizeIn: number },
  tapSizeIn: number,
  headInlet: Port,
  ceilingHt: number,
): void {
  const heads = rp.row.heads;
  const armSizeIn = headInlet.nominalSizeIn;
  const m = b.branchMethod;
  const material = b.branchMaterial;

  // The branch leaves the tee at the tee's (cross-main span) size. Reduce it down to
  // the branch's own size (one step at a time) right at the tap, then run.
  let upId = rp.teeId;
  let upPos: Point3 = rp.tapPos;
  let upSizeIn = tapSizeIn;
  const firstHead = heads[0];

  // Elbow turning the cross-main outlet (Z-stop) into the branch run (+X), placed at
  // the tap. Only when there is real run length to the first head.
  if (Math.abs(firstHead.pos.x - rp.tapPos.x) > 1e-6) {
    const elbow = b.addNode({
      id: b.id('elbow'),
      type: 'ELBOW',
      pos: { x: round(rp.tapPos.x), y: ceilingHt, z: round(rp.tapPos.z) },
    });
    // Reduce from the tap size down to the branch size before/through the elbow.
    const afterRed = insertReducerChain(
      b,
      upId,
      upPos,
      upSizeIn,
      rp.branchSizeIn,
      elbow.pos,
      'BRANCH',
      m,
      material,
    );
    b.run(afterRed.id, elbow.id, 'BRANCH', rp.branchSizeIn, planDist(afterRed.pos, elbow.pos), material);
    b.fitting(
      elbow.id,
      'ELBOW',
      { method: m, nominalSizeIn: rp.branchSizeIn, role: 'INLET' },
      [{ method: m, nominalSizeIn: rp.branchSizeIn, role: 'OUTLET' }],
    );
    upId = elbow.id;
    upPos = elbow.pos;
    upSizeIn = rp.branchSizeIn;
  } else {
    // No lead-in run: reduce to branch size in place so the first branch run is sized.
    upSizeIn = rp.branchSizeIn < tapSizeIn ? tapSizeIn : rp.branchSizeIn;
  }

  for (let k = 0; k < heads.length; k += 1) {
    const head = heads[k];
    const downstreamHeads = heads.length - k; // this head + heads further out
    const segSizeIn = sizeForHeadCount(downstreamHeads);
    const isLast = k === heads.length - 1;

    const branchPoint = b.addNode({
      id: b.id(isLast ? 'elbow' : 'tee'),
      type: isLast ? 'ELBOW' : 'TEE',
      pos: { x: round(head.pos.x), y: ceilingHt, z: round(rp.tapPos.z) },
    });

    // Reducer chain on the branch run if the size steps down before this point.
    const afterRed = insertReducerChain(
      b,
      upId,
      upPos,
      upSizeIn,
      segSizeIn,
      branchPoint.pos,
      'BRANCH',
      m,
      material,
    );
    b.run(
      afterRed.id,
      branchPoint.id,
      'BRANCH',
      segSizeIn,
      planDist(afterRed.pos, branchPoint.pos),
      material,
    );

    // Branch-point ports. A non-last point is a TEE (continue + arm-over); the last is
    // an ELBOW (single outlet to the arm-over). The arm-over outlet may step down to
    // the head inlet — the reducer chain below handles that; here the outlet is the
    // head inlet size so the tee/elbow advertises the real arm-over face.
    if (isLast) {
      b.fitting(
        branchPoint.id,
        'ELBOW',
        { method: m, nominalSizeIn: segSizeIn, role: 'INLET' },
        [{ method: m, nominalSizeIn: segSizeIn, role: 'OUTLET' }],
      );
    } else {
      // Reducing tee reduces at most one step; the continue-run reducer (next
      // iteration's insertReducerChain) does any larger step. Advertise both outlets
      // at the inlet size — the tee's honest face — so the fitting mates directly.
      b.fitting(
        branchPoint.id,
        'TEE',
        { method: m, nominalSizeIn: segSizeIn, role: 'INLET' },
        [
          { method: m, nominalSizeIn: segSizeIn, role: 'OUTLET' },
          { method: m, nominalSizeIn: segSizeIn, role: 'OUTLET' },
        ],
      );
    }

    // --- ARM_OVER drop from the branch point down to the head. Reducer chain to the
    //     head inlet size where the branch arm steps down. ---
    const armTopPos: Point3 = { x: round(head.pos.x), y: round(ceilingHt), z: round(rp.tapPos.z) };
    const armBotPos: Point3 = head.pos;
    const afterArmRed = insertReducerChain(
      b,
      branchPoint.id,
      armTopPos,
      segSizeIn,
      armSizeIn,
      armBotPos,
      'ARM_OVER',
      m,
      material,
    );
    b.run(
      afterArmRed.id,
      head.id,
      'ARM_OVER',
      armSizeIn,
      Math.max(0.5, Math.abs(afterArmRed.pos.y - head.pos.y)),
      material,
    );

    // The branch point's run-through outlet leaves at this segment's size; the next
    // iteration's reducer chain steps it down to the next (smaller) downstream size.
    upId = branchPoint.id;
    upPos = branchPoint.pos;
    upSizeIn = segSizeIn;
  }
}

/* --------------------------------------------------------------- connectivity */

/**
 * Set of node ids reachable from `start` over the segment graph (treated as
 * undirected) — a real BFS. `routedOk` rests on this: every head id must appear here.
 */
export function reachableFrom(start: string, segments: readonly Segment[]): Set<string> {
  const adj = new Map<string, string[]>();
  const link = (a: string, c: string): void => {
    const list = adj.get(a);
    if (list) list.push(c);
    else adj.set(a, [c]);
  };
  for (const s of segments) {
    link(s.from, s.to);
    link(s.to, s.from);
  }
  const seen = new Set<string>([start]);
  const queue = [start];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const next of adj.get(cur) ?? []) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return seen;
}

/* --------------------------------------------------------------- summaries */

/** Count routed nodes by type (for the preview handle + legend). */
export function summarizeRouted(routed: RoutedSystem): {
  segmentCount: number;
  fittingCount: number;
  riserCount: number;
  headCount: number;
} {
  let fittingCount = 0;
  let riserCount = 0;
  let headCount = 0;
  for (const n of routed.nodes) {
    if (n.type === 'TEE' || n.type === 'ELBOW' || n.type === 'REDUCER') fittingCount += 1;
    else if (n.type === 'SOURCE') riserCount += 1;
    else if (n.type === 'HEAD') headCount += 1;
  }
  return {
    segmentCount: routed.segments.length,
    fittingCount,
    riserCount,
    headCount,
  };
}
