const { getDb } = require('../index')
const { createNotification } = require('./notifications')
const { logAuditAction } = require('./audit')
const { eventNowIso } = require('../eventClock')


function getShiftById(shiftId) {
  return getDb().prepare('SELECT * FROM shifts WHERE id = ?').get(shiftId) || null
}

function startShift(userData, openingFloat, branchId = null) {
  const db = getDb()
  const openingCash = typeof openingFloat === 'object'
    ? (openingFloat.opening_cash ?? 0)
    : (parseFloat(openingFloat) || 0)

  // eventNowIso() = the true shift-open time when this was queued offline and
  // replayed later; Main's own clock for a live open.
  const startedAt = eventNowIso()
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

// Helper: only expenses paid from the cash drawer reduce expected cash.
// Transfer/EcoCash expenses don't touch the till, so they must not be deducted.
function queryCashExpenses(db, shiftId) {
  return db.prepare(
    `SELECT COALESCE(SUM(amount), 0) as total
     FROM expenses
     WHERE shift_id = ? AND (payment_method = 'Cash' OR payment_method IS NULL OR payment_method = '')`
  ).get(shiftId)?.total || 0
}

// Drawer math shared by closeShift and closeStaleShifts.
// Business rule: expected cash = opening float + cash sales + cash portion of splits − cash expenses.
function computeDrawerTotals(db, shift) {
  const salesTotal = db.prepare(
    `SELECT COALESCE(SUM(total), 0) as total FROM sales WHERE shift_id = ? AND status = 'completed'`
  ).get(shift.id)?.total || 0

  // Cash-method sales only — Transfer/EcoCash/Swipe sales never go into the cash drawer
  const cashSalesOnly = db.prepare(
    `SELECT COALESCE(SUM(total), 0) as t
     FROM sales WHERE shift_id = ? AND status = 'completed' AND payment_method = 'Cash'`
  ).get(shift.id)?.t || 0

  // Split payments: only the ZWG cash_amount portion lands in the drawer
  const splitCashPortion = db.prepare(
    `SELECT COALESCE(SUM(cash_amount), 0) as t
     FROM sales WHERE shift_id = ? AND status = 'completed' AND payment_method = 'Split'`
  ).get(shift.id)?.t || 0

  // Only cash expenses reduce the drawer — Transfer/EcoCash expenses do not
  const cashExpensesTotal = queryCashExpenses(db, shift.id)

  // Transfer/EcoCash receipts never pass through the drawer, so they are reconciled
  // as their own figure rather than folded into expectedCash. Same derivation
  // getShiftSummary uses, kept here so closeShift doesn't need the full summary.
  const transferSalesOnly = db.prepare(
    `SELECT COALESCE(SUM(total), 0) as t
     FROM sales WHERE shift_id = ? AND status = 'completed'
     AND payment_method IN ('Transfer','Swipe','EcoCash','USD')`
  ).get(shift.id)?.t || 0

  const splitTransferPortion = db.prepare(
    `SELECT COALESCE(SUM(usd_amount), 0) as t
     FROM sales WHERE shift_id = ? AND status = 'completed' AND payment_method = 'Split'`
  ).get(shift.id)?.t || 0

  const expectedCash = (shift.opening_cash || 0) + cashSalesOnly + splitCashPortion - cashExpensesTotal
  const expectedTransfer = transferSalesOnly + splitTransferPortion
  return { salesTotal, expectedCash, expectedTransfer }
}

function closeShift(shiftId, closingFloat, notes = '') {
  const db = getDb()

  // eventNowIso() = the true close time when this was queued offline and replayed
  // later; Main's own clock for a live close.
  const closedAt = eventNowIso()

  // A close that arrives with no shift id is a satellite's provisional/offline close:
  // its shift-start was still sitting in the queue when the cashier closed the drawer,
  // so the renderer never had a real id to send. The cashier travels in closingFloat
  // instead — resolve their open shift here. Without this the replay throws
  // 'Shift not found', the shift is left open, and the overnight stale-shift sweep
  // discards the cashier's real closing count and variance.
  let shift = shiftId ? getShiftById(shiftId) : null
  const cashier = typeof closingFloat === 'object' ? closingFloat.cashier : null
  if (!shift && cashier) {
    // started_at <= closedAt matters: if the till stayed offline overnight and the
    // cashier opened a fresh shift before the queue drained, the newest open shift
    // is NOT the one this close belongs to. Pick the latest that had already begun
    // when the drawer was actually counted.
    shift = db.prepare(
      `SELECT * FROM shifts
         WHERE cashier_username = ? AND status = 'open'
           AND datetime(started_at) <= datetime(?)
       ORDER BY started_at DESC LIMIT 1`
    ).get(cashier, closedAt) || null
  }
  if (!shift) throw new Error('Shift not found')
  shiftId = shift.id

  const { salesTotal, expectedCash, expectedTransfer } = computeDrawerTotals(db, shift)

  const closingCash = typeof closingFloat === 'object'
    ? (closingFloat.closing_cash || 0)
    : (parseFloat(closingFloat) || 0)

  const variance = closingCash - expectedCash

  // Transfer/EcoCash reconciliation is optional per shift — only End of Day collects
  // it today, and only for shifts that took transfer payments. `null` (not 0) when
  // it wasn't counted, so "not reconciled" stays distinguishable from "counted, and
  // it was zero".
  const hasTransferCount = typeof closingFloat === 'object' && closingFloat !== null
    && closingFloat.closing_transfer !== undefined && closingFloat.closing_transfer !== null
    && closingFloat.closing_transfer !== ''
  const closingTransfer = hasTransferCount ? (parseFloat(closingFloat.closing_transfer) || 0) : null
  const transferVariance = hasTransferCount ? closingTransfer - expectedTransfer : null

  let reconciliationStatus = 'balanced'
  if (Math.abs(variance) > 0.01) reconciliationStatus = variance > 0 ? 'over' : 'short'
  // A shift whose cash balances but whose transfers don't is not balanced.
  else if (hasTransferCount && Math.abs(transferVariance) > 0.01) {
    reconciliationStatus = transferVariance > 0 ? 'over' : 'short'
  }

  db.prepare(
    `UPDATE shifts SET closing_cash = ?, closing_usd = 0, variance = ?, usd_variance = 0,
     closing_transfer = ?, transfer_variance = ?,
     reconciliation_status = ?, notes = ?, closed_at = ?, status = 'closed',
     total_sales_value = ?, total_sales_count = (SELECT COUNT(*) FROM sales WHERE shift_id = ? AND status = 'completed'),
     sync_updated_at = datetime('now')
     WHERE id = ?`
  ).run(closingCash, variance, closingTransfer, transferVariance, reconciliationStatus, notes, closedAt, salesTotal, shiftId, shiftId)
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

  // ── Payment-method breakdown ──────────────────────────────────────────────
  const cashSalesOnly = db.prepare(
    `SELECT COALESCE(SUM(total), 0) as t
     FROM sales WHERE shift_id = ? AND status = 'completed' AND payment_method = 'Cash'`
  ).get(shiftId)?.t || 0

  const transferSalesOnly = db.prepare(
    `SELECT COALESCE(SUM(total), 0) as t
     FROM sales WHERE shift_id = ? AND status = 'completed'
     AND payment_method IN ('Transfer','Swipe','EcoCash','USD')`
  ).get(shiftId)?.t || 0

  const splitRow = db.prepare(
    `SELECT COALESCE(SUM(cash_amount), 0) as cash_part, COALESCE(SUM(usd_amount), 0) as transfer_part
     FROM sales WHERE shift_id = ? AND status = 'completed' AND payment_method = 'Split'`
  ).get(shiftId) || {}

  // Only cash-paid expenses reduce the drawer balance
  const cashExpenses = queryCashExpenses(db, shiftId)

  const cashSales     = cashSalesOnly + (splitRow.cash_part || 0)
  const transferSales = transferSalesOnly + (splitRow.transfer_part || 0)

  const salesTotal    = salesRow.total || 0
  const expensesTotal = expRow.total || 0
  const openingCash   = shift.opening_cash || 0
  const closingCash   = shift.closing_cash || 0

  // For CLOSED shifts: lock expected_cash to the value used at close time.
  // Prevents post-close voids/additions from silently changing EOD totals.
  // Derivation: variance = closingCash − expectedCash → expectedCash = closingCash − variance
  const expectedCash = shift.status === 'closed'
    ? closingCash - (shift.variance || 0)
    : openingCash + cashSales - cashExpenses

  // Transfer receipts don't come through the cash drawer, so they reconcile on their
  // own. For a CLOSED shift, lock to what was counted at close time — same reasoning
  // as expected_cash above: a later void must not silently rewrite a signed-off day.
  const closingTransfer = shift.closing_transfer
  const hasTransferCount = closingTransfer !== null && closingTransfer !== undefined
  const expectedTransfer = shift.status === 'closed' && hasTransferCount
    ? closingTransfer - (shift.transfer_variance || 0)
    : transferSales
  const transferVariance = shift.status === 'closed'
    ? (hasTransferCount ? (shift.transfer_variance || 0) : null)
    : null

  const variance = shift.status === 'closed' ? (shift.variance || 0) : (closingCash - expectedCash)
  const balance  = variance

  const durationMinutes = shift.closed_at
    ? Math.floor((new Date(shift.closed_at) - new Date(shift.started_at)) / 60000)
    : Math.floor((Date.now() - new Date(shift.started_at)) / 60000)

  return {
    ...shift,
    start_float:       openingCash,
    end_float:         closingCash,
    cash_sales:        cashSales,
    transfer_sales:    transferSales,
    expected_cash:     expectedCash,
    expected_transfer: expectedTransfer,
    actual_cash:       closingCash,
    actual_transfer:   hasTransferCount ? closingTransfer : null,
    transfer_variance: transferVariance,
    cash_variance:     variance,
    balance,
    total_sales:       salesTotal,
    total_expenses:    expensesTotal,
    cash_expenses:     cashExpenses,
    sales:    { count: salesRow.count || 0, total: salesTotal },
    expenses: { count: expRow.count || 0, total: expensesTotal },
    held_count:       heldRow.count || 0,
    sales_count:      salesRow.count || 0,
    duration_minutes: durationMinutes,
    is_balanced:      Math.abs(balance) < 0.01,
    // Legacy zeros kept for backward compat
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

// Auto-close shifts left open from a previous day. A shift that survives midnight
// otherwise keeps accumulating duration forever (the 35h/300h "runaway shift" bug)
// and silently drops off the End of Day page, which only lists today's shifts.
// Runs on the authoritative DB only (standalone or LAN-server mode) — satellites
// mirror shifts from Main, so they receive these closures via delta sync.
function closeStaleShifts() {
  const db = getDb()
  const stale = db.prepare(
    `SELECT * FROM shifts WHERE status = 'open' AND date(started_at, 'localtime') < date('now', 'localtime')`
  ).all()

  const results = []
  for (const shift of stale) {
    try {
      const { salesTotal, expectedCash } = computeDrawerTotals(db, shift)
      // End the shift at 23:59:59 LOCAL of the day it started so recorded durations stay sane
      const start = new Date(shift.started_at)
      const closedAt = new Date(start.getFullYear(), start.getMonth(), start.getDate(), 23, 59, 59).toISOString()
      // closed_at is backdated, so the delta query's closed_at check won't pick this
      // row up — sync_updated_at = now is what propagates it to satellites.
      db.prepare(
        `UPDATE shifts SET closing_cash = ?, closing_usd = 0, variance = 0, usd_variance = 0,
         reconciliation_status = 'balanced', notes = ?, closed_at = ?, status = 'closed',
         total_sales_value = ?, total_sales_count = (SELECT COUNT(*) FROM sales WHERE shift_id = ? AND status = 'completed'),
         sync_updated_at = datetime('now')
         WHERE id = ?`
      ).run(expectedCash, 'Auto-closed — left open overnight', closedAt, salesTotal, shift.id, shift.id)
      db.prepare('UPDATE users SET current_shift_id = NULL WHERE username = ?').run(shift.cashier_username)
      try {
        logAuditAction('system', 'SHIFT_AUTO_CLOSED', 'SHIFT', String(shift.id),
          `Shift for ${shift.cashier_username} auto-closed (left open overnight). Recorded cash: $${expectedCash.toFixed(2)}`)
        createNotification({
          type: 'SHIFT_AUTO_CLOSED',
          message: `⏱️ ${shift.cashier_username}'s shift from ${String(shift.started_at).slice(0, 10)} was left open overnight and has been auto-closed. Please review it in Shift Management.`,
        })
      } catch (_) {}
      results.push({ shiftId: shift.id, cashier: shift.cashier_username, success: true })
    } catch (err) {
      results.push({ shiftId: shift.id, cashier: shift.cashier_username, success: false, error: err.message })
    }
  }
  return results
}

function closeAllOpenShifts(closingDataArray, eodNote) {
  const note = eodNote || 'Auto-closed by End of Day'
  const results = []
  for (const item of (closingDataArray || [])) {
    const { shiftId, closingCash, closingTransfer } = item
    const shift = getShiftById(shiftId)
    if (!shift || shift.status !== 'open') continue
    try {
      const result = closeShift(
        shiftId,
        { closing_cash: closingCash || 0, closing_transfer: closingTransfer ?? null },
        note
      )
      results.push({ shiftId, success: true, result })
    } catch (err) {
      results.push({ shiftId, success: false, error: err.message })
    }
  }
  return results
}

// Finds completed sales for this shift's cashier that were written with no shift_id
// (or an id that no longer resolves to any shift) but clearly happened during this
// shift's time window — the classic symptom of a shift-start that got queued while
// offline, leaving the till's cached "current shift" without a real id at sale time.
// Read-only: used both for the admin preview and internally by the reconcile step.
function findOrphanedSalesForShift(db, shift) {
  const windowEnd = shift.closed_at || new Date().toISOString()
  // sales.created_at is SQLite datetime('now') ('YYYY-MM-DD HH:MM:SS') while a
  // shift's started_at/closed_at are JS toISOString() ('…T…Z'). Wrap both sides in
  // datetime() so they normalise to the same UTC form — a raw string compare would
  // sort the space-separated form before the T-separated one and match nothing.
  return db.prepare(
    `SELECT s.* FROM sales s
     WHERE s.cashier = ? AND s.status = 'completed'
       AND (s.shift_id IS NULL OR NOT EXISTS (SELECT 1 FROM shifts sh WHERE sh.id = s.shift_id))
       AND datetime(s.created_at) >= datetime(?) AND datetime(s.created_at) <= datetime(?)
     ORDER BY s.created_at ASC`
  ).all(shift.cashier_username, shift.started_at, windowEnd)
}

function previewOrphanedSales(shiftId) {
  const db = getDb()
  const shift = getShiftById(shiftId)
  if (!shift) throw new Error('Shift not found')
  const matched = findOrphanedSalesForShift(db, shift)
  return {
    shiftId,
    cashier: shift.cashier_username,
    count: matched.length,
    total: matched.reduce((sum, s) => sum + (s.total || 0), 0),
    sales: matched.map(s => ({
      id: s.id, created_at: s.created_at, total: s.total,
      payment_method: s.payment_method, receipt_number: s.receipt_number,
    })),
  }
}

// Backfills shift_id on the matched sales and recomputes this shift's cached
// counters — same COUNT/SUM subquery pattern closeShift/closeStaleShifts already
// use, so the fix is consistent with how those totals are derived everywhere else.
// Idempotent: once a sale is relinked it no longer matches the "orphaned" query,
// so running this again finds nothing further to do.
function reconcileOrphanedSales(shiftId) {
  const db = getDb()
  const shift = getShiftById(shiftId)
  if (!shift) throw new Error('Shift not found')
  const matched = findOrphanedSalesForShift(db, shift)
  if (matched.length === 0) return { shiftId, relinked: 0, total: 0 }

  const relink = db.prepare(`UPDATE sales SET shift_id = ?, sync_updated_at = datetime('now') WHERE id = ?`)
  const total = matched.reduce((sum, s) => sum + (s.total || 0), 0)

  db.transaction(() => {
    for (const s of matched) relink.run(shiftId, s.id)
    db.prepare(
      `UPDATE shifts SET
         total_sales_count = (SELECT COUNT(*) FROM sales WHERE shift_id = ? AND status = 'completed'),
         total_sales_value = (SELECT COALESCE(SUM(total), 0) FROM sales WHERE shift_id = ? AND status = 'completed'),
         sync_updated_at = datetime('now')
       WHERE id = ?`
    ).run(shiftId, shiftId, shiftId)
  })()

  try {
    logAuditAction('system', 'SHIFT_SALES_RELINKED', 'SHIFT', String(shiftId),
      `Relinked ${matched.length} orphaned sale(s) totalling $${total.toFixed(2)} to ${shift.cashier_username}'s shift`)
  } catch (_) {}

  return { shiftId, relinked: matched.length, total }
}

module.exports = {
  startShift, updateShiftSalesForPaymentMethod, closeShift, getShiftById,
  getCurrentShift, getExistingOpenShift, getShiftsByCashier, getAllShifts,
  getActiveShifts, getShiftSummary, closeAllOpenShifts, closeStaleShifts, reopenShift,
  previewOrphanedSales, reconcileOrphanedSales,
}
