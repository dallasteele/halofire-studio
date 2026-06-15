/**
 * HaloFire — REAL hydraulic NETWORK solver (Phase 3, "hydraulics that hold up").
 *
 * Unlike the earlier single-path estimate in hydraulics.js (which walked an
 * abstract `network` summary of branchLines/mainZ), THIS module solves the
 * ACTUAL connected pipe/head topology that Phase 2 built — the same node graph
 * the Smart Pipe classifier derives from `cadModel.solids`. It:
 *
 *   1. Builds the undirected pipe graph (pipes = edges, junctions = nodes),
 *      attaching heads to the nodes they sit on.
 *   2. Picks the hydraulically most-remote FLOWING head and walks the connected
 *      topology back toward the supply (a tree walk over the spanning structure
 *      rooted at the supply), so flow direction is well-defined.
 *   3. Sums flow at every junction (conservation): each flowing head discharges
 *      Q = K·√P at its node pressure; a pipe carries the sum of all downstream
 *      head flows; ΣQ_in = ΣQ_out at every node.
 *   4. Accumulates the REQUIRED pressure from the remote head back to the source
 *      over each pipe: Hazen-Williams friction (4.52·Q^1.852 / (C^1.852·d^4.8704)
 *      per ft, × length + fitting equivalent lengths) + elevation head
 *      (0.433 psi/ft) + velocity-pressure change (Pv = 0.001123·Q²/d⁴).
 *   5. Reports the system DEMAND (gpm) and REQUIRED pressure at the source, the
 *      worst-case (most-remote) path, available supply, and the safety margin.
 *
 * Plus ITERATIVE PIPE UPSIZING: if the required source pressure exceeds the
 * available supply, bump under-performing pipes up the schedule one nominal size
 * at a time and re-solve, until the demand is met or the schedule is exhausted.
 *
 * 🔬 NUMERICAL TRUTH: every relation here is a published NFPA-13 / Hazen-Williams
 * formula, golden-tested against hand-computed values (see test/network-solve.test.js).
 *
 * HONESTY / fail-closed: this is an ENGINEERING AID. It is a forward
 * (demand-fixed) tree solve with Q=K√P heads — NOT a sealed Hardy-Cross GRID
 * balance (looped mains are walked as a tree, not iterated to ΣhL→0 around
 * loops), NOT AutoSprink, NOT PE-stamped, NOT AHJ-approved. Verify against the
 * stamped calc before permit. No claim gate is cleared here.
 *
 * Units: gpm (flow), inches (diameter), feet (length/elevation), psi.
 */

import { equivalentLengthFt } from './fitting-le.js';

const ELEVATION_PSI_PER_FT = 0.433;          // water column
const DEFAULT_C = 120;
const DEFAULT_K_FACTOR = 5.6;                // standard 1/2" K5.6 spray head
const DEFAULT_MIN_HEAD_PRESSURE_PSI = 7;     // NFPA-13 minimum operating pressure
const NODE_TOL_FT = 0.05;                    // endpoint snap (matches smart-pipe)
// NFPA-13 (2022) §23.4.2 — max water velocity guidance; many AHJs cap branch/main
// velocity ~32 fps to limit friction/erosion/water-hammer. Used as the color-by-
// condition "over-velocity" threshold (advisory; not a hard code prohibition).
export const MAX_VELOCITY_FPS = 32;

// Schedule-40 internal diameters (in). Used by iterative upsizing — bumping a
// pipe to the next nominal size means jumping to the next entry here.
export const SCHED40_ID = Object.freeze([
  1.049, 1.380, 1.610, 2.067, 2.469, 3.068, 4.026, 6.065, 7.981,
]);

export const DISCLAIMER =
  'ENGINEERING AID — real connected-network Hazen-Williams demand/pressure solve '
  + '(Q=K√P heads, junction flow conservation, iterative upsizing). NOT a sealed '
  + 'Hardy-Cross grid balance, NOT AutoSprink, NOT PE-stamped, NOT AHJ-approved. '
  + 'Verify against the stamped hydraulic calc before permit.';

// ---------------------------------------------------------------------------
// Core scalar relations (golden-tested against hand calcs).
// ---------------------------------------------------------------------------

/** Hazen-Williams friction loss, psi per foot. p = 4.52·Q^1.852 / (C^1.852·d^4.8704). */
export function hwLossPsiPerFt(gpm, diameterIn, C = DEFAULT_C) {
  if (!(diameterIn > 0)) throw new Error('diameterIn must be > 0');
  if (!(C > 0)) throw new Error('C must be > 0');
  const Q = Math.max(0, Number(gpm) || 0);
  if (Q === 0) return 0;
  return (4.52 * Math.pow(Q, 1.852)) / (Math.pow(C, 1.852) * Math.pow(diameterIn, 4.8704));
}

