const { getDb } = require('../index')
const { createNotification } = require('./notifications')
const { logAuditAction } = require('./audit')


function getShiftById(shiftId) {
  return getDb().prepare('SELECT * FROM shifts WHERE id = ?').get(shiftId) || null
}

function startShift(userData, openingFloat, branchId = null) {
  const db = getDb()
  const openingCash = typeof openingFloat === 'object'
    ? (openingFloat.opening_cash ?? 0)
    : (parseFloat(openingFloat) || 0)

  const startedAt = new Date().toISOString()
  const { lastInsertRowid: shiftId } = db.prepare(
    `INSERT INTO shifts (cashier_username, cashier_display_name, branch_id, status, opening_cash, opening_usd, started_at)
     VALUES (?, ?, ?, 'open', ?, 0, ?)`
  ).run(userData.username, userData.name || userData.username, branchId, openingCash, startedAt)

  if (!shiftId) throw new Error('Failed to get shift ID after insert')
  db.prepare('UPDATE users SET current_shift_id = ? WHERE id = ?').run(shiftId, userData.id)
  try { logAuditAction(userData.username, 'SHIFT_OPENED', 'SHIFT', String(shiftId), `Shift opened — Opening float: $${openingCash.toFixed(2)}`) } catch (_) {}
  return getShiftById(shiftId)
}

function updateShiftSalesForPaymentMethod(shiftId, paymentMethod, amount) {
  getDb().prepare(
    `UPDATE shifts SET total_sales_count = total_sales_count + 1, total_sales_value = total_sales_value + ?, sync_updated_at = datetime('now') WHERE id = ?`
  ).run(amount, shiftId)
}

function closeShift(shiftId, closingFloat, notes = '') {
  const db = getDb()
  const shift = getShiftById(shiftId)
  if (!shift) throw new Error('Shift not found')

  const salesTotal = db.prepare(
    `SELECT COALESCE(SUM(total), 0) as total FROM sales WHERE shift_id = ? AND status = 'completed'`
  ).get(shiftId)?.total || 0

  const expensesTotal = db.prepare(
    `SELECT COALESCE(SUM(amount), 0) as total FROM expenses WHERE shift_id = ?`
  ).get(shiftId)?.total || 0

  // Only cash-received amounts count toward expected cash in drawer
  const cashSalesOnly = db.prepare(
    `SELECT COALESCE(SUM(total), 0) as t FROM sales WHERE shift_id = ? AND status = 'completed' AND payment_method = 'Cash'`
  ).get(shiftId)?.t || 0
  const splitCashPortion = db.prepare(
    `SELECT COALESCE(SUM(cash_amount), 0) as t FROM sales WHERE shift_id = ? AND status = 'completed' AND payment_method = 'Split'`
  ).get(shiftId)?.t || 0

  const closingCash = typeof closingFloat === 'object'
    ? (closingFloat.closing_cash || 0)
    : (parseFloat(closingFloat) || 0)

  const expectedCash = (shift.opening_cash || 0) + cashSalesOnly + splitCashPortion - expensesTotal
  const variance = closingCash - expectedCash

  let reconciliationStatus = 'balanced'
  if (Math.abs(variance) > 0.01) reconciliationStatus = variance > 0 ? 'over' : 'short'

  const closedAt = new Date().toISOString()
  db.prepare(
    `UPDATE shifts SET closing_cash = ?, closing_usd = 0, variance = ?, usd_variance = 0,
     reconciliation_status = ?, notes = ?, closed_at = ?, status = 'closed',
     total_sales_value = ?, total_sales_count = (SELECT COUNT(*) FROM sales WHERE shift_id = ? AND status = 'completed')
     WHERE id = ?`
  ).run(closingCash, variance, reconciliationStatus, notes, closedAt, salesTotal, shiftId, shiftId)
  db.prepare('UPDATE users SET current_shift_id = NULL WHERE username = ?').run(shift.cashier_username)
  try {
    logAuditAction(shift.cashier_username, 'SHIFT_CLOSED', 'SHIFT', String(shiftId),
      `Shift closed — ${reconciliationStatus} (Variance: $${variance.toFixed(2)})`)
  } catch (_) {}

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
    `SELECT COUNT(*) as count, COALESCE(SUM(total), 0) as total
     FROM sales WHERE shift_id = ? AND status = 'completed'`
  ).get(shiftId) || {}
  const heldRow = db.prepare(
    `SELECT COUNT(*) as count FROM sales WHERE shift_id = ? AND status = 'held'`
  ).get(shiftId) || {}
  const expRow = db.prepare(
    `SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as total FROM expenses WHERE shift_id = ?`
  ).get(shiftId) || {}

  // ── Payment-method breakdown ──────────────────────────────
  const cashSalesOnly = db.prepare(
    `SELECT COALESCE(SUM(total), 0) as t FROM sales WHERE shift_id = ? AND status = 'completed' AND payment_method = 'Cash'`
  ).get(shiftId)?.t || 0

  const transferSalesOnly = db.prepare(
    `SELECT COALESCE(SUM(total), 0) as t FROM sales WHERE shift_id = ? AND status = 'completed' AND payment_method IN ('Transfer','Swipe','EcoCash','USD')`
  ).get(shiftId)?.t || 0

  const splitRow = db.prepare(
    `SELECT COALESCE(SUM(cash_amount), 0) as cash_part, COALESCE(SUM(usd_amount), 0) as transfer_part, COALESCE(SUM(total), 0) as total
     FROM sales WHERE shift_id = ? AND status = 'completed' AND payment_method = 'Split'`
  ).get(shiftId) || {}

  // Cash in drawer  = cash sales + cash portion of split sales
  const cashSales     = cashSalesOnly + (splitRow.cash_part || 0)
  // Transfer receipts = transfer sales + transfer portion of split sales
  const transferSales = transferSalesOnly + (splitRow.transfer_part || 0)

  const salesTotal    = salesRow.total || 0
  const expensesTotal = expRow.total || 0
  const openingCash   = shift.opening_cash || 0
  const closingCash   = shift.closing_cash || 0

  // Expected cash in drawer accounts for cash-only payments
  const expectedCash     = openingCash + cashSales - expensesTotal
  // Expected transfer is purely electronic — informational
  const expectedTransfer = transferSales

  const variance = shift.status === 'closed' ? (shift.variance || 0) : (closingCash - expectedCash)
  const balance  = variance

  const durationMinutes = shift.closed_at
    ? Math.floor((new Date(shift.closed_at) - new Date(shift.started_at)) / 60000)
    : Math.floor((Date.now() - new Date(shift.started_at)) / 60000)

  return {
    ...shift,
    start_float:        openingCash,
    end_float:          closingCash,
    // Payment breakdown
    cash_sales:         cashSales,
    transfer_sales:     transferSales,
    // Expectations
    expected_cash:      expectedCash,
    expected_transfer:  expectedTransfer,
    actual_cash:        closingCash,
    cash_variance:      variance,
    balance,
    // Totals
    total_sales:        salesTotal,
    total_expenses:     expensesTotal,
    cash_expenses:      expensesTotal,
    sales: { count: salesRow.count || 0, total: salesTotal },
    expenses: { count: expRow.count || 0, total: expensesTotal },
    held_count:         heldRow.count || 0,
    sales_count:        salesRow.count || 0,
    duration_minutes:   durationMinutes,
    is_balanced:        Math.abs(balance) < 0.01,
    // Legacy zero fields kept for backward compat
    start_float_usd: 0, end_float_usd: 0, expected_usd: 0, actual_usd: 0, usd_variance: 0,
    usd_sales: 0, usd_expenses: 0,
  }
}

