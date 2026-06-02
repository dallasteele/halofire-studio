import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '..');

describe('SAM31 workbench browser smoke script', () => {
  it('publishes a bounded Playwright smoke for the saved-evidence replay path', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    expect(pkg.scripts['smoke:sam31-workbench']).toBe('node scripts/smoke-sam31-workbench.mjs');
    expect(pkg.devDependencies.playwright).toBe('^1.60.0');

    const script = fs.readFileSync(path.join(ROOT, 'scripts/smoke-sam31-workbench.mjs'), 'utf8');
    expect(script).toContain('playwright');
    expect(script).toContain('output/playwright');
    expect(script).toContain('/api/auth/login');
    expect(script).toContain('/pdf-boundary-decision');
    expect(script).toContain('/sam31-visual-audit/results');
    expect(script).toContain('SAM31 perception summary');
    expect(script).toContain('Download full SAM31 packet');
    expect(script).toContain('no_claims_cleared');
  });
});
