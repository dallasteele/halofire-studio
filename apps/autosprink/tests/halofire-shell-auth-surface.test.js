import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const shell = readFileSync(fileURLToPath(new URL('../public/halofire-shell.js', import.meta.url)), 'utf8');

describe('shared HaloFire shell auth identity surface', () => {
  it('distinguishes a real 401 from a runtime or network failure', () => {
    expect(shell).toContain('response && response.status === 401');
    expect(shell).toContain('Sign in required');
    expect(shell).toContain('Session unavailable');
    expect(shell).toContain('hydrateAuthSurface(document)');
  });

  it('turns the unauthenticated shell action into a sign-in link', () => {
    expect(shell).toContain("signout.textContent = 'Sign in'");
    expect(shell).toContain("signout.href = '/'");
    expect(shell).toContain('signout.onclick = null');
    expect(shell).toContain("role.innerHTML = '<span class=\"dot\"></span> Sign in required'");
  });

  it('does not expose sign-out while session health is unavailable', () => {
    expect(shell).toContain('signout.hidden = true');
    expect(shell).toContain("signout.setAttribute('aria-hidden', 'true')");
    expect(shell).toContain('applyAuthSurface(root, null, null)');
  });
});
