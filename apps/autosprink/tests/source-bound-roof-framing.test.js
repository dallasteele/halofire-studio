import { describe, expect, it } from 'vitest';
import { evaluateSourceBoundRoofFraming } from '../src/engine/source-bound-roof-framing.js';

const roof = {
  status: 'passed', evidenceReceiptSha256: 'roof-receipt', exclusions: [], features: [],
  planes: [{ id: 'plane', boundaryPlanFt: [[0, 0], [20, 0], [20, 20], [0, 20]], equation: { a: 0.1, b: 0, c: 10 }, normal: [-0.1, 0, 1] }],
};
const condition = {
  passed: true, condition: 'flush-framed-unless-noted', source_pdf_sha256: 'struct-hash',
  governing_text: 'BEAMS SHOWN ON THIS SHEET OCCUR WITHIN THE ROOF FRAMING SHOWN (FLUSH-FRAMED), UNO.',
  source_pages: [{ pdf_sha256: 'struct-hash', page_index: 1, sheet: 'S-190.B' }],
  plan_specific_drop_markers: [],
};
const exact = {
  id: 'B1', kind: 'beam', member: 'HSS10X4X3/8', a_ft: [2, 5], b_ft: [18, 5],
  source: { pdf_sha256: 'struct-hash', page_index: 1, sheet: 'S-190.B' },
  section: { status: 'standards-resolved-section', profile: 'rectangular-hss', outer_width_in: 4, outer_depth_in: 10 },
};

describe('evaluateSourceBoundRoofFraming', () => {
  it('places an exact member continuously on a verified sloped plane', () => {
    const result = evaluateSourceBoundRoofFraming({ roofModel: roof, candidates: {
      source_structural_pdf_sha256: 'struct-hash', framing_condition_gate: condition, beams: [exact], joists: [],
    } });
    expect(result.status).toBe('passed');
    expect(result.counts).toMatchObject({ candidates: 1, exactPhysicalPlacements: 1, skipped: 0 });
    expect(result.placedMembers[0].topEndpointsFt).toEqual([[2, 5, 10.2], [18, 5, 11.8]]);
  });

  it('accounts for bounded wood without promoting it to a physical solid', () => {
    const wood = { ...exact, id: 'J1', member: '2X12', section: {
      status: 'source-bounded-dry-minimum-dressed-section', profile: 'sawn-wood-rectangular', modeled_minimum_dressed_in: [1.5, 11.25],
    } };
    const result = evaluateSourceBoundRoofFraming({ roofModel: roof, candidates: {
      source_structural_pdf_sha256: 'struct-hash', framing_condition_gate: condition, beams: [], joists: [wood],
    } });
    expect(result.status).toBe('blocked');
    expect(result.counts).toMatchObject({ boundedNonPhysicalRepresentations: 1, rejected: 0, skipped: 0 });
  });

  it('rejects a centerline that crosses an excluded opening even when its endpoints are on roof', () => {
    const roofWithOpening = { ...roof, exclusions: [{ id: 'opening', reason: 'roof hatch', boundaryPlanFt: [[9, 4], [11, 4], [11, 6], [9, 6]] }] };
    const result = evaluateSourceBoundRoofFraming({ roofModel: roofWithOpening, candidates: {
      source_structural_pdf_sha256: 'struct-hash', framing_condition_gate: condition, beams: [exact], joists: [],
    } });
    expect(result.counts).toMatchObject({ exactPhysicalPlacements: 0, rejected: 1, skipped: 0 });
    expect(result.rejectedMembers[0].reason.code).toBe('ROOF_POINT_IN_EXCLUDED_OPENING');
  });

  it('rejects adversarial source drift and plan-specific DROP ambiguity', () => {
    const badCondition = {
      ...condition,
      source_pages: [{ ...condition.source_pages[0], page_index: 99 }],
      plan_specific_drop_markers: [{ id: 'DROP-1' }],
    };
    const result = evaluateSourceBoundRoofFraming({ roofModel: roof, candidates: {
      source_structural_pdf_sha256: 'changed-hash', framing_condition_gate: badCondition, beams: [exact], joists: [],
    } });
    expect(result.evaluationComplete).toBe(true);
    expect(result.counts.skipped).toBe(0);
    expect(result.issues.map((entry) => entry.code)).toContain('FRAMING_DROP_ASSOCIATION_REQUIRED');
    expect(result.issues.map((entry) => entry.code)).toContain('FRAMING_CONDITION_SOURCE_HASH_MISMATCH');
    expect(result.issues.map((entry) => entry.code)).toContain('FRAMING_CONDITION_SOURCE_PAGE_MISMATCH');
  });
});
