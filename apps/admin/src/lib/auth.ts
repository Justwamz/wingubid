export function saveToken(token: string) {
  localStorage.setItem('admin_access_token', token)
}

export function getToken(): string | null {
  return localStorage.getItem('admin_access_token')
}

export function clearToken() {
  localStorage.removeItem('admin_access_token')
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