/** Velocity, fps. v = 0.4085·Q / d². */
export function velocityFps(gpm, diameterIn) {
  if (!(diameterIn > 0)) throw new Error('diameterIn must be > 0');
  return (0.4085 * (Number(gpm) || 0)) / (diameterIn * diameterIn);
}

/** Velocity pressure, psi. Pv = 0.001123·Q² / d⁴ (NFPA-13). */
export function velocityPressurePsi(gpm, diameterIn) {
  if (!(diameterIn > 0)) throw new Error('diameterIn must be > 0');
  const Q = Number(gpm) || 0;
  return (0.001123 * Q * Q) / Math.pow(diameterIn, 4);
}

/** K-factor head discharge. Q = K·√P. Returns 0 at or below 0 psi. */
export function kFactorFlow(k, psi) {
  if (!(k > 0)) throw new Error('kFactor must be > 0');
  const p = Number(psi);
  if (!(p > 0)) return 0;
  return k * Math.sqrt(p);
}

// ---------------------------------------------------------------------------
// Graph construction over the real cadModel.solids topology.
// ---------------------------------------------------------------------------

function key(p) {
  const q = NODE_TOL_FT;
  return `${Math.round(p[0] / q)}|${Math.round(p[1] / q)}|${Math.round(p[2] / q)}`;
}

function len3(a, b) {
  return Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
}

/**
 * Build the pipe graph from a cadModel:
 *   nodes: Map key -> { key, pt, edges:[edgeIdx], heads:[head], z }
 *   edges: [{ idx, a, b, ka, kb, length, diameterIn, C, solid }]
 * Heads attach to the node at their position.
 */
export function buildGraph(cadModel, opts = {}) {
  const C = opts.C > 0 ? opts.C : DEFAULT_C;
  const solids = (cadModel && Array.isArray(cadModel.solids)) ? cadModel.solids : [];
  const pipes = solids.filter((s) => s && s.kind === 'pipe' && Array.isArray(s.from) && Array.isArray(s.to));
  const heads = solids.filter((s) => s && s.kind === 'head' && Array.isArray(s.position));

  const nodes = new Map();
  const ensure = (pt) => {
    const k = key(pt);
    if (!nodes.has(k)) nodes.set(k, { key: k, pt: pt.map(Number), edges: [], heads: [], z: Number(pt[2]) || 0 });
    return nodes.get(k);
  };

  // First pass: register every pipe's two endpoints as nodes (so interior-tap
  // detection below can test endpoint points against every raw segment).
  const raw = pipes.map((s, idx) => {
    const from = s.from.map(Number);
    const to = s.to.map(Number);
    ensure(from);
    ensure(to);
    return { idx, solid: s, from, to,
      diameterIn: Number(s.diameterIn) || 1,
      C: Number(s.C) > 0 ? Number(s.C) : C };
  });

  // --- INTERIOR TAPS + EDGE SPLITTING: a generated model taps a drop onto the
  // MIDDLE of a long branch line, and a riser-tie onto the MIDDLE of a cross-main
  // — the carrier is one un-split segment, so the tap's endpoint NODE does not
  // coincide with either carrier endpoint. Without splitting the carrier at those
  // taps, the graph fragments into one tiny component per branch (the bug GUARD#2
  // caught: a 1230-head model solving as only 2 heads). For every raw pipe, find
  // every OTHER node that lies on its interior, then SPLIT the pipe into ordered
  // sub-edges at those taps so each connection is a true shared-endpoint joint.
  // (Mirrors smart-pipe's pointOnSegment interior-incidence detection.) ---
  const allNodeKeys = [...nodes.keys()];
  const nodePt = (k) => nodes.get(k).pt;
  // Spatial prefilter: bin nodes by X cell so a segment only tests the nodes in
  // the X-range it spans (taps lie ON the segment, so they share its X-extent).
  // Turns the interior-tap scan from O(pipes×nodes) into roughly O(pipes×localNodes).
  const CELL = 4; // ft bucket
  const xBins = new Map();
  for (const k of allNodeKeys) {
    const cx = Math.floor(nodes.get(k).pt[0] / CELL);
    if (!xBins.has(cx)) xBins.set(cx, []);
    xBins.get(cx).push(k);
  }
  const candidateKeys = (a, b) => {
    const lo = Math.floor(Math.min(a[0], b[0]) / CELL) - 1;
    const hi = Math.floor(Math.max(a[0], b[0]) / CELL) + 1;
    const out = [];
    for (let c = lo; c <= hi; c += 1) { const arr = xBins.get(c); if (arr) out.push(...arr); }
    return out;
  };
  const edges = [];
  let eIdx = 0;
  for (const r of raw) {
    // interior taps: nodes strictly between from..to (exclude the two endpoints)
    const kFrom = key(r.from);
    const kTo = key(r.to);
    const taps = [];
    for (const k of candidateKeys(r.from, r.to)) {
      if (k === kFrom || k === kTo) continue;
      const p = nodePt(k);
      if (pointOnSegment(p, r.from, r.to)) {
        // parameter along from->to for ordering
        const t = paramOnSegment(p, r.from, r.to);
        taps.push({ k, t, p });
      }
    }
    taps.sort((a, b) => a.t - b.t);
    // ordered chain of points: from, ...taps, to
    const chain = [{ k: kFrom, p: r.from }, ...taps.map((t) => ({ k: t.k, p: t.p })), { k: kTo, p: r.to }];
    for (let i = 0; i < chain.length - 1; i += 1) {
      const aNode = nodes.get(chain[i].k) || ensure(chain[i].p);
      const bNode = nodes.get(chain[i + 1].k) || ensure(chain[i + 1].p);
      aNode.edges.push(eIdx);
      bNode.edges.push(eIdx);
      edges.push({
        idx: eIdx,
        a: aNode.key,
        b: bNode.key,
        ka: aNode.key,
        kb: bNode.key,
        length: len3(chain[i].p, chain[i + 1].p),
        diameterIn: r.diameterIn,
        C: r.C,
        solid: r.solid,     // all sub-edges of one pipe share the solid (for upsizing)
        pipeIdx: r.idx,
        from: chain[i].p,
        to: chain[i + 1].p,
      });
      eIdx += 1;
    }
  }

  // Attach heads to the node they sit on (exact node coincidence).
  for (const h of heads) {
    const k = key(h.position);
    const node = nodes.get(k);
    const kf = Number(h.kFactor) > 0 ? Number(h.kFactor) : (opts.kFactor > 0 ? opts.kFactor : DEFAULT_K_FACTOR);
    if (node) node.heads.push({ solid: h, kFactor: kf, position: h.position.map(Number) });
    else {
      // head not on a pipe node — create a stub node so it is still counted
      const n = ensure(h.position);
      n.heads.push({ solid: h, kFactor: kf, position: h.position.map(Number) });
    }
  }

  return { nodes, edges, heads };
}

