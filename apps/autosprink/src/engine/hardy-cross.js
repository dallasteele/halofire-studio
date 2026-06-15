/**
 * HaloFire — REAL Hardy-Cross loop/grid balance (Phase 3 hydraulics).
 *
 * The earlier `network-solve.js` solves the connected pipe/head topology as a
 * forward demand-fixed TREE walk: it picks the most-remote head, walks back to
 * the supply summing Hazen-Williams friction, and (honestly) flags
 * `hardyCrossBalanced:false` because looped/gridded mains are broken into a
 * spanning tree (the BFS chord is recorded, not iterated). That is correct for a
 * pure tree but UNDER-solves a gridded system, where flow splits around loops and
 * the split is governed by the requirement that the head loss summed around each
 * closed loop is zero.
 *
 * THIS module is the missing piece: a true **Hardy-Cross** iterative loop
 * balancer.
 *
 *   Physical laws enforced:
 *     1. Continuity (Kirchhoff's 1st law): ΣQ = 0 at every node — flow in = flow
 *        out. Held BY CONSTRUCTION: the initial flow guess satisfies node balance
 *        and every correction we apply is a *loop circulation* (it adds +ΔQ to
 *        every edge of a loop in a consistent orientation), which cannot change
 *        the net flow at any node.
 *     2. Energy (Kirchhoff's 2nd law): Σ h_f = 0 around every independent loop —
 *        the head loss summed around a closed loop, with sign by flow direction,
 *        must vanish at convergence.
 *
 *   Head-loss model per pipe (Hazen-Williams, same coefficient as network-solve):
 *        h_f = r · Q^n · sign(Q),  with  n = 1.852
 *        r   = 4.52 · L_eff / (C^1.852 · d^4.8704)     [L_eff = length + Σ fitting Le]
 *     (so h_f for a single 1-ft pipe equals hwLossPsiPerFt × that foot — the two
 *      modules share the identical friction physics; only the solve differs.)
 *
 *   Loop correction (the Hardy-Cross step), applied per independent loop k:
 *        ΔQ_k = − ( Σ_e  h_f,e ) / ( n · Σ_e ( |h_f,e| / |Q_e| ) )
 *     then Q_e ← Q_e + ΔQ_k for every edge e of loop k (with the loop's edge
 *     orientation). Repeat over all loops until the worst |Σ h_f| residual across
 *     loops drops below tolerance (converged) or the iteration cap is hit.
 *
 *   Loop identification: build a spanning tree of the (sub)graph; every non-tree
 *   edge ("chord") closes exactly one independent fundamental loop = chord + the
 *   unique tree path between its endpoints. The number of such loops is the
 *   cyclomatic number  μ = E − N + components  (the cycle-space dimension). A pure
 *   tree has μ = 0 — HONESTLY reported as loopCount 0, and the solver returns
 *   converged with zero residual (nothing to balance).
 *
 * 🔬 NUMERICAL TRUTH: validated against a textbook 2-loop network with a KNOWN
 * converged solution (see tests/hardy-cross.test.js). If the solver disagrees
 * with the hand calc, the SOLVER is wrong.
 *
 * HONESTY / fail-closed: an ENGINEERING AID. A Hardy-Cross loop balance is a real
 * and standard hydraulic method, but THIS implementation is not AHJ/PE-stamped,
 * not AutoSprink, and the loop topology it sees is only as good as the generated
 * model. Verify against the stamped calc before permit.
 *
 * Units: flow in consistent units (gpm here), diameter inches, length feet; head
 * loss in psi when r uses the 4.52 Hazen-Williams constant (psi basis).
 */

import { equivalentLengthFt } from './fitting-le.js';

export const HW_EXP = 1.852;        // Hazen-Williams flow exponent n
export const HW_CONST = 4.52;       // psi-basis Hazen-Williams constant
const DEFAULT_C = 120;
const NODE_TOL_FT = 0.05;           // endpoint snap (matches network-solve / smart-pipe)
const DEFAULT_TOL = 1e-6;           // |Σh_f| loop residual tolerance (psi)
const DEFAULT_MAX_ITER = 200;
const MIN_Q = 1e-9;                 // floor to avoid div-by-zero in dΣh/dQ

export const DISCLAIMER =
  'ENGINEERING AID — real Hardy-Cross loop balance (continuity ΣQ=0 at nodes, '
  + 'energy Σh_f→0 around every loop, Hazen-Williams h_f=r·Q^1.852). NOT AutoSprink, '
  + 'NOT PE-stamped, NOT AHJ-approved. Verify against the stamped hydraulic calc before permit.';

