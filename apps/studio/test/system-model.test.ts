import { describe, expect, it } from 'vitest';
import {
  buildSystem,
  summarizeFindings,
  validateSystem,
  type SystemSpec,
} from '../src/lib/system-model';

function spec(over: Partial<SystemSpec> = {}): SystemSpec {
  return {
    hazard: 'ordinary_1',
    widthFt: 40,
    lengthFt: 40,
    headsPerBranch: 3,
    branchCount: 3,
    headSku: 'reliable-ra1311',
    ...over,
  };
}

describe('buildSystem — topology', () => {
  it('builds a wet system with the canonical trunk + heads', () => {
    const sys = buildSystem(spec());
    expect(sys.type).toBe('wet');
    const kinds = new Set(sys.nodes.map((n) => n.kind));
    for (const k of [
      'supply',
      'backflow',
      'control_valve',
      'system_valve',
      'riser',
      'feed_main',
      'cross_main',
      'branch_line',
      'sprinkler_head',
      'drain',
      'inspectors_test',
    ]) {
      expect(kinds.has(k as never)).toBe(true);
    }
  });

  it('lays headsPerBranch * branchCount heads', () => {
    const sys = buildSystem(spec({ headsPerBranch: 4, branchCount: 2 }));
    expect(sys.heads.length).toBe(8);
    expect(sys.nodes.filter((n) => n.kind === 'sprinkler_head').length).toBe(8);
  });

  it('parent/child connectivity is correct: supply is root, heads parent a branch', () => {
    const sys = buildSystem(spec());
    const supply = sys.nodes.find((n) => n.id === 'supply')!;
    expect(supply.parentId).toBeNull();

    const byId = new Map(sys.nodes.map((n) => [n.id, n]));
    // Every non-root parent resolves.
    for (const n of sys.nodes) {
      if (n.parentId !== null) {
        expect(byId.has(n.parentId)).toBe(true);
      }
    }
    // A head's parent is a branch line.
    const head = sys.nodes.find((n) => n.kind === 'sprinkler_head')!;
    expect(byId.get(head.parentId!)!.kind).toBe('branch_line');
    // A branch line's parent is the cross main.
    const branch = sys.nodes.find((n) => n.kind === 'branch_line')!;
    expect(byId.get(branch.parentId!)!.kind).toBe('cross_main');
  });

  it('the chosen head SKU is attached to head nodes', () => {
    const sys = buildSystem(spec({ headSku: 'tyco-ty1131' }));
    const heads = sys.nodes.filter((n) => n.kind === 'sprinkler_head');
    expect(heads.every((h) => h.componentSku === 'tyco-ty1131')).toBe(true);
  });
});

describe('validateSystem — port mate-ability', () => {
  it('a default 1" NPT branch -> 1/2" NPT head connects via a real reducing bushing', () => {
    const sys = buildSystem(
      spec({
        branchSizeIn: 0.75,
        branchMethod: 'THREADED_NPT',
        headInlet: { method: 'THREADED_NPT', nominalSizeIn: 0.5, role: 'INLET' },
      }),
    );
    const findings = validateSystem(sys);
    // No port_mate errors.
    expect(findings.filter((f) => f.code === 'port_mate' && f.severity === 'error')).toHaveLength(0);
    // At least one adapter-bridged ok finding.
    expect(
      findings.some(
        (f) => f.code === 'port_mate' && f.severity === 'ok' && /adapter|bushing|via/i.test(f.message),
      ),
    ).toBe(true);
  });

  it('flags an oversize/method mismatch with no real adapter as an error', () => {
    const sys = buildSystem(
      spec({
        branchSizeIn: 1,
        branchMethod: 'THREADED_NPT',
        // A head inlet that no real adapter bridges from a 1" NPT outlet.
        headInlet: { method: 'SOLDER', nominalSizeIn: 3, role: 'INLET' },
      }),
    );
    const findings = validateSystem(sys);
    const errs = findings.filter((f) => f.code === 'port_mate' && f.severity === 'error');
    expect(errs.length).toBeGreaterThan(0);
    expect(errs[0].citedRule.length).toBeGreaterThan(0);
  });

  it('flags a dangling parent as a topology error', () => {
    const sys = buildSystem(spec());
    // Corrupt one node's parent to a non-existent id.
    sys.nodes[sys.nodes.length - 1].parentId = 'nonexistent';
    const findings = validateSystem(sys);
    expect(findings.some((f) => f.code === 'topology' && f.severity === 'error')).toBe(true);
  });
});

describe('validateSystem — coverage & spacing checks (cited)', () => {
  it('flags over-area when too few heads cover too large a footprint', () => {
    // 100x100 = 10000 ft^2, only 4 heads -> 2500 ft^2/head >> 130 (ordinary).
    const sys = buildSystem(
      spec({ widthFt: 100, lengthFt: 100, headsPerBranch: 2, branchCount: 2 }),
    );
    const findings = validateSystem(sys);
    const area = findings.find((f) => f.code === 'coverage_area');
    expect(area).toBeDefined();
    expect(area!.severity).toBe('warn');
    expect(area!.citedRule.toLowerCase()).toContain('nfpa 13');
  });

  it('passes coverage when many heads cover a small footprint', () => {
    const sys = buildSystem(
      spec({ widthFt: 30, lengthFt: 30, headsPerBranch: 3, branchCount: 3 }),
    );
    const findings = validateSystem(sys);
    const area = findings.find((f) => f.code === 'coverage_area')!;
    expect(area.severity).toBe('ok');
  });

  it('always emits the honesty disclaimer finding', () => {
    const findings = validateSystem(buildSystem(spec()));
    const disc = findings.find((f) => f.code === 'disclaimer');
    expect(disc).toBeDefined();
    expect(disc!.message.toLowerCase()).toContain('not for construction');
  });

  it('every finding carries a non-empty cited rule', () => {
    const findings = validateSystem(buildSystem(spec()));
    for (const f of findings) {
      expect(f.citedRule.trim().length).toBeGreaterThan(0);
      expect(f.message.trim().length).toBeGreaterThan(0);
    }
  });
});

describe('summarizeFindings', () => {
  it('counts ok/warn/error and totals to the finding count', () => {
    const findings = validateSystem(buildSystem(spec()));
    const s = summarizeFindings(findings);
    expect(s.ok + s.warn + s.error).toBe(findings.length);
  });
});
