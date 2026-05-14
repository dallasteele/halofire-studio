export type PortalSearchParamsLike =
  | URLSearchParams
  | { get(name: string): string | null }
  | null
  | undefined

const TOKEN_KEYS = ['jwt', 'token', 'access_token', 'x-halofire-jwt']

export function resolvePortalAuthToken(searchParams: PortalSearchParamsLike): string | null {
  if (!searchParams) return null
  for (const key of TOKEN_KEYS) {
    const value = searchParams.get(key)
    if (value && value.trim()) {
      return value.trim()
    }
  }
  return null
}

export function buildPortalRequestInit(token: string | null): RequestInit | undefined {
  if (!token) return undefined
  return {
    headers: {
      Authorization: `Bearer ${token}`,
      'x-halofire-jwt': token,
    },
  }
}