const PT_TOL = NODE_TOL_FT;
/** True iff point p lies on segment a->b within tolerance (interior or endpoint). */
function pointOnSegment(p, a, b) {
  const abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2];
  const apx = p[0] - a[0], apy = p[1] - a[1], apz = p[2] - a[2];
  const abLen2 = abx * abx + aby * aby + abz * abz;
  if (abLen2 < 1e-9) return false;
  let t = (apx * abx + apy * aby + apz * abz) / abLen2;
  if (t < -1e-6 || t > 1 + 1e-6) return false;
  t = Math.max(0, Math.min(1, t));
  const cx = a[0] + abx * t, cy = a[1] + aby * t, cz = a[2] + abz * t;
  return Math.hypot(p[0] - cx, p[1] - cy, p[2] - cz) <= PT_TOL;
}
/** Projection parameter t in [0,1] of p onto segment a->b (for ordering taps). */
function paramOnSegment(p, a, b) {
  const abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2];
  const apx = p[0] - a[0], apy = p[1] - a[1], apz = p[2] - a[2];
  const abLen2 = abx * abx + aby * aby + abz * abz;
  if (abLen2 < 1e-9) return 0;
  return Math.max(0, Math.min(1, (apx * abx + apy * aby + apz * abz) / abLen2));
}

/**
 * Find the supply/source node: the lowest-Z node that a riser/floor connection
 * touches (Z ≈ network minimum). If a supply marker solid is present, prefer it.
 */
function findSourceNode(graph) {
  let minZ = Infinity;
  for (const n of graph.nodes.values()) minZ = Math.min(minZ, n.z);
  // candidate source nodes sit at the network floor (lowest Z)
  let source = null;
  for (const n of graph.nodes.values()) {
    if (Math.abs(n.z - minZ) <= NODE_TOL_FT) {
      // prefer the one with the highest edge degree (the riser base/manifold)
      if (!source || n.edges.length > source.edges.length) source = n;
    }
  }
  return source;
}

