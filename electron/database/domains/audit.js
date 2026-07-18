const { getDb } = require('../index')
const os = require('os')
const { eventNowSql } = require('../eventClock')

// Module-level context set by the LAN server before each /lan/invoke call so
// audit entries from satellite machines record the satellite's IP rather than
// the server's hostname. Cleared immediately after the call returns.
let _requestMachine = null
function setRequestMachine(ipOrName) { _requestMachine = ipOrName }
function clearRequestMachine() { _requestMachine = null }

function logAuditAction(username, actionType, entityType, entityId, description, oldValue = null, newValue = null) {
  const machineName = _requestMachine || os.hostname()
  try {
    getDb().prepare(
      `INSERT INTO transaction_audit_log (username, action_type, entity_type, entity_id, description, old_value, new_value, machine_name, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?)`
    ).run(username, actionType, entityType, entityId, description, oldValue, newValue, machineName, eventNowSql())
  } catch (_) {}
}

function getAuditLog(startDate, endDate) {
  try {
    return getDb().prepare(
      `SELECT * FROM transaction_audit_log WHERE DATE(created_at) BETWEEN ? AND ? ORDER BY created_at DESC LIMIT 1000`
    ).all(startDate, endDate)
  } catch (_) { return [] }
}

function getEntityAuditTrail(entityType, entityId) {
  try {
    return getDb().prepare(
      `SELECT * FROM transaction_audit_log WHERE entity_type = ? AND entity_id = ? ORDER BY created_at DESC`
    ).all(entityType, entityId)
  } catch (_) { return [] }
}

function getRecentAuditActions() {
  try {
    return getDb().prepare(`SELECT * FROM transaction_audit_log ORDER BY created_at DESC LIMIT 100`).all()
  } catch (_) { return [] }
}

function cleanupOldAuditLogs() {
  try {
    const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()
    getDb().prepare(`DELETE FROM transaction_audit_log WHERE created_at < ?`).run(cutoff)
  } catch (_) {}
}

module.exports = { logAuditAction, getAuditLog, getEntityAuditTrail, getRecentAuditActions, cleanupOldAuditLogs, setRequestMachine, clearRequestMachine }
