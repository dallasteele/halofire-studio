/**
 * HaloFire — Smart Pipe classification (Phase 2, system intelligence).
 *
 * Re-derives the TOPOLOGICAL ROLE of every pipe run in a sprinkler model from
 * pure geometry + connectivity, INDEPENDENTLY of whatever `role` string the
 * generator happened to stamp on the solid. This is the data foundation the BOM
 * and the hydraulic solve depend on: a pipe priced/sized as a "branch line" is a
 * very different part from a "cross main" or a "drop".
 *
 * The taxonomy (AutoSPRINK parity):
 *   riser       — vertical trunk from the source/floor up into the overhead main.
 *   main        — the largest horizontal feed trunk; feeds cross-mains (or the
 *                 cross-main directly when there is only one feed level).
 *   cross-main  — horizontal run that feeds MULTIPLE branch lines.
 *   branch-line — horizontal run that serves a ROW of heads (via drops/arm-overs).
 *   arm-over    — short horizontal offset feeding ONE head off a branch line.
 *   drop        — short vertical run DOWN to a pendent head.
 *   sprig       — short vertical run UP to an upright head.
 *
 * Inference signals (all topological / geometric — never the stored label):
 *   - node degree (how many runs share an endpoint)
 *   - orientation (vertical vs horizontal, and which horizontal axis)
 *   - run length (drops/arm-overs/sprigs are short; mains are long)
 *   - diameter hint (mains are larger than branch lines)
 *   - heads served (does the run terminate at / feed a head?)
 *   - feeds-what (a run feeding many branches is a cross-main; a run feeding
 *     many cross-mains is a main)
 *
 * Pure + deterministic: identical solids in -> identical classification out.
 * No DOM, no THREE, no I/O. Unit-tested in test/smart-pipe.test.js.
 */

export const PIPE_ROLES = Object.freeze([
  'riser', 'main', 'cross-main', 'branch-line', 'arm-over', 'drop', 'sprig',
]);

// Endpoint snap tolerance (feet). Generated coords are rounded to 0.01 ft; a
// node tolerance an order larger absorbs that without merging distinct joints.
const NODE_TOL_FT = 0.05;

// A run is "vertical" when its Z extent dominates its horizontal extent.
// Drops/risers/sprigs are vertical; branches/mains are horizontal.
const VERTICAL_RATIO = 2.0;

// Length thresholds (feet). A leaf vertical run shorter than this is a
// drop/sprig (it just steps from the branch elevation to the head). A leaf
// horizontal run shorter than this, serving one head, is an arm-over.
const SHORT_RUN_FT = 6.0;

function key(p) {
  // Snap to the node grid so endpoints that meant to coincide do.
  const q = NODE_TOL_FT;
  return `${Math.round(p[0] / q)}|${Math.round(p[1] / q)}|${Math.round(p[2] / q)}`;
}

function len3(a, b) {
  return Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
}

/** Orientation of a from->to run: 'vertical' (z-dominant) or 'horizontal'. */
function orientationOf(from, to) {
  const dz = Math.abs(to[2] - from[2]);
  const dh = Math.hypot(to[0] - from[0], to[1] - from[1]);
  if (dz >= dh * VERTICAL_RATIO && dz > 1e-6) return 'vertical';
  return 'horizontal';
}

/**
 * True iff point p lies on segment a->b (within NODE_TOL_FT), used to detect
 * interior taps (a drop tapping a branch line, a riser-tie tapping a cross-main).
 * Endpoint coincidence is intentionally INCLUDED — callers that only want strict
 * interior hits filter endpoints out separately.
 */
function pointOnSegment(p, a, b) {
  const abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2];
  const apx = p[0] - a[0], apy = p[1] - a[1], apz = p[2] - a[2];
  const abLen2 = abx * abx + aby * aby + abz * abz;
  if (abLen2 < 1e-9) return false; // degenerate
  // projection parameter t of p onto the line, clamped to [0,1]
  let t = (apx * abx + apy * aby + apz * abz) / abLen2;
  if (t < -1e-6 || t > 1 + 1e-6) return false; // beyond the segment ends
  t = Math.max(0, Math.min(1, t));
  const cx = a[0] + abx * t, cy = a[1] + aby * t, cz = a[2] + abz * t;
  const dist = Math.hypot(p[0] - cx, p[1] - cy, p[2] - cz);
  return dist <= NODE_TOL_FT;
}

/** Dominant horizontal axis of a run ('x' | 'y' | null for vertical). */
function horizAxisOf(from, to) {
  const dx = Math.abs(to[0] - from[0]);
  const dy = Math.abs(to[1] - from[1]);
  if (dx < 1e-6 && dy < 1e-6) return null;
  return dx >= dy ? 'x' : 'y';
}

