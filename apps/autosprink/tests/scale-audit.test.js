import test from 'node:test';
import assert from 'node:assert/strict';

import { auditRegistryScale, formatScaleAuditReport } from '../src/components/scale-audit.js';

test('registry part meshes stay within 5% of declared true-scale envelopes', () => {
  const report = auditRegistryScale({ tolerance: 0.05 });
  assert.ok(report.auditableCount > 0, 'expected at least one auditable registry part');
  assert.equal(report.offScaleCount, 0, formatScaleAuditReport(report));
});
