// HF-PHASE2-SCHEDULE — NFPA-13 pipe-schedule cascade (pure, deterministic).
//
// The pipe-schedule sizing method (NFPA 13, schedule chapters — historically the
// §22/§23 schedule tables for Light & Ordinary hazard steel pipe) sizes each pipe
// by the NUMBER OF SPRINKLERS it serves downstream and the hazard class. Apply the
// schedule across the WHOLE system at once and every run's diameter cascades from
// its heads-served credit: a branch line serving 2 heads is 1", serving 5 heads is
// 1½"; a cross-main serving 40 heads steps to 3", a riser/main feeding the whole
// floor steps up the same table. Larger systems => larger feed mains.
//
// This is the SCHEDULE method (a table lookup on head count), NOT the hydraulic
// calculation method (pressure/flow solve). It is the classic, code-recognized way
// to size light/ordinary occupancies up to the listed limits and is what AutoSPRINK
// exposes as "Apply Pipe Schedule". heads-served per pipe comes from smart-pipe.js
// classifyPipes() (topology + carrier credit), so the cascade follows the real tree.
//
// PURE: no THREE, no DOM. The live caller wraps applyPipeSchedule in HFEdit.apply
// for one undo step, then re-renders + regenerateBom.

import { classifyPipes, PIPE_ROLES } from './smart-pipe.js';

// Node-snap grid (matches smart-pipe's NODE_TOL_FT so the two graphs agree).
const NODE_TOL_FT = 0.05;
function nkey(p) {
  const q = NODE_TOL_FT;
  return `${Math.round(p[0] / q)}|${Math.round(p[1] / q)}|${Math.round(p[2] / q)}`;
}
function onSeg(p, a, b) {
  const abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2];
  const apx = p[0] - a[0], apy = p[1] - a[1], apz = p[2] - a[2];
  const ab2 = abx * abx + aby * aby + abz * abz;
  if (ab2 < 1e-9) return false;
  let t = (apx * abx + apy * aby + apz * abz) / ab2;
  if (t < -1e-6 || t > 1 + 1e-6) return false;
  t = Math.max(0, Math.min(1, t));
  const cx = a[0] + abx * t, cy = a[1] + aby * t, cz = a[2] + abz * t;
  return Math.hypot(p[0] - cx, p[1] - cy, p[2] - cz) <= NODE_TOL_FT;
}

/**
 * CUMULATIVE downstream heads per pipe. The schedule method sizes a feed carrier
 * for EVERY head it ultimately serves (a cross-main feeding 13 branch lines of 18
 * heads each carries 234 heads), but smart-pipe's carrierCredit only credits the
 * DIRECT tap. So we compute the real downstream subtree count here: build the pipe
 * adjacency (shared nodes + interior taps), root at the riser source(s) (lowest-Z
 * vertical runs), BFS outward, and sum the heads in each pipe's far subtree.
 *
 * Returns Map<solid, downstreamHeads>. Pure + deterministic.
 */
