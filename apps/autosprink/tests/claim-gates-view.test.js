import { describe, it, expect } from 'vitest';
import { renderGateFlag } from '../src/autobid/claim-gates-view.js';

describe('renderGateFlag', () => {
  it('renders a needs-verification gate with artifact + action, never the word blocked', () => {
    const line = renderGateFlag({
      code: 'AHJ_APPROVAL_MISSING',
      status: 'blocked',
      missing_artifact: 'AHJ approval record',
      next_action: 'Record the AHJ approval artifact.',
    });
    expect(line).toContain('NEEDS VERIFICATION');
    expect(line).toContain('AHJ approval record');
    expect(line).toContain('human signoff still required');
    expect(line.toLowerCase()).not.toContain('blocked');
  });

  it('renders a verified gate', () => {
    const line = renderGateFlag({ code: 'AUTOSPRINK_EVIDENCE_MISSING', resolved_by: 'dallas' });
    expect(line).toBe('VERIFIED: AUTOSPRINK_EVIDENCE_MISSING');
  });

  it('accepts the gateFlag shape directly', () => {
    const line = renderGateFlag({
      code: 'MANUFACTURER_MODEL_APPROVAL_MISSING',
      verificationStatus: 'needs-verification',
      residual: 'Manufacturer model approval evidence',
      note: 'Attach manufacturer approval evidence.',
    });
    expect(line).toContain('Manufacturer model approval evidence');
    expect(line).toContain('NEEDS VERIFICATION');
  });
});
