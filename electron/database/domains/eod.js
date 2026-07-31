const { getDb } = require('../index')

function addEndOfDay(eod) {
  const db = getDb()

  // Transfer figures are stored alongside — never folded into `difference`, which
  // stays cash-only so existing reports and history rows keep meaning what they
  // always meant.
  const expectedTransfer = eod.expected_transfer || 0
  const actualTransfer   = eod.actual_transfer || 0
  const transferDiff     = eod.transfer_difference ?? (actualTransfer - expectedTransfer)

  // The printable report is frozen here as JSON so a reprint months later shows the
  // figures the cash was signed off against, not whatever the shift rows say today.
  const snapshot = eod.report_snapshot
    ? (typeof eod.report_snapshot === 'string' ? eod.report_snapshot : JSON.stringify(eod.report_snapshot))
    : null

  const existing = db.prepare('SELECT id FROM end_of_day WHERE date = ?').get(eod.date)
  if (existing) {
    db.prepare(
      `UPDATE end_of_day SET cashier = ?, total_sales = ?, total_expenses = ?, expected_cash = ?, actual_cash = ?, difference = ?,
       expected_transfer = ?, actual_transfer = ?, transfer_difference = ?, status = ?, notes = ?, report_snapshot = ?,
       sync_updated_at = datetime('now') WHERE date = ?`
    ).run(eod.cashier, eod.total_sales, eod.total_expenses, eod.expected_cash, eod.actual_cash, eod.difference,
      expectedTransfer, actualTransfer, transferDiff, eod.status || '', eod.notes || '', snapshot, eod.date)
  } else {
    db.prepare(
      `INSERT INTO end_of_day (date, cashier, total_sales, total_expenses, expected_cash, actual_cash, difference,
       expected_transfer, actual_transfer, transfer_difference, status, notes, report_snapshot, sync_updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
    ).run(eod.date, eod.cashier, eod.total_sales, eod.total_expenses, eod.expected_cash, eod.actual_cash, eod.difference,
      expectedTransfer, actualTransfer, transferDiff, eod.status || '', eod.notes || '', snapshot)
  }
}

function getEndOfDayRecords() {
  return getDb().prepare('SELECT * FROM end_of_day ORDER BY date DESC').all()
}

function getEndOfDayByDate(date) {
  return getDb().prepare('SELECT * FROM end_of_day WHERE date = ?').get(date) || null
}

module.exports = { addEndOfDay, getEndOfDayRecords, getEndOfDayByDate }
