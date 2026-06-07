// E0 history tests — the pure undo/redo stack. We treat T as a simple string so
// the tests assert the STACK mechanics (record/undo/redo/limit), independent of
// the CAD document. The store integration is covered in store-undo.test.ts.

import { describe, expect, it } from 'vitest';
import {
  canRedo,
  canUndo,
  emptyHistory,
  record,
  redo,
  undo,
  DEFAULT_HISTORY_LIMIT,
} from '../src/lib/history';

describe('emptyHistory', () => {
  it('starts with nothing to undo or redo', () => {
    const h = emptyHistory<string>();
    expect(canUndo(h)).toBe(false);
    expect(canRedo(h)).toBe(false);
    expect(h.limit).toBe(DEFAULT_HISTORY_LIMIT);
  });

  it('clamps a silly limit to at least 1', () => {
    expect(emptyHistory<string>(0).limit).toBe(1);
    expect(emptyHistory<string>(-5).limit).toBe(1);
  });
});

describe('record', () => {
  it('pushes the pre-mutation snapshot onto the past and enables undo', () => {
    let h = emptyHistory<string>();
    h = record(h, 'A'); // about to move A -> B
    expect(canUndo(h)).toBe(true);
    expect(canRedo(h)).toBe(false);
    expect(h.past).toEqual(['A']);
  });

  it('a new record clears the redo future', () => {
    let h = emptyHistory<string>();
    h = record(h, 'A'); // present now B
    const u = undo(h, 'B')!; // back to A, future=[B]
    expect(canRedo(u.history)).toBe(true);
    // A new edit from A -> C must drop the redo of B.
    const h2 = record(u.history, 'A');
    expect(canRedo(h2)).toBe(false);
    expect(h2.future).toEqual([]);
  });
});

describe('undo / redo round-trip', () => {
  it('undo returns the prior snapshot and stashes the current for redo', () => {
    let h = emptyHistory<string>();
    h = record(h, 'A'); // present B
    const u = undo(h, 'B');
    expect(u).not.toBeNull();
    expect(u!.present).toBe('A');
    expect(u!.history.future).toEqual(['B']);
    expect(canUndo(u!.history)).toBe(false);
  });

  it('redo replays the undone snapshot', () => {
    let h = emptyHistory<string>();
    h = record(h, 'A'); // present B
    const u = undo(h, 'B')!; // present A, future [B]
    const r = redo(u.history, 'A');
    expect(r).not.toBeNull();
    expect(r!.present).toBe('B');
    expect(canRedo(r!.history)).toBe(false);
    expect(r!.history.past).toEqual(['A']);
  });

  it('undo on empty history returns null (caller no-ops)', () => {
    expect(undo(emptyHistory<string>(), 'X')).toBeNull();
  });

  it('redo on empty future returns null', () => {
    expect(redo(emptyHistory<string>(), 'X')).toBeNull();
  });

  it('multi-step: A->B->C, undo twice lands on A, redo twice lands on C', () => {
    let h = emptyHistory<string>();
    h = record(h, 'A'); // present B
    h = record(h, 'B'); // present C
    const u1 = undo(h, 'C')!; // present B
    expect(u1.present).toBe('B');
    const u2 = undo(u1.history, 'B')!; // present A
    expect(u2.present).toBe('A');
    expect(canUndo(u2.history)).toBe(false);
    const r1 = redo(u2.history, 'A')!; // present B
    expect(r1.present).toBe('B');
    const r2 = redo(r1.history, 'B')!; // present C
    expect(r2.present).toBe('C');
    expect(canRedo(r2.history)).toBe(false);
  });
});

describe('limit bounds memory', () => {
  it('drops the oldest past entry beyond the limit', () => {
    let h = emptyHistory<number>(3);
    for (let i = 0; i < 5; i++) h = record(h, i); // record 0,1,2,3,4
    // Only the last 3 are kept: 2,3,4.
    expect(h.past).toEqual([2, 3, 4]);
    expect(h.past.length).toBe(3);
  });
});
