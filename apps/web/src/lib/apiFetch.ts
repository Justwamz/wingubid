const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

export async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('access_token') : null

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
    throw new Error("We couldn't reach the server. Please check your internet connection and try again.")
  }

  const json = await res.json().catch(() => null)
  if (!res.ok) {
    throw new Error(
      (json as { error?: { message?: string } } | null)?.error?.message
      ?? 'Something went wrong. Please try again in a moment.',
    )
  }
  return json as T
}