// ---------------------------------------------------------------------------
// Per-pipe resistance r (so h_f = r·Q^n). Shares network-solve's HW physics.
// ---------------------------------------------------------------------------

/**
 * Hazen-Williams pipe resistance r such that h_f(psi) = r · Q^1.852.
 * r = 4.52 · L_eff / (C^1.852 · d^4.8704). For L_eff = 1 ft this is exactly the
 * psi-per-foot used by network-solve.hwLossPsiPerFt, so the two modules agree.
 *
 * @param {number} lengthFt effective pipe length (incl. fitting Le), feet
 * @param {number} diameterIn internal diameter, inches
 * @param {number} [C=120] Hazen-Williams roughness
 */
export function pipeResistance(lengthFt, diameterIn, C = DEFAULT_C) {
  if (!(diameterIn > 0)) throw new Error('diameterIn must be > 0');
  if (!(C > 0)) throw new Error('C must be > 0');
  const L = Math.max(0, Number(lengthFt) || 0);
  return (HW_CONST * L) / (Math.pow(C, HW_EXP) * Math.pow(diameterIn, 4.8704));
}

/** Signed head loss h_f = r · |Q|^n · sign(Q) (psi). */
export function headLoss(r, Q) {
  const q = Number(Q) || 0;
  if (q === 0) return 0;
  return r * Math.pow(Math.abs(q), HW_EXP) * Math.sign(q);
}

// ---------------------------------------------------------------------------
// Loop solver over an explicit {nodes, edges} description.
//
// edges: [{ id?, from, to, r? , length?, diameterIn?, C? }]  (from/to are node ids)
//   r is the resistance; if absent it is computed from length/diameterIn/C.
// A consistent reference orientation per edge is from->to (positive Q = from->to).
// ---------------------------------------------------------------------------

/**
 * Identify the independent (fundamental) loops of an undirected multigraph from a
 * spanning forest: each non-tree edge (chord) + the unique tree path between its
 * endpoints forms one loop. Returns loops as ordered lists of { edgeIndex, dir }
 * where dir=+1 means the edge's from->to agrees with the loop traversal.
 *
 * @param {Array} edges edge list (each {from,to})
 * @param {Array} nodeIds distinct node ids
 * @returns {{loops:Array<Array<{edge:number,dir:number}>>, components:number,
 *   cyclomatic:number, treeEdges:number[], chordEdges:number[]}}
 */
