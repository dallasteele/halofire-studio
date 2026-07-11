import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');

describe('employee studio shell styling', () => {
  it('keeps workbench and CAD studio on the login black-glass system with mobile fallbacks', () => {
    for (const file of ['official-flow.html', 'autosprink.html']) {
      const html = fs.readFileSync(path.join(ROOT, file), 'utf8');
      const glassCss = fs.readFileSync(path.join(ROOT, 'public/styles/halofire-glass.css'), 'utf8');

      expect(html).toContain('<link rel="stylesheet" href="/public/styles/halofire-tokens.css">');
      // Allow additional body attributes (e.g. official-flow's data-hf-page for the
      // shared glass-theme shell) — the studio-glass class is what matters here.
      expect(html).toContain('<body class="hf-shell hf-studio-glass"');
      expect(html).toContain('id="employee-studio-glass-overrides"');
      // Shell material and mobile behavior may be page-local overrides or shared
      // stylesheet rules; inspect the complete source set without requiring CSS
      // duplication in every page.
      const source = `${html}\n${glassCss}`;
      expect(source).toMatch(/backdrop-filter:blur\(28px\) saturate\(1\.(?:35|4)\)/);
      expect(source).toContain('linear-gradient(180deg,#ffd54f,#c89a3c)');
      expect(source).toContain('@media(max-width:840px)');
      expect(source).toContain('grid-template-columns:1fr');
      expect(source).toContain('overflow:auto');
    }
  });
});