// ---------------------------------------------------------------------------
// The solve: BFS tree from the source, flow accumulation leaves->root, then
// pressure accumulation root-relative along the most-remote path.
// ---------------------------------------------------------------------------

/**
 * Solve the real connected network for system demand + required source pressure.
 *
 * @param {{solids:Array}} cadModel
 * @param {{C?:number, kFactor?:number, minHeadPressurePsi?:number,
 *   availablePsi?:number, fittingsPerHead?:number}} [opts]
 * @returns {object} solve result (see fields below)
 */
export function solveNetwork(cadModel, opts = {}) {
  const C = opts.C > 0 ? opts.C : DEFAULT_C;
  const minHead = opts.minHeadPressurePsi != null ? opts.minHeadPressurePsi : DEFAULT_MIN_HEAD_PRESSURE_PSI;
  const graph = buildGraph(cadModel, opts);
  const { nodes, edges } = graph;

  const totalHeads = [...nodes.values()].reduce((n, nd) => n + nd.heads.length, 0);

  if (edges.length === 0 || totalHeads === 0) {
    return degenerate(totalHeads, minHead, opts);
  }

  const source = findSourceNode(graph);
  if (!source) return degenerate(totalHeads, minHead, opts);

  // --- 1. Spanning tree (BFS) rooted at the source. parentEdge[node] = the edge
  // connecting a node to its parent (toward the source). Loops are broken by BFS
  // (the second edge into an already-visited node is a "loop chord" — recorded,
  // but the tree walk carries flow; honest PARTIAL flag, not a Hardy-Cross loop). ---
  const parent = new Map();      // nodeKey -> { edgeIdx, parentKey }
  const order = [];              // BFS visitation order (root first)
  const visited = new Set([source.key]);
  const queue = [source.key];
  const loopChords = [];
  order.push(source.key);
  while (queue.length) {
    const nk = queue.shift();
    const node = nodes.get(nk);
    for (const ei of node.edges) {
      const e = edges[ei];
      const other = e.a === nk ? e.b : e.a;
      if (other === nk) continue; // self-loop guard
      if (!visited.has(other)) {
        visited.add(other);
        parent.set(other, { edgeIdx: ei, parentKey: nk });
        order.push(other);
        queue.push(other);
      } else if (parent.get(nk)?.edgeIdx !== ei) {
        // already-visited neighbor reached by a different edge => loop chord
        if (!loopChords.includes(ei)) loopChords.push(ei);
      }
    }
  }

  // --- 2. Head node pressures (forward iteration). We don't know node pressures
  // a-priori, so we seed every FLOWING head at the minimum operating pressure and
  // compute its discharge Q=K√P. The most-remote head (greatest tree-distance from
  // source) governs; heads closer to the source see >= that pressure, so seeding
  // all heads at minHead is the conservative balanced-demand basis NFPA uses for a
  // hand calc of the remote area. (A full balance would raise near-source heads;
  // that is the Hardy-Cross refinement flagged PARTIAL.) ---
  // Optional remote-area subset: opts.flowingHeads(head) -> bool decides which
  // heads discharge (the NFPA-13 design area). Default = all heads open.
  const isFlowing = typeof opts.flowingHeads === 'function' ? opts.flowingHeads : () => true;
  const headFlowAtNode = new Map(); // nodeKey -> gpm discharged by heads there
  let nFlowing = 0;
  for (const [nk, node] of nodes) {
    let q = 0;
    for (const h of node.heads) {
      if (!isFlowing(h.solid, h)) continue;
      const hq = kFactorFlow(h.kFactor, minHead);
      q += hq;
      if (hq > 0) nFlowing += 1;
    }
    if (q > 0) headFlowAtNode.set(nk, q);
  }

  // --- 3. Flow accumulation leaves -> root. Process BFS order in REVERSE so a
  // child is always summed before its parent edge. edgeFlow[edgeIdx] = total gpm
  // flowing through that pipe = sum of all head discharges in the subtree beyond
  // it (away from source). This is conservation: ΣQ at each node balances. ---
  const subtreeFlow = new Map(); // nodeKey -> gpm leaving via its parent edge
  for (const nk of nodes.keys()) subtreeFlow.set(nk, headFlowAtNode.get(nk) || 0);
  const edgeFlow = new Array(edges.length).fill(0);
  for (let i = order.length - 1; i >= 0; i -= 1) {
    const nk = order[i];
    const p = parent.get(nk);
    if (!p) continue; // the source/root has no parent edge
    const flow = subtreeFlow.get(nk) || 0;
    edgeFlow[p.edgeIdx] += flow;
    subtreeFlow.set(p.parentKey, (subtreeFlow.get(p.parentKey) || 0) + flow);
  }
  const demandGpm = subtreeFlow.get(source.key) || 0; // all flow arrives at source

  // --- 4. Most-remote flowing head: greatest cumulative pipe length from source
  // along the tree. Walk that path source->head, recording per-pipe loss. ---
  const distFromSource = new Map([[source.key, 0]]);
  for (const nk of order) {
    const p = parent.get(nk);
    if (!p) continue;
    const e = edges[p.edgeIdx];
    distFromSource.set(nk, (distFromSource.get(p.parentKey) || 0) + e.length);
  }
  let remoteKey = null;
  let remoteDist = -1;
  for (const [nk, node] of nodes) {
    if (node.heads.length && (distFromSource.get(nk) || 0) > remoteDist) {
      remoteDist = distFromSource.get(nk) || 0;
      remoteKey = nk;
    }
  }

  // --- 5. Pressure accumulation along the remote path, source-rooted. We compute
  // the REQUIRED pressure at the source so the remote head sees >= minHead. Walk
  // remote-head -> source, summing, on each pipe carrying edgeFlow:
  //   + Hazen-Williams friction over (length + fitting Le)
  //   + elevation rise toward the head (0.433 psi/ft) [downstream side higher]
  //   + velocity-pressure regain handled at head (normal vs total pressure)
  // requiredSourcePsi = minHead + Σ(friction) + Σ(elevation source->head)
  //                     + Pv at the remote head (total-pressure basis). ---
  const fittingsPerHead = opts.fittingsPerHead != null ? opts.fittingsPerHead : 1; // 1 tee+elbow approx per leaf
  const worstPath = [];
  let frictionPsi = 0;
  let elevationPsi = 0;
  // Fitting equivalent-length accounting along the worst path, broken out by type
  // so the in-product hook can show WHICH fittings added length (and how much).
  const fittingByType = {};   // type -> { count, equivFt }
  let fittingTotalEquivFt = 0;
  const addFitting = (type, dia, cAttr) => {
    const le = equivalentLengthFt(type, dia, cAttr);
    if (!fittingByType[type]) fittingByType[type] = { count: 0, equivFt: 0 };
    fittingByType[type].count += 1;
    fittingByType[type].equivFt = round(fittingByType[type].equivFt + le);
    fittingTotalEquivFt += le;
    return le;
  };
  if (remoteKey) {
    let cur = remoteKey;
    while (parent.has(cur)) {
      const p = parent.get(cur);
      const e = edges[p.edgeIdx];
      const flow = edgeFlow[p.edgeIdx];
      // fitting equivalent length: leaf legs (drops/arm-overs) add a tee at the
      // tap + an elbow; longer carriers add proportionally fewer. Approximate
      // with `fittingsPerHead` tee+elbow on the short leaf legs only.
      let leFt = 0;
      if (e.length < 6 && fittingsPerHead > 0) {
        leFt = addFitting('teeBranch', e.diameterIn, e.C)
          + addFitting('elbow90', e.diameterIn, e.C);
      }
      const effLen = e.length + leFt;
      const lossPerFt = hwLossPsiPerFt(flow, e.diameterIn, e.C);
      const segFriction = lossPerFt * effLen;
      frictionPsi += segFriction;
      // elevation: child (cur) is downstream (toward head); rise = childZ - parentZ
      const childZ = nodes.get(cur).z;
      const parentZ = nodes.get(p.parentKey).z;
      const dz = childZ - parentZ; // positive => head is higher than source side
      elevationPsi += ELEVATION_PSI_PER_FT * dz;
      worstPath.unshift({
        edge: e.idx,
        fromKey: p.parentKey,
        toKey: cur,
        diameterIn: round(e.diameterIn),
        lengthFt: round(e.length),
        fittingLeFt: round(leFt),
        flowGpm: round(flow),
        velocityFps: round(velocityFps(flow, e.diameterIn)),
        lossPsiPerFt: round6(lossPerFt),
        frictionPsi: round(segFriction),
        elevationPsi: round(ELEVATION_PSI_PER_FT * dz),
      });
      cur = p.parentKey;
    }
  }

  const remoteNode = remoteKey ? nodes.get(remoteKey) : null;
  const remoteK = remoteNode && remoteNode.heads.length ? remoteNode.heads[0].kFactor : DEFAULT_K_FACTOR;
  const remoteQ = kFactorFlow(remoteK, minHead);
  const remoteVp = remoteNode ? velocityPressurePsi(remoteQ, worstPathLeafDia(worstPath)) : 0;

  const requiredPsi = round(minHead + frictionPsi + Math.max(0, elevationPsi) + remoteVp);

  // --- 6. PER-EDGE + PER-NODE results (node tags + color-by-condition feed). The
  // pressure walk above only traced the remote path; here we cover EVERY tree edge
  // and node. Pipe head loss on each edge uses the same Hazen-Williams physics with
  // its carried edgeFlow; node pressure is the source-required pressure minus the
  // cumulative (friction + elevation) along that node's tree path back to source.
  // This is the SAME forward demand-fixed tree solve — just reported per element,
  // so it is exactly as honest (and as PARTIAL on looped grids) as the headline. ---
  const edgeLossPsi = new Array(edges.length).fill(0);     // friction loss on each tree edge
  const edgeElevPsi = new Array(edges.length).fill(0);     // elevation rise (child higher) on each edge
  for (const nk of order) {
    const p = parent.get(nk);
    if (!p) continue;
    const e = edges[p.edgeIdx];
    const flow = edgeFlow[p.edgeIdx];
    // leaf legs (< 6 ft) carry a tee+elbow fitting Le, mirroring the remote-path calc
    let leFt = 0;
    if (e.length < 6 && fittingsPerHead > 0) {
      leFt = equivalentLengthFt('teeBranch', e.diameterIn, e.C)
        + equivalentLengthFt('elbow90', e.diameterIn, e.C);
    }
    const effLen = e.length + leFt;
    edgeLossPsi[p.edgeIdx] = hwLossPsiPerFt(flow, e.diameterIn, e.C) * effLen;
    const childZ = nodes.get(nk).z;
    const parentZ = nodes.get(p.parentKey).z;
    edgeElevPsi[p.edgeIdx] = ELEVATION_PSI_PER_FT * (childZ - parentZ);
  }
  // Forward node-pressure walk (root -> leaves, BFS order): P(child) = P(parent)
  // − friction(edge) − elevation(edge). Root is the required source pressure.
  const nodePsi = new Map([[source.key, requiredPsi]]);
  for (const nk of order) {
    const p = parent.get(nk);
    if (!p) continue;
    const pPsi = nodePsi.get(p.parentKey);
    nodePsi.set(nk, round((pPsi != null ? pPsi : requiredPsi) - edgeLossPsi[p.edgeIdx] - edgeElevPsi[p.edgeIdx]));
  }
  // Per-edge report (velocity + condition flags drive color-by-condition).
  const edgeResults = [];
  for (const e of edges) {
    const flow = edgeFlow[e.idx] || 0;
    const v = velocityFps(flow, e.diameterIn);
    edgeResults.push({
      edge: e.idx,
      pipeIdx: e.pipeIdx,
      a: e.a,
      b: e.b,
      from: e.from,
      to: e.to,
      diameterIn: round(e.diameterIn),
      lengthFt: round(e.length),
      flowGpm: round(flow),
      velocityFps: round(v),
      frictionPsi: round(edgeLossPsi[e.idx]),
      overVelocity: v > MAX_VELOCITY_FPS,
    });
  }
  // Per-node report (the node tags: P/Q/V at junctions). flowGpm at a node is the
  // sum of flows on its child edges + heads there (= flow passing through / out).
  const nodeResults = [];
  for (const [nk, node] of nodes) {
    const psi = nodePsi.has(nk) ? nodePsi.get(nk) : null;
    const headQ = headFlowAtNode.get(nk) || 0;
    // through-flow on this node's parent edge (the pipe feeding it); for the
    // source this is the full demand. Used as the node's representative Q.
    const pp = parent.get(nk);
    const throughGpm = pp ? edgeFlow[pp.edgeIdx] : demandGpm;
    // representative velocity: on the parent (feeding) edge.
    const repDia = pp ? edges[pp.edgeIdx].diameterIn : (node.edges.length ? edges[node.edges[0]].diameterIn : 1);
    nodeResults.push({
      key: nk,
      pt: node.pt,
      isSource: nk === source.key,
      isRemote: nk === remoteKey,
      headCount: node.heads.length,
      pressurePsi: psi,
      flowGpm: round(throughGpm),
      headFlowGpm: round(headQ),
      velocityFps: round(velocityFps(throughGpm, repDia)),
      degree: node.edges.length,
    });
  }
  // System velocity envelope (worst pipe) — a headline color-by-condition number.
  let maxVelocity = 0; let maxVelocityEdge = -1;
  for (const er of edgeResults) { if (er.velocityFps > maxVelocity) { maxVelocity = er.velocityFps; maxVelocityEdge = er.edge; } }
  let minNodePsi = Infinity; let minNodePsiKey = null;
  for (const nr of nodeResults) { if (nr.pressurePsi != null && nr.pressurePsi < minNodePsi) { minNodePsi = nr.pressurePsi; minNodePsiKey = nr.key; } }

  const result = {
    demandGpm: round(demandGpm),
    requiredPsi,
    minHeadPressurePsi: minHead,
    frictionLossPsi: round(frictionPsi),
    elevationPsi: round(elevationPsi),
    velocityPressurePsi: round(remoteVp),
    // NFPA-13 fitting equivalent-length used on the worst (remote) path, summed
    // and broken out by fitting type. These are the SAME Le values added to each
    // segment's effective length in the friction calc above (real, not display-only).
    fittingLe: {
      totalEquivFt: round(fittingTotalEquivFt),
      byType: fittingByType,
      basis: 'worst (most-remote) path; tee-branch + 90° elbow per short leaf leg '
        + '(< 6 ft, e.g. drops/arm-overs), NFPA-13 Le table scaled by (C/120)^1.852.',
    },
    headsTotal: totalHeads,
    headsFlowing: nFlowing,
    remoteHeadFlowGpm: round(remoteQ),
    remotePathLengthFt: round(remoteDist),
    worstPath,
    loopCount: loopChords.length,
    hardyCrossBalanced: false, // tree walk, not loop-iterated
    nodeCount: nodes.size,
    pipeCount: edges.length,
    C,
    kFactor: remoteK,
    conservationOk: conservationCheck(graph, edges, edgeFlow, parent, headFlowAtNode),
    // PER-ELEMENT results — node tags (P/Q/V at junctions) + color-by-condition
    // (per-edge velocity + over-velocity flag). Same forward tree solve, reported
    // per element (so exactly as honest / PARTIAL on loops as the headline).
    nodes: nodeResults,
    edgeResults,
    maxVelocityFps: round(maxVelocity),
    maxVelocityEdge,
    maxVelocityThresholdFps: MAX_VELOCITY_FPS,
    minNodePressurePsi: minNodePsiKey ? round(minNodePsi) : null,
    minNodePressureKey: minNodePsiKey,
    designBasis: opts.flowingHeads ? 'remote-area-subset' : 'all-heads-open',
    designBasisNote: opts.flowingHeads
      ? 'flowing only the supplied remote-area heads.'
      : 'ALL heads flowed simultaneously — a worst-case envelope, NOT the NFPA-13 '
        + 'remote-area design demand (which flows only the hydraulically most-remote '
        + 'design area). Use the Remote-Area boundary tool for the code design demand.',
    disclaimer: DISCLAIMER,
  };

  if (opts.availablePsi != null) {
    const avail = Number(opts.availablePsi);
    result.availablePsi = round(avail);
    result.safetyMargin = round(avail - requiredPsi);
    result.demandMet = avail >= requiredPsi;
  }

  return result;
}