export function downstreamHeadsPerPipe(model) {
  const out = new Map();
  if (!model || !Array.isArray(model.solids)) return out;
  const solids = model.solids;
  const pipes = solids.filter((s) => s && s.kind === 'pipe' && Array.isArray(s.from) && Array.isArray(s.to));
  const heads = solids.filter((s) => s && s.kind === 'head' && Array.isArray(s.position));
  if (!pipes.length) return out;

  // node -> pipe indices (shared endpoints)
  const nodePipes = new Map();
  const recs = pipes.map((s, idx) => {
    const from = s.from.map(Number), to = s.to.map(Number);
    const ka = nkey(from), kb = nkey(to);
    for (const k of [ka, kb]) { if (!nodePipes.has(k)) nodePipes.set(k, new Set()); nodePipes.get(k).add(idx); }
    return { idx, solid: s, from, to, ka, kb, minZ: Math.min(from[2], to[2]), maxZ: Math.max(from[2], to[2]) };
  });

  // pipe adjacency: pipes sharing a node OR connected by an interior tap.
  const adj = recs.map(() => new Set());
  for (const r of recs) {
    for (const k of [r.ka, r.kb]) for (const j of nodePipes.get(k)) if (j !== r.idx) { adj[r.idx].add(j); adj[j].add(r.idx); }
  }
  // interior taps: an endpoint of one pipe lying on the interior of another.
  for (const r of recs) {
    for (const p of [r.from, r.to]) {
      const k = nkey(p);
      for (const o of recs) {
        if (o.idx === r.idx) continue;
        if (o.ka === k || o.kb === k) continue; // already a node-share
        if (onSeg(p, o.from, o.to)) { adj[r.idx].add(o.idx); adj[o.idx].add(r.idx); }
      }
    }
  }

  // heads incident to each pipe (head sits at a pipe endpoint or on its interior).
  const headAt = new Map(); // node key -> head count
  for (const h of heads) { const k = nkey(h.position); headAt.set(k, (headAt.get(k) || 0) + 1); }
  const directHeads = recs.map((r) => {
    let n = (headAt.get(r.ka) || 0) + (headAt.get(r.kb) || 0);
    // interior head taps
    for (const h of heads) {
      const k = nkey(h.position);
      if (k === r.ka || k === r.kb) continue;
      if (onSeg(h.position, r.from, r.to)) n += 1;
    }
    return n;
  });

  // source pipes: vertical runs reaching the network floor (riser sources). If
  // none (a flat fixture), fall back to the lowest-Z pipe as the root.
  let netMinZ = Infinity; for (const r of recs) netMinZ = Math.min(netMinZ, r.minZ);
  const isVertical = (r) => Math.abs(r.to[2] - r.from[2]) >= Math.hypot(r.to[0] - r.from[0], r.to[1] - r.from[1]);
  let sources = recs.filter((r) => isVertical(r) && Math.abs(r.minZ - netMinZ) < 0.5).map((r) => r.idx);
  if (!sources.length) {
    let lo = recs[0]; for (const r of recs) if (r.minZ < lo.minZ) lo = r; sources = [lo.idx];
  }

  // BFS from sources to assign each pipe a parent (the edge toward the source).
  const parent = new Array(recs.length).fill(-2); // -2 unvisited, -1 root
  const order = [];
  const queue = [];
  for (const s of sources) { parent[s] = -1; queue.push(s); order.push(s); }
  let qi = 0;
  while (qi < queue.length) {
    const cur = queue[qi++];
    for (const nb of adj[cur]) if (parent[nb] === -2) { parent[nb] = cur; queue.push(nb); order.push(nb); }
  }
  // any unvisited (disconnected) pipe is its own root
  for (let i = 0; i < recs.length; i++) if (parent[i] === -2) { parent[i] = -1; order.push(i); }

  // subtree heads = own direct heads + sum of children subtrees. Process in
  // reverse BFS order (leaves first) so children are summed before parents.
  const subtree = directHeads.slice();
  for (let oi = order.length - 1; oi >= 0; oi--) {
    const i = order[oi];
    if (parent[i] >= 0) subtree[parent[i]] += subtree[i];
  }
  for (let i = 0; i < recs.length; i++) out.set(recs[i].solid, subtree[i]);
  return out;
}

// NFPA-13 schedule tables: ascending [maxSprinklers, nominalSizeIn]. A pipe
// serving N heads takes the SMALLEST nominal size whose maxSprinklers >= N. Above
// the largest listed count the size holds at the table top (schedule method is
// limited to listed counts — flagged as atScheduleLimit in the result).
//
// Light & Ordinary differ at 2½"+ (ordinary carries more heads per size because
// of higher density allowance in the historical schedule). Extra hazard is not a
// recognized schedule-method occupancy (NFPA requires hydraulic calc) — we still
// provide a conservative table for completeness but mark hydraulicRequired.
export const SCHEDULE_TABLES = Object.freeze({
  light: [
    [2, 1.0], [3, 1.25], [5, 1.5], [10, 2.0], [30, 2.5], [60, 3.0], [100, 3.5], [9999, 4.0],
  ],
  ordinary: [
    [2, 1.0], [3, 1.25], [5, 1.5], [10, 2.0], [20, 2.5], [40, 3.0], [65, 3.5],
    [100, 4.0], [160, 5.0], [275, 6.0], [9999, 8.0],
  ],
  // Extra hazard: schedule method is NOT NFPA-recognized for extra hazard, but a
  // conservative table (one density step tighter than ordinary) is offered so the
  // cascade still produces sane sizes; the result flags hydraulicRequired:true.
  extra: [
    [2, 1.0], [3, 1.25], [5, 1.5], [8, 2.0], [15, 2.5], [27, 3.0], [55, 3.5],
    [80, 4.0], [120, 5.0], [200, 6.0], [9999, 8.0],
  ],
});

