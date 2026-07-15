const { getDb } = require('../index')
const logger = require('../../logger')

// Transactional history wiped by a test-data reset. Order matters: children
// before parents so foreign keys never dangle mid-transaction.
// KEPT: products (with quantities), users, suppliers, branches, shops.
const WIPE_TABLES = [
  'sale_items',
  'sale_holds',
  'sales',
  'shifts',
  'end_of_day',
  'stock_receivings',
  'stock_movements',
  'notifications',
  'expenses',
  'transaction_audit_log',
]

// Wipe all transactional history while keeping master data (products/stock
// levels, users, suppliers, branches, shop settings). Used to start testing
// from a clean slate — also purges legacy corrupt rows (e.g. 300-hour shifts).
function resetTransactionalData() {
  const db = getDb()

  const counts = {}
  db.transaction(() => {
    for (const table of WIPE_TABLES) {
      counts[table] = db.prepare(`DELETE FROM ${table}`).run().changes
    }
    // No shift exists any more, so no user can point at one
    db.prepare('UPDATE users SET current_shift_id = NULL').run()
    // Restart AUTOINCREMENT ids so receipt/shift numbering begins at 1 again
    const placeholders = WIPE_TABLES.map(() => '?').join(', ')
    db.prepare(`DELETE FROM sqlite_sequence WHERE name IN (${placeholders})`).run(...WIPE_TABLES)
  })()

  db.exec('VACUUM')

  const total = Object.values(counts).reduce((a, b) => a + b, 0)
  logger.info(`🧹 Transactional data reset: ${total} rows removed — ` +
    Object.entries(counts).filter(([, n]) => n > 0).map(([t, n]) => `${t}:${n}`).join(', '))
  return { success: true, removed: counts, totalRemoved: total }
}

module.exports = { resetTransactionalData }
