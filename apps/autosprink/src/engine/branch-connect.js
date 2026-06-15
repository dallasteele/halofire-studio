/**
 * HaloFire — Branch-line connectivity + tie-in repair (Phase 2, system intelligence).
 *
 * Smart Pipe (src/engine/smart-pipe.js) tells you what ROLE each run plays. This
 * module answers the orthogonal, load-bearing question a real sprinkler system
 * must satisfy: is the network actually CONNECTED — does every head trace, through
 * real pipe topology, all the way back to a riser/source?
 *
 * A flat list of pipes can name a "branch-line" and a "cross-main" yet leave a row
 * of heads stranded on a branch that never ties into anything (an ORPHAN). That is
 * a defect AutoSPRINK would never emit and a hydraulic solve cannot survive. So we:
 *
 *   1. Build the pipe graph: nodes are snapped endpoints; two runs are adjacent
 *      when they share a node OR one run's endpoint lies on the INTERIOR of the
 *      other (a drop taps a branch interior; a branch ties into a cross-main
 *      interior — shared-node lookup alone misses these interior taps).
 *   2. Identify SOURCES: vertical runs that reach the network's floor level
 *      (system risers). Water enters there.
 *   3. Flood-fill reachability from every source across the adjacency graph.
 *   4. A head is CONNECTED iff at least one pipe incident to its position is
 *      reachable from a source. Everything else is an ORPHAN.
 *   5. REPAIR: for each connected component of pipes that contains heads but no
 *      source, synthesize the missing tie-in — a branch/feed run from that
 *      component's carrier to the nearest reachable carrier (or to the nearest
 *      source), plus a tee fitting marker at the junction — then re-verify. Repair
 *      is geometric and deterministic: every added run is derived from existing
 *      coordinates, never invented, and the function re-floods to prove the orphan
 *      count actually dropped.
 *
 * Pure + deterministic: identical solids in -> identical analysis/repair out.
 * No DOM, no THREE, no I/O. Unit-tested in tests/branch-connect.test.js.
 */

// Endpoint snap tolerance (feet) — matches smart-pipe.js so the two modules agree
// on what counts as a shared node. Generated coords round to 0.01ft; 0.05 absorbs
// that without merging distinct joints.
const NODE_TOL_FT = 0.05;
const VERTICAL_RATIO = 2.0;

function key(p) {
  const q = NODE_TOL_FT;
  return `${Math.round(p[0] / q)}|${Math.round(p[1] / q)}|${Math.round(p[2] / q)}`;
}

function len3(a, b) {
  return Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
}

function orientationOf(from, to) {
  const dz = Math.abs(to[2] - from[2]);
  const dh = Math.hypot(to[0] - from[0], to[1] - from[1]);
  if (dz >= dh * VERTICAL_RATIO && dz > 1e-6) return 'vertical';
  return 'horizontal';
}

/** True iff point p lies on segment a->b within NODE_TOL_FT (endpoints included). */
function pointOnSegment(p, a, b) {
  const abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2];
  const apx = p[0] - a[0], apy = p[1] - a[1], apz = p[2] - a[2];
  const abLen2 = abx * abx + aby * aby + abz * abz;
  if (abLen2 < 1e-9) return false;
  let t = (apx * abx + apy * aby + apz * abz) / abLen2;
  if (t < -1e-6 || t > 1 + 1e-6) return false;
  t = Math.max(0, Math.min(1, t));
  const cx = a[0] + abx * t, cy = a[1] + aby * t, cz = a[2] + abz * t;
  return Math.hypot(p[0] - cx, p[1] - cy, p[2] - cz) <= NODE_TOL_FT;
}

/**
 * Build the pipe-graph records + adjacency. Adjacency is symmetric and includes
 * interior taps (an endpoint of one run lying on the body of another).
 *
 * @returns {{
 *   recs: Array, adj: Array<Set<number>>, nodes: Map,
 *   headAt: Map<string, Array>, networkMinZ: number,
 * }}
 */
