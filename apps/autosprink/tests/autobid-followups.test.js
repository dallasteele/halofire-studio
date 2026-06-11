import { describe, expect, it } from 'vitest';
import { needsFollowup, dueFollowups, enteredCurrentStatusMs, DEFAULT_FOLLOWUP_DAYS } from '../src/autobid/followups.js';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-06-11T00:00:00.000Z');

function bidSentDaysAgo(id, title, days) {
  const sentIso = new Date(NOW - days * DAY).toISOString();
  return {
    id,
    title,
    status: 'bid_sent',
    status_history: [
      { status: 'received', atIso: new Date(NOW - (days + 3) * DAY).toISOString() },
      { status: 'reviewing', atIso: new Date(NOW - (days + 2) * DAY).toISOString() },
      { status: 'estimating', atIso: new Date(NOW - (days + 1) * DAY).toISOString() },
      { status: 'bid_sent', atIso: sentIso },
    ],
  };
}

describe('enteredCurrentStatusMs', () => {
  it('returns the timestamp the record entered its current status', () => {
    const rec = bidSentDaysAgo(1, 'x', 7);
    expect(enteredCurrentStatusMs(rec)).toBe(NOW - 7 * DAY);
  });
});

describe('needsFollowup', () => {
  it('flags a bid_sent older than the threshold', () => {
    const res = needsFollowup(bidSentDaysAgo(1, 'x', 7), { now: NOW, days: 5 });
    expect(res.due).toBe(true);
    expect(res.daysInStatus).toBe(7);
  });
  it('does NOT flag a recent bid_sent', () => {
    expect(needsFollowup(bidSentDaysAgo(1, 'x', 2), { now: NOW, days: 5 }).due).toBe(false);
  });
  it('ignores non-bid_sent records', () => {
    expect(needsFollowup({ status: 'estimating', status_history: [] }, { now: NOW }).due).toBe(false);
  });
  it('uses the default threshold when none is given', () => {
    expect(DEFAULT_FOLLOWUP_DAYS).toBe(5);
    expect(needsFollowup(bidSentDaysAgo(1, 'x', 6), { now: NOW }).due).toBe(true);
  });
});

describe('dueFollowups', () => {
  it('returns overdue bids, most-overdue first', () => {
    const recs = [
      bidSentDaysAgo(1, 'A', 6),
      bidSentDaysAgo(2, 'B', 12),
      bidSentDaysAgo(3, 'C', 2), // not due
      { id: 4, title: 'D', status: 'won', status_history: [] }, // not bid_sent
    ];
    const due = dueFollowups(recs, { now: NOW, days: 5 });
    expect(due.map((d) => d.id)).toEqual([2, 1]);
    expect(due[0].daysInStatus).toBe(12);
  });
  it('returns [] for non-array input', () => {
    expect(dueFollowups(null)).toEqual([]);
  });
});
