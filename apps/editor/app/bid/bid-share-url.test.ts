import { describe, expect, test } from 'bun:test'
import { buildClientBidShareUrl } from '../../lib/halofire/bid-share-url'

describe('buildClientBidShareUrl', () => {
  test('builds the canonical signed bid route and preserves auth query params', () => {
    const url = buildClientBidShareUrl(
      'http://localhost:18080/',
      '1881-cooperative',
      '?project=1881-cooperative&jwt=abc123&foo=bar&sig=signed-token',
    )

    expect(url).toBe(
      'http://localhost:18080/bids/1881-cooperative?jwt=abc123&sig=signed-token',
    )
  })

  test('omits the query string when no auth params exist', () => {
    const url = buildClientBidShareUrl(
      'http://localhost:18080',
      '1881-cooperative',
      '?project=1881-cooperative&foo=bar',
    )

    expect(url).toBe('http://localhost:18080/bids/1881-cooperative')
  })
})