function buildGraph(pipes, heads) {
  const nodes = new Map(); // node key -> { pipeIdx:Set, pt }
  const headAt = new Map(); // node key -> [head solids]
  for (const h of heads) {
    const k = key(h.position);
    if (!headAt.has(k)) headAt.set(k, []);
    headAt.get(k).push(h);
  }

  const recs = pipes.map((s, idx) => {
    const from = s.from.map(Number);
    const to = s.to.map(Number);
    const ka = key(from);
    const kb = key(to);
    if (!nodes.has(ka)) nodes.set(ka, { pipeIdx: new Set(), pt: from });
    if (!nodes.has(kb)) nodes.set(kb, { pipeIdx: new Set(), pt: to });
    nodes.get(ka).pipeIdx.add(idx);
    nodes.get(kb).pipeIdx.add(idx);
    return {
      idx, solid: s, from, to, ka, kb,
      length: len3(from, to),
      orientation: orientationOf(from, to),
      minZ: Math.min(from[2], to[2]),
      maxZ: Math.max(from[2], to[2]),
      diameterIn: Number(s.diameterIn) || 0,
    };
  });

  let networkMinZ = Infinity;
  for (const r of recs) networkMinZ = Math.min(networkMinZ, r.minZ);

  // Adjacency: shared node first (cheap), then interior taps.
  const adj = recs.map(() => new Set());
  for (const [, node] of nodes) {
    const idxs = [...node.pipeIdx];
    for (let i = 0; i < idxs.length; i += 1) {
      for (let j = i + 1; j < idxs.length; j += 1) {
        adj[idxs[i]].add(idxs[j]);
        adj[idxs[j]].add(idxs[i]);
      }
    }
  }
  // Interior taps: endpoint of run a lies on the body of run b (not at b's nodes).
  for (let a = 0; a < recs.length; a += 1) {
    const ra = recs[a];
    for (let b = 0; b < recs.length; b += 1) {
      if (a === b) continue;
      const rb = recs[b];
      // a's endpoints already shared as nodes are handled above; only test the
      // off-node interior case.
      for (const [pk, pt] of [[ra.ka, ra.from], [ra.kb, ra.to]]) {
        if (pk === rb.ka || pk === rb.kb) continue;
        if (pointOnSegment(pt, rb.from, rb.to)) { adj[a].add(b); adj[b].add(a); }
      }
    }
  }

  return { recs, adj, nodes, headAt, networkMinZ };
}

/** Indices of source runs: vertical runs whose low end reaches the floor level. */
function findSources(recs, networkMinZ) {
  const sources = [];
  for (const r of recs) {
    if (r.orientation === 'vertical' && r.minZ <= networkMinZ + NODE_TOL_FT) sources.push(r.idx);
  }
  return sources;
}

/** Flood-fill: set of pipe indices reachable from any seed across adj. */
function flood(seeds, adj) {
  const seen = new Set(seeds);
  const stack = [...seeds];
  while (stack.length) {
    const i = stack.pop();
    for (const j of adj[i]) if (!seen.has(j)) { seen.add(j); stack.push(j); }
  }
  return seen;
}

/**
 * Analyze connectivity of a CAD model: how many branch-lines, how many heads
 * trace back to a riser source, and how many are orphaned.
 *
 * Branch-line count here is geometric-and-honest: a horizontal carrier that has
 * at least one head hanging off it (via a drop/arm-over or a head at its own
 * endpoint). It does NOT depend on Smart Pipe's labels — connectivity must be
 * checkable on a raw model.
 *
 * @param {{solids:Array}} cadModel
 * @returns {{
 *   branchCount:number, headsConnected:number, orphanHeads:number,
 *   totalHeads:number, riserCount:number, orphanHeadNames:Array<string>,
 *   componentCount:number, sourcedComponentCount:number,
 * }}
 */
