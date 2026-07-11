/**
 * HaloFire — Arm-over / Easy-Drop / Sprig connection engine (Phase 2, system
 * intelligence). AutoSPRINK parity: Tools › Smart Pipe › Arm Over (#31),
 * Tools › Smart Pipe › Sprig (#32), Auto › Easy Drop (#34).
 *
 * Smart Pipe (smart-pipe.js) CLASSIFIES the runs that already exist; branch-connect
 * (branch-connect.js) proves the network traces back to a riser. This module owns
 * the geometry that physically joins a BRANCH LINE to each SPRINKLER HEAD — the
 * short final connection every real sprinkler needs and that a flat generated model
 * is often missing:
 *
 *   EASY-DROP — head BELOW the branch elevation: a vertical drop pipe from the
 *               branch down to a pendent head deflector.
 *   SPRIG     — head ABOVE the branch elevation: a vertical sprig pipe from the
 *               branch UP to an upright head.
 *   ARM-OVER  — head LATERALLY OFFSET from the branch line (not directly under/over
 *               it): a short horizontal arm-over pipe from the branch out to the
 *               point above/below the head, THEN a drop/sprig nipple to the head.
 *               (AutoSPRINK calls the offset connector the "arm-over".)
 *
 * Two halves, both pure + deterministic (no DOM/THREE/I/O):
 *   analyzeDrops(model)        — read-only classification. For every head, find its
 *                                serving branch and report what connection it needs
 *                                + whether one is already present. Returns the
 *                                observable { armOvers, drops, sprigs, ... } tallies.
 *   buildDropConnections(model)— synthesizes the MISSING connection geometry for
 *                                every head that lacks a proper one: arm-over pipe
 *                                (when offset) + drop/sprig nipple + elbow/reducer
 *                                fitting markers. Every coordinate is derived from
 *                                existing head/branch geometry — never invented.
 *                                Idempotent: a fully-connected model gets 0 adds.
 *
 * Unit-tested in tests/drop-connect.test.js.
 */

// Snap tolerance (ft) — matches smart-pipe.js / branch-connect.js so the modules
// agree on node coincidence. Generated coords round to 0.01ft; 0.05 absorbs it.
const NODE_TOL_FT = 0.05;
// A head whose lateral (horizontal, in-plane) distance from the branch line CENTRE
// AXIS exceeds this needs an ARM-OVER; within it, a straight drop/sprig suffices.
const ARMOVER_MIN_FT = 0.25;
// A branch line is only a candidate carrier for a head if the head sits within this
// horizontal band of the branch's axis (so we tie a head to ITS row, not a far one).
const BRANCH_REACH_FT = 8.0;
// Vertical agreement: a connection is "drop/sprig" (vertical) vs needs an arm-over
// horizontal leg. The branch is at branchZ; head at headZ. |dz| this small ⇒ the
// head is essentially AT branch elevation (degenerate — treat as arm-over only).
const FLAT_DZ_FT = 0.05;
import { createFittingPlacement, normalizeRunAxis, stablePerpendicularAxis } from './fitting-orient.js';

import { HEAD_DIMS, REDUCER_DIMS, nearestNps, pipeOdIn } from '../components/openscad/part-dims.js';

function num3(p) { return [Number(p[0]), Number(p[1]), Number(p[2])]; }
function len3(a, b) { return Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]); }
function round(n) { return Math.round((n + Number.EPSILON) * 1000) / 1000; }
function roundPt(p) { return [round(p[0]), round(p[1]), round(p[2])]; }

function headThreadNominalIn(head) {
  if (Number(head && head.threadSizeIn) > 0) return Number(head.threadSizeIn);
  const thread = String(head && head.thread ? head.thread : '').trim();
  if (/3\/4/.test(thread)) return 0.75;
  if (/(^|\D)1\s*NPT/.test(thread)) return 1.0;
  return 0.5;
}

