// E0 — a pure, generic undo/redo history (the edit foundation every interactive
// tool builds on). It is deliberately UNAWARE of the CAD document: it stores
// snapshots of whatever immutable value `T` you hand it (the cad store snapshots
// its document slice). Keeping it pure makes it trivially testable and reusable.
//
// Model: a `past` stack (older snapshots) and a `future` stack (snapshots undone,
// available to redo). `record` is called with the PRE-mutation snapshot right
// before the document changes; `undo`/`redo` move the "present" between the stacks.
// A `limit` bounds memory — the oldest past entries are dropped past the limit.

/** An immutable undo/redo history of `T` snapshots. */
export interface History<T> {
  /** Older snapshots, oldest first; the last element is the most recent past. */
  readonly past: readonly T[];
  /** Undone snapshots available to redo, next-to-redo first. */
  readonly future: readonly T[];
  /** Max combined entries kept on either stack (oldest past dropped past it). */
  readonly limit: number;
}

/** Default number of undo steps retained. */
export const DEFAULT_HISTORY_LIMIT = 100;

/** An empty history (nothing to undo or redo). */
export function emptyHistory<T>(limit: number = DEFAULT_HISTORY_LIMIT): History<T> {
  return { past: [], future: [], limit: Math.max(1, Math.floor(limit)) };
}

/** True when there is at least one snapshot to undo to. */
export function canUndo<T>(h: History<T>): boolean {
  return h.past.length > 0;
}

/** True when there is at least one snapshot to redo to. */
export function canRedo<T>(h: History<T>): boolean {
  return h.future.length > 0;
}

/**
 * Record `present` (the PRE-mutation snapshot) onto the past stack and clear the
 * redo stack — a new edit always invalidates the redo future. The oldest past
 * entry is dropped once `limit` is exceeded.
 */
export function record<T>(h: History<T>, present: T): History<T> {
  const past = [...h.past, present];
  // Bound the past stack to `limit` (drop oldest).
  const trimmed = past.length > h.limit ? past.slice(past.length - h.limit) : past;
  return { past: trimmed, future: [], limit: h.limit };
}

/** The result of an undo/redo move: the new history + the snapshot to apply. */
export interface HistoryMove<T> {
  readonly history: History<T>;
  readonly present: T;
}

/**
 * Undo: pop the most recent past snapshot to become the new present, and push the
 * CURRENT `present` onto the redo future. Returns null when there is nothing to
 * undo (caller should no-op).
 */
export function undo<T>(h: History<T>, present: T): HistoryMove<T> | null {
  if (h.past.length === 0) return null;
  const prev = h.past[h.past.length - 1];
  const past = h.past.slice(0, -1);
  const future = [present, ...h.future];
  const trimmed = future.length > h.limit ? future.slice(0, h.limit) : future;
  return { history: { past, future: trimmed, limit: h.limit }, present: prev };
}

/**
 * Redo: pop the next future snapshot to become the new present, and push the
 * CURRENT `present` onto the past. Returns null when there is nothing to redo.
 */
export function redo<T>(h: History<T>, present: T): HistoryMove<T> | null {
  if (h.future.length === 0) return null;
  const next = h.future[0];
  const future = h.future.slice(1);
  const past = [...h.past, present];
  const trimmed = past.length > h.limit ? past.slice(past.length - h.limit) : past;
  return { history: { past: trimmed, future, limit: h.limit }, present: next };
}