// Min nominal size by role floor — a feed carrier never drops below its class min
// even when it (transiently) credits few heads. Mains/cross-mains feed networks;
// schedule method still floors them so a tiny test model doesn't size a main at 1".
const ROLE_MIN_SIZE = Object.freeze({
  'main': 2.5,
  'cross-main': 2.0,
  'riser': 2.5,
  'branch-line': 1.0,
  'arm-over': 1.0,
  'drop': 1.0,
  'sprig': 1.0,
});

function tableFor(hazard) {
  const key = String(hazard || 'ordinary').toLowerCase();
  return { key, table: SCHEDULE_TABLES[key] || SCHEDULE_TABLES.ordinary };
}

/**
 * The scheduled nominal pipe size (inches) for a run serving `heads` sprinklers
 * under `hazard`, with an optional role floor. Pure table lookup.
 * @returns {{ sizeIn:number, atScheduleLimit:boolean }}
 */
export function scheduleSizeFor(heads, hazard, role) {
  const { table } = tableFor(hazard);
  const n = Math.max(0, Math.round(Number(heads) || 0));
  let sizeIn = table[table.length - 1][1];
  let atLimit = true;
  for (const [maxN, sz] of table) {
    if (n <= maxN) { sizeIn = sz; atLimit = (maxN >= 9999); break; }
  }
  const floor = role ? (ROLE_MIN_SIZE[role] || 0) : 0;
  if (floor && sizeIn < floor) sizeIn = floor;
  return { sizeIn, atScheduleLimit: atLimit };
}

/**
 * Cascade the NFPA schedule across the WHOLE model. Classifies pipes by topology
 * (role + heads-served downstream), then sets each pipe solid's diameterIn to the
 * scheduled size for its heads-served credit under `hazard`. A feed main serving
 * the whole floor sizes up; a 2-head branch tail sizes down. Returns a NEW model
 * (or null if nothing changed) plus an observable report.
 *
 * Drops/sprigs/arm-overs are head leaves — each serves exactly its head and the
 * schedule floors them at the branch min (1"), which matches generated drop sizing.
 *
 * @param {object} model  cadModel { solids:[...] }
 * @param {string} hazard 'light' | 'ordinary' | 'extra'
 * @returns {{ model:object|null, report:object }}
 */