/** Diameter of the leaf (head-side) pipe on the worst path, for velocity pressure. */
function worstPathLeafDia(worstPath) {
  if (!worstPath.length) return 1;
  return worstPath[worstPath.length - 1].diameterIn || 1;
}

/**
 * Conservation check: at every interior node, flow IN from the parent edge equals
 * flow OUT to children edges + heads discharged at the node. Returns true when the
 * worst residual is within tolerance.
 */
function conservationCheck(graph, edges, edgeFlow, parent, headFlowAtNode) {
  let worst = 0;
  for (const [nk, node] of graph.nodes) {
    const p = parent.get(nk);
    const inflow = p ? edgeFlow[p.edgeIdx] : null; // source has no parent
    // outflow = sum of child edge flows + heads at this node
    let childOut = 0;
    for (const ei of node.edges) {
      if (p && ei === p.edgeIdx) continue;
      // is this edge a child (its far node's parent is nk)?
      const e = edges[ei];
      const other = e.a === nk ? e.b : e.a;
      const op = parent.get(other);
      if (op && op.parentKey === nk) childOut += edgeFlow[ei];
    }
    const headOut = headFlowAtNode.get(nk) || 0;
    if (inflow != null) {
      worst = Math.max(worst, Math.abs(inflow - (childOut + headOut)));
    }
  }
  return worst < 1e-6;
}

