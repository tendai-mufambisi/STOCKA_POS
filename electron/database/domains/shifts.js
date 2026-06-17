const { getDb } = require('../index')
const { createNotification } = require('./notifications')
const { logAuditAction } = require('./audit')


function getShiftById(shiftId) {
  return getDb().prepare('SELECT * FROM shifts WHERE id = ?').get(shiftId) || null
}

function startShift(userData, openingFloat, branchId = null) {
  const db = getDb()
  const openingCash = typeof openingFloat === 'object'
    ? (openingFloat.opening_cash ?? openingFloat.opening_usd_cash ?? 0)
    : (parseFloat(openingFloat) || 0)

  const startedAt = new Date().toISOString()
  const { lastInsertRowid: shiftId } = db.prepare(
    `INSERT INTO shifts (cashier_username, cashier_display_name, branch_id, status, opening_cash, started_at) VALUES (?, ?, ?, 'open', ?, ?)`
  ).run(userData.username, userData.name || userData.username, branchId, openingCash, startedAt)

  if (!shiftId) throw new Error('Failed to get shift ID after insert')
  db.prepare('UPDATE users SET current_shift_id = ? WHERE id = ?').run(shiftId, userData.id)
  try { logAuditAction(userData.username, 'SHIFT_OPENED', 'SHIFT', String(shiftId), `Shift opened with $${openingCash.toFixed(2)} opening cash`) } catch (_) {}
  return getShiftById(shiftId)
}

function updateShiftSalesForPaymentMethod(shiftId, paymentMethod, amount) {
  getDb().prepare(
    `UPDATE shifts SET total_sales_count = total_sales_count + 1, total_sales_value = total_sales_value + ? WHERE id = ?`
  ).run(amount, shiftId)
}

function closeShift(shiftId, closingFloat, notes = '') {
  const db = getDb()
  const shift = getShiftById(shiftId)
  if (!shift) throw new Error('Shift not found')

  const shiftExpenses = db.prepare(
    `SELECT COALESCE(SUM(amount), 0) as total FROM expenses WHERE shift_id = ?`
  ).get(shiftId)?.total || 0

  const closingCash = typeof closingFloat === 'object'
    ? (closingFloat.closing_cash || 0)
    : (parseFloat(closingFloat) || 0)

  const expectedCash = (shift.opening_cash || 0) + (shift.total_sales_value || 0) - shiftExpenses
  const variance = closingCash - expectedCash
  let reconciliationStatus = 'balanced'
  if (Math.abs(variance) > 0.01) reconciliationStatus = variance > 0 ? 'over' : 'short'

  const closedAt = new Date().toISOString()
  db.prepare(
    `UPDATE shifts SET closing_cash = ?, variance = ?, reconciliation_status = ?, notes = ?, closed_at = ?, status = 'closed' WHERE id = ?`
  ).run(closingCash, variance, reconciliationStatus, notes, closedAt, shiftId)
  db.prepare('UPDATE users SET current_shift_id = NULL WHERE username = ?').run(shift.cashier_username)
  try { logAuditAction(shift.cashier_username, 'SHIFT_CLOSED', 'SHIFT', String(shiftId), `Shift closed — ${reconciliationStatus} (variance: $${variance.toFixed(2)})`) } catch (_) {}

  const durationHours = (new Date(closedAt) - new Date(shift.started_at)) / (1000 * 60 * 60)
  try {
    createNotification({ type: 'SHIFT_CLOSED', message: `Cashier ${shift.cashier_username} closed shift — Status: ${reconciliationStatus.toUpperCase()}` })
    if (variance < -5) createNotification({ type: 'SHIFT_SHORTAGE', message: `⚠️ Cashier ${shift.cashier_username} short by $${Math.abs(variance).toFixed(2)}` })
    if (durationHours > 10) createNotification({ type: 'SHIFT_LONG', message: `⏱️ Cashier ${shift.cashier_username} on shift for ${Math.floor(durationHours)}h ${Math.round((durationHours % 1) * 60)}m` })
  } catch (_) {}

  return getShiftById(shiftId)
}

function getCurrentShift(cashierUsername) {
  return getDb().prepare(
    `SELECT * FROM shifts WHERE cashier_username = ? AND status = 'open' ORDER BY started_at DESC LIMIT 1`
  ).get(cashierUsername) || null
}

function getExistingOpenShift(cashierUsername) {
  return getCurrentShift(cashierUsername)
}

function getShiftsByCashier(cashierUsername, status = null) {
  let sql = 'SELECT * FROM shifts WHERE cashier_username = ?'
  const params = [cashierUsername]
  if (status) { sql += ' AND status = ?'; params.push(status) }
  sql += ' ORDER BY started_at DESC'
  return getDb().prepare(sql).all(...params)
}

function getAllShifts(status = null, fromDate = null, toDate = null) {
  let sql = 'SELECT * FROM shifts WHERE 1 = 1'
  const params = []
  if (status) { sql += ' AND status = ?'; params.push(status) }
  if (fromDate) { sql += ' AND started_at >= ?'; params.push(fromDate) }
  if (toDate) { sql += ' AND started_at <= ?'; params.push(toDate) }
  sql += ' ORDER BY started_at DESC'
  return getDb().prepare(sql).all(...params)
}

function getActiveShifts() {
  return getAllShifts('open')
}

function getShiftSummary(shiftId) {
  const shift = getShiftById(shiftId)
  if (!shift) throw new Error('Shift not found')
  const db = getDb()

  const salesRow = db.prepare(
    `SELECT COUNT(*) as count, COALESCE(SUM(total), 0) as total FROM sales WHERE shift_id = ? AND status = 'completed'`
  ).get(shiftId) || {}
  const heldRow = db.prepare(
    `SELECT COUNT(*) as count FROM sales WHERE shift_id = ? AND status = 'held'`
  ).get(shiftId) || {}
  const expRow = db.prepare(
    `SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as total FROM expenses WHERE shift_id = ?`
  ).get(shiftId) || {}

  const salesTotal = salesRow.total || 0
  const expensesTotal = expRow.total || 0
  const openingFloat = shift.opening_cash || 0
  const closingFloat = shift.closing_cash || 0
  const expectedCash = openingFloat + salesTotal - expensesTotal
  const balance = closingFloat - expectedCash
  const durationMinutes = shift.closed_at
    ? Math.floor((new Date(shift.closed_at) - new Date(shift.started_at)) / 60000)
    : Math.floor((Date.now() - new Date(shift.started_at)) / 60000)

  return {
    ...shift,
    start_float: openingFloat,
    end_float: closingFloat,
    expected_cash: expectedCash,
    actual_cash: closingFloat,
    balance,
    total_sales: salesTotal,
    total_expenses: expensesTotal,
    sales: { count: salesRow.count || 0, total: salesTotal },
    expenses: { count: expRow.count || 0, total: expensesTotal },
    held_count: heldRow.count || 0,
    sales_count: salesRow.count || 0,
    duration_minutes: durationMinutes,
    is_balanced: Math.abs(shift.variance || 0) < 0.01
  }
}

module.exports = {
  startShift, updateShiftSalesForPaymentMethod, closeShift, getShiftById,
  getCurrentShift, getExistingOpenShift, getShiftsByCashier, getAllShifts,
  getActiveShifts, getShiftSummary
}
