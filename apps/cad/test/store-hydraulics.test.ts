// store.ts W5 hydraulics: supply + designArea state, setSupply / setDesignArea, and
// the selectHydraulics LIVE-RECALC selector. Editing a segment diameter (or the
// supply) recomputes the result. window.__cad exposes demand/riser-psi/adequacy.
//
// HONESTY: the selector is pure over the persisted network — no fabrication.

import { beforeEach, describe, expect, it } from 'vitest';
import { emptyProject } from '../src/lib/model';
import { EMPTY_SELECTION, selectHydraulics, useCadStore } from '../src/store';

function reset(): void {
  useCadStore.setState({
    project: emptyProject(),
    selection: { ...EMPTY_SELECTION },
    viewMode: 'split',
    activeTool: 'select',
    underlay: null,
    activeHeadSku: null,
    supplyPoint: null,
    supply: null,
    designAreaSqFt: null,
  });
}

function addRow(n: number, z: number, y = 10): void {
  for (let i = 0; i < n; i += 1) {
    useCadStore.getState().addHead({ x: i * 10, y, z });
  }
}

describe('setSupply / setDesignArea', () => {
  beforeEach(reset);

  it('stores and clears the supply', () => {
    useCadStore.getState().setSupply({ staticPsi: 70, residualPsi: 50, flowGpm: 1000 });
    expect(useCadStore.getState().supply).toEqual({ staticPsi: 70, residualPsi: 50, flowGpm: 1000 });
    useCadStore.getState().setSupply(null);
    expect(useCadStore.getState().supply).toBeNull();
  });

  it('clamps a non-positive design area to null (operate all heads)', () => {
    useCadStore.getState().setDesignArea(1500);
    expect(useCadStore.getState().designAreaSqFt).toBe(1500);
    useCadStore.getState().setDesignArea(0);
    expect(useCadStore.getState().designAreaSqFt).toBeNull();
    useCadStore.getState().setDesignArea(-5);
    expect(useCadStore.getState().designAreaSqFt).toBeNull();
  });
});

describe('selectHydraulics — live recalc', () => {
  beforeEach(reset);

  it('produces demand + riser pressure once the system is routed', () => {
    addRow(3, 0);
    useCadStore.getState().routeSystem();
    const res = selectHydraulics(useCadStore.getState());
    expect(res.systemDemand.gpm).toBeGreaterThan(0);
    expect(res.systemDemand.psiAtRiser).toBeGreaterThan(0);
    expect(res.remoteAreaHeadIds.length).toBeGreaterThan(0);
  });

  it('editing a segment diameter CHANGES the result (smaller -> higher riser psi)', () => {
    addRow(4, 0);
    useCadStore.getState().routeSystem();
    const before = selectHydraulics(useCadStore.getState()).systemDemand.psiAtRiser;
    // Shrink the first branch segment -> more friction -> higher required pressure.
    const seg = useCadStore.getState().project.network.segments.find((s) => s.role === 'BRANCH')!;
    useCadStore.getState().setSegmentDiameter(seg.id, 0.5);
    const after = selectHydraulics(useCadStore.getState()).systemDemand.psiAtRiser;
    expect(after).toBeGreaterThan(before);
  });

  it('setting a supply flips adequacy live', () => {
    addRow(3, 0);
    useCadStore.getState().routeSystem();
    // No supply -> not adequate.
    expect(selectHydraulics(useCadStore.getState()).adequate).toBe(false);
    // Strong supply -> adequate.
    useCadStore.getState().setSupply({ staticPsi: 90, residualPsi: 80, flowGpm: 1000 });
    expect(selectHydraulics(useCadStore.getState()).adequate).toBe(true);
    // Weak supply -> short again.
    useCadStore.getState().setSupply({ staticPsi: 8, residualPsi: 4, flowGpm: 30 });
    expect(selectHydraulics(useCadStore.getState()).adequate).toBe(false);
  });

  it('a design area narrows the operating head count live', () => {
    addRow(6, 0);
    useCadStore.getState().routeSystem();
    const all = selectHydraulics(useCadStore.getState()).remoteAreaHeadIds.length;
    expect(all).toBe(6);
    // emptyProject default hazard is LIGHT (225 ft^2/head): ceil(300/225) = 2.
    useCadStore.getState().setDesignArea(300);
    expect(selectHydraulics(useCadStore.getState()).remoteAreaHeadIds.length).toBe(2);
  });
});
