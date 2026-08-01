const { getDb } = require('../index')
const { costResolverFor } = require('../../analytics/sql/costResolver')

// Freezes what was on the shelves, and what it was worth, on the day just
// closed.
//
// Historical stock can be reconstructed by rolling the movement log backwards
// (see analytics/sql/inventoryLedger.js), and that reconstruction stays the
// source of truth. But it costs a scan per product per report, and it depends
// on the movement log being complete for the whole intervening period. Writing
// a row per product at close is cheap, exact at the moment it is taken, and
// gives the monthly report an opening stock figure that does not have to be
// derived at all.
//
// Deliberately non-fatal: a shop must always be able to close its day. If this
// fails, the reconstruction still answers the question.
function snapshotInventory(db, date) {
  try {
    const resolver = costResolverFor(db, { asOf: date })
    const products = db.prepare('SELECT id, current_quantity FROM products').all()
    const insert = db.prepare(
      `INSERT INTO inventory_daily_snapshots
         (date, product_id, qty, unit_cost, value_at_cost, cost_source, built_from)
       VALUES (@date, @product_id, @qty, @unit_cost, @value_at_cost, @cost_source, 'live')
       ON CONFLICT(date, product_id) DO UPDATE SET
         qty = excluded.qty, unit_cost = excluded.unit_cost,
         value_at_cost = excluded.value_at_cost, cost_source = excluded.cost_source,
         built_from = excluded.built_from`
    )

    db.transaction(() => {
      for (const p of products) {
        const cost = resolver.costOf(p.id)
        const known = cost.source === 'receiving'
        insert.run({
          date,
          product_id: p.id,
          qty: p.current_quantity || 0,
          // null, not 0, when the cost is unknown — so a later reader can tell
          // "worth nothing" from "we never recorded what this cost".
          unit_cost: known ? cost.cost : null,
          value_at_cost: known ? (p.current_quantity || 0) * cost.cost : null,
          cost_source: cost.source,
        })
      }
    })()
  } catch (err) {
    console.warn('Inventory snapshot skipped (non-fatal):', err.message)
  }
}

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

  // Freeze the shelves as they stand at close, for next month's opening stock.
  snapshotInventory(db, eod.date)
}

function getEndOfDayRecords() {
  return getDb().prepare('SELECT * FROM end_of_day ORDER BY date DESC').all()
}

function getEndOfDayByDate(date) {
  return getDb().prepare('SELECT * FROM end_of_day WHERE date = ?').get(date) || null
}

module.exports = { addEndOfDay, getEndOfDayRecords, getEndOfDayByDate }
