import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');

describe('HaloFire workbench deep links', () => {
  it('preserves the requested 1881 workbench target through login', () => {
    const index = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

    // Cookie-session login (HFAuth migration): the redirect target is
    // validated by safePostLoginRedirect (same-origin allowlist incl.
    // /workbench.html) and the session is the HttpOnly cookie, not a
    // stored token.
    expect(index).toContain("params.get('redirect')");
    expect(index).toContain('safePostLoginRedirect');
    expect(index).toContain("'/workbench.html'");
    expect(index).toContain("fetch(HALOFIRE_BASE_PATH + '/' + 'api/auth/login'");
    expect(index).toContain('acceptCookieSession(data)');
    expect(index).toContain('window.location.href=safePostLoginRedirect()');
  });

  it('selects the project target from the workbench query string before loading evidence', () => {
    const workbench = fs.readFileSync(path.join(ROOT, 'official-flow.html'), 'utf8');

    expect(workbench).toContain('applyProjectTargetFromQuery');
    expect(workbench).toContain("new URLSearchParams(window.location.search)");
    expect(workbench).toContain("params.get('project')");
    expect(workbench).toContain("select.value = project");
  });

  it('can authenticate the workbench from the secure session cookie without a stored token', () => {
    const workbench = fs.readFileSync(path.join(ROOT, 'official-flow.html'), 'utf8');

    // HFAuth migration: the workbench authenticates from the HttpOnly
    // session cookie via the shared guard — no bearer token reads.
    expect(workbench).toContain('/public/halofire-auth.js');
    expect(workbench).toContain('HFAuth.guard()');
    expect(workbench).toContain('HFAuth.api(');
    expect(workbench).not.toContain("localStorage.getItem('halofire_token')");
    expect(workbench).not.toContain("headers.Authorization = 'Bearer '");
  });

  it('signs out through the mounted logout route before redirecting home', () => {
    const workbench = fs.readFileSync(path.join(ROOT, 'official-flow.html'), 'utf8');
    const hfAuth = fs.readFileSync(path.join(ROOT, 'public', 'halofire-auth.js'), 'utf8');

    // HFAuth migration: the workbench delegates sign-out to the shared
    // guard, which POSTs the mounted logout route with the cookie session
    // then redirects home.
    expect(workbench).toContain('HFAuth.logout()');
    expect(hfAuth).toContain("fetch(API_BASE + '/auth/logout', { method: 'POST', credentials: 'include' })");
    expect(hfAuth).toContain("window.location = BASE_PATH + '/'");
  });
});
