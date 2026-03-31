export type AdminRole = 'super_admin' | 'finance' | 'support' | 'reports'
export type AdminStatus = 'active' | 'suspended'

export interface AdminUser {
  id: string
  name: string
  email: string
  role: AdminRole
  status: AdminStatus
  created_at: string
}

export interface AuditLogEntry {
  id: string
  admin_id: string
  action: string
  entity: string
  entity_id: string | null
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
  created_at: string
}
