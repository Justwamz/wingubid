'use client'
import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api'

interface StaffRow {
  id: string; name: string; email: string; status: string
  auth_provider: string; last_login_at: string | null
  role_id: string | null; role_name: string | null; role_key: string | null
}
interface Role {
  id: string; key: string; name: string; description: string | null
  isSystem: boolean; locked: boolean; permissions: string[]
}
interface CatalogGroup { area: string; label: string; permissions: { key: string; label: string }[] }

export function StaffTab() {
  const [staff, setStaff] = useState<StaffRow[]>([])
  const [roles, setRoles] = useState<Role[]>([])
  const [catalog, setCatalog] = useState<CatalogGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState<string | null>(null)
  const [section, setSection] = useState<'staff' | 'roles' | 'ldap'>('staff')

  const load = useCallback(async () => {
    setLoading(true)
    const [s, r, c] = await Promise.all([
      apiFetch<{ staff: StaffRow[] }>('/admin/staff'),
      apiFetch<{ roles: Role[] }>('/admin/roles'),
      apiFetch<{ catalog: CatalogGroup[] }>('/admin/permissions-catalog'),
    ])
    if (s.data) setStaff(s.data.staff)
    if (r.data) setRoles(r.data.roles)
    if (c.data) setCatalog(c.data.catalog)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  function flash(m: string) { setMsg(m); setTimeout(() => setMsg(null), 3000) }

  if (loading) return <div className="text-gray-500 py-10 text-center">Loading staff...</div>

  return (
    <div className="space-y-6">
      {msg && <div className="bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-sm text-cyan-300">{msg}</div>}
      <div className="flex gap-1 border-b border-gray-800">
        {(['staff', 'roles', 'ldap'] as const).map(t => (
          <button key={t} onClick={() => setSection(t)}
            className={`px-4 py-2 text-sm font-medium capitalize border-b-2 -mb-px ${section === t ? 'border-cyan-500 text-cyan-400' : 'border-transparent text-gray-500 hover:text-gray-300'}`}>
            {t === 'ldap' ? 'Directory / SSO' : t}
          </button>
        ))}
      </div>

      {section === 'staff' && <StaffSection staff={staff} roles={roles} reload={load} flash={flash} />}
      {section === 'roles' && <RolesSection roles={roles} catalog={catalog} reload={load} flash={flash} />}
      {section === 'ldap' && <LdapSection roles={roles} flash={flash} />}
    </div>
  )
}

function StaffSection({ staff, roles, reload, flash }: { staff: StaffRow[]; roles: Role[]; reload: () => Promise<void>; flash: (m: string) => void }) {
  const [form, setForm] = useState({ name: '', email: '', roleId: '', password: '' })
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  async function create(e: React.FormEvent) {
    e.preventDefault()
    setBusy('create')
    const { error } = await apiFetch('/admin/staff', { method: 'POST', body: JSON.stringify(form) })
    setBusy(null)
    if (error) { flash(error.message); return }
    setForm({ name: '', email: '', roleId: '', password: '' }); setOpen(false)
    flash('Staff created.'); await reload()
  }

  async function setStatus(id: string, status: string) {
    setBusy(id + status)
    const { error } = await apiFetch(`/admin/staff/${id}/status`, { method: 'PUT', body: JSON.stringify({ status }) })
    setBusy(null)
    if (error) { flash(error.message); return }
    await reload()
  }

  async function changeRole(id: string, roleId: string) {
    const { error } = await apiFetch(`/admin/staff/${id}`, { method: 'PUT', body: JSON.stringify({ roleId }) })
    if (error) { flash(error.message); return }
    flash('Role updated.'); await reload()
  }

  async function resetPw(id: string) {
    const pw = prompt('Enter a temporary password (min 8 chars). The user must change it at next login.')
    if (!pw) return
    const { error } = await apiFetch(`/admin/staff/${id}/reset-password`, { method: 'POST', body: JSON.stringify({ password: pw }) })
    flash(error ? error.message : 'Password reset.')
  }

  return (
    <div className="space-y-4">
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-xs text-gray-500 uppercase border-b border-gray-800">
            <th className="text-left px-4 py-3">Name</th><th className="text-left px-4 py-3">Email</th>
            <th className="text-left px-4 py-3">Role</th><th className="text-left px-4 py-3">Status</th>
            <th className="text-left px-4 py-3">Last login</th><th className="text-left px-4 py-3">Actions</th>
          </tr></thead>
          <tbody>
            {staff.map(s => (
              <tr key={s.id} className="border-b border-gray-800/50">
                <td className="px-4 py-3 font-medium">{s.name}</td>
                <td className="px-4 py-3 text-gray-400">{s.email}</td>
                <td className="px-4 py-3">
                  <select value={s.role_id ?? ''} onChange={e => changeRole(s.id, e.target.value)}
                    className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs">
                    {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select>
                </td>
                <td className="px-4 py-3">
                  <span className={s.status === 'active' ? 'text-green-400' : 'text-red-400'}>{s.status}</span>
                </td>
                <td className="px-4 py-3 text-gray-500 text-xs">{s.last_login_at ? new Date(s.last_login_at).toLocaleString() : 'never'}</td>
                <td className="px-4 py-3">
                  <div className="flex gap-3 text-xs">
                    <button onClick={() => setStatus(s.id, s.status === 'active' ? 'suspended' : 'active')}
                      disabled={busy === s.id + (s.status === 'active' ? 'suspended' : 'active')}
                      className="text-yellow-400 hover:text-yellow-300 disabled:opacity-50">
                      {s.status === 'active' ? 'Suspend' : 'Activate'}
                    </button>
                    <button onClick={() => resetPw(s.id)} className="text-cyan-400 hover:text-cyan-300">Reset password</button>
                  </div>
                </td>
              </tr>
            ))}
            {staff.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-600">No staff yet</td></tr>}
          </tbody>
        </table>
      </div>

      <button onClick={() => setOpen(o => !o)} className="text-sm text-cyan-400 hover:text-cyan-300">
        {open ? 'Cancel' : '+ Add staff'}
      </button>

      {open && (
        <form onSubmit={create} className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-3 max-w-md">
          <input required placeholder="Full name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
          <input required type="email" placeholder="Email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
          <select required value={form.roleId} onChange={e => setForm({ ...form, roleId: e.target.value })}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm">
            <option value="">Select a role...</option>
            {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          <input required type="text" placeholder="Temporary password (min 8)" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
          <p className="text-xs text-gray-500">The staff member will be asked to change this at first login.</p>
          <button type="submit" disabled={busy === 'create'}
            className="w-full bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white font-semibold text-sm py-2 rounded-lg">
            {busy === 'create' ? 'Creating...' : 'Create staff'}
          </button>
        </form>
      )}
    </div>
  )
}

function RolesSection({ roles, catalog, reload, flash }: { roles: Role[]; catalog: CatalogGroup[]; reload: () => Promise<void>; flash: (m: string) => void }) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Set<string>>(new Set())
  const [creating, setCreating] = useState(false)
  const [newRole, setNewRole] = useState({ key: '', name: '', description: '' })

  const selected = roles.find(r => r.id === selectedId) ?? null

  function pick(r: Role) {
    setSelectedId(r.id); setCreating(false); setDraft(new Set(r.permissions))
  }
  function toggle(key: string) {
    setDraft(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n })
  }

  async function saveEdit() {
    if (!selected) return
    const { error } = await apiFetch(`/admin/roles/${selected.id}`, { method: 'PUT', body: JSON.stringify({ permissions: Array.from(draft) }) })
    if (error) { flash(error.message); return }
    flash('Role updated.'); await reload()
  }

  async function createRole(e: React.FormEvent) {
    e.preventDefault()
    const { error } = await apiFetch('/admin/roles', { method: 'POST', body: JSON.stringify({ ...newRole, permissions: Array.from(draft) }) })
    if (error) { flash(error.message); return }
    flash('Role created.'); setCreating(false); setNewRole({ key: '', name: '', description: '' }); setDraft(new Set()); await reload()
  }

  async function del(r: Role) {
    if (!confirm(`Delete role "${r.name}"?`)) return
    const { error } = await apiFetch(`/admin/roles/${r.id}`, { method: 'DELETE' })
    if (error) { flash(error.message); return }
    flash('Role deleted.'); setSelectedId(null); await reload()
  }

  return (
    <div className="grid md:grid-cols-3 gap-6">
      <div className="space-y-2">
        {roles.map(r => (
          <div key={r.id} className={`rounded-lg border px-3 py-2 cursor-pointer ${selectedId === r.id ? 'border-cyan-500 bg-gray-800' : 'border-gray-800 bg-gray-900 hover:border-gray-700'}`}
            onClick={() => pick(r)}>
            <div className="flex items-center justify-between">
              <span className="font-medium text-sm">{r.name}</span>
              {r.locked ? <span className="text-[10px] text-gray-500 uppercase">locked</span>
                : !r.isSystem ? <button onClick={e => { e.stopPropagation(); del(r) }} className="text-[10px] text-red-400 hover:text-red-300">delete</button>
                : <span className="text-[10px] text-gray-600 uppercase">system</span>}
            </div>
            <p className="text-xs text-gray-500">{r.permissions.length} permissions</p>
          </div>
        ))}
        <button onClick={() => { setCreating(true); setSelectedId(null); setDraft(new Set()) }}
          className="w-full text-sm text-cyan-400 hover:text-cyan-300 py-2">+ New role</button>
      </div>

      <div className="md:col-span-2">
        {creating ? (
          <form onSubmit={createRole} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <input required placeholder="key (e.g. ops)" value={newRole.key} onChange={e => setNewRole({ ...newRole, key: e.target.value })}
                className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
              <input required placeholder="Name" value={newRole.name} onChange={e => setNewRole({ ...newRole, name: e.target.value })}
                className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
            </div>
            <input placeholder="Description" value={newRole.description} onChange={e => setNewRole({ ...newRole, description: e.target.value })}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm" />
            <PermissionGrid catalog={catalog} draft={draft} toggle={toggle} disabled={false} />
            <button type="submit" className="bg-cyan-600 hover:bg-cyan-500 text-white font-semibold text-sm py-2 px-4 rounded-lg">Create role</button>
          </form>
        ) : selected ? (
          <div className="space-y-4">
            <div>
              <h3 className="font-semibold">{selected.name}</h3>
              <p className="text-xs text-gray-500">{selected.description}</p>
            </div>
            <PermissionGrid catalog={catalog} draft={draft} toggle={toggle} disabled={selected.locked} />
            {!selected.locked && (
              <button onClick={saveEdit} className="bg-cyan-600 hover:bg-cyan-500 text-white font-semibold text-sm py-2 px-4 rounded-lg">Save permissions</button>
            )}
            {selected.locked && <p className="text-xs text-gray-500">Super Admin always has every permission and cannot be edited.</p>}
          </div>
        ) : (
          <p className="text-gray-600 text-sm">Select a role to edit its permissions, or create a new one.</p>
        )}
      </div>
    </div>
  )
}

function PermissionGrid({ catalog, draft, toggle, disabled }: { catalog: CatalogGroup[]; draft: Set<string>; toggle: (k: string) => void; disabled: boolean }) {
  return (
    <div className="space-y-4 max-h-[420px] overflow-y-auto pr-1">
      {catalog.map(g => (
        <div key={g.area}>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">{g.label}</p>
          <div className="grid grid-cols-2 gap-1">
            {g.permissions.map(p => (
              <label key={p.key} className={`flex items-center gap-2 text-xs ${disabled ? 'text-gray-600' : 'text-gray-300'}`}>
                <input type="checkbox" disabled={disabled} checked={draft.has(p.key)} onChange={() => toggle(p.key)} />
                {p.label}
              </label>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function LdapSection({ roles, flash }: { roles: Role[]; flash: (m: string) => void }) {
  const [cfg, setCfg] = useState({
    enabled: false, host: '', port: 636, useTls: true, baseDN: '', bindDN: '',
    bindPassword: '', userFilter: '(mail={{login}})', groupAttribute: 'memberOf',
    groupRoleMap: {} as Record<string, string>, hasBindPassword: false,
  })
  const [mapText, setMapText] = useState('')

  useEffect(() => {
    apiFetch<{ config: typeof cfg }>('/admin/ldap-config').then(({ data }) => {
      if (data?.config) {
        setCfg({ ...data.config, bindPassword: '' })
        setMapText(Object.entries(data.config.groupRoleMap || {}).map(([g, r]) => `${g} = ${r}`).join('\n'))
      }
    })
  }, [])

  async function save() {
    const groupRoleMap: Record<string, string> = {}
    for (const line of mapText.split('\n')) {
      // Group identifiers are DNs that contain '=' themselves, so split on the
      // last '=': everything before it is the group DN, the remainder is the role key.
      const idx = line.lastIndexOf('=')
      if (idx === -1) continue
      const g = line.slice(0, idx).trim()
      const r = line.slice(idx + 1).trim()
      if (g && r) groupRoleMap[g] = r
    }
    const body: Record<string, unknown> = { ...cfg, groupRoleMap }
    if (!cfg.bindPassword) delete body.bindPassword // keep stored secret
    delete (body as { hasBindPassword?: boolean }).hasBindPassword
    const { error } = await apiFetch('/admin/ldap-config', { method: 'PUT', body: JSON.stringify(body) })
    flash(error ? error.message : 'Directory settings saved.')
  }

  return (
    <div className="max-w-2xl space-y-4">
      <div className="bg-yellow-900/20 border border-yellow-700/40 rounded-lg px-4 py-2 text-xs text-yellow-300">
        Directory / SSO login. The bind module is ready but stays inactive until you enable it below and point it at a directory. Day-to-day login uses local passwords.
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={cfg.enabled} onChange={e => setCfg({ ...cfg, enabled: e.target.checked })} />
        Enable LDAP authentication
      </label>
      <div className="grid grid-cols-2 gap-3 text-sm">
        <input placeholder="Host" value={cfg.host} onChange={e => setCfg({ ...cfg, host: e.target.value })} className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2" />
        <input type="number" placeholder="Port" value={cfg.port} onChange={e => setCfg({ ...cfg, port: Number(e.target.value) })} className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2" />
        <input placeholder="Base DN" value={cfg.baseDN} onChange={e => setCfg({ ...cfg, baseDN: e.target.value })} className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 col-span-2" />
        <input placeholder="Bind DN (service account)" value={cfg.bindDN} onChange={e => setCfg({ ...cfg, bindDN: e.target.value })} className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 col-span-2" />
        <input type="password" placeholder={cfg.hasBindPassword ? 'Bind password (stored - leave blank to keep)' : 'Bind password'} value={cfg.bindPassword} onChange={e => setCfg({ ...cfg, bindPassword: e.target.value })} className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 col-span-2" />
        <input placeholder="User filter" value={cfg.userFilter} onChange={e => setCfg({ ...cfg, userFilter: e.target.value })} className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2" />
        <input placeholder="Group attribute" value={cfg.groupAttribute} onChange={e => setCfg({ ...cfg, groupAttribute: e.target.value })} className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2" />
      </div>
      <div>
        <label className="text-xs text-gray-400 block mb-1">Group to role map (one per line: <code>ldap-group = role-key</code>)</label>
        <textarea rows={4} value={mapText} onChange={e => setMapText(e.target.value)}
          placeholder={"cn=Finance,dc=example,dc=com = finance"}
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm font-mono" />
        <p className="text-xs text-gray-600 mt-1">Valid role keys: {roles.map(r => r.key).join(', ')}</p>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={cfg.useTls} onChange={e => setCfg({ ...cfg, useTls: e.target.checked })} />
        Use TLS (ldaps)
      </label>
      <button onClick={save} className="bg-cyan-600 hover:bg-cyan-500 text-white font-semibold text-sm py-2 px-4 rounded-lg">Save directory settings</button>
    </div>
  )
}
