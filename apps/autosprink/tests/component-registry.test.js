import { describe, it, expect } from 'vitest';
import {
  COMPONENTS,
  getComponent,
  componentsByCategory,
  buildParityInventory,
  AUTOSPRINK_PARITY_GATE,
  parityGateStatus,
} from '../src/components/registry.js';

// Every category the roadmap (T15) requires the inventory to cover.
const REQUIRED_CATEGORIES = [
  'heads',
  'pipe',
  'fittings',
  'grooved',
  'valves',
  'fdc',
  'backflow_preventer',
  'riser_assembly',
  'riser_trim',
  'gauge',
  'hanger',
  'seismic_brace',
  'drain',
  'inspector_test',
  'identification_sign',
];

describe('COMPONENTS inventory', () => {
  it('is a non-empty frozen array', () => {
    expect(Array.isArray(COMPONENTS)).toBe(true);
    expect(COMPONENTS.length).toBeGreaterThan(0);
    expect(Object.isFrozen(COMPONENTS)).toBe(true);
  });

  it('every entry has the canonical shape { key, category, name, params, required }', () => {
    for (const c of COMPONENTS) {
      expect(typeof c.key).toBe('string');
      expect(c.key.length).toBeGreaterThan(0);
      expect(typeof c.category).toBe('string');
      expect(typeof c.name).toBe('string');
      expect(c.name.length).toBeGreaterThan(0);
      expect(c.params).toBeTypeOf('object');
      expect(c.params).not.toBeNull();
      expect(typeof c.required).toBe('boolean');
      // entries (and their params) should be immutable
      expect(Object.isFrozen(c)).toBe(true);
      expect(Object.isFrozen(c.params)).toBe(true);
    }
  });

  it('keys are unique', () => {
    const keys = COMPONENTS.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('covers every required category', () => {
    const cats = new Set(COMPONENTS.map((c) => c.category));
    for (const cat of REQUIRED_CATEGORIES) {
      expect(cats.has(cat)).toBe(true);
    }
  });

  it('includes the listed head members', () => {
    const headKeys = COMPONENTS.filter((c) => c.category === 'heads').map((c) => c.key);
    for (const m of [
      'head_pendent',
      'head_upright',
      'head_sidewall',
      'head_concealed',
      'head_dry_pendent',
      'head_esfr',
    ]) {
      expect(headKeys).toContain(m);
    }
  });

  it('includes the listed pipe members', () => {
    const pipeKeys = COMPONENTS.filter((c) => c.category === 'pipe').map((c) => c.key);
    expect(pipeKeys).toContain('pipe_sch10');
    expect(pipeKeys).toContain('pipe_sch40');
  });

  it('includes the listed fitting members', () => {
    const fitKeys = COMPONENTS.filter((c) => c.category === 'fittings').map((c) => c.key);
    for (const m of [
      'fitting_tee',
      'fitting_elbow_90',
      'fitting_elbow_45',
      'fitting_coupling',
      'fitting_reducer',
      'fitting_cap',
      'fitting_cross',
    ]) {
      expect(fitKeys).toContain(m);
    }
  });

  it('includes the listed grooved members', () => {
    const grKeys = COMPONENTS.filter((c) => c.category === 'grooved').map((c) => c.key);
    expect(grKeys).toContain('grooved_coupling');
    expect(grKeys).toContain('grooved_flange_adapter');
  });

  it('includes the listed valve members', () => {
    const valveKeys = COMPONENTS.filter((c) => c.category === 'valves').map((c) => c.key);
    for (const m of [
      'valve_alarm_check',
      'valve_check',
      'valve_butterfly',
      'valve_osy_gate',
      'valve_prv',
      'valve_deluge',
    ]) {
      expect(valveKeys).toContain(m);
    }
  });

  it('includes the listed drain members', () => {
    const drainKeys = COMPONENTS.filter((c) => c.category === 'drain').map((c) => c.key);
    expect(drainKeys).toContain('drain_main');
    expect(drainKeys).toContain('drain_aux');
  });

  it('marks required heads, pipe, core fittings and core valves as required', () => {
    for (const k of [
      'head_pendent',
      'pipe_sch40',
      'fitting_tee',
      'fitting_elbow_90',
      'valve_alarm_check',
      'fdc',
      'backflow_preventer',
      'riser_assembly',
    ]) {
      const c = getComponent(k);
      expect(c, `missing ${k}`).toBeTruthy();
      expect(c.required, `${k} should be required`).toBe(true);
    }
  });
});

describe('getComponent', () => {
  it('returns the entry for a known key', () => {
    const c = getComponent('head_pendent');
    expect(c).toBeTruthy();
    expect(c.key).toBe('head_pendent');
    expect(c.category).toBe('heads');
  });

  it('returns undefined for an unknown key', () => {
    expect(getComponent('does_not_exist')).toBeUndefined();
  });
});

describe('componentsByCategory', () => {
  it('groups every component under its category', () => {
    const grouped = componentsByCategory();
    const totalGrouped = Object.values(grouped).reduce((n, arr) => n + arr.length, 0);
    expect(totalGrouped).toBe(COMPONENTS.length);
    for (const cat of REQUIRED_CATEGORIES) {
      expect(Array.isArray(grouped[cat])).toBe(true);
      expect(grouped[cat].length).toBeGreaterThan(0);
    }
  });
});

describe('buildParityInventory', () => {
  it('counts a real catalog/generated model as present and a missing/placeholder as missing', () => {
    const status = {
      head_pendent: { source: 'catalog', model: 'pendent.glb' },
      pipe_sch40: { source: 'generated', model: 'pipe.scad' },
      fitting_tee: { source: 'placeholder' }, // not a real model -> missing
      valve_alarm_check: { source: 'missing' }, // explicitly missing
      // everything else absent -> missing
    };
    const inv = buildParityInventory(status);
    expect(inv.total).toBe(COMPONENTS.length);
    expect(inv.present).toBe(2);
    expect(inv.missing).toContain('fitting_tee');
    expect(inv.missing).toContain('valve_alarm_check');
    expect(inv.missing).toContain('head_upright');
    expect(inv.missing).not.toContain('head_pendent');
    expect(inv.missing).not.toContain('pipe_sch40');
    expect(inv.parityComplete).toBe(false);
  });

  it('does not count a present source flag without an actual model', () => {
    const status = { head_pendent: { source: 'catalog' } }; // no model field
    const inv = buildParityInventory(status);
    expect(inv.present).toBe(0);
    expect(inv.missing).toContain('head_pendent');
  });

  it('treats an empty/undefined status map as everything missing', () => {
    const inv = buildParityInventory();
    expect(inv.present).toBe(0);
    expect(inv.missing.length).toBe(COMPONENTS.length);
    expect(inv.parityComplete).toBe(false);
  });

  it('byCategory reports present/total per category', () => {
    const inv = buildParityInventory({ head_pendent: { source: 'catalog', model: 'x.glb' } });
    expect(inv.byCategory.heads.total).toBeGreaterThan(0);
    expect(inv.byCategory.heads.present).toBe(1);
    expect(inv.byCategory.pipe.present).toBe(0);
  });

  it('parityComplete is true only when EVERY required component has a real model', () => {
    // Give a real model to every required component but leave optional ones missing.
    const status = {};
    for (const c of COMPONENTS) {
      if (c.required) status[c.key] = { source: 'catalog', model: `${c.key}.glb` };
    }
    const inv = buildParityInventory(status);
    expect(inv.parityComplete).toBe(true);
    // dropping one required component breaks parity
    const required = COMPONENTS.filter((c) => c.required);
    const partial = { ...status };
    delete partial[required[0].key];
    expect(buildParityInventory(partial).parityComplete).toBe(false);
  });
});

describe('AUTOSPRINK_PARITY_GATE + parityGateStatus (fail-closed)', () => {
  it('is a blocking, blocked claim-gate descriptor', () => {
    expect(AUTOSPRINK_PARITY_GATE.code).toBe('AUTOSPRINK_PARITY_INCOMPLETE');
    expect(AUTOSPRINK_PARITY_GATE.severity).toBe('blocking');
    expect(AUTOSPRINK_PARITY_GATE.status).toBe('blocked');
    expect(AUTOSPRINK_PARITY_GATE.blockedClaims).toContain('AutoSprink parity');
    expect(AUTOSPRINK_PARITY_GATE.blockedClaims).toContain('complete component library');
    expect(Object.isFrozen(AUTOSPRINK_PARITY_GATE)).toBe(true);
  });

  it('stays blocked while anything is missing', () => {
    expect(parityGateStatus(buildParityInventory())).toBe('blocked');
    const partial = buildParityInventory({ head_pendent: { source: 'catalog', model: 'x.glb' } });
    expect(parityGateStatus(partial)).toBe('blocked');
  });

  it('clears only when the inventory is genuinely complete', () => {
    const status = {};
    for (const c of COMPONENTS) {
      if (c.required) status[c.key] = { source: 'catalog', model: `${c.key}.glb` };
    }
    const inv = buildParityInventory(status);
    expect(inv.parityComplete).toBe(true);
    expect(parityGateStatus(inv)).toBe('clear');
  });
});
