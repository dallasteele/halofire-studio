// HF-W1-CMD — snapshot-based undo/redo command stack for the live Studio.
//
// PORTED from apps/cad/src/lib/history.ts (record/undo/redo/limit) + the
// snapshot discipline of apps/cad/src/store.ts mutate() (a mutator returning
// the SAME reference / null = a no-op that records nothing). The cad store is
// itself snapshot-based — it records docOf(s) PRE-mutation and never per-op
// inverse deltas — so this mirrors the proven pattern exactly, but for the
// autosprink in-memory `cadModel` ({solids:[...], rooms, counts}) instead of a
// React doc slice.
//
// WHY SNAPSHOT, NOT IN-PLACE THREE MUTATION + INVERSE COMMANDS: autosprink's
// renderModel() FULLY REBUILDS modelGroup from cadModel.solids on every change
// (and calls clearSelection(false)), so restoring a snapshot renders
// identically with zero residual scene state. In-place THREE mutation + inverse
// undo would fight the instanced-color highlight and the
// model-rebuild-clears-selection invariant. Keep this module PURE (no THREE, no
// DOM): it owns history + cloning only; the caller owns render + persist.

export const DEFAULT_HISTORY_LIMIT = 100;

// Deep clone a cadModel snapshot. structuredClone when available (browsers +
// modern node), else a JSON round-trip (cadModel is plain JSON data — numbers,
// strings, arrays, plain objects; no functions/dates/cycles), so the fallback
// is lossless for this shape.
export function cloneModel(model) {
  if (model == null) return model;
  if (typeof structuredClone === 'function') return structuredClone(model);
  return JSON.parse(JSON.stringify(model));
}

/**
 * Create a command stack over a single mutable "current model" slot.
 *
 * @param {object} opts
 * @param {() => any} opts.getModel  read the live current cadModel
 * @param {(model:any, label:string) => void} opts.setModel  install a new model
 *        (the caller re-renders + persists inside this — see autosprink.html).
 * @param {number} [opts.limit]  max combined entries per stack (default 100).
 * @param {(state:{label:string,canUndo:boolean,canRedo:boolean,depth:number}) => void} [opts.onChange]
 *        notified after every apply/undo/redo (for menu enable/disable, badges).
 */
export function createCommandStack(opts) {
  const getModel = opts && opts.getModel;
  const setModel = opts && opts.setModel;
  if (typeof getModel !== 'function' || typeof setModel !== 'function') {
    throw new Error('createCommandStack: getModel and setModel are required');
  }
  const limit = Math.max(1, Math.floor((opts && opts.limit) || DEFAULT_HISTORY_LIMIT));
  const onChange = (opts && opts.onChange) || function () {};

  // past: PRE snapshots, oldest first (last = most recent past).
  // future: snapshots undone, next-to-redo first. Mirrors history.ts.
  const past = [];
  const future = [];

  function notify(label) {
    onChange({ label: label || '', canUndo: past.length > 0, canRedo: future.length > 0, depth: past.length });
  }

  /**
   * Run `mutator` against a deep clone of the current model. The mutator may:
   *   - return a NEW model object  -> committed (PRE pushed to past, future cleared)
   *   - mutate the passed draft and return it (or undefined) -> committed using the draft
   *   - return null               -> no-op (store.ts discipline: records nothing)
   * Returns true when a change was committed, false on no-op.
   */
  function apply(label, mutator) {
    const current = getModel();
    const pre = cloneModel(current);
    const draft = cloneModel(current);
    let result;
    try {
      result = mutator(draft);
    } catch (e) {
      // A throwing mutator must NOT corrupt history or the live model.
      throw e;
    }
    if (result === null) return false; // explicit no-op
    const next = result === undefined ? draft : result;
    // Guard: if the mutator handed back the exact live reference unchanged,
    // treat it as a no-op (cannot have mutated the live model — we cloned).
    if (next === current) return false;
    past.push(pre);
    if (past.length > limit) past.splice(0, past.length - limit);
    future.length = 0; // a new edit invalidates redo
    setModel(next, label || 'edit');
    notify(label);
    return true;
  }

  function undo() {
    if (past.length === 0) return false;
    const present = cloneModel(getModel());
    const prev = past.pop();
    future.unshift(present);
    if (future.length > limit) future.length = limit;
    setModel(prev, 'undo');
    notify('undo');
    return true;
  }

  function redo() {
    if (future.length === 0) return false;
    const present = cloneModel(getModel());
    const next = future.shift();
    past.push(present);
    if (past.length > limit) past.splice(0, past.length - limit);
    setModel(next, 'redo');
    notify('redo');
    return true;
  }

  return {
    apply,
    undo,
    redo,
    canUndo: () => past.length > 0,
    canRedo: () => future.length > 0,
    depth: () => past.length,
    limit,
    // test/debug hook — never mutate the returned arrays
    _stacks: () => ({ past: past.slice(), future: future.slice() }),
  };
}

