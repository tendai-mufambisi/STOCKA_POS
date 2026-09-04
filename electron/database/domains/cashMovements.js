/**
 * Cash movements, and the cash position they feed.
 *
 * ── What this table is for ──────────────────────────────────────────────────
 *
 * Before this, the only money the app knew about was a sale or an expense, so
 * "how much cash does this business have?" had no answer. Cash was reconciled
 * per shift and per day and then forgotten — nothing carried a balance forward,
 * and money that moved for any other reason was invisible.
 *
 * ── What goes in here, and what does not ────────────────────────────────────
 *
 * Only movements the app cannot already derive. Sales, refunds and expenses are
 * NOT copied in: getCashPosition() sums those tables and adds this ledger on
 * top. Duplicating them would need a backfill, would need every void to write a
 * compensating row, and would drift the day the two paths disagreed.
 *
 * ── Why none of it touches profit ───────────────────────────────────────────
 *
 * Every type here is a balance-sheet movement. An owner drawing is profit
 * already earned being taken out, not a cost of trading. Cash spent on stock
 * becomes cost of goods sold when the stock sells, which sale_items.cost_price
 * already accounts for. Recording either as an expense — the only option owners
 * had before this existed — understates profit. `expenses` stays the sole
 * deduction from it.
 */

const { getDb } = require('../index')
const { logAuditAction } = require('./audit')
const {
  drawerAmountExpr,
  cashExpenseSql,
} = require('../../analytics/sql/paymentClassifier')

// `direction` is stored on each row rather than looked up here at query time,
// so a type added later cannot retroactively flip the sign of existing rows.
// This stays the source of truth for validation and labelling.
const MOVEMENT_TYPES = {
  capital_in: {
    direction: 'in',
    label: 'Money put into the business',
    hint: 'Cash the owner or an investor added to the business.',
  },
  bank_withdrawal: {
    direction: 'in',
    label: 'Drawn from the bank',
    hint: 'Cash brought from the bank or mobile money into the till.',
  },
  owner_draw: {
    direction: 'out',
    label: 'Money taken by the owner',
    hint: 'Cash the owner took out for personal use. Not an expense — it does not reduce profit.',
  },
  stock_purchase: {
    direction: 'out',
    label: 'Cash taken to buy stock',
    hint: 'Money taken from the business to go and order goods.',
  },
  supplier_payment: {
    direction: 'out',
    label: 'Paid a supplier',
    hint: 'Paying a supplier directly out of the drawer.',
  },
  bank_deposit: {
    direction: 'out',
    label: 'Banked / sent out',
    hint: 'Cash moved out of the till into a bank or mobile money account.',
  },
  adjustment: {
    direction: null,   // a correction can go either way, so the caller states it
    label: 'Correction',
    hint: 'A correction to make the recorded cash match what is actually in the drawer.',
  },
}

/** Only 'Cash' movements touch the physical drawer. NULL/'' means cash. */
const CASH_MOVEMENT_SQL = `(m.payment_method = 'Cash' OR m.payment_method IS NULL OR m.payment_method = '')`

/**
 * Resolve a movement's direction, or null when the type is unknown or a
 * correction arrived without one. Callers validate by checking for null rather
 * than by repeating the type list.
 */
function resolveDirection(type, requestedDirection) {
  const spec = MOVEMENT_TYPES[type]
  if (!spec) return null
  if (spec.direction) return spec.direction
  return requestedDirection === 'in' || requestedDirection === 'out'
    ? requestedDirection
    : null
}

function getMovementTypes() {
  return Object.entries(MOVEMENT_TYPES).map(([id, spec]) => ({
    id, direction: spec.direction, label: spec.label, hint: spec.hint,
  }))
}

function addCashMovement(movement) {
  const direction = resolveDirection(movement.type, movement.direction)
  if (!direction) {
    throw new Error(
      MOVEMENT_TYPES[movement.type]
        ? "A correction needs a direction of 'in' or 'out'."
        : `Unknown movement type: ${movement.type}`
    )
  }

  const amount = parseFloat(movement.amount)
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('Enter an amount greater than zero.')
  }

  const db = getDb()
  const { lastInsertRowid } = db.prepare(`
    INSERT INTO cash_movements
      (type, direction, amount, payment_method, date, note, counterparty,
       recorded_by, shift_id, sync_dirty, sync_updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, datetime('now'))
  `).run(
    movement.type,
    direction,
    amount,
    movement.payment_method || 'Cash',
    movement.date,
    movement.note || null,
    movement.counterparty || null,
    movement.recorded_by,
    movement.shift_id || null
  )

  try {
    logAuditAction(
      movement.recorded_by, 'CASH_MOVEMENT_RECORDED', 'CASH_MOVEMENT',
      String(lastInsertRowid),
      `${MOVEMENT_TYPES[movement.type].label}: ${direction === 'in' ? '+' : '-'}$${amount}` +
        (movement.counterparty ? ` (${movement.counterparty})` : '')
    )
  } catch (_) {}

  return { id: lastInsertRowid, direction }
}

/** Live movements, newest first. Optionally bounded by date and filtered by type. */
function getCashMovements({ from, to, type } = {}) {
  const clauses = ['deleted_at IS NULL']
  const params = []
  if (from) { clauses.push('date >= ?'); params.push(from) }
  if (to)   { clauses.push('date <= ?'); params.push(to) }
  if (type) { clauses.push('type = ?');  params.push(type) }

  const rows = getDb().prepare(`
    SELECT * FROM cash_movements
    WHERE ${clauses.join(' AND ')}
    ORDER BY date DESC, created_at DESC
  `).all(...params)

  return rows.map(r => ({
    ...r,
    label: (MOVEMENT_TYPES[r.type] || {}).label || r.type,
  }))
}

