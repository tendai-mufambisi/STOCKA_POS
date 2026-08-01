const { getDb } = require('../index')
const { createNotification } = require('./notifications')
const { logAuditAction } = require('./audit')
const { eventNowIso, isReplay } = require('../eventClock')
const { getRequestTill, isRemoteRequest, getLocalTillCode, getTillPresence } = require('../tillPresence')
const { drawerCashSql, nonDrawerSql, splitSql, cashExpenseSql } = require('../../analytics/sql/paymentClassifier')


// Closed shifts whose figures were never confirmed against a physical count:
// 'unreconciled' = auto-closed overnight, drawer never counted at all;
// 'unverified'   = counted, but closed while the owning till was unreachable, so
//                  the expected figure it was compared against may be incomplete.
// Neither may ever be reported as balanced.
const UNVERIFIED_STATUSES = new Set(['unreconciled', 'unverified'])

function getShiftById(shiftId) {
  return getDb().prepare('SELECT * FROM shifts WHERE id = ?').get(shiftId) || null
}

// The till that owns the drawer being written right now: the satellite whose LAN
// call we're serving, or this machine when the write is local. Returns null for a
// satellite that didn't identify itself (an older build) — falling back to Main's
// own code there would misattribute the drawer to the wrong machine.
function actingTillCode() {
  if (isRemoteRequest()) return getRequestTill()
  return getLocalTillCode() || null
}

function startShift(userData, openingFloat, branchId = null) {
  const db = getDb()
  const openingCash = typeof openingFloat === 'object'
    ? (openingFloat.opening_cash ?? 0)
    : (parseFloat(openingFloat) || 0)

  // eventNowIso() = the true shift-open time when this was queued offline and
  // replayed later; Main's own clock for a live open.
  const startedAt = eventNowIso()
  // Which physical till holds this drawer's cash. Recorded at open because that's
  // the only moment we reliably know it — closeShift then uses it to refuse to
  // cash up a drawer whose till Main can't currently see.
  const tillCode = actingTillCode()
  const { lastInsertRowid: shiftId } = db.prepare(
    `INSERT INTO shifts (cashier_username, cashier_display_name, branch_id, status, opening_cash, opening_usd, started_at, till_code)
     VALUES (?, ?, ?, 'open', ?, 0, ?, ?)`
  ).run(userData.username, userData.name || userData.username, branchId, openingCash, startedAt, tillCode)

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
     FROM expenses e
     WHERE e.shift_id = ? AND ${cashExpenseSql('e')}`
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
     FROM sales s WHERE s.shift_id = ? AND s.status = 'completed' AND ${drawerCashSql('s')}`
  ).get(shift.id)?.t || 0

  // Split payments: only the ZWG cash_amount portion lands in the drawer
  const splitCashPortion = db.prepare(
    `SELECT COALESCE(SUM(cash_amount), 0) as t
     FROM sales s WHERE s.shift_id = ? AND s.status = 'completed' AND ${splitSql('s')}`
  ).get(shift.id)?.t || 0

  // Only cash expenses reduce the drawer — Transfer/EcoCash expenses do not
  const cashExpensesTotal = queryCashExpenses(db, shift.id)

  // Transfer/EcoCash receipts never pass through the drawer, so they are reconciled
  // as their own figure rather than folded into expectedCash. Same derivation
  // getShiftSummary uses, kept here so closeShift doesn't need the full summary.
  const transferSalesOnly = db.prepare(
    `SELECT COALESCE(SUM(total), 0) as t
     FROM sales s WHERE s.shift_id = ? AND s.status = 'completed' AND ${nonDrawerSql('s')}`
  ).get(shift.id)?.t || 0

  const splitTransferPortion = db.prepare(
    `SELECT COALESCE(SUM(usd_amount), 0) as t
     FROM sales s WHERE s.shift_id = ? AND s.status = 'completed' AND ${splitSql('s')}`
  ).get(shift.id)?.t || 0

  const expectedCash = (shift.opening_cash || 0) + cashSalesOnly + splitCashPortion - cashExpensesTotal
  const expectedTransfer = transferSalesOnly + splitTransferPortion
  return { salesTotal, expectedCash, expectedTransfer }
}