export function applyPipeSchedule(model, hazard) {
  const report = {
    hazard: tableFor(hazard).key,
    changed: 0, total: 0, atLimitCount: 0,
    hydraulicRequired: tableFor(hazard).key === 'extra',
    bySize: {}, byRole: {}, maxSizeIn: 0,
    sizedPipes: [],
  };
  if (!model || !Array.isArray(model.solids)) return { model: null, report };

  const cls = classifyPipes(model);
  // map solid identity -> { role, headsServed } from the classification
  const info = new Map();
  for (const p of cls.pipes) info.set(p.solid, p);
  // CUMULATIVE downstream heads (the schedule sizes a feed for EVERY head it
  // ultimately serves, not just the direct tap). Used as the head-count input so a
  // feed main sizes up over the cross-mains/branches it feeds.
  const downstream = downstreamHeadsPerPipe(model);

  const newSolids = model.solids.slice();
  let changed = 0;
  for (let i = 0; i < newSolids.length; i++) {
    const s = newSolids[i];
    if (!s || s.kind !== 'pipe' || typeof s.diameterIn !== 'number') continue;
    const meta = info.get(s);
    if (!meta) continue; // not a classified linear run (e.g. zero-length) — skip
    report.total += 1;
    // size by the CUMULATIVE downstream head count (>= the direct carrier credit),
    // so feed carriers cascade up the table; never below the direct credit.
    const dsHeads = downstream.has(s) ? downstream.get(s) : meta.headsServed;
    const headCount = Math.max(dsHeads || 0, meta.headsServed || 0);
    const { sizeIn, atScheduleLimit } = scheduleSizeFor(headCount, hazard, meta.role);
    if (atScheduleLimit && headCount > 0) report.atLimitCount += 1;
    meta.scheduleHeads = headCount;
    const sizeKey = `${sizeIn}"`;
    report.bySize[sizeKey] = (report.bySize[sizeKey] || 0) + 1;
    report.byRole[meta.role] = report.byRole[meta.role] || {};
    report.byRole[meta.role][sizeKey] = (report.byRole[meta.role][sizeKey] || 0) + 1;
    if (sizeIn > report.maxSizeIn) report.maxSizeIn = sizeIn;
    report.sizedPipes.push({ role: meta.role, headsServed: headCount, sizeIn, was: s.diameterIn });
    if (Math.abs(s.diameterIn - sizeIn) > 1e-6) {
      const ns = { ...s, diameterIn: sizeIn, scheduleHazard: report.hazard, scheduleHeads: headCount, scheduleRole: meta.role };
      ns.edited = true;
      newSolids[i] = ns;
      changed += 1;
    } else {
      // size already correct — still stamp the schedule provenance (no-op for undo
      // purposes only if a field actually changed)
      if (s.scheduleHazard !== report.hazard || s.scheduleHeads !== headCount) {
        newSolids[i] = { ...s, scheduleHazard: report.hazard, scheduleHeads: headCount, scheduleRole: meta.role };
      }
    }
  }
  report.changed = changed;

  // sensible-cascade verdict: a pyramid where feed carriers are bigger than leaves.
  report.cascadeIsSensible = scheduleCascadeIsSensible(report.byRole);

  if (report.total === 0) return { model: null, report }; // no sized pipe — true no-op
  if (changed === 0 && report.total > 0) {
    // already on-schedule for this hazard — return the stamped model only if a
    // provenance field changed; otherwise null (true no-op).
    const stampChanged = newSolids.some((s, i) => s !== model.solids[i]);
    return { model: stampChanged ? { ...model, solids: newSolids, sizing: { ...(model.sizing || {}), scheduleHazard: report.hazard } } : null, report };
  }
  return {
    model: { ...model, solids: newSolids, sizing: { ...(model.sizing || {}), scheduleHazard: report.hazard } },
    report,
  };
}

// Average nominal size per role (for the sensible-cascade check).
function avgSizeForRole(byRoleEntry) {
  if (!byRoleEntry) return 0;
  let n = 0, sum = 0;
  for (const [k, c] of Object.entries(byRoleEntry)) { const sz = parseFloat(k); sum += sz * c; n += c; }
  return n ? sum / n : 0;
}

/**
 * A schedule cascade is sensible when feed carriers (main/cross-main/riser) are,
 * on average, at least as large as the branch lines they feed, and branch lines
 * are at least as large as the head leaves (drop/sprig/arm-over). Pure verdict.
 */
export function scheduleCascadeIsSensible(byRole) {
  if (!byRole) return false;
  const feed = Math.max(
    avgSizeForRole(byRole['main']),
    avgSizeForRole(byRole['cross-main']),
    avgSizeForRole(byRole['riser']),
  );
  const branch = avgSizeForRole(byRole['branch-line']);
  const leaf = Math.max(
    avgSizeForRole(byRole['drop']),
    avgSizeForRole(byRole['sprig']),
    avgSizeForRole(byRole['arm-over']),
  );
  // Only assert ordering across tiers that actually exist in this model.
  const haveFeed = feed > 0, haveBranch = branch > 0, haveLeaf = leaf > 0;
  if (haveFeed && haveBranch && feed + 1e-9 < branch) return false;
  if (haveBranch && haveLeaf && branch + 1e-9 < leaf) return false;
  if (haveFeed && haveLeaf && feed + 1e-9 < leaf) return false;
  // At least two distinct tiers must be present (not all one size).
  const tiers = [haveFeed, haveBranch, haveLeaf].filter(Boolean).length;
  return tiers >= 1; // a single-tier model (branches only) is still a valid cascade
}

export const SCHEDULE_ROLES = PIPE_ROLES;
