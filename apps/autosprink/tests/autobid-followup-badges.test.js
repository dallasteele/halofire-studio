import { describe, it, expect } from 'vitest';
import { badgeForBid, sortByUrgency } from '../src/autobid/followup-badges.js';

const bid = (status, atIso) => ({
  status,
  status_history: atIso ? [{ status, atIso }] : [],
});

const NOW = '2026-06-11T00:00:00.000Z';
const daysAgo = (n) => new Date(Date.parse(NOW) - n * 86400000).toISOString();

describe('badgeForBid', () => {
  it('returns null for a non-bid_sent bid (e.g. won)', () => {
    expect(badgeForBid(bid('won', daysAgo(30)), NOW, 5)).toBeNull();
  });

  it('flags ok below threshold', () => {
    const b = badgeForBid(bid('bid_sent', daysAgo(2)), NOW, 5);
    expect(b).toEqual({ daysOut: 2, level: 'ok' });
  });

  it('flags due at/above threshold', () => {
    expect(badgeForBid(bid('bid_sent', daysAgo(5)), NOW, 5).level).toBe('due');
  });

  it('flags overdue at/above twice threshold', () => {
    expect(badgeForBid(bid('bid_sent', daysAgo(10)), NOW, 5).level).toBe('overdue');
  });

  it('throws TypeError on missing nowIso', () => {
    expect(() => badgeForBid(bid('bid_sent', daysAgo(1)), '', 5)).toThrow(TypeError);
  });

  it('throws TypeError on malformed bid', () => {
    expect(() => badgeForBid({ status: 'bid_sent' }, NOW, 5)).toThrow(TypeError);
  });
});

describe('sortByUrgency', () => {
  it('orders overdue > due > ok > non-bid_sent, ties by daysOut desc; pure', () => {
    const input = [
      bid('won', daysAgo(99)),
      bid('bid_sent', daysAgo(2)), // ok
      bid('bid_sent', daysAgo(12)), // overdue
      bid('bid_sent', daysAgo(5)), // due
      bid('bid_sent', daysAgo(20)), // overdue, older
    ];
    const snapshot = JSON.stringify(input);
    const out = sortByUrgency(input, NOW, 5);
    const levels = out.map((b) =>
      b.status === 'bid_sent' ? badgeForBid(b, NOW, 5).level : 'none',
    );
    expect(levels).toEqual(['overdue', 'overdue', 'due', 'ok', 'none']);
    // ties: the older overdue (20d) comes before the 12d one.
    expect(badgeForBid(out[0], NOW, 5).daysOut).toBe(20);
    expect(JSON.stringify(input)).toBe(snapshot); // input untouched
  });
});