function headThreadOdIn(head) {
  const nominal = headThreadNominalIn(head);
  if (nominal >= 1.0) return HEAD_DIMS.thread_one_npt_od.value;
  if (nominal >= 0.75) return HEAD_DIMS.thread_three_quarter_npt_od.value;
  return HEAD_DIMS.thread_half_npt_od.value;
}

function reducerLengthIn(dropNominalIn) {
  const largeNps = nearestNps(dropNominalIn);
  return REDUCER_DIMS.lengthByLargeNps[largeNps] || REDUCER_DIMS.lengthByLargeNps[1.5] || 2.0;
}

function buildReducerSpec({ head, towardPipe, dropNominalIn }) {
  const towardPipePt = num3(towardPipe);
  const headPt = num3(head.position);
  const dist = len3(towardPipePt, headPt);
  if (dist < 1e-9) return null;
  const lenIn = reducerLengthIn(dropNominalIn);
  const lenFt = lenIn / 12;
  const ux = (towardPipePt[0] - headPt[0]) / dist;
  const uy = (towardPipePt[1] - headPt[1]) / dist;
  const uz = (towardPipePt[2] - headPt[2]) / dist;
  const actualLenFt = Math.min(lenFt, dist);
  const pipePt = [
    headPt[0] + ux * actualLenFt,
    headPt[1] + uy * actualLenFt,
    headPt[2] + uz * actualLenFt,
  ];
  const center = [
    headPt[0] + ux * actualLenFt / 2,
    headPt[1] + uy * actualLenFt / 2,
    headPt[2] + uz * actualLenFt / 2,
  ];
  const dropOdIn = pipeOdIn(dropNominalIn);
  const threadOd = headThreadOdIn(head);
  const topPort = pipePt[2] >= headPt[2] ? pipePt : headPt;
  const bottomPort = pipePt[2] >= headPt[2] ? headPt : pipePt;
  return {
    center: roundPt(center),
    lengthFt: round(actualLenFt),
    lengthIn: round(actualLenFt * 12),
    dropNominalIn: round(dropNominalIn),
    headThreadIn: round(headThreadNominalIn(head)),
    topOdIn: round(dropOdIn),
    bottomOdIn: round(threadOd),
    topOdFt: round(dropOdIn / 12),
    bottomOdFt: round(threadOd / 12),
    pipePort: roundPt(pipePt),
    headPort: roundPt(headPt),
    topPort: roundPt(topPort),
    bottomPort: roundPt(bottomPort),
  };
}

/** Orientation of a from->to run: 'vertical' (z-dominant) or 'horizontal'. */
function orientationOf(from, to) {
  const dz = Math.abs(to[2] - from[2]);
  const dh = Math.hypot(to[0] - from[0], to[1] - from[1]);
  if (dz >= dh * 2.0 && dz > 1e-6) return 'vertical';
  return 'horizontal';
}

/**
 * Horizontal (in-plan) distance from point p to the infinite line through a->b,
 * plus the foot of the perpendicular (the point ON the branch axis directly
 * beside p, at the branch's own elevation). XY only — Z is handled separately so
 * a head below a branch reads zero lateral offset.
 * @returns {{ dist:number, foot:[x,y,z], t:number }} t = param along a->b (clamped).
 */
function lateralToAxis(p, a, b) {
  const ax = a[0], ay = a[1];
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const L2 = dx * dx + dy * dy;
  if (L2 < 1e-9) {
    return { dist: Math.hypot(p[0] - ax, p[1] - ay), foot: [ax, ay, a[2]], t: 0 };
  }
  let t = ((p[0] - ax) * dx + (p[1] - ay) * dy) / L2;
  t = Math.max(0, Math.min(1, t));
  const fx = ax + dx * t, fy = ay + dy * t;
  // foot elevation is the branch elevation interpolated along its (horizontal) run
  const fz = a[2] + (b[2] - a[2]) * t;
  return { dist: Math.hypot(p[0] - fx, p[1] - fy), foot: [fx, fy, fz], t };
}

