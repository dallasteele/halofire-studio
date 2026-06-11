/**
 * AB5 — Follow-up tracking (pure module).
 *
 * A bid_request that has been in 'bid_sent' for longer than N days (default 5)
 * is "due for follow-up". This is the logic the dead sys:bid-followups cron
 * surface always lacked. Pure: given hydrated bid_request records (status +
 * status_history) and a `now`, decide which are overdue and by how long.
 */

export const DEFAULT_FOLLOWUP_DAYS = 5;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Timestamp (ms) the record entered its CURRENT status, from status_history. */
export function enteredCurrentStatusMs(record) {
  const history = Array.isArray(record?.status_history) ? record.status_history : [];
  // Walk back to the last contiguous run of the current status.
  for (let i = history.length - 1; i >= 0; i -= 1) {
    if (history[i].status !== record.status) {
      const next = history[i + 1];
      return next ? Date.parse(next.atIso) : NaN;
    }
  }
  // Entire history is the current status (or empty) — use the first entry.
  return history.length ? Date.parse(history[0].atIso) : NaN;
}

/**
 * needsFollowup(record, { now, days }) -> { due:boolean, daysInStatus:number|null }
 * Only 'bid_sent' records are eligible. now/days accept overrides for testing.
 */
export function needsFollowup(record, { now = Date.now(), days = DEFAULT_FOLLOWUP_DAYS } = {}) {
  if (!record || record.status !== 'bid_sent') return { due: false, daysInStatus: null };
  const enteredMs = enteredCurrentStatusMs(record);
  if (!Number.isFinite(enteredMs)) return { due: false, daysInStatus: null };
  const elapsedMs = now - enteredMs;
  const daysInStatus = Math.floor(elapsedMs / DAY_MS);
  return { due: elapsedMs >= days * DAY_MS, daysInStatus };
}

/**
 * dueFollowups(records, opts) -> Array of { id, title, daysInStatus } for every
 * bid_sent record past the threshold, newest-overdue first.
 */
export function dueFollowups(records, opts = {}) {
  if (!Array.isArray(records)) return [];
  return records
    .map((r) => ({ record: r, ...needsFollowup(r, opts) }))
    .filter((x) => x.due)
    .map((x) => ({ id: x.record.id, title: x.record.title, daysInStatus: x.daysInStatus }))
    .sort((a, b) => b.daysInStatus - a.daysInStatus);
}

export default { DEFAULT_FOLLOWUP_DAYS, enteredCurrentStatusMs, needsFollowup, dueFollowups };
