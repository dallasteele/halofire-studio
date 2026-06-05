import { describe, it, expect } from 'vitest';
import {
  sprinklerHeadScad,
  pipeScad,
  teeScad,
  elbowScad,
  couplingScad,
  reducerScad,
  valveScad,
  hangerScad,
  generateScadFor,
  renderScadToStl,
} from '../src/components/openscad/generators.js';

const BEST_EFFORT = /best-effort/i;
const NOT_EXACT = /not manufacturer-exact/i;

describe('openscad generators — per-component .scad source', () => {
  it('sprinklerHeadScad returns a parametric module with best-effort label', () => {
    const scad = sprinklerHeadScad({ type: 'pendent', k: 5.6, thread: '1/2 NPT' });
    expect(typeof scad).toBe('string');
    expect(scad.length).toBeGreaterThan(0);
    expect(scad).toMatch(/module\s+sprinkler_head/);
    expect(scad).toMatch(BEST_EFFORT);
    expect(scad).toMatch(NOT_EXACT);
    // params surface into the source
    expect(scad).toContain('5.6');
    expect(scad).toContain('pendent');
  });

  it('pipeScad returns a parametric cylinder module with the length and schedule', () => {
    const scad = pipeScad({ nominalIn: 2, lengthFt: 10, schedule: '40' });
    expect(scad).toMatch(/module\s+pipe/);
    expect(scad).toMatch(/cylinder/);
    expect(scad).toMatch(BEST_EFFORT);
    expect(scad).toContain('Schedule 40');
  });

  it('teeScad returns a parametric tee module naming run and branch', () => {
    const scad = teeScad({ runIn: 2, branchIn: 1.5 });
    expect(scad).toMatch(/module\s+tee/);
    expect(scad).toMatch(BEST_EFFORT);
    expect(scad).toContain('run');
    expect(scad).toContain('branch');
  });

  it('elbowScad returns a parametric elbow module with the angle', () => {
    const scad = elbowScad({ nominalIn: 2, deg: 90 });
    expect(scad).toMatch(/module\s+elbow/);
    expect(scad).toMatch(BEST_EFFORT);
    expect(scad).toContain('90');
  });

  it('couplingScad returns a parametric coupling module', () => {
    const scad = couplingScad({ nominalIn: 3 });
    expect(scad).toMatch(/module\s+coupling/);
    expect(scad).toMatch(BEST_EFFORT);
  });

  it('reducerScad returns a parametric reducer module naming both sizes', () => {
    const scad = reducerScad({ fromIn: 4, toIn: 2 });
    expect(scad).toMatch(/module\s+reducer/);
    expect(scad).toMatch(BEST_EFFORT);
    expect(scad).toContain('4');
    expect(scad).toContain('2');
  });

  it('valveScad returns a parametric valve module with type and size', () => {
    const scad = valveScad({ type: 'butterfly', nominalIn: 4 });
    expect(scad).toMatch(/module\s+valve/);
    expect(scad).toMatch(BEST_EFFORT);
    expect(scad).toContain('butterfly');
  });

  it('hangerScad returns a parametric hanger module', () => {
    const scad = hangerScad({ nominalIn: 2 });
    expect(scad).toMatch(/module\s+hanger/);
    expect(scad).toMatch(BEST_EFFORT);
  });

  it('every generator names the component and is clearly NOT manufacturer-exact', () => {
    const all = [
      sprinklerHeadScad({ type: 'upright', k: 8.0, thread: '1/2 NPT' }),
      pipeScad({ nominalIn: 1, lengthFt: 4, schedule: '10' }),
      teeScad({ runIn: 2, branchIn: 2 }),
      elbowScad({ nominalIn: 2, deg: 45 }),
      couplingScad({ nominalIn: 2 }),
      reducerScad({ fromIn: 3, toIn: 2 }),
      valveScad({ type: 'check', nominalIn: 4 }),
      hangerScad({ nominalIn: 1.5 }),
    ];
    for (const scad of all) {
      expect(scad).toMatch(BEST_EFFORT);
      expect(scad).toMatch(NOT_EXACT);
      // commented header with $fn so the source actually renders smoothly
      expect(scad).toMatch(/\$fn/);
    }
  });
});