// Refuses to cash up a drawer whose till Main cannot currently account for.
//
// Closing a shift computes the variance from the sales Main holds. If the till
// that owns the drawer is disconnected — or is connected but still has writes in
// its offline queue — those sales exist on that machine and nowhere else, so the
// "expected cash" is simply wrong, and the cashier gets blamed for a shortage
// that is really a sync gap. Worse, when the queue finally drains, the sales land
// on a shift that is already closed and signed off.
//
// Never blocks a till closing its OWN drawer (it is by definition present, and
// its own queue drains through the same connection), and never blocks when this
// machine isn't running a LAN server (standalone shops have no tills to check).
function assertTillReachable(shift, force) {
  const till = shift.till_code
  if (!till) return null                       // opened before till_code existed — nothing to check
  const acting = actingTillCode()

  // The till is cashing up its own drawer. Never refused — the cashier is standing
  // at that machine and has counted the money. But "present" is not the same as
  // "up to date": a till that reconnected seconds ago is online while its queue is
  // still draining, and a live write goes straight out ahead of that queue. The
  // expected cash is then computed without the sales still in the queue, and the
  // cashier is blamed for a shortage that is really a sync gap.
  //
  // Replays are exempt: the queue is FIFO, so anything still behind this close
  // happened after it and was never part of its figures.
  if (acting && acting === till) {
    if (isReplay()) return null
    const own = getTillPresence(till)
    if (own.observable && own.pending > 0) {
      return `This till still has ${own.pending} write${own.pending === 1 ? '' : 's'} waiting to reach the Main Computer, ` +
        `so the expected cash was worked out without ${own.pending === 1 ? 'it' : 'them'}.`
    }
    return null
  }

  const presence = getTillPresence(till)
  if (!presence.observable) return null        // no LAN server here — no opinion to give

  let reason = null
  if (!presence.online) {
    const mins = presence.lastSeen ? Math.round((Date.now() - presence.lastSeen) / 60000) : null
    reason = `Till ${till} is not connected to the Main Computer${presence.seen && mins !== null ? ` (last seen ${mins} min ago)` : ''}. ` +
      `Any sales still on that machine are missing from these totals, so the variance would be wrong.`
  } else if (presence.pending > 0) {
    reason = `Till ${till} is connected but still has ${presence.pending} write${presence.pending === 1 ? '' : 's'} waiting to reach the Main Computer. ` +
      `Those sales are not in these totals yet — this usually clears in a moment.`
  }
  if (!reason) return null

  if (force) return reason                     // overridden on purpose; recorded on the shift

  const err = new Error(`${reason} Reconnect the till, or close anyway to record this drawer as unverified.`)
  err.code = 'TILL_UNREACHABLE'
  err.tillCode = till
  throw err
}

// Resolves which shift a close belongs to.
//
// A close that arrives with no shift id is a satellite's provisional/offline close:
// its shift-start was still sitting in the queue when the cashier closed the drawer,
// so the renderer never had a real id to send. The cashier travels in closingFloat
// instead. Without this the replay throws 'Shift not found', the shift is left open,
// and the overnight stale-shift sweep discards the cashier's real closing count.
function resolveShiftForClose(db, shiftId, cashier, closedAt) {
  if (shiftId) return getShiftById(shiftId)
  if (!cashier) return null

  // started_at <= closedAt matters: if the till stayed offline overnight and the
  // cashier opened a fresh shift before the queue drained, the newest open shift
  // is NOT the one this close belongs to. Pick the latest that had already begun
  // when the drawer was actually counted.
  const open = db.prepare(
    `SELECT * FROM shifts
       WHERE cashier_username = ? AND status = 'open'
         AND datetime(started_at) <= datetime(?)
     ORDER BY started_at DESC LIMIT 1`
  ).get(cashier, closedAt)
  if (open) return open

  // Nothing open — the shift was force-closed by End of Day or auto-closed
  // overnight while this count sat in the queue. Match it anyway so the count is
  // recorded as an amendment instead of being rejected as 'Shift not found',
  // which the satellite would dead-letter into failed_writes.json and lose.
  //
  // closed_at >= closedAt is what makes this safe: the shift must still have been
  // open at the moment the cashier counted the drawer. Without it, a count that
  // arrives with no id could attach itself to some unrelated shift from last week.
  return db.prepare(
    `SELECT * FROM shifts
       WHERE cashier_username = ?
         AND datetime(started_at) <= datetime(?)
         AND closed_at IS NOT NULL
         AND datetime(closed_at) >= datetime(?)
     ORDER BY started_at DESC LIMIT 1`
  ).get(cashier, closedAt, closedAt) || null
}

