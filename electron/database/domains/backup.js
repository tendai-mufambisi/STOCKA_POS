const fs = require('fs')
const path = require('path')
const { getDb, saveDb } = require('../index')
const { extractResults } = require('../utils')
const { logAuditAction } = require('./audit')

const ALLOWED_TABLES = new Set([
  'products', 'sales', 'sale_items', 'expenses', 'suppliers',
  'stock_receivings', 'stock_movements', 'shifts', 'users', 'shops',
  'end_of_day', 'notifications', 'branches', 'transaction_audit_log'
])

// Export a backup .db file to JSON string (opens backup with sql.js, dumps all tables)
function exportBackupAsFile(backupsDir, filename) {
  const filePath = path.join(backupsDir, filename)
  if (!fs.existsSync(filePath)) throw new Error(`Backup not found: ${filename}`)

  const data = fs.readFileSync(filePath)
  const SQL = global._stockaSqlJs
  let backupDb = null
  if (!SQL) throw new Error('SQL.js not initialized')
  backupDb = new SQL.Database(data)

  const tables = ['shops', 'users', 'products', 'suppliers', 'stock_receivings',
    'stock_movements', 'sales', 'sale_items', 'expenses', 'notifications',
    'end_of_day', 'branches', 'shifts', 'sale_holds', 'transaction_audit_log']

  const exportData = {
    created_at: new Date().toISOString(),
    export_date: new Date().toISOString(),
    app_version: '1.1.3',
    tables: {}
  }

  for (const tableName of tables) {
    try {
      exportData.tables[tableName] = extractResults(backupDb.exec(`SELECT * FROM ${tableName}`))
    } catch (_) {}
  }

  backupDb.close()
  return JSON.stringify(exportData, null, 2)
}

// Import from JSON backup string into the live database
function importBackupFromFile(jsonString) {
  const backup = JSON.parse(jsonString)
  if (!backup.tables || !backup.created_at) throw new Error('Invalid backup file format')

  const db = getDb()
  for (const tableName of Object.keys(backup.tables).filter(t => ALLOWED_TABLES.has(t))) {
    try { db.run(`DELETE FROM ${tableName}`) } catch (_) {}
  }
  for (const [tableName, rows] of Object.entries(backup.tables)) {
    if (!ALLOWED_TABLES.has(tableName) || !Array.isArray(rows) || !rows.length) continue
    try {
      const columns = Object.keys(rows[0])
      const placeholders = columns.map(() => '?').join(', ')
      for (const row of rows) {
        db.run(`INSERT INTO ${tableName} (${columns.join(', ')}) VALUES (${placeholders})`, columns.map(c => row[c]))
      }
    } catch (err) {
      console.warn(`Failed to restore table ${tableName}:`, err.message)
    }
  }
  saveDb()
  const key = `imported_${new Date().toISOString().replace(/[:.]/g, '-')}`
  try { logAuditAction('system', 'RESTORE_DATABASE', 'BACKUP', key, `Database restored from JSON backup`) } catch (_) {}
  return key
}

module.exports = { exportBackupAsFile, importBackupFromFile }
