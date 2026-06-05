import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');

describe('HaloFire workbench deep links', () => {
  it('preserves the requested 1881 workbench target through login', () => {
    const index = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

    expect(index).toContain('redirect');
    expect(index).toContain('safeWorkbenchRedirect');
    expect(index).toContain("fetch(HALOFIRE_BASE_PATH + '/' + 'api/auth/login'");
    expect(index).toContain('storeLoginToken(data)');
    expect(index).toContain("window.location.href=safeWorkbenchRedirect()");
  });

  it('selects the project target from the workbench query string before loading evidence', () => {
    const workbench = fs.readFileSync(path.join(ROOT, 'workbench.html'), 'utf8');

    expect(workbench).toContain('applyProjectTargetFromQuery');
    expect(workbench).toContain("new URLSearchParams(window.location.search)");
    expect(workbench).toContain("params.get('project')");
    expect(workbench).toContain("select.value = project");
  });

  it('can authenticate the workbench from the secure session cookie without a stored token', () => {
    const workbench = fs.readFileSync(path.join(ROOT, 'workbench.html'), 'utf8');

    expect(workbench).toContain('readStoredToken');
    expect(workbench).toContain("credentials: 'include'");
    expect(workbench).toContain("if (token) headers.Authorization = 'Bearer ' + token");
    expect(workbench).not.toContain('if (!token) {');
  });

  it('signs out through the mounted logout route before redirecting home', () => {
    const workbench = fs.readFileSync(path.join(ROOT, 'workbench.html'), 'utf8');

    expect(workbench).toContain("fetch(HALOFIRE_API_BASE + '/auth/logout'");
    expect(workbench).toContain("method: 'POST'");
    expect(workbench).toContain("credentials: 'include'");
    expect(workbench).toContain("location.href = HALOFIRE_BASE_PATH + '/'");
  });
});