function degenerate(totalHeads, minHead, opts) {
  const out = {
    demandGpm: 0,
    requiredPsi: round(minHead),
    minHeadPressurePsi: minHead,
    frictionLossPsi: 0,
    elevationPsi: 0,
    velocityPressurePsi: 0,
    fittingLe: { totalEquivFt: 0, byType: {}, basis: 'no flowing path' },
    headsTotal: totalHeads,
    headsFlowing: 0,
    remoteHeadFlowGpm: 0,
    remotePathLengthFt: 0,
    worstPath: [],
    loopCount: 0,
    hardyCrossBalanced: false,
    nodeCount: 0,
    pipeCount: 0,
    conservationOk: true,
    nodes: [],
    edgeResults: [],
    maxVelocityFps: 0,
    maxVelocityEdge: -1,
    maxVelocityThresholdFps: MAX_VELOCITY_FPS,
    minNodePressurePsi: null,
    minNodePressureKey: null,
    disclaimer: DISCLAIMER,
  };
  if (opts.availablePsi != null) {
    out.availablePsi = round(Number(opts.availablePsi));
    out.safetyMargin = round(Number(opts.availablePsi) - out.requiredPsi);
    out.demandMet = Number(opts.availablePsi) >= out.requiredPsi;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Iterative pipe upsizing.
// ---------------------------------------------------------------------------

/** Next schedule-40 ID above `dia`, or null if already the largest. */
export function nextSizeUp(dia) {
  for (const s of SCHED40_ID) if (s > dia + 1e-6) return s;
  return null;
}

/**
 * If the network under-delivers (requiredPsi > availablePsi), iteratively bump
 * the worst (highest friction-loss) pipes on the remote path up one nominal size
 * and re-solve, until demand is met or no pipe can grow / a max-iteration cap is
 * hit. Pure: clones the model's pipe diameters, never mutates the caller's solids.
 *
 * @param {{solids:Array}} cadModel
 * @param {{availablePsi:number, maxIterations?:number, ...}} opts (availablePsi required)
 * @returns {{base:object, final:object, upsized:Array, iterations:number, met:boolean}}
 */
export function solveWithUpsizing(cadModel, opts = {}) {
  if (opts.availablePsi == null) {
    // nothing to size against — just solve once
    const base = solveNetwork(cadModel, opts);
    return { base, final: base, upsized: [], iterations: 0, met: null };
  }
  const maxIter = opts.maxIterations || 24;
  // Work on a shallow clone where each pipe solid is copied (diameter mutable).
  const working = cloneModelPipes(cadModel);
  const base = solveNetwork(working, opts);
  if (base.demandMet) {
    return { base, final: base, upsized: [], iterations: 0, met: true };
  }

  const upsized = [];
  let current = base;
  let iter = 0;
  while (!current.demandMet && iter < maxIter) {
    // Pick the highest-friction pipe ON THE WORST PATH that can still grow.
    const candidates = current.worstPath
      .map((seg) => ({ seg, solid: solidForEdge(working, seg.edge) }))
      .filter((c) => c.solid && nextSizeUp(c.solid.diameterIn) != null)
      .sort((a, b) => b.seg.frictionPsi - a.seg.frictionPsi);
    if (!candidates.length) break; // nothing left to grow
    const pick = candidates[0];
    const from = pick.solid.diameterIn;
    const to = nextSizeUp(from);
    pick.solid.diameterIn = to;
    upsized.push({
      edge: pick.seg.edge,
      name: pick.solid.name || `pipe-${pick.seg.edge}`,
      fromDiameterIn: round(from),
      toDiameterIn: round(to),
      atIteration: iter + 1,
    });
    current = solveNetwork(working, opts);
    iter += 1;
  }

  return {
    base,
    final: current,
    upsized,
    iterations: iter,
    met: !!current.demandMet,
  };
}

/** Clone a cadModel with copies of every pipe solid (so diameter edits are local). */
function cloneModelPipes(cadModel) {
  const solids = (cadModel && Array.isArray(cadModel.solids)) ? cadModel.solids : [];
  return {
    ...cadModel,
    solids: solids.map((s) => (s && s.kind === 'pipe' ? { ...s } : s)),
  };
}

/** Find the cloned pipe solid corresponding to an edge index in a fresh graph. */
function solidForEdge(model, edgeIdx) {
  const g = buildGraph(model);
  const e = g.edges[edgeIdx];
  return e ? e.solid : null;
}

function round(n) {
  return Math.round((Number(n) + Number.EPSILON) * 1000) / 1000;
}
function round6(n) {
  return Math.round((Number(n) + Number.EPSILON) * 1e6) / 1e6;
}