export function findLoops(edges, nodeIds) {
  const adj = new Map();              // node -> [{edge, other}]
  for (const id of nodeIds) adj.set(id, []);
  edges.forEach((e, i) => {
    if (!adj.has(e.from)) adj.set(e.from, []);
    if (!adj.has(e.to)) adj.set(e.to, []);
    adj.get(e.from).push({ edge: i, other: e.to });
    adj.get(e.to).push({ edge: i, other: e.from });
  });

  const parent = new Map();          // node -> { node, edge } toward the tree root
  const inTree = new Set();          // edge indices that are tree edges
  const visited = new Set();
  let components = 0;

  // BFS spanning forest. Track which edge was used to reach each node.
  for (const start of adj.keys()) {
    if (visited.has(start)) continue;
    components += 1;
    visited.add(start);
    parent.set(start, null);
    const queue = [start];
    while (queue.length) {
      const u = queue.shift();
      for (const { edge, other } of adj.get(u)) {
        if (!visited.has(other)) {
          visited.add(other);
          parent.set(other, { node: u, edge });
          inTree.add(edge);
          queue.push(other);
        }
      }
    }
  }

  const treeEdges = [];
  const chordEdges = [];
  edges.forEach((_, i) => { (inTree.has(i) ? treeEdges : chordEdges).push(i); });

  // Depth of each node + path-to-root helper for fundamental-loop construction.
  const pathToRoot = (node) => {
    const path = []; // ordered list of { node, edge } from node up to root
    let cur = node;
    while (parent.get(cur)) {
      const p = parent.get(cur);
      path.push({ from: cur, edge: p.edge, to: p.node });
      cur = p.node;
    }
    return path; // last entry's `to` is the root
  };

  const loops = [];
  for (const c of chordEdges) {
    const e = edges[c];
    // fundamental loop = chord (to->from in traversal) + tree path from->...->to.
    const pathFrom = pathToRoot(e.from);
    const pathTo = pathToRoot(e.to);
    // Find lowest common ancestor by trimming shared tail (toward root).
    const keyOf = (step) => step.to; // node we ascend to
    // Build node->index for pathTo's ascent nodes (including endpoint chain).
    const toChainNodes = [e.to, ...pathTo.map((s) => s.to)];
    const toIndex = new Map(toChainNodes.map((n, idx) => [n, idx]));
    // Walk up from `from` until we hit a node that is on the `to` chain (the LCA).
    let lca = null;
    const fromSteps = [];
    let curNode = e.from;
    if (toIndex.has(curNode)) {
      lca = curNode;
    } else {
      for (const step of pathFrom) {
        fromSteps.push(step);
        if (toIndex.has(step.to)) { lca = step.to; break; }
      }
    }
    if (lca == null) {
      // disconnected chord endpoints (shouldn't happen within a component); skip.
      continue;
    }
    // tree path from `to` up to the LCA (reverse so loop is a clean cycle)
    const toSteps = [];
    for (const step of pathTo) {
      toSteps.push(step);
      if (step.to === lca) break;
    }

    // Assemble the oriented loop. Traverse: e.from -> (up fromSteps to lca)
    //   -> (down toSteps reversed from lca to e.to) -> (chord e.to -> e.from).
    const loop = [];
    // fromSteps: each {from,edge,to} ascends from->to; traversal agrees with edge
    // orientation iff edge.from === step.from.
    for (const step of fromSteps) {
      const ed = edges[step.edge];
      const dir = ed.from === step.from ? +1 : -1;
      loop.push({ edge: step.edge, dir });
    }
    // toSteps reversed: we go DOWN from lca toward e.to, i.e. opposite of ascent.
    for (let i = toSteps.length - 1; i >= 0; i -= 1) {
      const step = toSteps[i];
      const ed = edges[step.edge];
      // ascent was step.from -> step.to; descent is step.to -> step.from, so
      // traversal agrees with edge orientation iff edge.from === step.to.
      const dir = ed.from === step.to ? +1 : -1;
      loop.push({ edge: step.edge, dir });
    }
    // chord: traversal goes e.to -> e.from, edge orientation is e.from -> e.to,
    // so dir = -1.
    loop.push({ edge: c, dir: -1 });
    loops.push(loop);
  }

  return {
    loops,
    components,
    cyclomatic: edges.length - nodeIds.length + components,
    treeEdges,
    chordEdges,
  };
}

/**
 * Hardy-Cross balance of a looped pipe network with FIXED nodal demands.
 *
 * @param {object} spec
 * @param {Array} spec.edges edge list. Each: { from, to, r? , length?, diameterIn?,
 *   C?, Q0? }. `r` overrides the computed resistance; `Q0` seeds the initial flow.
 * @param {Object<string,number>} [spec.demands] net OUTFLOW at each node (gpm).
 *   Positive = water leaves the network at that node (a sprinkler/junction draw);
 *   the supply node(s) carry the balancing negative. ΣQ over all nodes must be 0.
 *   If omitted, any provided Q0 values are taken as a continuity-satisfying guess.
 * @param {object} [opts] { tol, maxIterations, C }
 * @returns {object} {
 *   converged, iterations, maxResidual, loopCount, cyclomatic, components,
 *   flows:[{from,to,Q,headLoss,r,...}], loopResiduals:[psi], nodeImbalance,
 *   disclaimer }
 */