// A count that arrives for a shift somebody already closed. Never rewrites the
// stored figures: End of Day may already have been signed off against them, and
// silently changing them leaves the day's saved record disagreeing with its own
// shifts. The count is recorded as a note + audit entry + notification so an
// admin can reconcile it deliberately.
function recordLateCount(db, shift, closingCash, closingTransfer, notes, closedAt) {
  const same = Math.abs((shift.closing_cash || 0) - closingCash) < 0.01
    && (closingTransfer === null || Math.abs((shift.closing_transfer || 0) - closingTransfer) < 0.01)
  if (same) return { ...shift, __alreadyClosed: true, __duplicate: true }

  const stamp = new Date(closedAt).toISOString().slice(0, 16).replace('T', ' ')
  const parts = [`Cash counted $${closingCash.toFixed(2)}`]
  if (closingTransfer !== null) parts.push(`transfers counted $${closingTransfer.toFixed(2)}`)
  const line = `[${stamp}] Late count from ${shift.cashier_username} after this shift was already closed — ` +
    `${parts.join(', ')} (recorded on ${shift.closing_cash != null ? `$${(shift.closing_cash).toFixed(2)}` : 'no count'}). ` +
    `Not applied automatically.${notes ? ` Cashier note: ${notes}` : ''}`

  db.prepare(
    `UPDATE shifts SET notes = TRIM(COALESCE(notes || char(10), '') || ?), sync_updated_at = datetime('now') WHERE id = ?`
  ).run(line, shift.id)

  try {
    logAuditAction(shift.cashier_username, 'SHIFT_LATE_COUNT', 'SHIFT', String(shift.id), line)
    createNotification({
      type: 'SHIFT_LATE_COUNT',
      message: `⚠️ ${shift.cashier_username} submitted a drawer count for a shift that was already closed. Review it in Shift Management.`,
    })
  } catch (_) {}

  return { ...getShiftById(shift.id), __alreadyClosed: true, __declaredCash: closingCash, __declaredTransfer: closingTransfer }
}

