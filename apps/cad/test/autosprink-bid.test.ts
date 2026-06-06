// autosprink-bid.ts (W6) tests: best-effort "Send to HaloFire bid" is honest +
// fail-soft. It NEVER throws and reports wired / unauthorized / not-reachable /
// skipped truthfully.

import { describe, expect, it } from 'vitest';
import { sendBidToAutosprink } from '../src/lib/autosprink-bid';

describe('sendBidToAutosprink — fail-soft + honest status', () => {
  it('skips when there is no total to send', async () => {
    const res = await sendBidToAutosprink({ total: 0, token: 't' });
    expect(res.status).toBe('skipped');
  });

  it('reports unauthorized when no token is present', async () => {
    const res = await sendBidToAutosprink({ total: 1000, token: null, tokenReader: () => null });
    expect(res.status).toBe('unauthorized');
  });

  it('reports not-reachable when the fetch throws (offline / no backend)', async () => {
    const throwing = (async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    const res = await sendBidToAutosprink({ total: 1000, token: 'tok', fetchImpl: throwing });
    expect(res.status).toBe('not-reachable');
  });

  it('reports unauthorized on a 401 from the backend', async () => {
    const f = (async () => ({ ok: false, status: 401 })) as unknown as typeof fetch;
    const res = await sendBidToAutosprink({ total: 1000, token: 'tok', fetchImpl: f });
    expect(res.status).toBe('unauthorized');
    expect(res.httpStatus).toBe(401);
  });

  it('reports wired on a 2xx, surfacing the created bid id, and sends Pending', async () => {
    let sentBody: unknown = null;
    const f = (async (_url: string, init?: RequestInit) => {
      sentBody = init?.body ? JSON.parse(init.body as string) : null;
      return { ok: true, status: 200, json: async () => ({ id: 7, message: 'Bid created' }) };
    }) as unknown as typeof fetch;
    const res = await sendBidToAutosprink({
      total: 1234.56,
      token: 'tok',
      project: 'Demo',
      fetchImpl: f,
    });
    expect(res.status).toBe('wired');
    expect(res.bidId).toBe(7);
    expect((sentBody as { status: string }).status).toBe('Pending');
    expect((sentBody as { value: number }).value).toBe(1234.56);
    expect((sentBody as { project: string }).project).toBe('Demo');
  });

  it('treats a 2xx with no parseable body as a successful send', async () => {
    const f = (async () => ({
      ok: true,
      status: 201,
      json: async () => {
        throw new Error('no body');
      },
    })) as unknown as typeof fetch;
    const res = await sendBidToAutosprink({ total: 500, token: 'tok', fetchImpl: f });
    expect(res.status).toBe('wired');
  });
});
