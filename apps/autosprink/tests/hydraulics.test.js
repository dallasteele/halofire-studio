import { describe, expect, it } from 'vitest';
import {
  computeHydraulics,
  hazenWilliamsLossPsiPerFt,
  remoteAreaDemand,
  requiredPressureAtRiser,
  flagSchedule,
  velocityFps,
} from '../src/engine/hydraulics.js';
import { buildRoomCad } from '../src/engine/cad-model.js';

const rect = (w, h) => [[0, 0], [w, 0], [w, h], [0, h]];

// Hand-computed Hazen-Williams: p = 4.52 * Q^1.852 / (C^1.852 * d^4.8704) psi/ft.
// Q=100 gpm, d=2 in, C=120 -> 4.52*100^1.852 / (120^1.852 * 2^4.8704)
//   = 0.1102448412... psi/ft  (verified independently with node)
describe('hazenWilliamsLossPsiPerFt (hand-computed)', () => {
  it('matches the standard formula for Q=100, d=2, C=120', () => {
    expect(hazenWilliamsLossPsiPerFt(100, 2, 120)).toBeCloseTo(0.11024484, 7);
  });

  it('matches for Q=20, d=1, C=120', () => {
    expect(hazenWilliamsLossPsiPerFt(20, 1, 120)).toBeCloseTo(0.16368253, 7);
  });

  it('matches for Q=50, d=1.5, C=120', () => {
    expect(hazenWilliamsLossPsiPerFt(50, 1.5, 120)).toBeCloseTo(0.12398020, 7);
  });

  it('defaults C to 120', () => {
    expect(hazenWilliamsLossPsiPerFt(100, 2)).toBeCloseTo(hazenWilliamsLossPsiPerFt(100, 2, 120), 10);
  });

  it('is zero at zero flow and rises monotonically with flow', () => {
    expect(hazenWilliamsLossPsiPerFt(0, 2, 120)).toBe(0);
    expect(hazenWilliamsLossPsiPerFt(200, 2, 120)).toBeGreaterThan(hazenWilliamsLossPsiPerFt(100, 2, 120));
  });

  it('falls as diameter grows', () => {
    expect(hazenWilliamsLossPsiPerFt(100, 4, 120)).toBeLessThan(hazenWilliamsLossPsiPerFt(100, 2, 120));
  });

  it('rejects non-positive diameter', () => {
    expect(() => hazenWilliamsLossPsiPerFt(100, 0, 120)).toThrow();
  });
});

// velocity v = 0.4085 * Q / d^2 (fps). Q=100, d=2 -> 10.2125 fps.
describe('velocityFps (hand-computed)', () => {
  it('matches v = 0.4085*Q/d^2 for Q=100, d=2', () => {
    expect(velocityFps(100, 2)).toBeCloseTo(10.2125, 6);
  });
  it('matches for Q=20, d=1', () => {
    expect(velocityFps(20, 1)).toBeCloseTo(8.17, 6);
  });
});

describe('remoteAreaDemand (NFPA 13 density × area-of-operation)', () => {
  it('light hazard: 0.10 over 1500 -> 150 gpm', () => {
    const d = remoteAreaDemand('light');
    expect(d.densityGpmPerSqft).toBeCloseTo(0.10, 6);
    expect(d.designAreaSqft).toBe(1500);
    expect(d.requiredFlowGpm).toBeCloseTo(150, 6);
  });

  it('ordinary hazard: 0.18 over 1500 -> 270 gpm', () => {
    const d = remoteAreaDemand('ordinary');
    expect(d.densityGpmPerSqft).toBeCloseTo(0.18, 6);
    expect(d.designAreaSqft).toBe(1500);
    expect(d.requiredFlowGpm).toBeCloseTo(270, 6);
  });

  it('extra hazard: 0.30 over 2500 -> 750 gpm', () => {
    const d = remoteAreaDemand('extra');
    expect(d.densityGpmPerSqft).toBeCloseTo(0.30, 6);
    expect(d.designAreaSqft).toBe(2500);
    expect(d.requiredFlowGpm).toBeCloseTo(750, 6);
  });

  it('defaults unknown hazard to ordinary', () => {
    expect(remoteAreaDemand('bogus').requiredFlowGpm).toBeCloseTo(270, 6);
  });
});

