const { getDb, saveDb } = require('../index')
const { extractResults } = require('../utils')

function logAuditAction(username, actionType, entityType, entityId, description, oldValue = null, newValue = null) {
  try {
    getDb().run(
      `INSERT INTO transaction_audit_log (username, action_type, entity_type, entity_id, description, old_value, new_value, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'completed')`,
      [username, actionType, entityType, entityId, description, oldValue, newValue]
    )
    saveDb()
  } catch (_) {}
}

function getAuditLog(startDate, endDate) {
  try {
    return extractResults(getDb().exec(
      `SELECT * FROM transaction_audit_log WHERE DATE(created_at) BETWEEN ? AND ? ORDER BY created_at DESC LIMIT 1000`,
      [startDate, endDate]
    ))
  } catch (_) { return [] }
}

function getEntityAuditTrail(entityType, entityId) {
  try {
    return extractResults(getDb().exec(
      `SELECT * FROM transaction_audit_log WHERE entity_type = ? AND entity_id = ? ORDER BY created_at DESC`,
      [entityType, entityId]
    ))
  } catch (_) { return [] }
}

function getRecentAuditActions() {
  try {
    return extractResults(getDb().exec(`SELECT * FROM transaction_audit_log ORDER BY created_at DESC LIMIT 100`))
  } catch (_) { return [] }
}

function cleanupOldAuditLogs() {
  try {
    const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()
    getDb().run(`DELETE FROM transaction_audit_log WHERE created_at < ?`, [cutoff])
    saveDb()
  } catch (_) {}
}

module.exports = { logAuditAction, getAuditLog, getEntityAuditTrail, getRecentAuditActions, cleanupOldAuditLogs }