function closeShift(shiftId, closingFloat, notes = '') {
  const db = getDb()

  // eventNowIso() = the true close time when this was queued offline and replayed
  // later; Main's own clock for a live close.
  const closedAt = eventNowIso()

  const opts = (closingFloat && typeof closingFloat === 'object') ? closingFloat : {}
  const shift = resolveShiftForClose(db, shiftId, opts.cashier || null, closedAt)
  if (!shift) throw new Error('Shift not found')
  shiftId = shift.id

  const closingCash = typeof closingFloat === 'object'
    ? (closingFloat.closing_cash || 0)
    : (parseFloat(closingFloat) || 0)

  // Transfer/EcoCash reconciliation is optional per shift. `null` (not 0) when it
  // wasn't counted, so "not reconciled" stays distinguishable from "counted, and
  // it was zero".
  const hasTransferCount = opts.closing_transfer !== undefined && opts.closing_transfer !== null
    && opts.closing_transfer !== ''
  const closingTransfer = hasTransferCount ? (parseFloat(opts.closing_transfer) || 0) : null

  // Already closed: record, don't rewrite. Covers a double-submit, a queued close
  // replaying after End of Day force-closed the same shift, and the overnight
  // auto-close beating a satellite's queue.
  if (shift.status !== 'open') {
    return recordLateCount(db, shift, closingCash, closingTransfer, notes, closedAt)
  }

  // Refuse (or record an override) when the owning till is unreachable.
  const unverifiedReason = assertTillReachable(shift, opts.force === true)

  const { salesTotal, expectedCash, expectedTransfer } = computeDrawerTotals(db, shift)

  const variance = closingCash - expectedCash

  const transferVariance = hasTransferCount ? closingTransfer - expectedTransfer : null

  let reconciliationStatus = 'balanced'
  if (Math.abs(variance) > 0.01) reconciliationStatus = variance > 0 ? 'over' : 'short'
  // A shift whose cash balances but whose transfers don't is not balanced.
  else if (hasTransferCount && Math.abs(transferVariance) > 0.01) {
    reconciliationStatus = transferVariance > 0 ? 'over' : 'short'
  }
  // Closed over an unreachable till: the figures were computed from sales Main may
  // not have. Whatever they came out as, they are not evidence the drawer balanced.
  if (unverifiedReason) reconciliationStatus = 'unverified'

  // Wording stays cause-neutral: a drawer is unverified either because its till was
  // disconnected or because that till was still holding sales it hadn't sent.
  const finalNotes = unverifiedReason
    ? [notes, `⚠️ Figures not verified — the Main Computer may not have every sale from this shift. ${unverifiedReason}`].filter(Boolean).join('\n')
    : notes

  // One transaction: a crash between the two statements used to leave the user
  // pointing at a shift that is already closed, with no way back into a drawer.
  db.transaction(() => {
    db.prepare(
      `UPDATE shifts SET closing_cash = ?, closing_usd = 0, variance = ?, usd_variance = 0,
       closing_transfer = ?, transfer_variance = ?,
       reconciliation_status = ?, notes = ?, closed_at = ?, status = 'closed',
       total_sales_value = ?, total_sales_count = (SELECT COUNT(*) FROM sales WHERE shift_id = ? AND status = 'completed'),
       sync_updated_at = datetime('now')
       WHERE id = ? AND status = 'open'`
    ).run(closingCash, variance, closingTransfer, transferVariance, reconciliationStatus, finalNotes, closedAt, salesTotal, shiftId, shiftId)
    db.prepare('UPDATE users SET current_shift_id = NULL WHERE username = ?').run(shift.cashier_username)
  })()

  // Who actually did this. Falling back to the cashier used to make the audit log
  // claim a cashier closed their own drawer when an admin closed it for them.
  const actor = opts.closed_by || shift.cashier_username
  try {
    logAuditAction(actor, 'SHIFT_CLOSED', 'SHIFT', String(shiftId),
      `Shift closed for ${shift.cashier_username} — ${reconciliationStatus} (Variance: $${variance.toFixed(2)})` +
      (unverifiedReason ? ` — figures unverified: ${unverifiedReason}` : ''))
  } catch (_) {}

  const durationHours = (new Date(closedAt) - new Date(shift.started_at)) / (1000 * 60 * 60)
  try {
    createNotification({ type: 'SHIFT_CLOSED', message: `Cashier ${shift.cashier_username} closed shift — Status: ${reconciliationStatus.toUpperCase()}` })
    if (variance < -5) createNotification({ type: 'SHIFT_SHORTAGE', message: `⚠️ Cashier ${shift.cashier_username} short by $${Math.abs(variance).toFixed(2)}` })
    if (durationHours > 10) createNotification({ type: 'SHIFT_LONG', message: `⏱️ Cashier ${shift.cashier_username} on shift for ${Math.floor(durationHours)}h ${Math.round((durationHours % 1) * 60)}m` })
    if (unverifiedReason) createNotification({
      type: 'SHIFT_UNVERIFIED',
      message: `⚠️ ${shift.cashier_username}'s shift was closed before till ${shift.till_code} had sent everything — recheck it once that till syncs.`,
    })
  } catch (_) {}

  const closed = getShiftById(shiftId)
  return unverifiedReason ? { ...closed, __unverified: true, __unverifiedReason: unverifiedReason } : closed
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
  // Classification comes from analytics/sql/paymentClassifier so the drawer
  // figures here, the ones closeShift computes, and the ones reports show are
  // all derived from one taxonomy.
  const cashSalesOnly = db.prepare(
    `SELECT COALESCE(SUM(total), 0) as t
     FROM sales s WHERE s.shift_id = ? AND s.status = 'completed' AND ${drawerCashSql('s')}`
  ).get(shiftId)?.t || 0

  const transferSalesOnly = db.prepare(
    `SELECT COALESCE(SUM(total), 0) as t
     FROM sales s WHERE s.shift_id = ? AND s.status = 'completed' AND ${nonDrawerSql('s')}`
  ).get(shiftId)?.t || 0

  const splitRow = db.prepare(
    `SELECT COALESCE(SUM(cash_amount), 0) as cash_part, COALESCE(SUM(usd_amount), 0) as transfer_part
     FROM sales s WHERE s.shift_id = ? AND s.status = 'completed' AND ${splitSql('s')}`
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
    // A drawer nobody counted, or one closed while its till was unreachable, is
    // never "balanced" — its variance is 0 only because there was nothing to
    // compare against. Anything reading is_balanced as a tick must not get one.
    is_balanced:      Math.abs(balance) < 0.01 && !UNVERIFIED_STATUSES.has(shift.reconciliation_status),
    is_verified:      !UNVERIFIED_STATUSES.has(shift.reconciliation_status),
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

  // A cashier may only have one drawer open at a time — otherwise sales split
  // silently across two shifts and neither reconciles.
  const otherOpen = db.prepare(
    `SELECT id FROM shifts WHERE cashier_username = ? AND status = 'open' AND id != ? LIMIT 1`
  ).get(shift.cashier_username, shiftId)
  if (otherOpen) throw new Error(`${shift.cashier_username} already has an open shift (#${otherOpen.id}) — close that one first`)

  // Clear the transfer figures too. Leaving them behind showed a reopened shift
  // as still carrying a counted transfer amount that no longer applied to it.
  db.transaction(() => {
    db.prepare(
      `UPDATE shifts SET status = 'open', closed_at = NULL, closing_cash = NULL, variance = NULL,
       closing_transfer = NULL, transfer_variance = NULL,
       reconciliation_status = NULL, sync_updated_at = datetime('now') WHERE id = ?`
    ).run(shiftId)
    db.prepare('UPDATE users SET current_shift_id = ? WHERE username = ?').run(shiftId, shift.cashier_username)
  })()
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
      //
      // Status is 'unreconciled', NOT 'balanced': nobody counted this drawer. The
      // recorded cash is the expected figure, so the variance is 0 by construction —
      // calling that "balanced" made a forgotten till look like a verified one, and
      // every report that sums variance treated it as clean.
      db.transaction(() => {
        db.prepare(
          `UPDATE shifts SET closing_cash = ?, closing_usd = 0, variance = 0, usd_variance = 0,
           reconciliation_status = 'unreconciled', notes = ?, closed_at = ?, status = 'closed',
           total_sales_value = ?, total_sales_count = (SELECT COUNT(*) FROM sales WHERE shift_id = ? AND status = 'completed'),
           sync_updated_at = datetime('now')
           WHERE id = ? AND status = 'open'`
        ).run(expectedCash, 'Auto-closed — left open overnight. Drawer was never counted, so these figures are the expected amounts, not a verified count.', closedAt, salesTotal, shift.id, shift.id)
        db.prepare('UPDATE users SET current_shift_id = NULL WHERE username = ?').run(shift.cashier_username)
      })()
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

// End of Day. `opts.force` closes drawers whose till is unreachable anyway (the
// admin's explicit call — recorded on each such shift as 'unverified'), and
// `opts.closedBy` records who actually pressed the button.
function closeAllOpenShifts(closingDataArray, eodNote, opts = {}) {
  const note = eodNote || 'Auto-closed by End of Day'
  const results = []
  for (const item of (closingDataArray || [])) {
    const { shiftId, closingCash, closingTransfer } = item
    const shift = getShiftById(shiftId)
    if (!shift || shift.status !== 'open') continue
    try {
      const result = closeShift(
        shiftId,
        {
          closing_cash: closingCash || 0,
          closing_transfer: closingTransfer ?? null,
          force: opts.force === true,
          closed_by: opts.closedBy || null,
        },
        note
      )
      results.push({
        shiftId, success: true, result,
        cashier: shift.cashier_username,
        unverified: !!result?.__unverified,
      })
    } catch (err) {
      // A blocked till is a refusal the admin can act on (reconnect it, or
      // override) — keep it distinguishable from a genuine failure.
      results.push({
        shiftId, success: false, error: err.message,
        code: err.code || null,
        cashier: shift.cashier_username,
        tillCode: err.tillCode || shift.till_code || null,
      })
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