describe('requiredPressureAtRiser', () => {
  const room = { name: 'Bay', polygon: rect(60, 40), hazard: 'light', ceilingHeightFt: 14 };
  const cad = buildRoomCad(room);
  const result = requiredPressureAtRiser({ cadModel: cad, hazard: 'light' });

  it('returns the demand flow, friction, elevation, and total pressure', () => {
    expect(result.requiredFlowGpm).toBeCloseTo(150, 6);
    expect(result.frictionLossPsi).toBeGreaterThan(0);
    expect(result.segments.length).toBeGreaterThan(0);
  });

  it('elevation head = 0.433 psi/ft of rise from floor to the remote head', () => {
    // riser climbs floor(0) -> mainZ; head sits at headZ. Net rise to head = headZ.
    // ceiling 14 -> headZ 12.5 -> 0.433*12.5 = 5.4125; engine rounds to 3 dp -> 5.413.
    const headZ = cad.network.headZ;
    expect(headZ).toBe(12.5);
    expect(result.elevationPsi).toBe(5.413);
    expect(result.elevationPsi).toBeCloseTo(0.433 * headZ, 2);
  });

  it('required pressure = friction + elevation + min operating head (7 psi default)', () => {
    expect(result.requiredPressurePsi).toBeCloseTo(
      result.frictionLossPsi + result.elevationPsi + 7,
      4,
    );
  });

  it('accepts a raw network instead of a cadModel', () => {
    const viaNetwork = requiredPressureAtRiser({ network: cad.network, hazard: 'light' });
    expect(viaNetwork.requiredPressurePsi).toBeCloseTo(result.requiredPressurePsi, 6);
  });

  it('honors a custom minimum operating pressure', () => {
    const r2 = requiredPressureAtRiser({ cadModel: cad, hazard: 'light', minHeadPressurePsi: 0 });
    expect(r2.requiredPressurePsi).toBeCloseTo(result.frictionLossPsi + result.elevationPsi, 4);
  });

  it('each segment carries diameter, length, flow, loss and velocity', () => {
    for (const seg of result.segments) {
      expect(seg.diameterIn).toBeGreaterThan(0);
      expect(seg.lengthFt).toBeGreaterThanOrEqual(0);
      expect(seg.flowGpm).toBeGreaterThan(0);
      expect(seg.lossPsi).toBeGreaterThanOrEqual(0);
      expect(seg.velocityFps).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('flagSchedule', () => {
  it('returns no high-velocity warnings for a sanely-sized light-hazard room', () => {
    const room = { name: 'Bay', polygon: rect(60, 40), hazard: 'light', ceilingHeightFt: 14 };
    const cad = buildRoomCad(room);
    const warnings = flagSchedule(cad, 'light');
    expect(Array.isArray(warnings)).toBe(true);
    expect(warnings.filter((w) => w.type === 'velocity')).toHaveLength(0);
  });

  it('flags velocity when full demand is forced through a tiny pipe', () => {
    // Synthetic network: 750 gpm (extra-hazard demand) shoved through a 1" branch.
    const network = {
      headZ: 12,
      branchLines: [
        { row: 0, y: 0, startX: 0, endX: 40, headCount: 50, diameterIn: 1.0 },
      ],
      mainX: 0,
      mainZ: 13,
      branchZ: 13,
    };
    const warnings = flagSchedule(network, 'extra');
    expect(warnings.some((w) => w.type === 'velocity')).toBe(true);
  });
});

describe('computeHydraulics', () => {
  it('includes hanger spacing compliance for a model with properly spaced hangers', () => {
    const cadModel = {
      material: 'steel',
      solids: [
        {
          kind: 'pipe',
          name: 'branch-0',
          role: 'branch',
          diameterIn: 2,
          from: [0, 0, 10],
          to: [30, 0, 10],
          hangers: [{ offsetFt: 0 }, { offsetFt: 15 }, { offsetFt: 30 }],
        },
      ],
      network: {
        branchLines: [{ row: 0, y: 0, startX: 0, endX: 30, headCount: 6, diameterIn: 2 }],
        mainX: 0,
        mainZ: 13,
        branchZ: 10,
        headZ: 9,
        totalHeads: 6,
      },
    };

    const result = computeHydraulics({ cadModel, hazard: 'light' });
    expect(result.hangerSpacingResult).toEqual({
      spacing: 15,
      requiredCount: 3,
      isCompliant: true,
    });
    expect(result.requiredFlowGpm).toBeGreaterThan(0);
  });
});
