const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

export async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<{ data?: T; error?: { code: string; message: string } }> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('admin_access_token') : null

  let res: Response
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...options,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
    })
  } catch {
    return { error: { code: 'NETWORK_ERROR', message: "Couldn't reach the server. Please check your connection and try again." } }
  }

  const json = await res.json().catch(() => null)
  if (!res.ok) return { error: json?.error ?? { code: 'SERVER_ERROR', message: 'Something went wrong. Please try again in a moment.' } }
  return { data: json as T }
}
