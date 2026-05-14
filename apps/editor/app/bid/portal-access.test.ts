import { describe, expect, test } from 'bun:test'

import { buildPortalRequestInit, resolvePortalAuthToken } from './portal-access'

describe('portal-access', () => {
  test('resolves the first non-empty token parameter', () => {
    const params = new URLSearchParams('?token=&jwt=abc123&x-halofire-jwt=zzz')
    expect(resolvePortalAuthToken(params)).toBe('abc123')
  })

  test('returns null when no token is present', () => {
    expect(resolvePortalAuthToken(new URLSearchParams('?project=alpha'))).toBeNull()
  })

  test('builds request init with bearer and fallback headers', () => {
    expect(buildPortalRequestInit('abc123')).toEqual({
      headers: {
        Authorization: 'Bearer abc123',
        'x-halofire-jwt': 'abc123',
      },
    })
  })
})
