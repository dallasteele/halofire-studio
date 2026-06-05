import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');

describe('Workbench mounted API path normalizer', () => {
  it('accepts root and /halo-fire mounted API hrefs before fetch', () => {
    const html = fs.readFileSync(path.join(ROOT, 'workbench.html'), 'utf8');

    expect(html).toContain('function normalizeApiPath');
    expect(html).toContain("const HALOFIRE_API_BASE = HALOFIRE_BASE_PATH + '/' + 'api';");
    expect(html).toContain("if (value.startsWith('/halo-fire/' + 'api/')) return value.slice(('/halo-fire/' + 'api').length);");
    expect(html).toContain("if (value.startsWith('/' + 'api/')) return value.slice(('/' + 'api').length);");
    expect(html).not.toContain("startsWith('/api/') ? String(href).slice(4)");
    expect(html).not.toContain("replace(/^\\/api/, '')");
  });
});