/**
 * Soft delete. A hard DELETE would be undone by the next pull from the server,
 * which still holds the row — the same reason expenses use a tombstone.
 */
function deleteCashMovement(id, deletedBy) {
  const db = getDb()
  const row = db.prepare('SELECT * FROM cash_movements WHERE id = ? AND deleted_at IS NULL').get(id)
  if (!row) return false

  db.prepare(`
    UPDATE cash_movements
    SET deleted_at = datetime('now'), sync_dirty = 1, sync_updated_at = datetime('now')
    WHERE id = ?
  `).run(id)

  try {
    logAuditAction(deletedBy, 'CASH_MOVEMENT_DELETED', 'CASH_MOVEMENT', String(id),
      `Deleted ${row.type}: $${row.amount}`)
  } catch (_) {}

  return true
}

/**
 * The components of the cash position over one window.
 *
 * `from` may be null, meaning "everything up to `to`" — that is how the opening
 * balance is taken.
 *
 * Sales are dated by created_at and everything else by its own `date` column,
 * because that is what each table means by "when the money moved". Sales use
 * date(created_at,'localtime') to match the rest of the reporting engine: a
 * sale at 9pm belongs to that shop's day, not to UTC's.
 */
function cashComponents(db, from, to) {
  const saleWindow = from
    ? `date(s.created_at, 'localtime') BETWEEN ? AND ?`
    : `date(s.created_at, 'localtime') <= ?`
  const dateWindow = (alias) => from
    ? `${alias}.date BETWEEN ? AND ?`
    : `${alias}.date <= ?`
  const params = from ? [from, to] : [to]

  const sales = db.prepare(`
    SELECT COALESCE(SUM(${drawerAmountExpr('s')}), 0) AS cash_sales,
           COALESCE(SUM(s.total), 0)                  AS all_sales
    FROM sales s
    WHERE s.status IN ('completed', 'refunded') AND ${saleWindow}
  `).get(...params)

  const expenses = db.prepare(`
    SELECT COALESCE(SUM(CASE WHEN ${cashExpenseSql('e')} THEN e.amount ELSE 0 END), 0) AS cash_expenses,
           COALESCE(SUM(e.amount), 0)                                                  AS all_expenses
    FROM expenses e
    WHERE ${dateWindow('e')}
  `).get(...params)

  const byType = db.prepare(`
    SELECT m.type,
           m.direction,
           COUNT(*)                   AS count,
           COALESCE(SUM(m.amount), 0) AS total,
           COALESCE(SUM(CASE WHEN ${CASH_MOVEMENT_SQL} THEN m.amount ELSE 0 END), 0) AS cash_total
    FROM cash_movements m
    WHERE m.deleted_at IS NULL AND ${dateWindow('m')}
    GROUP BY m.type, m.direction
  `).all(...params).map(r => ({
    ...r,
    label: (MOVEMENT_TYPES[r.type] || {}).label || r.type,
  }))

  const sumCash = (dir) => byType
    .filter(t => t.direction === dir)
    .reduce((n, t) => n + t.cash_total, 0)

  const moneyIn  = sumCash('in')
  const moneyOut = sumCash('out')

  return {
    cash_sales:    sales.cash_sales,
    cash_expenses: expenses.cash_expenses,
    money_in:      moneyIn,
    money_out:     moneyOut,
    net:           sales.cash_sales - expenses.cash_expenses + moneyIn - moneyOut,
    all_sales:     sales.all_sales,
    all_expenses:  expenses.all_expenses,
    by_type:       byType,
  }
}

/**
 * Cash in hand, plus the movement over `from`..`to` that explains it.
 *
 *   cash in hand = cash sales − cash expenses + movements in − movements out
 *
 * summed over all time up to `to`. Everything before `from` is folded into an
 * opening balance so the window reads as a statement the owner can follow top
 * to bottom: opened with X, took in Y, paid out Z, therefore holding W.
 *
 * Note there is no refunds term. Unlike the server, the desktop database has no
 * refunds table — a refund here voids the sale, which drops it out of the
 * status filter above, so the money is already accounted for.
 */
function getCashPosition({ from, to } = {}) {
  const db = getDb()
  const end   = to   || new Date().toISOString().slice(0, 10)
  const start = from || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)

  const dayBefore = new Date(new Date(start).getTime() - 86400000).toISOString().slice(0, 10)

  const opening = cashComponents(db, null, dayBefore)
  const period  = cashComponents(db, start, end)

  return {
    period: { from: start, to: end },
    opening_balance: opening.net,
    cash_in_hand: opening.net + period.net,
    movement: {
      cash_sales:    period.cash_sales,
      cash_expenses: period.cash_expenses,
      money_in:      period.money_in,
      money_out:     period.money_out,
      net:           period.net,
    },
    by_type: period.by_type,
    // Context for the owner: trade that never touched the drawer, so a low cash
    // figure next to strong sales reads as "it went to EcoCash" rather than
    // "money is missing".
    non_cash_sales:    period.all_sales - period.cash_sales,
    non_cash_expenses: period.all_expenses - period.cash_expenses,
  }
}

module.exports = {
  MOVEMENT_TYPES,
  getMovementTypes,
  resolveDirection,
  addCashMovement,
  getCashMovements,
  deleteCashMovement,
  getCashPosition,
}