/** True iff point p lies on segment a->b within tol (endpoints included). */
function pointOnSegment(p, a, b, tol) {
  const abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2];
  const apx = p[0] - a[0], apy = p[1] - a[1], apz = p[2] - a[2];
  const abLen2 = abx * abx + aby * aby + abz * abz;
  if (abLen2 < 1e-9) return false;
  let t = (apx * abx + apy * aby + apz * abz) / abLen2;
  if (t < -1e-6 || t > 1 + 1e-6) return false;
  t = Math.max(0, Math.min(1, t));
  const cx = abx * t, cy = aby * t, cz = abz * t;
  return Math.hypot(apx - cx, apy - cy, apz - cz) <= (tol || NODE_TOL_FT);
}

function splitSolids(cadModel) {
  const solids = (cadModel && Array.isArray(cadModel.solids)) ? cadModel.solids : [];
  const pipes = solids.filter((s) => s && s.kind === 'pipe' && Array.isArray(s.from) && Array.isArray(s.to));
  const heads = solids.filter((s) => s && s.kind === 'head' && Array.isArray(s.position));
  const components = solids.filter((s) => s && s.kind === 'component' && Array.isArray(s.position));
  return { solids, pipes, heads, components };
}

/**
 * A pipe is a BRANCH-LINE candidate (a horizontal carrier a head can tie to) if it
 * is horizontal. We DON'T require it already serve a head (a freshly-drawn branch
 * with offset heads has none yet — that's exactly what we're here to connect).
 * Drops/sprigs/arm-overs (short verticals + short horizontals) are excluded from
 * being carriers by orientation/length so a head never ties to another head's drop.
 */
function branchCarriers(pipes) {
  return pipes.filter((r) => {
    const from = num3(r.from), to = num3(r.to);
    if (orientationOf(from, to) !== 'horizontal') return false;
    // an arm-over is a short horizontal leg; the branch it taps is longer. Exclude
    // very short horizontals (likely existing arm-overs) from carrier candidacy.
    return len3(from, to) >= 2.0;
  }).map((r) => ({ solid: r, from: num3(r.from), to: num3(r.to), diameterIn: Number(r.diameterIn) || 0 }));
}

/**
 * For a head, find the branch carrier that serves it: the horizontal branch whose
 * axis the head is closest to (laterally, in-plan), within BRANCH_REACH_FT, AND
 * that sits at a DIFFERENT elevation (so a drop/sprig actually spans). Returns null
 * if no branch is in reach (an orphan head — branch-connect handles those).
 */
function servingBranch(head, carriers) {
  const p = num3(head.position);
  let best = null;
  for (const c of carriers) {
    const { dist, foot } = lateralToAxis(p, c.from, c.to);
    if (dist > BRANCH_REACH_FT) continue;
    const dz = Math.abs(c.from[2] - p[2]); // branch elev vs head elev
    // prefer the branch the head is laterally closest to; tie-break on smaller |dz|
    const score = dist + dz * 0.001;
    if (!best || score < best.score) best = { carrier: c, dist, foot, dz, score };
  }
  return best;
}

/**
 * Does this head ALREADY have a proper connection present in the model? A proper
 * connection is a pipe (drop/sprig/arm-over leg) incident to the head position that
 * traces, via at most one arm-over leg, to the serving branch. We check the simple,
 * honest signal: is there a pipe whose endpoint coincides with the head position?
 * (the drop/sprig nipple). Generated models always have this for in-line heads.
 */
function headHasConnection(head, pipes, components = []) {
  const p = num3(head.position);
  for (const r of pipes) {
    const from = num3(r.from), to = num3(r.to);
    if (len3(from, p) <= NODE_TOL_FT || len3(to, p) <= NODE_TOL_FT) return true;
    // head sits on a run interior (rare, but a pass-through nipple counts)
    if (pointOnSegment(p, from, to, NODE_TOL_FT)) return true;
  }
  for (const c of components) {
    if (c.componentKey !== 'fitting_reducer') continue;
    if (Array.isArray(c.headPort) && len3(num3(c.headPort), p) <= NODE_TOL_FT) return true;
    if (Array.isArray(c.bottomPort) && len3(num3(c.bottomPort), p) <= NODE_TOL_FT) return true;
    if (Array.isArray(c.topPort) && len3(num3(c.topPort), p) <= NODE_TOL_FT) return true;
  }
  return false;
}

