import { apiFetch } from './api'

export interface Me {
  id: string
  name: string
  email: string
  role: string | null
  roleKey: string | null
  permissions: string[]
}

export async function fetchMe(): Promise<Me | null> {
  const { data } = await apiFetch<Me>('/admin/me')
  return data ?? null
}
