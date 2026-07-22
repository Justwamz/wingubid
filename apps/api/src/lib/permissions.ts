export interface PermissionGroup {
  area: string
  label: string
  permissions: { key: string; label: string }[]
}

export const SUPER_ADMIN_ROLE_KEY = 'super_admin'

export const PERMISSION_CATALOG: PermissionGroup[] = [
  { area: 'stats', label: 'Dashboard', permissions: [
    { key: 'stats.view', label: 'View dashboard stats' },
  ] },
  { area: 'players', label: 'Players', permissions: [
    { key: 'players.view', label: 'View players' },
    { key: 'players.edit', label: 'Edit players' },
    { key: 'players.suspend', label: 'Suspend players' },
    { key: 'players.adjust_balance', label: 'Adjust balances' },
    { key: 'players.export', label: 'Export players' },
  ] },
  { area: 'transactions', label: 'Transactions', permissions: [
    { key: 'transactions.view', label: 'View transactions' },
    { key: 'transactions.export', label: 'Export transactions' },
    { key: 'transactions.dispute', label: 'Dispute transactions' },
  ] },
  { area: 'withdrawals', label: 'Withdrawals', permissions: [
    { key: 'withdrawals.view', label: 'View withdrawals' },
    { key: 'withdrawals.approve', label: 'Approve withdrawals' },
    { key: 'withdrawals.reject', label: 'Reject withdrawals' },
    { key: 'withdrawals.config', label: 'Configure approval threshold' },
  ] },
  { area: 'reconciliation', label: 'Reconciliation', permissions: [
    { key: 'reconciliation.view', label: 'View paybill reconciliation' },
    { key: 'reconciliation.resolve', label: 'Resolve paybill payments' },
  ] },
  { area: 'payments', label: 'Payments', permissions: [
    { key: 'payments.view', label: 'View payment config' },
    { key: 'payments.edit', label: 'Edit payment config' },
  ] },
  { area: 'integrations', label: 'Integrations', permissions: [
    { key: 'integrations.view', label: 'View integrations' },
    { key: 'integrations.edit', label: 'Edit integrations' },
  ] },
  { area: 'promotions', label: 'Promotions', permissions: [
    { key: 'promotions.view', label: 'View banners' },
    { key: 'promotions.create', label: 'Create banners' },
    { key: 'promotions.edit', label: 'Edit banners' },
    { key: 'promotions.delete', label: 'Delete banners' },
    { key: 'promotions.activate', label: 'Activate banners' },
  ] },
  { area: 'chat', label: 'Chat', permissions: [
    { key: 'chat.view', label: 'View chat' },
    { key: 'chat.moderate', label: 'Moderate (delete, ban, mute)' },
    { key: 'chat.config', label: 'Enable/disable + autoban config' },
    { key: 'chat.words', label: 'Manage banned words' },
    { key: 'chat.reset_username', label: 'Reset usernames' },
  ] },
  { area: 'settings', label: 'Game Settings', permissions: [
    { key: 'settings.view', label: 'View game settings' },
    { key: 'settings.edit', label: 'Edit game settings' },
  ] },
  { area: 'bonuses', label: 'Bonuses', permissions: [
    { key: 'bonuses.view', label: 'View bonuses' },
    { key: 'bonuses.grant', label: 'Grant bonuses' },
  ] },
  { area: 'staff', label: 'Staff', permissions: [
    { key: 'staff.view', label: 'View staff' },
    { key: 'staff.create', label: 'Create staff' },
    { key: 'staff.edit', label: 'Edit staff' },
    { key: 'staff.suspend', label: 'Suspend/activate staff' },
    { key: 'staff.reset_password', label: 'Reset staff passwords' },
  ] },
  { area: 'roles', label: 'Roles', permissions: [
    { key: 'roles.view', label: 'View roles' },
    { key: 'roles.create', label: 'Create roles' },
    { key: 'roles.edit', label: 'Edit roles' },
    { key: 'roles.delete', label: 'Delete roles' },
  ] },
]

export const ALL_PERMISSION_KEYS: string[] =
  PERMISSION_CATALOG.flatMap(g => g.permissions.map(p => p.key))

const KEY_SET = new Set(ALL_PERMISSION_KEYS)

export function isValidPermission(key: string): boolean {
  return KEY_SET.has(key)
}
