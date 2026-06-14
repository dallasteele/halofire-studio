import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');

describe('employee studio shell styling', () => {
  it('keeps workbench and CAD studio on the login black-glass system with mobile fallbacks', () => {
    for (const file of ['official-flow.html', 'autosprink.html']) {
      const html = fs.readFileSync(path.join(ROOT, file), 'utf8');

      expect(html).toContain('<link rel="stylesheet" href="/public/styles/halofire-tokens.css">');
      // Allow additional body attributes (e.g. official-flow's data-hf-page for the
      // shared glass-theme shell) — the studio-glass class is what matters here.
      expect(html).toContain('<body class="hf-shell hf-studio-glass"');
      expect(html).toContain('id="employee-studio-glass-overrides"');
      expect(html).toContain('backdrop-filter:blur(28px) saturate(1.35)');
      expect(html).toContain('linear-gradient(180deg,#ffd54f,#c89a3c)');
      expect(html).toContain('@media(max-width:840px)');
      expect(html).toContain('grid-template-columns:1fr');
      expect(html).toContain('overflow:auto');
    }
  });
});