export function analyzeConnectivity(cadModel) {
  const solids = (cadModel && Array.isArray(cadModel.solids)) ? cadModel.solids : [];
  const pipes = solids.filter((s) => s && s.kind === 'pipe' && Array.isArray(s.from) && Array.isArray(s.to));
  const heads = solids.filter((s) => s && s.kind === 'head' && Array.isArray(s.position));

  if (pipes.length === 0) {
    return {
      branchCount: 0, headsConnected: 0, orphanHeads: heads.length,
      totalHeads: heads.length, riserCount: 0,
      orphanHeadNames: heads.map((h) => h.name || 'head'),
      componentCount: 0, sourcedComponentCount: 0,
    };
  }

  const { recs, adj, nodes, headAt, networkMinZ } = buildGraph(pipes, heads);
  const sources = findSources(recs, networkMinZ);
  const reachable = flood(sources, adj);

  // A head is connected iff a pipe incident to its node is reachable. "Incident"
  // = shares the head's node, or the head's position lies on a run's interior.
  let headsConnected = 0;
  const orphanHeadNames = [];
  for (const h of heads) {
    const hk = key(h.position);
    let connected = false;
    const node = nodes.get(hk);
    if (node) {
      for (const i of node.pipeIdx) if (reachable.has(i)) { connected = true; break; }
    }
    if (!connected) {
      for (const r of recs) {
        if (!reachable.has(r.idx)) continue;
        if (pointOnSegment(h.position.map(Number), r.from, r.to)) { connected = true; break; }
      }
    }
    if (connected) headsConnected += 1; else orphanHeadNames.push(h.name || 'head');
  }

  // Branch-line count: horizontal carriers that serve >=1 head. A head is served
  // by a horizontal run when a drop/leaf off it reaches the head, or a head sits
  // at the run's own node, or the head's position lies on the run.
  let branchCount = 0;
  const headNodeKeys = new Set([...headAt.keys()]);
  for (const r of recs) {
    if (r.orientation !== 'horizontal') continue;
    let serves = false;
    // head at this run's own endpoints
    if (headNodeKeys.has(r.ka) || headNodeKeys.has(r.kb)) serves = true;
    if (!serves) {
      // a vertical leaf (drop/arm) hangs off this run and ends at a head
      for (const j of adj[r.idx]) {
        const o = recs[j];
        if (o.orientation === 'vertical' && (headNodeKeys.has(o.ka) || headNodeKeys.has(o.kb))) { serves = true; break; }
      }
    }
    if (serves) branchCount += 1;
  }

  // Connected-component bookkeeping (for repair + diagnostics): how many pipe
  // components exist, and how many contain a source.
  const compId = new Array(recs.length).fill(-1);
  let nComp = 0;
  for (let s = 0; s < recs.length; s += 1) {
    if (compId[s] !== -1) continue;
    const comp = flood([s], adj);
    for (const i of comp) compId[i] = nComp;
    nComp += 1;
  }
  const sourcedComps = new Set();
  for (const i of sources) sourcedComps.add(compId[i]);

  return {
    branchCount,
    headsConnected,
    orphanHeads: heads.length - headsConnected,
    totalHeads: heads.length,
    riserCount: sources.length,
    orphanHeadNames,
    componentCount: nComp,
    sourcedComponentCount: sourcedComps.size,
  };
}

/**
 * Repair connectivity: connect orphaned head-bearing pipe components into the
 * sourced network by synthesizing the missing tie-in run + a tee fitting marker.
 *
 * Strategy (deterministic, geometry-derived):
 *   - Flood from sources; any pipe component with heads but unreachable is orphaned.
 *   - For each orphaned component, pick its carrier node closest (3D) to any
 *     reachable node, and add a straight tie-in pipe between those two points,
 *     sized to the orphan carrier's diameter, plus a 'fitting_tee' marker at the
 *     reachable end. This splices the orphan into the live network.
 *   - Re-flood and recompute. The added runs become reachable, so orphan heads on
 *     those components flip to connected.
 *
 * Mutates and returns the model's solids (adds pipes/components). Idempotent: a
 * fully-connected model gets zero additions.
 *
 * @param {{solids:Array}} cadModel
 * @returns {{ model:object, added:Array, analysisBefore:object, analysisAfter:object }}
 */
