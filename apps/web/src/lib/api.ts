const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

async function doFetch(path: string, options: RequestInit, token: string | null) {
  return fetch(`${API_URL}${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  })
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<{ data?: T; error?: { code: string; message: string } }> {
  if (typeof window === 'undefined') return {}

  let token = localStorage.getItem('access_token')
  let res = await doFetch(path, options, token)

  if (res.status === 401 && path !== '/auth/refresh') {
    const refresh = await doFetch('/auth/refresh', { method: 'POST' }, null)
    if (refresh.ok) {
      const refreshJson = await refresh.json().catch(() => null)
      if (refreshJson?.access_token) {
        localStorage.setItem('access_token', refreshJson.access_token)
        token = refreshJson.access_token
        res = await doFetch(path, options, token)
      }
    } else {
      localStorage.removeItem('access_token')
      window.location.href = '/login'
      return {}
    }
  }

  const json = await res.json().catch(() => null)
  if (!res.ok) return { error: json?.error ?? { code: 'ERROR', message: 'Request failed' } }
  return { data: json as T }
}