/**
 * Classify every pipe run in a CAD model by topology.
 *
 * @param {{solids: Array}} cadModel — model with .solids (pipes have from/to/diameterIn).
 * @returns {{
 *   roles: Map<object, string>,        // pipe solid -> assigned role
 *   roleCounts: Record<string, number>,
 *   headsServed: Record<string, number>, // role -> total heads served by that role
 *   unknownCount: number,
 *   pipes: Array<{ solid, role, length, diameterIn, headsServed, degA, degB, orientation }>,
 * }}
 */
export function classifyPipes(cadModel) {
  const solids = (cadModel && Array.isArray(cadModel.solids)) ? cadModel.solids : [];
  const pipes = solids.filter((s) => s && s.kind === 'pipe' && Array.isArray(s.from) && Array.isArray(s.to));
  const heads = solids.filter((s) => s && s.kind === 'head' && Array.isArray(s.position));

  // --- 1. Build the node graph. node -> { degree, pipes:[idx], pt } ---
  const nodes = new Map(); // key -> { degree, pipeIdx:Set, pt }
  const headAt = new Set(); // node keys that coincide with a head position
  for (const h of heads) headAt.add(key(h.position));

  const recs = pipes.map((s, idx) => {
    const from = s.from.map(Number);
    const to = s.to.map(Number);
    const ka = key(from);
    const kb = key(to);
    if (!nodes.has(ka)) nodes.set(ka, { degree: 0, pipeIdx: new Set(), pt: from });
    if (!nodes.has(kb)) nodes.set(kb, { degree: 0, pipeIdx: new Set(), pt: to });
    nodes.get(ka).degree += 1;
    nodes.get(kb).degree += 1;
    nodes.get(ka).pipeIdx.add(idx);
    nodes.get(kb).pipeIdx.add(idx);
    return {
      idx,
      solid: s,
      from,
      to,
      ka,
      kb,
      length: len3(from, to),
      diameterIn: Number(s.diameterIn) || 0,
      orientation: orientationOf(from, to),
      horizAxis: horizAxisOf(from, to),
      // a head sits at one of this run's endpoints
      headEndpoints: (headAt.has(ka) ? 1 : 0) + (headAt.has(kb) ? 1 : 0),
      minZ: Math.min(from[2], to[2]),
      maxZ: Math.max(from[2], to[2]),
    };
  });

  // Lowest Z anywhere in the network (the source / floor connection level).
  let networkMinZ = Infinity;
  for (const r of recs) networkMinZ = Math.min(networkMinZ, r.minZ);

  // --- 1b. Incidence: which runs does an endpoint POINT lie on? A drop taps a
  // branch line at an INTERIOR point of the branch (the branch is one long
  // segment, not split at each tap), and a riser-tie taps a cross-main at an
  // interior point. Shared-node lookup alone misses those, so we test each of a
  // run's two endpoints against every OTHER run's segment (point-on-segment).
  // Returns the set of run indices whose segment passes through point p. ---
  function runsThrough(p, exceptIdx) {
    const hits = [];
    // exact node coincidence first (cheap)
    const k = key(p);
    const node = nodes.get(k);
    if (node) for (const i of node.pipeIdx) if (i !== exceptIdx) hits.push(i);
    // interior incidence: p lies on run o's segment but not at o's endpoints
    for (const o of recs) {
      if (o.idx === exceptIdx) continue;
      if (o.ka === k || o.kb === k) continue; // already counted as a node
      if (pointOnSegment(p, o.from, o.to)) hits.push(o.idx);
    }
    return hits;
  }

  // --- 2. Heads served per run. A leaf run with a head at one endpoint
  // (drop/sprig/arm-over) credits the CARRIER it taps into at its non-head end,
  // whether that tap is at the carrier's endpoint or along its interior. ---
  const carrierCredit = new Map(); // pipe idx -> heads served (as a carrier)
  const directHeads = new Map(); // pipe idx -> heads at its own endpoints
  for (const r of recs) {
    if (r.headEndpoints > 0) {
      directHeads.set(r.idx, (directHeads.get(r.idx) || 0) + r.headEndpoints);
      // the non-head endpoint is the carrier tap; credit whatever run(s) it lies on
      const tapPt = headAt.has(r.ka) ? r.to : r.from;
      for (const cidx of runsThrough(tapPt, r.idx)) {
        carrierCredit.set(cidx, (carrierCredit.get(cidx) || 0) + r.headEndpoints);
      }
    }
  }

  // --- 4. Classify each run. Topology drives role, NOT diameter alone:
  //   pass A — verticals (riser/drop/sprig) + horizontal leaves (arm-over) +
  //            horizontal head-carriers (branch-line);
  //   pass B — horizontal feeds: a run feeding branch-lines is a cross-main;
  //            a run feeding cross-mains is a main. Iterated so the hierarchy
  //            settles (main only exists when it feeds cross-mains). ---
  const roles = new Map();
  const roleOfRec = (rec) => roles.get(rec.solid);

  // How many perpendicular horizontal carriers of a given role does r feed?
  function perpCarriersWithRole(r, wantRole) {
    let n = 0;
    const counted = new Set();
    const tryAdd = (oidx) => {
      if (oidx === r.idx || counted.has(oidx)) return;
      const o = recs[oidx];
      if (o.orientation === 'horizontal' && o.horizAxis && o.horizAxis !== r.horizAxis
        && roleOfRec(o) === wantRole) { counted.add(oidx); n += 1; }
    };
    // direct perpendicular incidence
    for (const o of recs) {
      if (o.orientation !== 'horizontal' || !o.horizAxis || o.horizAxis === r.horizAxis) continue;
      if (o.ka === r.ka || o.ka === r.kb || o.kb === r.ka || o.kb === r.kb
        || pointOnSegment(o.from, r.from, r.to) || pointOnSegment(o.to, r.from, r.to)
        || pointOnSegment(r.from, o.from, o.to) || pointOnSegment(r.to, o.from, o.to)) tryAdd(o.idx);
    }
    // via a short vertical tie (cross-main -> riser-tie -> branch elevation)
    for (const o of recs) {
      if (o.orientation !== 'vertical') continue;
      const tapsR = pointOnSegment(o.from, r.from, r.to) || pointOnSegment(o.to, r.from, r.to)
        || o.ka === r.ka || o.ka === r.kb || o.kb === r.ka || o.kb === r.kb;
      if (!tapsR) continue;
      const farPt = (pointOnSegment(o.from, r.from, r.to) || o.ka === r.ka || o.ka === r.kb) ? o.to : o.from;
      for (const fidx of runsThrough(farPt, o.idx)) tryAdd(fidx);
    }
    return n;
  }

  // PASS A — verticals + horizontal heads/leaves.
  for (const r of recs) {
    const degA = nodes.get(r.ka).degree;
    const degB = nodes.get(r.kb).degree;
    const leafEnd = Math.min(degA, degB) === 1; // at least one free end
    const carries = carrierCredit.get(r.idx) || 0; // heads hanging off this run
    const serves = directHeads.get(r.idx) || 0;    // head at this run's own end

    if (r.orientation === 'vertical') {
      const touchesFloor = r.minZ <= networkMinZ + NODE_TOL_FT;
      const headLow = headAt.has(r.minZ === r.from[2] ? r.ka : r.kb); // head at lower end?
      const headHigh = headAt.has(r.maxZ === r.from[2] ? r.ka : r.kb); // head at upper end?
      if (r.headEndpoints && headLow && r.length < SHORT_RUN_FT) {
        roles.set(r.solid, 'drop'); // pendent: head below
      } else if (r.headEndpoints && headHigh && r.length < SHORT_RUN_FT) {
        roles.set(r.solid, 'sprig'); // upright: head above
      } else if (r.headEndpoints) {
        roles.set(r.solid, headHigh ? 'sprig' : 'drop');
      } else if (r.length >= SHORT_RUN_FT && touchesFloor) {
        roles.set(r.solid, 'riser');
      } else if (touchesFloor) {
        roles.set(r.solid, 'riser');
      } else {
        // short vertical tie between main and branch elevation: deferred — folds
        // into the carrier it feeds (resolved in pass B). Mark provisional.
        roles.set(r.solid, '__tie__');
      }
    } else {
      const totalHeads = carries + serves;
      const armOver = leafEnd && r.length < SHORT_RUN_FT && totalHeads === 1;
      if (armOver) {
        roles.set(r.solid, 'arm-over');
      } else if (carries >= 1) {
        roles.set(r.solid, 'branch-line'); // a row of heads hangs off it
      } else {
        roles.set(r.solid, '__feed__'); // horizontal feed — resolved in pass B
      }
    }
  }

  // PASS B — resolve horizontal feeds into cross-main vs main, iterating until
  // stable. A feed that touches >=1 branch-line is a cross-main; a feed that
  // only touches cross-mains (>=1) is a main. Re-run so mains above cross-mains
  // settle after the cross-mains are named.
  for (let iter = 0; iter < 4; iter += 1) {
    let changed = false;
    for (const r of recs) {
      if (roleOfRec(r) !== '__feed__') continue;
      const branchTies = perpCarriersWithRole(r, 'branch-line');
      const crossTies = perpCarriersWithRole(r, 'cross-main');
      let next = '__feed__';
      if (branchTies >= 1) next = 'cross-main';
      else if (crossTies >= 1) next = 'main';
      if (next !== '__feed__') { roles.set(r.solid, next); changed = true; }
    }
    if (!changed) break;
  }
  // Any horizontal feed still unresolved (feeds nothing classified yet): it is a
  // bare carrier — call it a cross-main (it carries water but serves no heads of
  // its own). A truly isolated horizontal with no ties stays cross-main too.
  for (const r of recs) {
    if (roleOfRec(r) === '__feed__') roles.set(r.solid, 'cross-main');
  }
  // Resolve vertical ties: a tie folds into the role of the HIGHER-ORDER carrier
  // it connects (riser-tie off a cross-main is part of the cross-main; a tie off
  // a main is part of the main). Default to cross-main (overhead feed) — never a
  // head leaf. This keeps ties out of the branch/drop counts.
  const ORDER = { main: 3, 'cross-main': 2, 'branch-line': 1 };
  for (const r of recs) {
    if (roleOfRec(r) !== '__tie__') continue;
    let best = 'cross-main'; let bestRank = 0;
    for (const nk of [r.ka, r.kb]) {
      const node = nodes.get(nk);
      if (!node) continue;
      for (const oidx of node.pipeIdx) {
        if (oidx === r.idx) continue;
        const orole = roleOfRec(recs[oidx]);
        if (ORDER[orole] && ORDER[orole] > bestRank) { bestRank = ORDER[orole]; best = orole; }
      }
    }
    // a tie inherits the carrier it serves but is never itself a branch-line
    // (it carries no heads) — promote branch-line ties to cross-main feeds.
    roles.set(r.solid, best === 'branch-line' ? 'cross-main' : best);
  }

  // --- 5. Tally outputs ---
  const roleCounts = {};
  const headsServed = {};
  for (const role of PIPE_ROLES) { roleCounts[role] = 0; headsServed[role] = 0; }
  let unknownCount = 0;
  const pipeOut = [];
  for (const r of recs) {
    const role = roles.get(r.solid);
    const hs = (carrierCredit.get(r.idx) || 0) + (directHeads.get(r.idx) || 0);
    if (PIPE_ROLES.includes(role)) {
      roleCounts[role] += 1;
      headsServed[role] += hs;
    } else {
      unknownCount += 1;
    }
    pipeOut.push({
      solid: r.solid,
      role: role || 'unknown',
      length: round(r.length),
      diameterIn: r.diameterIn,
      headsServed: hs,
      degA: nodes.get(r.ka).degree,
      degB: nodes.get(r.kb).degree,
      orientation: r.orientation,
    });
  }

  return { roles, roleCounts, headsServed, unknownCount, pipes: pipeOut, nodeCount: nodes.size };
}

