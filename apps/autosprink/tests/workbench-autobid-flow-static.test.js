import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const page = fs.readFileSync(path.join(import.meta.dirname, '..', 'workbench.html'), 'utf8');

describe('workbench -> AutoBid operations flow', () => {
  it('hands the pipeline controls to the canonical intake and board routes', () => {
    expect(page).toContain('href="/autobid-intake.html?hf=r2" data-autobid-route="intake"');
    expect(page).toContain('href="/autobid-board.html?hf=r2" data-autobid-route="board"');
    expect(page).not.toMatch(/<button[^>]*>View pipeline<\/button>/i);
    expect(page).not.toMatch(/<button[^>]*>New bid<\/button>/i);
  });

  it('routes both static and API-rendered approval reviews to the AutoBid board', () => {
    expect(page).toContain('class="btn ghost sm" data-autobid-review="1" type="button">Review</button>');
    expect(page).toContain('data-autobid-review="1" style="all:unset;display:inline-flex');
    expect(page).toContain("e.target.closest('[data-autobid-review]')");
    expect(page).toContain("location.href='/autobid-board.html?hf=r2'");
  });
});
