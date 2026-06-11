/**
 * AB1 — CRM bid-request status machine (W7C pure transitions).
 *
 * Pure ESM, no I/O, no side effects. This module is the single source of truth
 * for how a bid_request moves through its lifecycle. The API layer MUST route
 * every status change through applyTransition() — direct status writes that
 * bypass this machine are forbidden (honesty/fail-closed: the audit history is
 * only trustworthy if every transition is recorded here).
 */

/** Canonical ordered status set for a bid request. */
export const BID_STATUSES = ['received', 'reviewing', 'estimating', 'bid_sent', 'won', 'lost'];

/**
 * Allowed forward transitions. A status mapping to [] is terminal-for-forward
 * (won has no further moves; lost may be re-opened to reviewing).
 */
export const ALLOWED_TRANSITIONS = {
  received: ['reviewing'],
  reviewing: ['estimating', 'lost'],
  estimating: ['bid_sent', 'lost'],
  bid_sent: ['won', 'lost'],
  won: [],
  lost: ['reviewing'],
};

/**
 * canTransition(from, to) -> boolean.
 * Returns false for unknown states; never throws.
 */
export function canTransition(from, to) {
  const targets = ALLOWED_TRANSITIONS[from];
  if (!Array.isArray(targets)) return false;
  return targets.includes(to);
}

function isPlainRecord(record) {
  return record !== null && typeof record === 'object' && !Array.isArray(record);
}

function isValidIso(value) {
  if (typeof value !== 'string' || value.trim() === '') return false;
  const ms = Date.parse(value);
  return Number.isFinite(ms);
}

/**
 * applyTransition(record, to, atIso) -> NEW record.
 *
 * Pure: the input record is never mutated. Returns a new record with
 * `status` set to `to` and a new history entry {status, atIso} appended.
 *
 * Throws:
 *  - TypeError on a malformed record (non-object, or history present but not an array)
 *    or a missing/invalid atIso.
 *  - Error('invalid transition <from> -> <to>') when the move is not allowed.
 */
export function applyTransition(record, to, atIso) {
  if (!isPlainRecord(record)) {
    throw new TypeError('applyTransition: record must be a plain object');
  }
  if (record.history !== undefined && !Array.isArray(record.history)) {
    throw new TypeError('applyTransition: record.history must be an array when present');
  }
  if (!isValidIso(atIso)) {
    throw new TypeError('applyTransition: atIso must be a valid ISO timestamp string');
  }
  const from = record.status;
  if (!canTransition(from, to)) {
    throw new Error(`invalid transition ${from} -> ${to}`);
  }
  const history = Array.isArray(record.history) ? record.history : [];
  return {
    ...record,
    status: to,
    history: [...history, { status: to, atIso }],
  };
}

/**
 * timeInStatusMs(record, nowIso) -> ms elapsed since the LAST history entry's
 * timestamp. Throws on empty/absent history or invalid dates.
 */
export function timeInStatusMs(record, nowIso) {
  if (!isPlainRecord(record)) {
    throw new TypeError('timeInStatusMs: record must be a plain object');
  }
  const history = record.history;
  if (!Array.isArray(history) || history.length === 0) {
    throw new Error('timeInStatusMs: record has no history');
  }
  const last = history[history.length - 1];
  if (!last || !isValidIso(last.atIso)) {
    throw new Error('timeInStatusMs: last history entry has an invalid atIso');
  }
  if (!isValidIso(nowIso)) {
    throw new TypeError('timeInStatusMs: nowIso must be a valid ISO timestamp string');
  }
  return Date.parse(nowIso) - Date.parse(last.atIso);
}
