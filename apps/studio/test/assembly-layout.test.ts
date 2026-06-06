import { describe, expect, it } from 'vitest';
import {
  computeAssembly,
  summarizeAssembly,
  assemblyPartSources,
  PLACED_PART_KINDS,
  ASSEMBLY_DESIGN_AID_DISCLAIMER,
  type AssemblySpec,
  type ResolvedHeadGeometry,
} from '../src/lib/assembly-layout';
import { MAX_SPACING_FT, type HazardClass } from '../src/lib/nfpa13-rules';

const REAL_HEAD: ResolvedHeadGeometry = {
  source: 'build123d',
  build123dKey: 'head_pendent',
  modelStatus: 'dimensioned_parametric',
};

const NONE_HEAD: ResolvedHeadGeometry = {
  source: 'none',
  modelStatus: null,
};

function spec(over: Partial<AssemblySpec> = {}): AssemblySpec {
  return {
    headSku: 'reliable-ra1311',
    hazard: 'ordinary_1',
    branchCount: 3,
    headsPerBranch: 4,
    headGeometry: REAL_HEAD,
    ...over,
  };
}

describe('computeAssembly — head count', () => {
  it('places exactly branchCount * headsPerBranch heads', () => {
    const a = computeAssembly(spec({ branchCount: 3, headsPerBranch: 4 }));
    const heads = a.parts.filter((p) => p.kind === 'head');
    expect(heads.length).toBe(12);
    expect(a.headsPlaced).toBe(12);
  });

  it('handles a single head', () => {
    const a = computeAssembly(spec({ branchCount: 1, headsPerBranch: 1 }));
    expect(a.headsPlaced).toBe(1);
    expect(a.parts.filter((p) => p.kind === 'head').length).toBe(1);
  });

  it('clamps non-positive / fractional counts to >= 1 integers', () => {
    const a = computeAssembly(spec({ branchCount: 0, headsPerBranch: 2.7 }));
    // branchCount 0 -> 1, headsPerBranch 2.7 -> 2.
    expect(a.headsPlaced).toBe(2);
  });
});

describe('computeAssembly — head spacing equals the real cited NFPA-13 max', () => {
  const hazards: HazardClass[] = ['light', 'ordinary_1', 'ordinary_2', 'extra_1', 'extra_2'];

  for (const hazard of hazards) {
    it(`uses MAX_SPACING_FT[${hazard}] for head + branch spacing`, () => {
      const a = computeAssembly(spec({ hazard, branchCount: 3, headsPerBranch: 3 }));
      const expected = MAX_SPACING_FT[hazard].value;
      expect(a.spacingFt).toBe(expected);
      expect(a.spacingCitation).toBe(MAX_SPACING_FT[hazard].citation);

      // Measured head-to-head spacing along a branch equals the rule.
      const heads = a.parts
        .filter((p) => p.kind === 'head' && p.position[2] === a.parts.find((q) => q.kind === 'head')!.position[2])
        .map((p) => p.position[0])
        .sort((x, y) => x - y);
      if (heads.length >= 2) {
        const step = heads[1] - heads[0];
        expect(step).toBeCloseTo(expected as number, 6);
      }
    });
  }

  it('branch-to-branch spacing also equals the cited max', () => {
    const a = computeAssembly(spec({ hazard: 'extra_1', branchCount: 3, headsPerBranch: 2 }));
    const expected = MAX_SPACING_FT.extra_1.value as number;
    // Distinct Z rows (one per branch), sorted.
    const rows = [...new Set(a.parts.filter((p) => p.kind === 'head').map((p) => p.position[2]))].sort(
      (x, y) => x - y,
    );
    expect(rows.length).toBe(3);
    expect(rows[1] - rows[0]).toBeCloseTo(expected, 6);
    expect(rows[2] - rows[1]).toBeCloseTo(expected, 6);
  });
});

