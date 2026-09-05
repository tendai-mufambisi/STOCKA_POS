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
const { SPLIT_METHOD } = require('../../analytics/sql/paymentClassifier')

// ── Tenders: the pockets money sits in ──────────────────────────────────────
//
// An earlier version of this reported only the cash drawer and treated
// everything else as a footnote. On real data that means showing a small
// fraction of the money — EcoCash takings dwarf cash takings — so money the
// business genuinely holds was recorded and then left out of every headline.
// The unit is now a tender, every pocket carries a balance, and cash in hand
// is simply the drawer's row.
//
// 'ZAR Cash' is its own pocket rather than part of cash in hand: it is
// physically cash but a different currency, and adding rand to a dollar total
// produces a meaningless number. Unrecognised values fall to 'other' so a new
// tender appears as its own line instead of inflating the drawer.

const DRAWER_METHODS = ['Cash', 'USD Cash']

const TENDERS = [
  { id: 'cash',     label: 'Cash in hand',  drawer: true,  methods: DRAWER_METHODS, matchesBlank: true },
  { id: 'ecocash',  label: 'EcoCash',       drawer: false, methods: ['EcoCash'] },
  { id: 'transfer', label: 'Bank transfer', drawer: false, methods: ['Transfer'] },
  { id: 'swipe',    label: 'Card / swipe',  drawer: false, methods: ['Swipe'] },
  { id: 'usd',      label: 'USD',           drawer: false, methods: ['USD'] },
  { id: 'zar',      label: 'ZAR cash',      drawer: false, methods: ['ZAR Cash'] },
  { id: 'other',    label: 'Other',         drawer: false, methods: [] },
]

const quoted = (list) => list.map(m => `'${m}'`).join(', ')

/** SQL CASE mapping a payment_method column to a tender id. */
function tenderBucketExpr(column) {
  const branches = TENDERS.filter(t => t.methods.length).map(t => {
    const blank = t.matchesBlank ? `${column} IS NULL OR ${column} = '' OR ` : ''
    return `WHEN ${blank}${column} IN (${quoted(t.methods)}) THEN '${t.id}'`
  })
  return `CASE ${branches.join(' ')} ELSE 'other' END`
}

const emptyTenderMap = () => Object.fromEntries(TENDERS.map(t => [t.id, 0]))

// `direction` is stored on each row rather than looked up here at query time,
// so a type added later cannot retroactively flip the sign of existing rows.
// This stays the source of truth for validation and labelling.
const MOVEMENT_TYPES = {
  capital_in: {
    direction: 'in',
    label: 'Money put into the business',
    hint: 'Money the owner or an investor added to the business.',
  },
  bank_withdrawal: {
    direction: 'in',
    label: 'Drawn from the bank',
    hint: 'Money moved from a bank or mobile money account into the till.',
  },
  owner_draw: {
    direction: 'out',
    label: 'Money taken by the owner',
    hint: 'Money the owner took out for personal use. Not an expense — it does not reduce profit.',
  },
  stock_purchase: {
    direction: 'out',
    label: 'Money taken to buy stock',
    hint: 'Money taken from the business to go and order goods.',
  },
  supplier_payment: {
    direction: 'out',
    label: 'Paid a supplier',
    hint: 'Paying a supplier directly, out of the till or from an account.',
  },
  bank_deposit: {
    direction: 'out',
    label: 'Banked / sent out',
    hint: 'Money moved out of the till into a bank or mobile money account.',
  },
  adjustment: {
    direction: null,   // a correction can go either way, so the caller states it
    label: 'Correction',
    hint: 'A correction to make the recorded money match what is actually there.',
  },
}

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
 * Balances per tender over one window, plus the movement that produced them.
 *
 * `from` may be null, meaning "everything up to `to`" — that is how the opening
 * balance is taken.
 *
 * Sales are dated by created_at and everything else by its own `date` column,
 * because that is what each table means by "when the money moved". Sales use
 * date(created_at,'localtime') to match the rest of the reporting engine: a
 * sale at 9pm belongs to that shop's day, not to UTC's.
 *
 * There is deliberately no refunds term: unlike the server, this database has
 * no refunds table — a refund voids the sale, which drops it out of the status
 * filter, so the money is already accounted for.
 */
