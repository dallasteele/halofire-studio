import { describe, expect, it } from 'vitest';
import {
  buildHaloFireOperationalKnowledgeReceipt,
  validateHaloFireOperationalKnowledgeReceipt,
} from '../src/engine/halofire-operational-knowledge.js';

const receipt = () => buildHaloFireOperationalKnowledgeReceipt({
  sessionId: 'winter-garden-source-building-operational-knowledge-20260713',
  preflightQuery: 'Halo Fire operations knowledge must actively constrain source-spec sprinkler generation',
  recallEpisodeIds: [139750, 139418, 60899, 129530, 133582, 136189],
  recalledWikiPages: [
    'decisions/halo-forge-stream-d-sprinkler-alpha-workflow-correction-loop-design-artifact-2026.md',
    'decisions/2026-05-15-halo-forge-stream-d-sprinkler-separate-design-issues-from-nfpa-ahj.md',
    'decisions/halo-forge-sprinkler-catalog-engineering-gate-2026-05-13.md',
  ],
});
const codes = (result) => result.issues.map((entry) => entry.code);

describe('Halo Fire operational knowledge receipt', () => {
  it('covers the full company lifecycle with applied source-bound decisions', () => {
    const result = validateHaloFireOperationalKnowledgeReceipt(receipt());
    expect(result.status).toBe('passed');
    expect(result.sourceCount).toBe(8);
    expect(result.appliedDecisionCount).toBe(10);
    expect(result.lifecycleStageCount).toBe(8);
    expect(result.operationalKnowledgeGrounded).toBe(true);
  });

  it('rejects a brain receipt that names sources but omits an executable field-RFI rule', () => {
    const value = receipt();
    value.applications = value.applications.filter((entry) => entry.id !== 'approved-set-field-rfi');
    expect(codes(validateHaloFireOperationalKnowledgeReceipt(value))).toContain('HALOFIRE_OPERATIONAL_APPLICATION_MISSING');
  });

  it('rejects a mutated downstream control even when the source and decision names remain', () => {
    const value = receipt();
    value.applications.find((entry) => entry.id === 'afc-before-fabrication').control = 'fabrication-ready';
    expect(codes(validateHaloFireOperationalKnowledgeReceipt(value))).toContain('HALOFIRE_OPERATIONAL_APPLICATION_MISSING');
  });

  it('rejects missing procurement, closeout, or internal-loop source breadth', () => {
    for (const suffix of ['04-Procurement-Vendors/04_Procurement_Vendors.md', '07-08-itm-pm.md', 'AI_AUTOMATION_OPPORTUNITIES.md']) {
      const value = receipt();
      value.sources = value.sources.filter((source) => !source.endsWith(suffix));
      expect(codes(validateHaloFireOperationalKnowledgeReceipt(value))).toContain('HALOFIRE_OPERATIONAL_SOURCE_MISSING');
    }
  });
});
