/**
 * Admin-configurable role privileges for sidebar tabs.
 *
 * Defaults below are the single source of truth for which roles see which
 * tabs. Admins can override them per role from Settings → Role Privileges;
 * overrides are stored as JSON in shops.role_privileges:
 *
 *   { "Cashier": { "my-transactions": false }, "Manager": { "reports": false } }
 *
 * Only Manager and Cashier are editable — Admin always keeps full access.
 * Locked tabs (Dashboard, Settings) can never be taken away since Settings
 * is where every user changes their own PIN.
 */

export const CONFIGURABLE_ROLES = ['Manager', 'Cashier']

export const NAV_PRIVILEGES = [
  { id: 'dashboard',        label: 'Dashboard',         group: 'Main',       roles: ['Admin', 'Manager', 'Cashier'], locked: true },
  { id: 'products',         label: 'Products',          group: 'Inventory',  roles: ['Admin', 'Manager'] },
  { id: 'inventory',        label: 'Current Inventory', group: 'Inventory',  roles: ['Admin', 'Manager'] },
  { id: 'reconciliation',   label: 'Reconciliation',    group: 'Inventory',  roles: ['Admin', 'Manager'] },
  { id: 'stock',            label: 'Receive Stock',     group: 'Inventory',  roles: ['Admin', 'Manager'] },
  { id: 'suppliers',        label: 'Suppliers',         group: 'Inventory',  roles: ['Admin', 'Manager'] },
  { id: 'restock',          label: 'Restock Needed',    group: 'Inventory',  roles: ['Admin', 'Manager'] },
  { id: 'deadstock',        label: 'Dead Stock',        group: 'Inventory',  roles: ['Admin', 'Manager'] },
  { id: 'expiry',           label: 'Expiry Tracking',   group: 'Inventory',  roles: ['Admin', 'Manager'] },
  { id: 'my-transactions',  label: 'Transactions',      group: 'Sales',      roles: ['Admin', 'Manager', 'Cashier'] },
  { id: 'expenses',         label: 'Expenses',          group: 'Finance',    roles: ['Admin', 'Manager'] },
  { id: 'reports',          label: 'Reports',           group: 'Finance',    roles: ['Admin', 'Manager'] },
  { id: 'endofday',         label: 'End of Day',        group: 'Finance',    roles: ['Admin', 'Manager'] },
  { id: 'shifts',           label: 'Shift Management',  group: 'Finance',    roles: ['Admin', 'Manager'] },
  { id: 'cashier-sessions', label: 'Cashier Sessions',  group: 'Finance',    roles: ['Admin', 'Manager'] },
  { id: 'activitylogs',     label: 'Activity Logs',     group: 'Operations', roles: ['Admin', 'Manager'] },
  { id: 'settings',         label: 'Settings',          group: 'Operations', roles: ['Admin', 'Manager', 'Cashier'], locked: true },
]

const normalizeRole = (role) => {
  const r = String(role || '').toLowerCase()
  if (r === 'admin') return 'Admin'
  if (r === 'manager') return 'Manager'
  return 'Cashier'
}

/** Parse shops.role_privileges (JSON string or object) into an overrides map. */
export const parseRolePrivileges = (raw) => {
  if (!raw) return {}
  if (typeof raw === 'object') return raw
  try { return JSON.parse(raw) || {} } catch { return {} }
}

/**
 * Effective visibility of a nav tab for a role, honouring admin overrides.
 * Unknown tab ids are allowed through (pages like 'sales' that aren't in
 * the sidebar are governed elsewhere).
 */
export const canRoleAccessNav = (role, navId, overrides = {}) => {
  const item = NAV_PRIVILEGES.find(n => n.id === navId)
  if (!item) return true
  const roleKey = normalizeRole(role)
  const byDefault = item.roles.includes(roleKey)
  if (roleKey === 'Admin' || item.locked) return byDefault
  const override = overrides?.[roleKey]?.[navId]
  return typeof override === 'boolean' ? override : byDefault
}