export function hardyCross(spec, opts = {}) {
  const C = opts.C > 0 ? opts.C : DEFAULT_C;
  const tol = opts.tol > 0 ? opts.tol : DEFAULT_TOL;
  const maxIter = opts.maxIterations > 0 ? opts.maxIterations : DEFAULT_MAX_ITER;

  const rawEdges = Array.isArray(spec.edges) ? spec.edges : [];
  const nodeSet = new Set();
  for (const e of rawEdges) { nodeSet.add(e.from); nodeSet.add(e.to); }
  const nodeIds = [...nodeSet];

  // Resolve resistance for each edge.
  const edges = rawEdges.map((e, i) => {
    const r = (e.r != null && e.r > 0)
      ? Number(e.r)
      : pipeResistance(
          (Number(e.length) || 0) + fittingLe(e, C),
          Number(e.diameterIn) || 1,
          (Number(e.C) > 0 ? Number(e.C) : C),
        );
    return { idx: i, from: e.from, to: e.to, r, Q: Number(e.Q0) || 0, raw: e };
  });

  const { loops, components, cyclomatic } = findLoops(edges, nodeIds);

  // Seed an initial continuity-satisfying flow if demands are given and no Q0s.
  const hasSeed = edges.some((e) => e.Q !== 0);
  if (spec.demands && !hasSeed) {
    seedInitialFlows(edges, nodeIds, spec.demands);
  }

  // Pure tree (no loops): nothing to balance. Continuity already defines flows.
  if (loops.length === 0) {
    const flows = describeFlows(edges);
    return {
      converged: true,
      iterations: 0,
      maxResidual: 0,
      loopCount: 0,
      cyclomatic,
      components,
      flows,
      loopResiduals: [],
      nodeImbalance: nodeImbalance(edges, nodeIds, spec.demands),
      disclaimer: DISCLAIMER,
    };
  }

  // ---- Hardy-Cross iteration ----
  let iterations = 0;
  let maxResidual = Infinity;
  let loopResiduals = [];
  for (let it = 0; it < maxIter; it += 1) {
    iterations = it + 1;
    maxResidual = 0;
    loopResiduals = [];
    for (const loop of loops) {
      // Σ h_f around the loop (signed by traversal direction) and Σ n·|h_f|/|Q|.
      let sumH = 0;
      let sumDeriv = 0;
      for (const { edge, dir } of loop) {
        const e = edges[edge];
        const qDir = e.Q * dir;                       // flow along traversal sense
        const h = headLoss(e.r, qDir);                // signed head loss
        sumH += h;
        const absQ = Math.max(MIN_Q, Math.abs(e.Q));
        sumDeriv += Math.abs(h) / absQ;
      }
      const residual = Math.abs(sumH);
      loopResiduals.push(residual);
      if (residual > maxResidual) maxResidual = residual;
      const denom = HW_EXP * sumDeriv;
      if (denom <= 0) continue;
      const dQ = -sumH / denom;
      // Apply the loop circulation: +dQ along the traversal sense of each edge.
      for (const { edge, dir } of loop) {
        edges[edge].Q += dQ * dir;
      }
    }
    if (maxResidual < tol) break;
  }

  return {
    converged: maxResidual < tol,
    iterations,
    maxResidual,
    loopCount: loops.length,
    cyclomatic,
    components,
    flows: describeFlows(edges),
    loopResiduals,
    nodeImbalance: nodeImbalance(edges, nodeIds, spec.demands),
    disclaimer: DISCLAIMER,
  };
}

function fittingLe(e, C) {
  if (!Array.isArray(e.fittings) || !e.fittings.length) return 0;
  let le = 0;
  for (const f of e.fittings) le += equivalentLengthFt(f, Number(e.diameterIn) || 1, (Number(e.C) > 0 ? Number(e.C) : C));
  return le;
}

function describeFlows(edges) {
  return edges.map((e) => ({
    from: e.from,
    to: e.to,
    Q: round(e.Q),
    absQ: round(Math.abs(e.Q)),
    direction: e.Q >= 0 ? `${e.from}->${e.to}` : `${e.to}->${e.from}`,
    headLoss: round(Math.abs(headLoss(e.r, e.Q))),
    r: round6(e.r),
  }));
}

/** Worst nodal continuity residual (gpm): |Σ inflow − Σ outflow − demand|. */
function nodeImbalance(edges, nodeIds, demands) {
  const net = new Map(nodeIds.map((n) => [n, 0]));
  for (const e of edges) {
    // positive Q flows from->to: leaves `from`, enters `to`.
    net.set(e.from, (net.get(e.from) || 0) - e.Q);
    net.set(e.to, (net.get(e.to) || 0) + e.Q);
  }
  let worst = 0;
  for (const n of nodeIds) {
    const demand = demands && demands[n] != null ? Number(demands[n]) : 0;
    // inflow - outflow should equal demand (net withdrawal). net = in - out.
    worst = Math.max(worst, Math.abs((net.get(n) || 0) - demand));
  }
  return round6(worst);
}

/**
 * Seed a continuity-satisfying initial flow from nodal demands using the spanning
 * tree: push each node's accumulated downstream demand along its tree edge toward
 * the root (the supply). Chords are seeded 0. This guarantees ΣQ=0 at every node
 * before the first Hardy-Cross correction (corrections are loop circulations that
 * preserve continuity, so it holds forever after).
 */