/**
 * Decide the connection TYPE a head needs from its serving branch, purely from
 * geometry:
 *   - lateral offset > ARMOVER_MIN_FT  ⇒ needs an ARM-OVER (+ a nipple)
 *   - head below branch (headZ < branchZ - FLAT_DZ) ⇒ DROP (pendent)
 *   - head above branch (headZ > branchZ + FLAT_DZ) ⇒ SPRIG (upright)
 * The 'connector' is the vertical type even when an arm-over is also required
 * (arm-over carries the run out, the nipple drops/sprigs to the head).
 * @returns {{ type:'drop'|'sprig', armOver:boolean, foot:[x,y,z], offset:number, dz:number }}
 */
function connectionFor(head, serve) {
  const p = num3(head.position);
  const branchZ = serve.foot[2];
  const dz = p[2] - branchZ;
  const offset = serve.dist;
  const armOver = offset > ARMOVER_MIN_FT;
  // orientation hint from the head solid (pendent/upright) is corroborated by dz,
  // but geometry (dz sign) is authoritative — a pendent head IS below the branch.
  let type;
  if (dz < -FLAT_DZ_FT) type = 'drop';
  else if (dz > FLAT_DZ_FT) type = 'sprig';
  else {
    // head essentially at branch elevation: fall back to the stored orientation,
    // else default to a (zero-length-tolerant) drop. Still gets an arm-over if offset.
    type = (head.orientation === 'upright') ? 'sprig' : 'drop';
  }
  return { type, armOver, foot: serve.foot.slice(), offset, dz };
}

/**
 * Classify the EXISTING connection runs in the model (read-only) AND report, per
 * head, what connection it needs + whether it is already present. This is the
 * observable basis for window.__hfPhase2.drops.
 *
 * @param {{solids:Array}} cadModel
 * @returns {{
 *   armOvers:number, drops:number, sprigs:number,    // existing runs by type
 *   totalHeads:number, headsConnected:number, headsNeedingWork:number,
 *   needArmOver:number, needDrop:number, needSprig:number, // for unconnected heads
 *   branchCarriers:number,
 *   perHead:Array<{name,type,armOver,connected,offset,dz}>,
 * }}
 */
