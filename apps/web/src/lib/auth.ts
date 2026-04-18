export function saveToken(token: string) {
  localStorage.setItem('access_token', token)
}

export function getToken(): string | null {
  return localStorage.getItem('access_token')
}

export function clearToken() {
  localStorage.removeItem('access_token')
}

export function refreshBalance() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('balanceRefresh'))
}

export function isAuthenticated(): boolean {
  const token = getToken()
  if (!token) return false
  try {
    const payload = JSON.parse(atob(token.split('.')[1]))
    return payload.exp * 1000 > Date.now()
  } catch {
    return false
  }
}