describe('computeAssembly — deterministic + non-overlapping', () => {
  it('is deterministic: identical specs produce identical parts', () => {
    const a = computeAssembly(spec());
    const b = computeAssembly(spec());
    expect(JSON.stringify(a.parts)).toBe(JSON.stringify(b.parts));
  });

  it('no two heads share a position', () => {
    const a = computeAssembly(spec({ branchCount: 4, headsPerBranch: 5 }));
    const heads = a.parts.filter((p) => p.kind === 'head');
    const seen = new Set<string>();
    for (const h of heads) {
      const key = h.position.join(',');
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
    expect(seen.size).toBe(heads.length);
  });

  it('adjacent heads are at least the head-to-head minimum apart (>= 6 ft)', () => {
    // Max spacing is always >= the 6 ft head-to-head minimum, so the grid never
    // violates the minimum. Verify the closest pair distance.
    const a = computeAssembly(spec({ hazard: 'extra_1', branchCount: 3, headsPerBranch: 3 }));
    const heads = a.parts.filter((p) => p.kind === 'head');
    let minDist = Infinity;
    for (let i = 0; i < heads.length; i += 1) {
      for (let j = i + 1; j < heads.length; j += 1) {
        const dx = heads[i].position[0] - heads[j].position[0];
        const dz = heads[i].position[2] - heads[j].position[2];
        minDist = Math.min(minDist, Math.hypot(dx, dz));
      }
    }
    expect(minDist).toBeGreaterThanOrEqual(6);
  });

  it('does not use Date or random (stable across calls within a run)', () => {
    const runs = Array.from({ length: 5 }, () => JSON.stringify(computeAssembly(spec()).parts));
    expect(new Set(runs).size).toBe(1);
  });
});

describe('computeAssembly — every part references a real key OR is an honest proxy', () => {
  it('build123d placements carry a non-empty key and dimensioned_parametric tier', () => {
    const a = computeAssembly(spec());
    for (const p of a.parts.filter((q) => q.partSource === 'build123d')) {
      expect(p.partKey.length).toBeGreaterThan(0);
      // build123d fittings + real heads are dimensioned_parametric (never higher).
      expect(p.provenanceTier).toBe('dimensioned_parametric');
    }
  });

  it('schematic pipe runs make NO real-tier claim (provenanceTier null) and carry a length', () => {
    const a = computeAssembly(spec());
    const pipes = a.parts.filter((p) => p.partSource === 'schematic');
    expect(pipes.length).toBeGreaterThan(0);
    for (const p of pipes) {
      expect(p.provenanceTier).toBeNull();
      expect(typeof p.lengthFt).toBe('number');
      expect(p.lengthFt as number).toBeGreaterThan(0);
      expect(['branch_pipe', 'cross_main', 'riser']).toContain(p.kind);
    }
  });

  it('a proxy head makes NO real-tier claim and is tagged partSource "proxy"', () => {
    const a = computeAssembly(spec({ headGeometry: NONE_HEAD }));
    const heads = a.parts.filter((p) => p.kind === 'head');
    for (const h of heads) {
      expect(h.partSource).toBe('proxy');
      expect(h.provenanceTier).toBeNull();
    }
  });

  it('a real head uses the resolved build123d key + the resolver tier', () => {
    const a = computeAssembly(spec({ headGeometry: REAL_HEAD }));
    const heads = a.parts.filter((p) => p.kind === 'head');
    for (const h of heads) {
      expect(h.partSource).toBe('build123d');
      expect(h.partKey).toBe('head_pendent');
      expect(h.provenanceTier).toBe('dimensioned_parametric');
    }
  });

  it('every placed part is one of the declared kinds', () => {
    const a = computeAssembly(spec());
    for (const p of a.parts) {
      expect(PLACED_PART_KINDS).toContain(p.kind);
    }
  });
});

describe('computeAssembly — provenance tier never exceeds the resolver', () => {
  it('head tier never exceeds the resolver-granted tier (null head -> null)', () => {
    const a = computeAssembly(spec({ headGeometry: NONE_HEAD }));
    for (const h of a.parts.filter((p) => p.kind === 'head')) {
      expect(h.provenanceTier).toBeNull();
    }
  });

  it('NEVER claims manufacturer_verified / sealed_approved anywhere', () => {
    const a = computeAssembly(spec());
    for (const p of a.parts) {
      expect(p.provenanceTier).not.toBe('manufacturer_verified');
      expect(p.provenanceTier).not.toBe('sealed_approved');
    }
  });

  it('a head resolved as visual_reference stays visual_reference (not upgraded)', () => {
    // If a resolver ever granted a lower tier with a build123d key, we honor it.
    const lowHead: ResolvedHeadGeometry = {
      source: 'build123d',
      build123dKey: 'head_pendent',
      modelStatus: 'visual_reference',
    };
    const a = computeAssembly(spec({ headGeometry: lowHead }));
    for (const h of a.parts.filter((p) => p.kind === 'head')) {
      expect(h.provenanceTier).toBe('visual_reference');
    }
  });
});

describe('computeAssembly — topology fittings', () => {
  it('places a tee + reducer + elbow per branch', () => {
    const a = computeAssembly(spec({ branchCount: 3, headsPerBranch: 4 }));
    const s = summarizeAssembly(a);
    expect(s.byKind.tee).toBe(3);
    expect(s.byKind.reducer).toBe(3);
    expect(s.byKind.elbow).toBe(3);
    expect(s.byKind.branch_pipe).toBe(3);
    expect(s.byKind.cross_main).toBe(1);
    expect(s.byKind.riser).toBe(1);
    expect(s.byKind.head).toBe(12);
  });

  it('tees reference the real fitting_tee build123d key', () => {
    const a = computeAssembly(spec());
    for (const t of a.parts.filter((p) => p.kind === 'tee')) {
      expect(t.partKey).toBe('fitting_tee');
      expect(t.partSource).toBe('build123d');
    }
  });
});

describe('computeAssembly — usesRealGeometry + reporting', () => {
  it('usesRealGeometry is true when build123d fittings/heads are present', () => {
    const a = computeAssembly(spec());
    expect(a.usesRealGeometry).toBe(true);
  });

  it('reports the design-aid disclaimer verbatim', () => {
    const a = computeAssembly(spec());
    expect(a.disclaimer).toBe(ASSEMBLY_DESIGN_AID_DISCLAIMER);
    expect(a.disclaimer).toMatch(/NOT a coordinated\/clash-checked model/);
    expect(a.disclaimer).toMatch(/NOT for construction/);
  });

  it('assemblyPartSources lists the distinct sources present', () => {
    const a = computeAssembly(spec({ headGeometry: NONE_HEAD }));
    const sources = assemblyPartSources(a);
    expect(sources).toContain('build123d'); // fittings
    expect(sources).toContain('schematic'); // pipes
    expect(sources).toContain('proxy'); // proxy heads
  });
});
