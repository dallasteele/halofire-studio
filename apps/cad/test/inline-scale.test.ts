// PlanCanvas set-scale (W7): the scale-apply path must call setScale with the
// ft/unit computed from the two picked points + the typed known distance, and the
// set-scale flow must NOT use window.prompt/alert anymore (replaced by an in-app
// inline popover). We assert the math via the pure scale helper the component calls,
// and grep the component source to prove window.prompt is gone from the flow.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { distanceUnits, setScaleFromTwoPoints } from '../src/lib/scale';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLAN_CANVAS = readFileSync(
  join(__dirname, '..', 'src', 'components', 'PlanCanvas.tsx'),
  'utf8',
);

describe('inline set-scale — apply path computes the right ft/unit', () => {
  it('setScaleFromTwoPoints yields knownFeet / pixelDistance (what applyScalePrompt feeds setScale)', () => {
    const a = { x: 0, y: 0 };
    const b = { x: 100, y: 0 }; // 100 plan units apart
    const knownFeet = 25;
    const ft = setScaleFromTwoPoints(a, b, knownFeet);
    // ft/unit = known real feet / measured units.
    expect(ft).toBeCloseTo(knownFeet / distanceUnits(a, b), 10);
    expect(ft).toBeCloseTo(0.25, 10);
  });

  it('rejects a non-positive / non-finite known distance (Apply surfaces the error)', () => {
    const a = { x: 0, y: 0 };
    const b = { x: 10, y: 0 };
    expect(() => setScaleFromTwoPoints(a, b, 0)).toThrow();
    expect(() => setScaleFromTwoPoints(a, b, Number.NaN)).toThrow();
  });
});

describe('no window.prompt/alert in the set-scale flow', () => {
  // The flow now uses an in-app inline popover. Strip line comments first so a
  // mention of "window.prompt" in a comment does not falsely fail the assertion;
  // we only care that there is no live CALL to window.prompt/window.alert/prompt(.
  const codeOnly = PLAN_CANVAS
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');

  it('PlanCanvas.tsx does not call window.prompt', () => {
    expect(codeOnly).not.toMatch(/window\.prompt\s*\(/);
    expect(codeOnly).not.toMatch(/[^.\w]prompt\s*\(/);
  });

  it('PlanCanvas.tsx does not call window.alert', () => {
    expect(codeOnly).not.toMatch(/window\.alert\s*\(/);
    expect(codeOnly).not.toMatch(/[^.\w]alert\s*\(/);
  });

  it('PlanCanvas.tsx wires the inline popover to setScale via applyScalePrompt', () => {
    expect(codeOnly).toMatch(/applyScalePrompt/);
    expect(codeOnly).toMatch(/setScaleFromTwoPoints/);
    expect(codeOnly).toMatch(/setScale\(/);
  });
});