// ── Pure cadModel mutators (the EDIT OPS). Each takes (model, ...args) and
// returns a NEW model (or null for a no-op). They operate ONLY on the data
// model; the caller wraps them in stack.apply(label, m => mutateXxx(m, ...)).
// `ref` identifies a solid: { kind, index } where index is the position within
// the kind-filtered order the viewer uses, OR a direct solids[] index via
// { solidIndex }. autosprink resolves a clicked part -> ref before calling.

// Resolve a selection ref to an index into model.solids (or -1).
export function resolveSolidIndex(model, ref) {
  if (!model || !Array.isArray(model.solids) || !ref) return -1;
  if (Number.isInteger(ref.solidIndex)) {
    return ref.solidIndex >= 0 && ref.solidIndex < model.solids.length ? ref.solidIndex : -1;
  }
  if (ref.kind && Number.isInteger(ref.index)) {
    let seen = -1;
    for (let i = 0; i < model.solids.length; i += 1) {
      const s = model.solids[i];
      if (matchesKind(s, ref.kind)) {
        seen += 1;
        if (seen === ref.index) return i;
      }
    }
  }
  return -1;
}

// The viewer buckets pipes by role for drops; a "drop" ref is kind:'pipe'
// role:'drop'. Treat ref.kind 'drop' as that bucket for convenience.
function matchesKind(s, kind) {
  if (!s) return false;
  if (kind === 'drop') return s.kind === 'pipe' && s.role === 'drop';
  if (kind === 'pipe') return s.kind === 'pipe' && s.role !== 'drop';
  return s.kind === kind;
}

function recountCounts(model) {
  // Keep cadModel.counts in sync so the right-panel readouts stay honest after edits.
  if (!model || !Array.isArray(model.solids)) return model;
  const c = { walls: 0, pipes: 0, heads: 0, columns: 0, components: 0,
    spaces: (model.counts && model.counts.spaces) || 0,
    interiorWalls: (model.counts && model.counts.interiorWalls) || 0,
    openings: (model.counts && model.counts.openings) || 0 };
  for (const s of model.solids) {
    if (s.kind === 'wall') c.walls += 1;
    else if (s.kind === 'pipe') c.pipes += 1;
    else if (s.kind === 'head') c.heads += 1;
    else if (s.kind === 'column') c.columns += 1;
    else if (s.kind === 'component') c.components += 1;
  }
  model.counts = { ...(model.counts || {}), ...c };
  return model;
}

// Vector helpers on plan coords [x,y,z].
function addV(p, d) { return [p[0] + d[0], p[1] + (d[1] || 0), p[2] !== undefined ? p[2] + (d[2] || 0) : undefined].filter((v) => v !== undefined); }

// Apply an edit flag so the Inspector + persistence record that this part was
// user-edited (needs-verification preserved — never an AHJ/PE claim).
function markEdited(s, how) {
  s.hfEdited = how || 'edited';
  return s;
}

/** MOVE: translate a solid by plan-space delta [dx,dy,dz]. */
export function moveSolid(model, ref, delta) {
  const i = resolveSolidIndex(model, ref);
  if (i < 0) return null;
  const d = [Number(delta[0]) || 0, Number(delta[1]) || 0, Number(delta[2]) || 0];
  if (d[0] === 0 && d[1] === 0 && d[2] === 0) return null;
  const s = { ...model.solids[i] };
  applyTranslate(s, d);
  markEdited(s, 'moved');
  model.solids = model.solids.slice();
  model.solids[i] = s;
  return model;
}

function applyTranslate(s, d) {
  if (Array.isArray(s.from)) s.from = addV(s.from, d);
  if (Array.isArray(s.to)) s.to = addV(s.to, d);
  if (Array.isArray(s.position)) s.position = addV(s.position, d);
  if (Array.isArray(s.center)) s.center = [s.center[0] + d[0], s.center[1] + d[1]];
  if (Array.isArray(s.a)) s.a = [s.a[0] + d[0], s.a[1] + d[1]];
  if (Array.isArray(s.b)) s.b = [s.b[0] + d[0], s.b[1] + d[1]];
  if (typeof s.x === 'number') s.x += d[0];
  if (typeof s.y === 'number') s.y += d[1];
}

/** DELETE: remove a solid. */
export function deleteSolid(model, ref) {
  const i = resolveSolidIndex(model, ref);
  if (i < 0) return null;
  model.solids = model.solids.slice(0, i).concat(model.solids.slice(i + 1));
  return recountCounts(model);
}

/** COPY: duplicate a solid, offset by `offset` plan-delta (default 2ft +X). */
export function copySolid(model, ref, offset) {
  const i = resolveSolidIndex(model, ref);
  if (i < 0) return null;
  const d = offset && offset.length ? [Number(offset[0]) || 0, Number(offset[1]) || 0, Number(offset[2]) || 0] : [2, 0, 0];
  const dup = cloneModel(model.solids[i]);
  applyTranslate(dup, d);
  markEdited(dup, 'copied');
  model.solids = model.solids.concat([dup]);
  return recountCounts(model);
}