function cashComponents(db, from, to) {
  const saleWindow = from
    ? `date(s.created_at, 'localtime') BETWEEN ? AND ?`
    : `date(s.created_at, 'localtime') <= ?`
  const dateWindow = (alias) => from
    ? `${alias}.date BETWEEN ? AND ?`
    : `${alias}.date <= ?`
  const params = from ? [from, to] : [to]

  // Non-split sales bucket straight off payment_method. A Split sale is handled
  // separately below because it lands in two pockets at once, and summing its
  // `total` into either one would double-count half the sale.
  const sales = emptyTenderMap()
  for (const r of db.prepare(`
    SELECT ${tenderBucketExpr('s.payment_method')} AS tender,
           COALESCE(SUM(s.total), 0) AS amount
    FROM sales s
    WHERE s.status IN ('completed', 'refunded')
      AND (s.payment_method IS NULL OR s.payment_method != '${SPLIT_METHOD}')
      AND ${saleWindow}
    GROUP BY 1
  `).all(...params)) {
    sales[r.tender] = (sales[r.tender] || 0) + r.amount
  }

  const split = db.prepare(`
    SELECT COALESCE(SUM(s.cash_amount), 0) AS cash,
           COALESCE(SUM(s.usd_amount), 0)  AS usd
    FROM sales s
    WHERE s.status IN ('completed', 'refunded')
      AND s.payment_method = '${SPLIT_METHOD}'
      AND ${saleWindow}
  `).get(...params)
  sales.cash += split.cash
  sales.usd  += split.usd

  const expenses = emptyTenderMap()
  for (const r of db.prepare(`
    SELECT ${tenderBucketExpr('e.payment_method')} AS tender,
           COALESCE(SUM(e.amount), 0) AS amount
    FROM expenses e
    WHERE ${dateWindow('e')}
    GROUP BY 1
  `).all(...params)) {
    expenses[r.tender] = (expenses[r.tender] || 0) + r.amount
  }

  const moveRows = db.prepare(`
    SELECT m.type,
           m.direction,
           ${tenderBucketExpr('m.payment_method')} AS tender,
           COUNT(*)                   AS count,
           COALESCE(SUM(m.amount), 0) AS amount
    FROM cash_movements m
    WHERE m.deleted_at IS NULL AND ${dateWindow('m')}
    GROUP BY 1, 2, 3
  `).all(...params)

  const moneyIn  = emptyTenderMap()
  const moneyOut = emptyTenderMap()
  for (const r of moveRows) {
    const target = r.direction === 'in' ? moneyIn : moneyOut
    target[r.tender] = (target[r.tender] || 0) + r.amount
  }

  // One balance per pocket. A pocket with no activity still reports 0 rather
  // than going missing, so the breakdown always adds up to the total.
  const balances = emptyTenderMap()
  for (const id of Object.keys(balances)) {
    balances[id] = (sales[id] || 0) - (expenses[id] || 0) + (moneyIn[id] || 0) - (moneyOut[id] || 0)
  }

  const sum = (m) => Object.values(m).reduce((n, v) => n + v, 0)

  // Movements grouped by reason across all pockets — what the money went on,
  // independent of which pocket it left.
  const byTypeMap = new Map()
  for (const r of moveRows) {
    const key = `${r.type}|${r.direction}`
    const hit = byTypeMap.get(key) || {
      type: r.type,
      direction: r.direction,
      label: (MOVEMENT_TYPES[r.type] || {}).label || r.type,
      count: 0,
      total: 0,
    }
    hit.count += r.count
    hit.total += r.amount
    byTypeMap.set(key, hit)
  }

  return {
    sales, expenses, money_in: moneyIn, money_out: moneyOut, balances,
    totals: {
      sales:     sum(sales),
      expenses:  sum(expenses),
      money_in:  sum(moneyIn),
      money_out: sum(moneyOut),
      net:       sum(balances),
    },
    by_type: [...byTypeMap.values()],
  }
}

/**
 * What the business holds, which pocket it is in, and the movement over
 * `from`..`to` that explains it.
 *
 *   balance = sales - expenses + movements in - movements out
 *
 * summed over all time up to `to`, per pocket. Everything before `from` folds
 * into an opening balance so the window reads as a statement the owner can
 * follow top to bottom: opened with X, took in Y, paid out Z, holding W.
 */
function getCashPosition({ from, to } = {}) {
  const db = getDb()
  const end   = to   || new Date().toISOString().slice(0, 10)
  const start = from || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)
  const dayBefore = new Date(new Date(start).getTime() - 86400000).toISOString().slice(0, 10)

  const opening = cashComponents(db, null, dayBefore)
  const period  = cashComponents(db, start, end)

  const byTender = TENDERS.map(t => ({
    id: t.id,
    label: t.label,
    drawer: !!t.drawer,
    opening:   opening.balances[t.id] || 0,
    sales:     period.sales[t.id] || 0,
    expenses:  period.expenses[t.id] || 0,
    money_in:  period.money_in[t.id] || 0,
    money_out: period.money_out[t.id] || 0,
    balance:   (opening.balances[t.id] || 0) + (period.balances[t.id] || 0),
  }))

  const drawer = byTender.find(t => t.drawer)

  return {
    period: { from: start, to: end },
    opening_balance: opening.totals.net,
    total_money: byTender.reduce((n, t) => n + t.balance, 0),
    // The drawer's own balance, kept as its own field because it is the one
    // figure that gets physically counted and signed off every evening.
    cash_in_hand: drawer ? drawer.balance : 0,
    movement: {
      sales:     period.totals.sales,
      expenses:  period.totals.expenses,
      money_in:  period.totals.money_in,
      money_out: period.totals.money_out,
      net:       period.totals.net,
    },
    by_tender: byTender,
    by_type: period.by_type,
  }
}

function getTenders() {
  return TENDERS.map(t => ({ id: t.id, label: t.label, drawer: !!t.drawer }))
}

module.exports = {
  MOVEMENT_TYPES,
  TENDERS,
  getTenders,
  getMovementTypes,
  resolveDirection,
  addCashMovement,
  getCashMovements,
  deleteCashMovement,
  getCashPosition,
}
