import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const board = readFileSync(fileURLToPath(new URL('../autobid-board.html', import.meta.url)), 'utf8');

describe('AutoBid board authentication/runtime boundary', () => {
  it('probes the authenticated session separately from the managed runtime', () => {
    expect(board).toContain("fetch('/api/auth/me',{credentials:'include'})");
    expect(board).toContain("probe('/ready-to-send')");
    expect(board).toContain("probe('/health')");
    expect(board).toContain('authProbe.status === 401 || readyProbe.status === 401 || healthProbe.status === 401');
  });

  it('does not tell an unauthenticated operator to start a local engine', () => {
    expect(board).toContain('Sign in to view the bid board');
    expect(board).toContain('Your HaloFire session is not authenticated');
    expect(board).toContain('href="/">Sign in</a>');
    expect(board).not.toContain('Start it: <code>C:/Python312/python.exe engine/api.py</code>');
  });

  it('fails closed on runtime errors and offers a truthful retry instead of rendering bid state', () => {
    expect(board).toContain('AutoBid runtime unavailable');
    expect(board).toContain('No bid state was loaded or inferred');
    expect(board).toContain('Retry runtime');
    expect(board).toContain("retry.addEventListener('click', function(){ loadBoard(); })");
    expect(board).toContain("showRuntimeState('runtime', null, readyProbe.status || healthProbe.status)");
  });
});