describe('generateScadFor — dispatch by category', () => {
  it('dispatches heads to sprinklerHeadScad', () => {
    const scad = generateScadFor({
      category: 'heads',
      params: { type: 'pendent', kFactors: [5.6], thread: '1/2 NPT' },
    });
    expect(scad).toMatch(/module\s+sprinkler_head/);
  });

  it('dispatches pipe to pipeScad', () => {
    const scad = generateScadFor({ category: 'pipe', params: { nominalSizesIn: [2], schedule: '40' } });
    expect(scad).toMatch(/module\s+pipe/);
  });

  it('dispatches a tee fitting to teeScad', () => {
    const scad = generateScadFor({ key: 'fitting_tee', category: 'fittings', params: { nominalSizesIn: [2] } });
    expect(scad).toMatch(/module\s+tee/);
  });

  it('dispatches a 90 elbow fitting to elbowScad', () => {
    const scad = generateScadFor({ key: 'fitting_elbow_90', category: 'fittings', params: { nominalSizesIn: [2], angleDeg: 90 } });
    expect(scad).toMatch(/module\s+elbow/);
    expect(scad).toContain('90');
  });

  it('dispatches a coupling fitting to couplingScad', () => {
    const scad = generateScadFor({ key: 'fitting_coupling', category: 'fittings', params: { nominalSizesIn: [3] } });
    expect(scad).toMatch(/module\s+coupling/);
  });

  it('dispatches a reducer fitting to reducerScad', () => {
    const scad = generateScadFor({ key: 'fitting_reducer', category: 'fittings', params: { nominalSizesIn: [4, 2] } });
    expect(scad).toMatch(/module\s+reducer/);
  });

  it('dispatches valves to valveScad', () => {
    const scad = generateScadFor({ category: 'valves', name: 'Butterfly valve', params: { nominalSizesIn: [4] } });
    expect(scad).toMatch(/module\s+valve/);
  });

  it('dispatches hanger to hangerScad', () => {
    const scad = generateScadFor({ category: 'hanger', params: { nominalSizesIn: [2] } });
    expect(scad).toMatch(/module\s+hanger/);
  });

  it('returns null for an unknown / unsupported category (fail-closed, no fake geometry)', () => {
    expect(generateScadFor({ category: 'identification_sign', params: {} })).toBeNull();
    expect(generateScadFor(null)).toBeNull();
    expect(generateScadFor({})).toBeNull();
  });
});

describe('renderScadToStl — injected runner only, never spawns', () => {
  it('with a mock runner returns ok + stl', async () => {
    const runner = async (scad) => ({ stl: `STL(${scad.length})` });
    const out = await renderScadToStl('module x(){}', { runner });
    expect(out.ok).toBe(true);
    expect(out.stl).toBe('STL(12)');
  });

  it('with no runner returns ok:false reason openscad_not_installed (fail-closed)', async () => {
    const out = await renderScadToStl('module x(){}', {});
    expect(out.ok).toBe(false);
    expect(out.reason).toBe('openscad_not_installed');
  });

  it('with no options at all returns ok:false reason openscad_not_installed', async () => {
    const out = await renderScadToStl('module x(){}');
    expect(out.ok).toBe(false);
    expect(out.reason).toBe('openscad_not_installed');
  });

  it('a throwing runner fails closed to ok:false (does not leak the error / never claims success)', async () => {
    const runner = async () => {
      throw new Error('openscad crashed');
    };
    const out = await renderScadToStl('module x(){}', { runner });
    expect(out.ok).toBe(false);
    expect(out.reason).toBe('render_failed');
  });

  it('a runner returning a string stl is accepted', async () => {
    const runner = async () => 'solid raw\nendsolid raw';
    const out = await renderScadToStl('module x(){}', { runner });
    expect(out.ok).toBe(true);
    expect(out.stl).toContain('solid raw');
  });
});
