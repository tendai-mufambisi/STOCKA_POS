/**
 * Role-based access control (RBAC) utilities
 * Enforces permissions based on user role
 * 
 * Role hierarchy:
 * - Admin: Full system access
 * - Manager: Operations oversight (inventory, expenses, reports)
 * - Cashier: Sales only (can complete sales and their own shift EOD)
 */

// Define role-based permissions
const rolePermissions = {
  Admin: {
    // System management
    canManageUsers: true,
    canAccessSettings: true,
    canChangeSystemSettings: true,
    canChangeExchangeRates: true,
    canChangeProductPrices: true,
    
    // Operational
    canVoidSales: true,
    canApproveVoidSales: true,
    canAccessAllShifts: true,
    canAccessAllReports: true,
    canViewCashierPerformance: true,
    canManageExpenses: true,
    canManageInventory: true,
    canReceiveStock: true,
    
    // Visibility
    canViewAllSales: true,
    canViewSalesHistory: true,
    canAccessDashboard: true,
    canAccessReports: true
  },
  
  Manager: {
    // System management - NOT allowed
    canManageUsers: false,
    canAccessSettings: false,
    canChangeSystemSettings: false,
    canChangeExchangeRates: false,
    canChangeProductPrices: false,
    
    // Operational - RESTRICTED
    canVoidSales: false,
    canApproveVoidSales: false,
    canAccessAllShifts: true,      // Can see shift reports
    canAccessAllReports: true,      // Can generate reports
    canViewCashierPerformance: true, // Can monitor staff
    canManageExpenses: true,        // Can record expenses
    canManageInventory: true,       // Can view inventory
    canReceiveStock: true,          // Can receive stock
    
    // Visibility
    canViewAllSales: true,
    canViewSalesHistory: true,
    canAccessDashboard: true,
    canAccessReports: true
  },
  
  Cashier: {
    // System management - NOT allowed
    canManageUsers: false,
    canAccessSettings: false,
    canChangeSystemSettings: false,
    canChangeExchangeRates: false,
    canChangeProductPrices: false,
    
    // Operational - RESTRICTED
    canVoidSales: false,
    canApproveVoidSales: false,
    canAccessAllShifts: false,       // Cannot see other shifts
    canAccessAllReports: false,      // Cannot generate reports
    canViewCashierPerformance: false, // Cannot see staff performance
    canManageExpenses: false,        // Cannot record expenses
    canManageInventory: false,       // Cannot manage inventory
    canReceiveStock: false,
    
    // Visibility - ONLY own sales
    canViewAllSales: false,
    canViewSalesHistory: false,
    canAccessDashboard: true,
    canAccessReports: false
  }
}

/**
 * Check if a user has permission for an action
 * @param {string} userRole - User's role (Admin, Manager, Cashier)
 * @param {string} permission - Permission key (e.g., 'canVoidSales')
 * @returns {boolean} - True if user has permission
 */
export const hasPermission = (userRole, permission) => {
  if (!rolePermissions[userRole]) {
    console.warn(`Unknown role: ${userRole}`)
    return false
  }
  
  const hasAccess = rolePermissions[userRole][permission]
  return hasAccess === true
}

/**
 * Multi-permission check (user needs ALL specified permissions)
 * @param {string} userRole - User's role
 * @param {string[]} permissions - Array of permission keys
 * @returns {boolean} - True if user has ALL permissions
 */
export const hasAllPermissions = (userRole, permissions) => {
  return permissions.every(permission => hasPermission(userRole, permission))
}

/**
 * Multi-permission check (user needs ANY of specified permissions)
 * @param {string} userRole - User's role
 * @param {string[]} permissions - Array of permission keys
 * @returns {boolean} - True if user has ANY permission
 */
export const hasAnyPermission = (userRole, permissions) => {
  return permissions.some(permission => hasPermission(userRole, permission))
}

/**
 * Verify user has permission before action (with error message)
 * @param {string} userRole - User's role
 * @param {string} permission - Permission key
 * @param {string} actionName - Name of action (for error message)
 * @throws {Error} - If permission denied
 * @returns {boolean} - True if permitted
 */
export const requirePermission = (userRole, permission, actionName = 'action') => {
  if (!hasPermission(userRole, permission)) {
    throw new Error(`Permission denied: You do not have access to ${actionName}`)
  }
  return true
}

/**
 * Get role display name
 * @param {string} role - Role key
 * @returns {string} - Display name
 */
export const getRoleDisplayName = (role) => {
  const displayNames = {
    Admin: 'Administrator',
    Manager: 'Manager',
    Cashier: 'Cashier'
  }
  return displayNames[role] || role
}

/**
 * Get role description
 * @param {string} role - Role key
 * @returns {string} - Role description
 */
export const getRoleDescription = (role) => {
  const descriptions = {
    Admin: 'Full system access - manage users, settings, and all operations',
    Manager: 'Oversee operations - view reports, manage stock, no user/setting changes',
    Cashier: 'Sales only - complete transactions and personal shift reconciliation'
  }
  return descriptions[role] || ''
}

/**
 * Get all available role options
 * @returns {Array} - Array of role objects with key and display name
 */
export const getAvailableRoles = () => {
  return [
    { key: 'Admin', name: 'Administrator', description: getRoleDescription('Admin') },
    { key: 'Manager', name: 'Manager', description: getRoleDescription('Manager') },
    { key: 'Cashier', name: 'Cashier', description: getRoleDescription('Cashier') }
  ]
}

/**
 * Validate if a role is valid
 * @param {string} role - Role to validate
 * @returns {boolean} - True if valid role
 */
export const isValidRole = (role) => {
  return Object.keys(rolePermissions).includes(role)
}

/**
 * Get all permissions for a role
 * @param {string} userRole - User's role
 * @returns {Object} - All permissions and their values
 */
export const getAllPermissionsForRole = (userRole) => {
  return rolePermissions[userRole] || {}
}