export function analyzeDrops(cadModel) {
  const { pipes, heads, components } = splitSolids(cadModel);
  const carriers = branchCarriers(pipes);

  // --- 1. Classify EXISTING connection runs by geometry. A vertical short run is
  // a drop (goes down) or a sprig (goes up); a short horizontal leaf run that ties
  // a head's column to a branch is an arm-over. We credit by the run's own role tag
  // when present (auto-generated runs carry connKind) AND fall back to geometry. ---
  let armOvers = 0, drops = 0, sprigs = 0;
  const headKeySet = new Set(heads.map((h) => keyOf(num3(h.position))));
  for (const r of pipes) {
    const from = num3(r.from), to = num3(r.to);
    if (r.connKind === 'arm-over') { armOvers += 1; continue; }
    if (r.connKind === 'drop') { drops += 1; continue; }
    if (r.connKind === 'sprig') { sprigs += 1; continue; }
    const ori = orientationOf(from, to);
    const L = len3(from, to);
    if (ori === 'vertical' && L < 6.0) {
      // head at an endpoint? lower end head => drop, upper end head => sprig
      const lowEndHead = headKeySet.has(keyOf(from[2] <= to[2] ? from : to));
      const highEndHead = headKeySet.has(keyOf(from[2] >= to[2] ? from : to));
      if (lowEndHead) drops += 1;
      else if (highEndHead) sprigs += 1;
      // a bare vertical with no head (riser-tie) is not a connection — skip
    } else if (ori === 'horizontal' && L < BRANCH_REACH_FT && L >= 0.1) {
      // a short horizontal leaf that ends at (or above/below) a head column is an
      // arm-over IFF one of its endpoints carries a head's drop (i.e. not a branch).
      const armEndHead = headKeySet.has(keyOf(from)) || headKeySet.has(keyOf(to));
      // or it connects to a head-bearing vertical at one end (arm-over -> nipple)
      let feedsNipple = false;
      if (!armEndHead) {
        for (const o of pipes) {
          if (o === r) continue;
          const of = num3(o.from), ot = num3(o.to);
          if (orientationOf(of, ot) !== 'vertical') continue;
          const touches = len3(of, from) <= NODE_TOL_FT || len3(of, to) <= NODE_TOL_FT
            || len3(ot, from) <= NODE_TOL_FT || len3(ot, to) <= NODE_TOL_FT;
          if (touches && (headKeySet.has(keyOf(of)) || headKeySet.has(keyOf(ot)))) { feedsNipple = true; break; }
        }
      }
      if ((armEndHead || feedsNipple) && len3(from, to) < BRANCH_REACH_FT) armOvers += 1;
    }
  }

  // --- 2. Per-head: needed connection + already-present. ---
  const perHead = [];
  let headsConnected = 0, needArmOver = 0, needDrop = 0, needSprig = 0;
  for (const h of heads) {
    const serve = servingBranch(h, carriers);
    const connected = headHasConnection(h, pipes, components);
    if (connected) headsConnected += 1;
    let type = h.orientation === 'upright' ? 'sprig' : 'drop';
    let armOver = false, offset = 0, dz = 0;
    if (serve) {
      const c = connectionFor(h, serve);
      type = c.type; armOver = c.armOver; offset = round(c.offset); dz = round(c.dz);
      if (!connected) {
        if (armOver) needArmOver += 1;
        if (type === 'drop') needDrop += 1; else needSprig += 1;
      }
    }
    perHead.push({ name: h.name || 'head', type, armOver, connected, offset, dz, hasBranch: !!serve });
  }

  return {
    armOvers, drops, sprigs,
    totalHeads: heads.length,
    headsConnected,
    headsNeedingWork: heads.length - headsConnected,
    needArmOver, needDrop, needSprig,
    branchCarriers: carriers.length,
    perHead,
  };
}

function keyOf(p) {
  const q = NODE_TOL_FT;
  return `${Math.round(p[0] / q)}|${Math.round(p[1] / q)}|${Math.round(p[2] / q)}`;
}

/**
 * Build the MISSING arm-over / drop / sprig connection geometry for every head
 * that has a serving branch but no connection yet. Deterministic + geometry-derived:
 *
 *   For a head offset from its branch:
 *     - ARM-OVER: a horizontal pipe from the foot-on-branch point out to the point
 *       directly above/below the head (head x,y at branch z), diameter = branch dia
 *       (capped at 1.25"), + an ELBOW fitting marker at the turn.
 *     - NIPPLE  : a vertical drop (down) or sprig (up) pipe from that turn point to
 *       the head, 1" dia, + a REDUCER fitting marker at the head.
 *   For an in-line head (no offset): just the vertical drop/sprig nipple + reducer.
 *
 * Each added pipe carries connKind ('arm-over'|'drop'|'sprig') + role so the render
 * loop colors/instances it correctly and re-analysis classifies it without geometry
 * heuristics. Mutates and returns the model's solids.
 *
 * @param {{solids:Array}} cadModel
 * @returns {{ model, added:Array, analysisBefore, analysisAfter,
 *             armOversAdded:number, dropsAdded:number, sprigsAdded:number }}
 */