export function repairConnectivity(cadModel) {
  const analysisBefore = analyzeConnectivity(cadModel);
  const solids = (cadModel && Array.isArray(cadModel.solids)) ? cadModel.solids : [];
  const added = [];

  // Re-build the graph to find orphaned head-bearing components and the set of
  // reachable nodes to tie them to.
  const pipes = solids.filter((s) => s && s.kind === 'pipe' && Array.isArray(s.from) && Array.isArray(s.to));
  const heads = solids.filter((s) => s && s.kind === 'head' && Array.isArray(s.position));
  if (pipes.length === 0) {
    return { model: cadModel, added, analysisBefore, analysisAfter: analysisBefore };
  }

  // Iterate: each pass connects one orphan component, then re-floods (a newly
  // connected component can become the tie target for the next). Bounded by the
  // component count so it always terminates.
  let guard = pipes.length + heads.length + 4;
  for (;;) {
    if (guard-- <= 0) break;
    const cur = solids.filter((s) => s && s.kind === 'pipe' && Array.isArray(s.from) && Array.isArray(s.to));
    const { recs, adj, networkMinZ } = buildGraph(cur, heads);
    const sources = findSources(recs, networkMinZ);
    if (sources.length === 0) break; // no source to tie into — cannot repair
    const reachable = flood(sources, adj);

    // Component map.
    const compId = new Array(recs.length).fill(-1);
    let nComp = 0;
    for (let s = 0; s < recs.length; s += 1) {
      if (compId[s] !== -1) continue;
      for (const i of flood([s], adj)) compId[i] = nComp;
      nComp += 1;
    }
    // Reachable component ids.
    const reachableComps = new Set();
    for (const i of reachable) reachableComps.add(compId[i]);

    // Which heads sit on which component (by incident pipe).
    const headComp = (h) => {
      const hp = h.position.map(Number);
      for (const r of recs) if (pointOnSegment(hp, r.from, r.to)) return compId[r.idx];
      return -1;
    };
    // Orphan components that actually contain heads (don't bother wiring empty stubs).
    const orphanCompsWithHeads = new Set();
    for (const h of heads) {
      const c = headComp(h);
      if (c >= 0 && !reachableComps.has(c)) orphanCompsWithHeads.add(c);
    }
    if (orphanCompsWithHeads.size === 0) break; // done

    // Pick the orphan component closest to the reachable network and tie it in.
    const reachableNodePts = [];
    for (const r of recs) {
      if (!reachable.has(r.idx)) continue;
      reachableNodePts.push(r.from, r.to);
    }
    let best = null; // { fromPt (orphan node), toPt (reachable node), dia }
    for (const oc of orphanCompsWithHeads) {
      for (const r of recs) {
        if (compId[r.idx] !== oc) continue;
        for (const op of [r.from, r.to]) {
          for (const rp of reachableNodePts) {
            const d = len3(op, rp);
            if (!best || d < best.d) best = { d, fromPt: op, toPt: rp, dia: r.diameterIn || 1.25 };
          }
        }
      }
    }
    if (!best) break;

    // Synthesize the tie-in run + a tee fitting marker at the live (reachable) end.
    const tie = {
      kind: 'pipe', name: `auto-tiein-${added.length}`, layer: 'MAIN', role: 'main-tie',
      from: [round(best.fromPt[0]), round(best.fromPt[1]), round(best.fromPt[2])],
      to: [round(best.toPt[0]), round(best.toPt[1]), round(best.toPt[2])],
      diameterIn: best.dia, autoGenerated: true,
    };
    solids.push(tie);
    added.push(tie);
    const tee = {
      kind: 'component', name: `auto-tee-${added.length}`, layer: 'COMPONENTS',
      componentKey: 'fitting_tee', category: 'fitting',
      position: [round(best.toPt[0]), round(best.toPt[1]), round(best.toPt[2])],
      autoGenerated: true,
    };
    solids.push(tee);
    added.push(tee);
  }

  const analysisAfter = analyzeConnectivity(cadModel);
  return { model: cadModel, added, analysisBefore, analysisAfter };
}

function round(n) {
  return Math.round((n + Number.EPSILON) * 1000) / 1000;
}
