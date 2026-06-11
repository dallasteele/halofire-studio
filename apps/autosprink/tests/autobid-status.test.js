import { describe, expect, it } from 'vitest';
import {
  BID_STATUSES,
  ALLOWED_TRANSITIONS,
  canTransition,
  applyTransition,
  timeInStatusMs,
} from '../src/autobid/crm-status.js';

describe('AB1 CRM status machine — constants', () => {
  it('exports the canonical status set in order', () => {
    expect(BID_STATUSES).toEqual(['received', 'reviewing', 'estimating', 'bid_sent', 'won', 'lost']);
  });

  it('exports the exact allowed-transition graph', () => {
    expect(ALLOWED_TRANSITIONS).toEqual({
      received: ['reviewing'],
      reviewing: ['estimating', 'lost'],
      estimating: ['bid_sent', 'lost'],
      bid_sent: ['won', 'lost'],
      won: [],
      lost: ['reviewing'],
    });
  });

  it('every transition target is itself a known status', () => {
    for (const targets of Object.values(ALLOWED_TRANSITIONS)) {
      for (const t of targets) {
        expect(BID_STATUSES).toContain(t);
      }
    }
  });
});

describe('canTransition', () => {
  it('returns true for every allowed edge', () => {
    expect(canTransition('received', 'reviewing')).toBe(true);
    expect(canTransition('reviewing', 'estimating')).toBe(true);
    expect(canTransition('reviewing', 'lost')).toBe(true);
    expect(canTransition('estimating', 'bid_sent')).toBe(true);
    expect(canTransition('estimating', 'lost')).toBe(true);
    expect(canTransition('bid_sent', 'won')).toBe(true);
    expect(canTransition('bid_sent', 'lost')).toBe(true);
    expect(canTransition('lost', 'reviewing')).toBe(true);
  });

  it('returns false for disallowed edges', () => {
    expect(canTransition('received', 'won')).toBe(false);
    expect(canTransition('received', 'estimating')).toBe(false);
    expect(canTransition('won', 'lost')).toBe(false);
    expect(canTransition('won', 'reviewing')).toBe(false);
    expect(canTransition('bid_sent', 'estimating')).toBe(false);
  });

  it('returns false for unknown states and never throws', () => {
    expect(canTransition('bogus', 'reviewing')).toBe(false);
    expect(canTransition('received', 'bogus')).toBe(false);
    expect(canTransition(undefined, 'reviewing')).toBe(false);
    expect(canTransition(null, null)).toBe(false);
    expect(canTransition('received', undefined)).toBe(false);
  });
});

describe('applyTransition', () => {
  it('returns a NEW record and does not mutate the input', () => {
    const record = { id: 1, status: 'received', history: [{ status: 'received', atIso: '2026-06-10T00:00:00.000Z' }] };
    const next = applyTransition(record, 'reviewing', '2026-06-10T01:00:00.000Z');

    expect(next).not.toBe(record);
    expect(next.status).toBe('reviewing');
    expect(next.history).toHaveLength(2);
    expect(next.history[1]).toEqual({ status: 'reviewing', atIso: '2026-06-10T01:00:00.000Z' });

    // input untouched
    expect(record.status).toBe('received');
    expect(record.history).toHaveLength(1);
    expect(next.history).not.toBe(record.history);
  });

  it('preserves other record fields', () => {
    const record = { id: 7, title: 'Warehouse FP', status: 'reviewing', history: [{ status: 'reviewing', atIso: '2026-06-10T00:00:00.000Z' }] };
    const next = applyTransition(record, 'estimating', '2026-06-10T02:00:00.000Z');
    expect(next.id).toBe(7);
    expect(next.title).toBe('Warehouse FP');
  });

  it('seeds history when the input has none', () => {
    const record = { status: 'received' };
    const next = applyTransition(record, 'reviewing', '2026-06-10T00:00:00.000Z');
    expect(next.history).toEqual([{ status: 'reviewing', atIso: '2026-06-10T00:00:00.000Z' }]);
  });

  it('throws Error with the exact message on an invalid transition', () => {
    const record = { status: 'received', history: [] };
    expect(() => applyTransition(record, 'won', '2026-06-10T00:00:00.000Z'))
      .toThrow('invalid transition received -> won');
  });

  it('throws TypeError on a malformed record', () => {
    expect(() => applyTransition(null, 'reviewing', '2026-06-10T00:00:00.000Z')).toThrow(TypeError);
    expect(() => applyTransition('nope', 'reviewing', '2026-06-10T00:00:00.000Z')).toThrow(TypeError);
    expect(() => applyTransition({ status: 'received', history: 'bad' }, 'reviewing', '2026-06-10T00:00:00.000Z')).toThrow(TypeError);
  });

  it('throws TypeError on a missing or invalid atIso', () => {
    const record = { status: 'received', history: [] };
    expect(() => applyTransition(record, 'reviewing')).toThrow(TypeError);
    expect(() => applyTransition(record, 'reviewing', '')).toThrow(TypeError);
    expect(() => applyTransition(record, 'reviewing', 'not-a-date')).toThrow(TypeError);
  });
});

describe('timeInStatusMs', () => {
  it('measures ms since the last history entry', () => {
    const record = { status: 'reviewing', history: [
      { status: 'received', atIso: '2026-06-10T00:00:00.000Z' },
      { status: 'reviewing', atIso: '2026-06-10T00:00:00.000Z' },
    ] };
    expect(timeInStatusMs(record, '2026-06-10T00:00:05.000Z')).toBe(5000);
  });

  it('throws on empty or absent history', () => {
    expect(() => timeInStatusMs({ status: 'received', history: [] }, '2026-06-10T00:00:00.000Z')).toThrow();
    expect(() => timeInStatusMs({ status: 'received' }, '2026-06-10T00:00:00.000Z')).toThrow();
  });

  it('throws on invalid dates', () => {
    const record = { status: 'received', history: [{ status: 'received', atIso: '2026-06-10T00:00:00.000Z' }] };
    expect(() => timeInStatusMs(record, 'not-a-date')).toThrow();
    const bad = { status: 'received', history: [{ status: 'received', atIso: 'nope' }] };
    expect(() => timeInStatusMs(bad, '2026-06-10T00:00:00.000Z')).toThrow();
  });
});