/**
 * Apply classification back onto the model: tag each pipe solid with
 * solid.smartRole (the topological role) without disturbing its original
 * generator role/layer. Returns the classification result for inspection.
 */
export function tagPipeRoles(cadModel) {
  const result = classifyPipes(cadModel);
  for (const [solid, role] of result.roles.entries()) {
    solid.smartRole = role;
  }
  return result;
}

/**
 * Sanity check: a sensible sprinkler tree, not all-one-role and not random.
 *
 * The defining shape of a tree-structured sprinkler system:
 *   - head LEAVES (drops + arm-overs + sprigs) are the most numerous role —
 *     there is one per head, and heads outnumber every carrier;
 *   - BRANCH LINES are the next tier and carry those leaves;
 *   - the FEED carriers (cross-mains + mains) are a minority of the network and
 *     never outnumber the branch lines they feed (riser-tie nipples that share
 *     the cross-main feed are tolerated, so cross-mains may modestly exceed
 *     branch lines, but the FEED tier as a whole stays below the leaf tier);
 *   - at least one riser/feed trunk exists;
 *   - at least three distinct roles are present (never collapsed to one role).
 */
export function distributionIsSensible(roleCounts) {
  const total = Object.values(roleCounts).reduce((a, b) => a + b, 0);
  if (total === 0) return false;
  const branchLines = roleCounts['branch-line'] || 0;
  const crossMains = roleCounts['cross-main'] || 0;
  const mains = roleCounts.main || 0;
  const feed = crossMains + mains;
  const leaves = (roleCounts.drop || 0) + (roleCounts['arm-over'] || 0) + (roleCounts.sprig || 0);
  const distinctRoles = PIPE_ROLES.filter((r) => (roleCounts[r] || 0) > 0).length;
  const noSingleRoleDominates = PIPE_ROLES.every((r) => (roleCounts[r] || 0) < total);
  return (
    distinctRoles >= 3 &&             // not all-one-role
    noSingleRoleDominates &&          // not 100% one role
    branchLines >= 1 &&
    leaves > branchLines &&           // head leaves are the most numerous tier
    leaves > feed &&                  // leaves outnumber every feed carrier
    mains <= crossMains &&            // pyramid: mains never exceed cross-mains
    feed <= branchLines + branchLines // feed tier bounded by the branch tier (+ nipples)
  );
}

function round(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
