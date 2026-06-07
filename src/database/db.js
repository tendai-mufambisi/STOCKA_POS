// Barrel re-export — all SQL runs in the main process via IPC.
// Components import from this file unchanged; calls route through window.stocka.*

export * from './domains/shop'
export * from './domains/products'
export * from './domains/suppliers'
export * from './domains/stock'
export * from './domains/sales'
export * from './domains/expenses'
export * from './domains/users'
export * from './domains/shifts'
export * from './domains/notifications'
export * from './domains/reports'
export * from './domains/audit'
export * from './domains/eod'
export * from './domains/branches'
export * from './domains/holds'
export * from './domains/backup'

// saveDb / getDb were internal sql.js helpers — no longer needed in renderer
export const saveDb = async () => {}
export const getDb = async () => { throw new Error('getDb is not available in renderer') }
