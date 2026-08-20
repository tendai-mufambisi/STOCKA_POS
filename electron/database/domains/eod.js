const { getDb } = require('../index')
const { costResolverFor } = require('../../analytics/sql/costResolver')
const { today: localToday } = require('../../analytics/kernel/time')
const { logAuditAction } = require('./audit')

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

  // A day cannot be signed off before it has happened.
  const todayStr = localToday()
  if (eod.date > todayStr) throw new Error(`Cannot close ${eod.date} — that day has not happened yet`)
  const isRetroactive = eod.date < todayStr

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
  //
  // Only for today. A snapshot is a MEASUREMENT of what is physically on the
  // shelves right now — writing today's quantities under last week's date would be
  // a fabricated one, labelled 'live', and it would silently become that month's
  // opening stock. Past days are answered by the movement-ledger reconstruction in
  // analytics/sql/inventoryLedger.js, which this snapshot is only an optimisation
  // of and which the header above names as the source of truth either way.
  if (isRetroactive) {
    try {
      logAuditAction(eod.cashier || 'system', 'EOD_RETROACTIVE', 'EOD', eod.date,
        `Day ${eod.date} closed retroactively on ${todayStr}. No inventory snapshot was taken — ` +
        `stock for that date is reconstructed from the movement ledger.`)
    } catch (_) {}
  } else {
    snapshotInventory(db, eod.date)
  }
}

// Past trading days that took money, or had a drawer, but were never signed off.
//
// End of Day used to be today-only, so a day the admin forgot simply stayed open
// forever with nothing to say so. This is what the dashboard banner reads, and
// what makes those days closable after the fact.
//
// Floored at the first day the shop ever closed (or 30 days back if it never has),
// so switching this on does not confront a long-running shop with hundreds of red
// rows it was never going to reconcile.
function getUnclosedBusinessDays(limit = 30) {
  return getDb().prepare(
    `WITH days AS (
       SELECT DISTINCT date(created_at, 'localtime') AS day
         FROM sales WHERE status = 'completed'
       UNION
       SELECT DISTINCT COALESCE(business_date, date(started_at, 'localtime')) FROM shifts
     )
     SELECT d.day,
            (SELECT COUNT(*) FROM sales s
              WHERE s.status = 'completed' AND date(s.created_at, 'localtime') = d.day) AS sales_count,
            (SELECT COALESCE(SUM(total), 0) FROM sales s
              WHERE s.status = 'completed' AND date(s.created_at, 'localtime') = d.day) AS sales_total,
            (SELECT COUNT(*) FROM shifts sh
              WHERE COALESCE(sh.business_date, date(sh.started_at, 'localtime')) = d.day) AS shift_count
       FROM days d
      WHERE d.day IS NOT NULL
        AND d.day < date('now', 'localtime')
        AND d.day NOT IN (SELECT date FROM end_of_day)
        AND d.day >= COALESCE((SELECT MIN(date) FROM end_of_day), date('now', 'localtime', '-30 days'))
      ORDER BY d.day DESC
      LIMIT ?`
  ).all(limit)
}

function getEndOfDayRecords() {
  return getDb().prepare('SELECT * FROM end_of_day ORDER BY date DESC').all()
}

function getEndOfDayByDate(date) {
  return getDb().prepare('SELECT * FROM end_of_day WHERE date = ?').get(date) || null
}

module.exports = { addEndOfDay, getEndOfDayRecords, getEndOfDayByDate, getUnclosedBusinessDays }