/** ROTATE: rotate a solid's geometry about a plan-space pivot by `rad` (CCW in plan XY). */
export function rotateSolid(model, ref, rad, pivot) {
  const i = resolveSolidIndex(model, ref);
  if (i < 0) return null;
  if (!rad) return null;
  const s = { ...model.solids[i] };
  const piv = pivot || solidCentroidPlan(s);
  const rot = (p) => rotatePlan(p, piv, rad);
  if (Array.isArray(s.from)) s.from = withZ(rot(s.from), s.from[2]);
  if (Array.isArray(s.to)) s.to = withZ(rot(s.to), s.to[2]);
  if (Array.isArray(s.position)) s.position = withZ(rot(s.position), s.position[2]);
  if (Array.isArray(s.center)) s.center = rot([s.center[0], s.center[1]]);
  if (Array.isArray(s.a)) s.a = rot([s.a[0], s.a[1]]);
  if (Array.isArray(s.b)) s.b = rot([s.b[0], s.b[1]]);
  if (typeof s.x === 'number' && typeof s.y === 'number') { const r = rot([s.x, s.y]); s.x = r[0]; s.y = r[1]; }
  if (typeof s.rotationY === 'number') s.rotationY += rad;
  markEdited(s, 'rotated');
  model.solids = model.solids.slice();
  model.solids[i] = s;
  return model;
}

/** MIRROR: reflect a solid across a plan axis ('x' mirrors plan-Y about pivot.y; 'y' mirrors plan-X). */
export function mirrorSolid(model, ref, axis, pivot) {
  const i = resolveSolidIndex(model, ref);
  if (i < 0) return null;
  const s = { ...model.solids[i] };
  const piv = pivot || solidCentroidPlan(s);
  const mir = (p) => mirrorPlan(p, piv, axis);
  if (Array.isArray(s.from)) s.from = withZ(mir(s.from), s.from[2]);
  if (Array.isArray(s.to)) s.to = withZ(mir(s.to), s.to[2]);
  if (Array.isArray(s.position)) s.position = withZ(mir(s.position), s.position[2]);
  if (Array.isArray(s.center)) s.center = mir([s.center[0], s.center[1]]);
  if (Array.isArray(s.a)) s.a = mir([s.a[0], s.a[1]]);
  if (Array.isArray(s.b)) s.b = mir([s.b[0], s.b[1]]);
  if (typeof s.x === 'number' && typeof s.y === 'number') { const r = mir([s.x, s.y]); s.x = r[0]; s.y = r[1]; }
  markEdited(s, 'mirrored');
  model.solids = model.solids.slice();
  model.solids[i] = s;
  return model;
}

/** ADD: append a new solid (draw tools). Returns model with the solid added. */
export function addSolid(model, solid) {
  if (!model || !solid) return null;
  if (!Array.isArray(model.solids)) model.solids = [];
  const s = cloneModel(solid);
  markEdited(s, 'drawn');
  model.solids = model.solids.concat([s]);
  return recountCounts(model);
}

/** SET FIELDS: commit edited Inspector fields onto a solid (diameterIn, position, etc.). */
export function setSolidFields(model, ref, fields) {
  const i = resolveSolidIndex(model, ref);
  if (i < 0 || !fields) return null;
  const s = { ...model.solids[i] };
  let changed = false;
  for (const k of Object.keys(fields)) {
    const v = fields[k];
    if (v === undefined || v === null) continue;
    // shallow compare arrays/numbers to skip no-ops
    if (Array.isArray(v)) {
      if (JSON.stringify(s[k]) === JSON.stringify(v)) continue;
      s[k] = v.slice();
    } else {
      if (s[k] === v) continue;
      s[k] = v;
    }
    changed = true;
  }
  if (!changed) return null;
  markEdited(s, 'fields-edited');
  model.solids = model.solids.slice();
  model.solids[i] = s;
  return model;
}

// ── plan-space geometry helpers (pure) ──
function withZ(xy, z) { return z === undefined ? xy : [xy[0], xy[1], z]; }
function rotatePlan(p, piv, rad) {
  const c = Math.cos(rad), s = Math.sin(rad);
  const dx = p[0] - piv[0], dy = p[1] - piv[1];
  return [piv[0] + dx * c - dy * s, piv[1] + dx * s + dy * c];
}
function mirrorPlan(p, piv, axis) {
  // axis 'y' => reflect plan-X about piv.x; axis 'x' => reflect plan-Y about piv.y.
  if (axis === 'y') return [2 * piv[0] - p[0], p[1]];
  return [p[0], 2 * piv[1] - p[1]];
}
export function solidCentroidPlan(s) {
  if (Array.isArray(s.from) && Array.isArray(s.to)) return [(s.from[0] + s.to[0]) / 2, (s.from[1] + s.to[1]) / 2];
  if (Array.isArray(s.position)) return [s.position[0], s.position[1]];
  if (Array.isArray(s.center)) return [s.center[0], s.center[1]];
  if (typeof s.x === 'number') return [s.x, s.y];
  return [0, 0];
}