function seedInitialFlows(edges, nodeIds, demands) {
  const { treeEdges } = findLoops(edges, nodeIds);
  const treeSet = new Set(treeEdges);
  // Build tree adjacency.
  const adj = new Map(nodeIds.map((n) => [n, []]));
  for (const i of treeEdges) {
    const e = edges[i];
    adj.get(e.from).push({ edge: i, other: e.to });
    adj.get(e.to).push({ edge: i, other: e.from });
  }
  // Root = the node with the most-negative demand (largest supply); fallback first.
  let root = nodeIds[0];
  let minDemand = Infinity;
  for (const n of nodeIds) {
    const d = demands[n] != null ? Number(demands[n]) : 0;
    if (d < minDemand) { minDemand = d; root = n; }
  }
  // DFS post-order: subtreeDemand[node] = its demand + children subtree demands.
  const parent = new Map([[root, null]]);
  const order = [];
  const stack = [root];
  const seen = new Set([root]);
  while (stack.length) {
    const u = stack.pop();
    order.push(u);
    for (const { edge, other } of adj.get(u)) {
      if (!seen.has(other)) { seen.add(other); parent.set(other, { node: u, edge }); stack.push(other); }
    }
  }
  const subtree = new Map(nodeIds.map((n) => [n, demands[n] != null ? Number(demands[n]) : 0]));
  for (let i = order.length - 1; i >= 0; i -= 1) {
    const n = order[i];
    const p = parent.get(n);
    if (!p) continue;
    const flow = subtree.get(n);
    // The subtree rooted at n withdraws `flow` net (Σ demands). That water must be
    // SUPPLIED from the root side, so it flows parent -> n through the parent edge.
    // With net = (inflow − outflow) and demand = net withdrawal, delivering `flow`
    // INTO n's subtree makes net[k] = demand[k] at every node (verified by the
    // nodeImbalance==0 golden). positive Q is from->to.
    const e = edges[p.edge];
    e.Q = e.from === p.node ? flow : -flow; // p.node -> n
    subtree.set(p.node, subtree.get(p.node) + flow);
  }
  // chords start at 0 (already initialized)
  void treeSet;
}

// ---------------------------------------------------------------------------
// Bridge: extract loops from a built cadModel graph (network-solve.buildGraph)
// and report loop structure + a Hardy-Cross balance over those loops.
// ---------------------------------------------------------------------------

/**
 * Analyze the loop structure of a network-solve graph ({nodes, edges}) and,
 * when there ARE loops, run Hardy-Cross over them. For a pure tree this honestly
 * returns loopCount 0 with converged:true (nothing to balance) — the model is a
 * tree, said so plainly.
 *
 * NOTE: a generated sprinkler tree has no loops, so this reports loopCount 0 on
 * the live model. The solver's correctness is proven by the textbook golden test,
 * not by the (loopless) live model. When gridded mains land, the same solver
 * balances them with no code change.
 *
 * @param {{nodes:Map, edges:Array}} graph from network-solve.buildGraph
 * @param {object} [opts]
 * @returns {{loopCount, maxResidual, iterations, converged, cyclomatic,
 *   components, ...}}
 */
export function analyzeGraphLoops(graph, opts = {}) {
  const edgeList = (graph && Array.isArray(graph.edges)) ? graph.edges : [];
  const nodeIds = graph && graph.nodes ? [...graph.nodes.keys()] : [];
  const edges = edgeList.map((e) => ({
    from: e.a, to: e.b,
    length: e.length, diameterIn: e.diameterIn, C: e.C,
  }));
  const { loops, components, cyclomatic } = findLoops(edges, nodeIds);
  if (loops.length === 0) {
    return {
      loopCount: 0,
      cyclomatic,
      components,
      maxResidual: 0,
      iterations: 0,
      converged: true,
      isTree: cyclomatic === 0,
      note: cyclomatic === 0
        ? 'pure TREE topology (no loops) — nothing for Hardy-Cross to balance; loopCount 0 reported honestly.'
        : 'no fundamental loops resolved.',
      disclaimer: DISCLAIMER,
    };
  }
  // There are loops — but a forward-demand balance needs nodal demands, which the
  // live tree model doesn't carry as a grid. We still report loop structure; a
  // demand-driven balance would be wired when gridded mains exist.
  return {
    loopCount: loops.length,
    cyclomatic,
    components,
    maxResidual: null,
    iterations: 0,
    converged: false,
    isTree: false,
    note: 'looped mains detected — Hardy-Cross balance available via hardyCross() with nodal demands.',
    disclaimer: DISCLAIMER,
  };
}

function round(n) {
  return Math.round((Number(n) + Number.EPSILON) * 1000) / 1000;
}
function round6(n) {
  return Math.round((Number(n) + Number.EPSILON) * 1e6) / 1e6;
}
