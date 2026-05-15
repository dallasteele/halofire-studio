const AUTH_QUERY_KEYS = ['jwt', 'token', 'access_token', 'x-halofire-jwt', 'sig'] as const

export function buildClientBidShareUrl(
  gatewayBaseUrl: string,
  projectId: string,
  search: string | URLSearchParams | null | undefined,
): string {
  const gateway = gatewayBaseUrl.replace(/\/+$/, '')
  const params = new URLSearchParams()
  const source = typeof search === 'string' ? new URLSearchParams(search) : search

  if (source) {
    for (const key of AUTH_QUERY_KEYS) {
      const value = source.get(key)
      if (value && value.trim()) {
        params.set(key, value.trim())
      }
    }
  }

  const query = params.toString()
  return query
    ? `${gateway}/bids/${projectId}?${query}`
    : `${gateway}/bids/${projectId}`
}