function reopenShift(shiftId) {
  const db = getDb()
  const shift = getShiftById(shiftId)
  if (!shift) throw new Error('Shift not found')
  if (shift.status !== 'closed') throw new Error('Shift is not closed')

  db.prepare(
    `UPDATE shifts SET status = 'open', closed_at = NULL, closing_cash = NULL, variance = NULL, reconciliation_status = NULL, sync_updated_at = datetime('now') WHERE id = ?`
  ).run(shiftId)
  db.prepare('UPDATE users SET current_shift_id = ? WHERE username = ?').run(shiftId, shift.cashier_username)
  try { logAuditAction('system', 'SHIFT_REOPENED', 'SHIFT', String(shiftId), `Shift ${shiftId} reopened by admin`) } catch (_) {}
  return getShiftById(shiftId)
}

function closeAllOpenShifts(closingDataArray, eodNote) {
  const note = eodNote || 'Auto-closed by End of Day'
  const results = []
  for (const item of (closingDataArray || [])) {
    const { shiftId, closingCash } = item
    const shift = getShiftById(shiftId)
    if (!shift || shift.status !== 'open') continue
    try {
      const result = closeShift(shiftId, { closing_cash: closingCash || 0 }, note)
      results.push({ shiftId, success: true, result })
    } catch (err) {
      results.push({ shiftId, success: false, error: err.message })
    }
  }
  return results
}

module.exports = {
  startShift, updateShiftSalesForPaymentMethod, closeShift, getShiftById,
  getCurrentShift, getExistingOpenShift, getShiftsByCashier, getAllShifts,
  getActiveShifts, getShiftSummary, closeAllOpenShifts, reopenShift
}