export function buildDropConnections(cadModel) {
  const analysisBefore = analyzeDrops(cadModel);
  const { solids, pipes, heads, components } = splitSolids(cadModel);
  const added = [];
  if (heads.length === 0) {
    return { model: cadModel, added, analysisBefore, analysisAfter: analysisBefore, armOversAdded: 0, dropsAdded: 0, sprigsAdded: 0 };
  }
  const carriers = branchCarriers(pipes);
  let armOversAdded = 0, dropsAdded = 0, sprigsAdded = 0;

  for (const h of heads) {
    if (headHasConnection(h, pipes, components)) continue; // already wired — idempotent
    const serve = servingBranch(h, carriers);
    if (!serve) continue; // orphan head, no branch in reach — branch-connect's job
    const c = connectionFor(h, serve);
    const p = num3(h.position);
    const branchZ = serve.foot[2];
    // The turn point: directly above/below the head, AT branch elevation.
    const turn = [round(p[0]), round(p[1]), round(branchZ)];
    const dia = Math.min(Number(serve.carrier.diameterIn) || 1.25, 1.25);

    if (c.armOver) {
      // horizontal arm-over: foot on branch axis -> turn (above/below head)
      const foot = [round(serve.foot[0]), round(serve.foot[1]), round(branchZ)];
      if (len3(foot, turn) > NODE_TOL_FT) {
        const branchRunAxis = normalizeRunAxis([
          serve.carrier.to[0] - serve.carrier.from[0],
          serve.carrier.to[1] - serve.carrier.from[1],
          0,
        ]);
        const armOverAxis = normalizeRunAxis([
          turn[0] - foot[0],
          turn[1] - foot[1],
          0,
        ]);
        const arm = {
          kind: 'pipe', name: `auto-armover-${added.length}`, layer: 'BRANCH',
          role: 'branch', connKind: 'arm-over',
          from: foot, to: turn, diameterIn: dia, autoGenerated: true,
        };
        solids.push(arm); added.push(arm); armOversAdded += 1;
        // elbow at the branch tap (foot) and at the turn
        solids.push(fitting(
          'fitting_elbow_90',
          foot,
          added.length,
          createFittingPlacement('fitting_elbow_90', branchRunAxis, armOverAxis, { fittingType: 'arm-over-elbow' }),
        ));
        added.push(solids[solids.length - 1]);
        solids.push(fitting(
          'fitting_elbow_90',
          turn,
          added.length,
          createFittingPlacement('fitting_elbow_90', armOverAxis, [0, 0, c.type === 'drop' ? -1 : 1], { fittingType: 'turn-elbow' }),
        ));
        added.push(solids[solids.length - 1]);
      }
    }
    // vertical nipple: turn -> head (down = drop, up = sprig)
    if (len3(turn, p) > NODE_TOL_FT * 0.5) {
      const reducer = buildReducerSpec({ head: h, towardPipe: turn, dropNominalIn: 1.0 });
      const nipTo = reducer ? reducer.pipePort : [round(p[0]), round(p[1]), round(p[2])];
      const nip = {
        kind: 'pipe', name: `auto-${c.type}-${added.length}`, layer: 'DROPS',
        role: 'drop', connKind: c.type, // role 'drop' so the render path instances it
        from: turn, to: nipTo,
        diameterIn: 1.0, autoGenerated: true,
      };
      if (reducer) nip.reducer = reducer;
      if (len3(nip.from, nip.to) > NODE_TOL_FT * 0.5) {
        solids.push(nip); added.push(nip);
        if (c.type === 'drop') dropsAdded += 1; else sprigsAdded += 1;
      }
      // reducer marker centered on the actual nipple -> head junction segment
      solids.push(fitting('fitting_reducer', reducer ? reducer.center : [round(p[0]), round(p[1]), round(p[2])], added.length, reducer || undefined));
      added.push(solids[solids.length - 1]);
    }
  }

  const analysisAfter = analyzeDrops(cadModel);
  return { model: cadModel, added, analysisBefore, analysisAfter, armOversAdded, dropsAdded, sprigsAdded };
}

function fitting(componentKey, position, n, extra = undefined) {
  return {
    kind: 'component', name: `auto-${componentKey}-${n}`, layer: 'COMPONENTS',
    componentKey, category: 'fitting',
    position: [round(position[0]), round(position[1]), round(position[2])],
    ...(extra && typeof extra === 'object' ? extra : {}),
    autoGenerated: true,
  };
}

export const DROP_CONNECT_TOL_FT = NODE_TOL_FT;
