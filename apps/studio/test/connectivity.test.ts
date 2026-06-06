import { describe, expect, it } from 'vitest';
import {
  ADAPTERS,
  arePortsCompatible,
  checkPorts,
  connectableSizesFor,
  findAdapter,
  rolesOppose,
  type Port,
} from '../src/lib/connectivity';

function port(p: Partial<Port> & Pick<Port, 'method' | 'nominalSizeIn' | 'role'>): Port {
  return p;
}

describe('rolesOppose', () => {
  it('OUTLET feeds INLET in either order', () => {
    expect(rolesOppose('OUTLET', 'INLET')).toBe(true);
    expect(rolesOppose('INLET', 'OUTLET')).toBe(true);
  });
  it('same roles never oppose', () => {
    expect(rolesOppose('INLET', 'INLET')).toBe(false);
    expect(rolesOppose('OUTLET', 'OUTLET')).toBe(false);
  });
});

describe('arePortsCompatible — direct connections', () => {
  it('connects matching method + size with opposing roles', () => {
    const a = port({ method: 'THREADED_NPT', nominalSizeIn: 0.5, role: 'OUTLET' });
    const b = port({ method: 'THREADED_NPT', nominalSizeIn: 0.5, role: 'INLET' });
    expect(arePortsCompatible(a, b)).toBe(true);
  });

  it('rejects two inlets (role mismatch) even if method+size match', () => {
    const a = port({ method: 'THREADED_NPT', nominalSizeIn: 0.5, role: 'INLET' });
    const b = port({ method: 'THREADED_NPT', nominalSizeIn: 0.5, role: 'INLET' });
    expect(arePortsCompatible(a, b)).toBe(false);
    expect(checkPorts(a, b).reason).toBe('role');
  });

  it('rejects two outlets (role mismatch)', () => {
    const a = port({ method: 'GROOVED', nominalSizeIn: 4, role: 'OUTLET' });
    const b = port({ method: 'GROOVED', nominalSizeIn: 4, role: 'OUTLET' });
    expect(arePortsCompatible(a, b)).toBe(false);
  });

  it('rejects size mismatch with no real reducer', () => {
    const a = port({ method: 'GROOVED', nominalSizeIn: 4, role: 'OUTLET' });
    const b = port({ method: 'GROOVED', nominalSizeIn: 6, role: 'INLET' });
    const res = checkPorts(a, b);
    expect(res.compatible).toBe(false);
    expect(res.reason).toBe('size');
  });

  it('rejects method mismatch with no real adapter', () => {
    const a = port({ method: 'SOLDER', nominalSizeIn: 0.5, role: 'OUTLET' });
    const b = port({ method: 'THREADED_NPT', nominalSizeIn: 0.5, role: 'INLET' });
    const res = checkPorts(a, b);
    expect(res.compatible).toBe(false);
    expect(res.reason).toBe('method');
  });
});

describe('adapter bridging — real fittings only', () => {
  it('an NPT reducing bushing bridges 3/4" outlet to 1/2" head inlet', () => {
    const branchOutlet = port({ method: 'THREADED_NPT', nominalSizeIn: 0.75, role: 'OUTLET' });
    const headInlet = port({ method: 'THREADED_NPT', nominalSizeIn: 0.5, role: 'INLET' });
    const res = checkPorts(branchOutlet, headInlet);
    expect(res.compatible).toBe(true);
    expect(res.adapter).not.toBeNull();
    expect(res.adapter!.id).toBe('npt-bushing-075-050');
  });

  it('a grooved-flange adapter bridges grooved 4" to flanged 4"', () => {
    const grooved = port({ method: 'GROOVED', nominalSizeIn: 4, role: 'OUTLET' });
    const flanged = port({ method: 'FLANGED', nominalSizeIn: 4, role: 'INLET' });
    expect(arePortsCompatible(grooved, flanged)).toBe(true);
  });

  it('an NPT x grooved adapter nipple bridges NPT 2" to grooved 2"', () => {
    const npt = port({ method: 'THREADED_NPT', nominalSizeIn: 2, role: 'OUTLET' });
    const grooved = port({ method: 'GROOVED', nominalSizeIn: 2, role: 'INLET' });
    expect(arePortsCompatible(npt, grooved)).toBe(true);
  });

  it('still requires opposing roles even when an adapter exists', () => {
    const a = port({ method: 'THREADED_NPT', nominalSizeIn: 0.75, role: 'OUTLET' });
    const b = port({ method: 'THREADED_NPT', nominalSizeIn: 0.5, role: 'OUTLET' });
    expect(arePortsCompatible(a, b)).toBe(false);
  });

  it('does NOT invent an adapter for a non-existent transition', () => {
    // No real 4" NPT x 8" grooved adapter is encoded -> must reject.
    expect(
      findAdapter('THREADED_NPT', 4, 'GROOVED', 8),
    ).toBeNull();
    const a = port({ method: 'THREADED_NPT', nominalSizeIn: 4, role: 'OUTLET' });
    const b = port({ method: 'GROOVED', nominalSizeIn: 8, role: 'INLET' });
    expect(arePortsCompatible(a, b)).toBe(false);
  });
});

describe('findAdapter — symmetric', () => {
  it('finds the adapter in both directions', () => {
    const fwd = findAdapter('GROOVED', 2, 'FLANGED', 2);
    const rev = findAdapter('FLANGED', 2, 'GROOVED', 2);
    expect(fwd).not.toBeNull();
    expect(rev).not.toBeNull();
    expect(fwd!.id).toBe(rev!.id);
  });
});

describe('ADAPTERS honesty — every adapter is documented', () => {
  it('every adapter has a non-empty justification note', () => {
    expect(ADAPTERS.length).toBeGreaterThan(0);
    for (const ad of ADAPTERS) {
      expect(ad.note.trim().length).toBeGreaterThan(0);
      expect(ad.label.trim().length).toBeGreaterThan(0);
      expect(ad.fromSizeIn).toBeGreaterThan(0);
      expect(ad.toSizeIn).toBeGreaterThan(0);
    }
  });
});

describe('connectableSizesFor', () => {
  it('includes the port own method+size first', () => {
    const p = port({ method: 'THREADED_NPT', nominalSizeIn: 0.75, role: 'OUTLET' });
    const out = connectableSizesFor(p);
    expect(out[0]).toEqual({ method: 'THREADED_NPT', nominalSizeIn: 0.75 });
  });

  it('includes adapter-reachable transitions, no duplicates', () => {
    const p = port({ method: 'THREADED_NPT', nominalSizeIn: 0.75, role: 'OUTLET' });
    const out = connectableSizesFor(p);
    // 3/4 NPT reaches 1/2 NPT (bushing) and 1 NPT (bushing).
    expect(out).toContainEqual({ method: 'THREADED_NPT', nominalSizeIn: 0.5 });
    expect(out).toContainEqual({ method: 'THREADED_NPT', nominalSizeIn: 1 });
    const keys = out.map((o) => `${o.method}|${o.nominalSizeIn}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('grooved 2" can reach flanged 2"', () => {
    const p = port({ method: 'GROOVED', nominalSizeIn: 2, role: 'OUTLET' });
    const out = connectableSizesFor(p);
    expect(out).toContainEqual({ method: 'FLANGED', nominalSizeIn: 2 });
  });
});
