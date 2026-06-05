import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '..');

describe('public read-only evidence smoke script', () => {
  it('publishes a reusable public/VPS smoke for mounted accepted-evidence Settings links', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    expect(pkg.scripts['smoke:public-readonly-evidence']).toBe('node scripts/smoke-public-readonly-evidence.mjs');

    const script = fs.readFileSync(path.join(ROOT, 'scripts/smoke-public-readonly-evidence.mjs'), 'utf8');
    expect(script).toContain('playwright');
    expect(script).toContain('HALOFIRE_PUBLIC_BASE_URL');
    expect(script).toContain('HALOFIRE_ADMIN_PASSWORD');
    expect(script).toContain('/api/auth/login');
    expect(script).toContain('localStorage.setItem');
    expect(script).toContain('resolved_evidence_settings_href');
    expect(script).toContain('validation_rows');
    expect(script).toContain('officialFlowReviewDecisionEvidenceId');
    expect(script).toContain('MANUFACTURER_MODEL_APPROVAL_MISSING');
    expect(script).toContain('data-signed-reviewer-workflow-action="inspect"');
    expect(script).toContain('/halo-fire/settings.html');
    expect(script).toContain('#wizPacketStatus');
    expect(script).toContain('signedReviewerReadonlyEvidenceId');
    expect(script).toContain('gate_cleared_after_explicit_signed_validation');
    expect(script).toContain('#wizSubmit');
    expect(script).toContain('uploadPacketHref');
  });
});
