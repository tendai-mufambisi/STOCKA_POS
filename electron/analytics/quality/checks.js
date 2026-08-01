const { completedSalesIn } = require('../sql/fragments')
const { shiftPeriodPredicate, saleDayExpr, earliestMovementDay } = require('../kernel/time')
const { findUnknownTypes } = require('../sql/movementSign')
const pay = require('../sql/paymentClassifier')

// Data-quality checks.
//
// The owner's stated priority: "I'd rather ship a smaller report with 100%
// reliable figures than a massive report with questionable numbers." These are
// the mechanism for honouring that without shrinking the report — every figure
// still appears, but the report says how far it can be trusted and why.
//
// severity:
//   blocker — the affected metrics cannot be computed honestly at all; they
//             render as '—'. Does NOT reduce the confidence score, because an
//             absent figure is not a wrong one.
//   warning — computable but degraded. Reduces confidence in proportion to
//             MEASURED EXPOSURE, not by a flat constant: one $2 line with no
//             cost should not dent a $40,000 month the way $12,000 of them does.
//   info    — worth stating, no effect on confidence.

const checks = new Map()

function defineCheck(def) {
  if (checks.has(def.id)) throw new Error(`defineCheck: duplicate id '${def.id}'`)
  checks.set(def.id, { severity: 'warning', affects: [], ...def })
  return def.id
}

const allCheckIds = () => [...checks.keys()]
const allChecks = () => [...checks.values()]

// ── Blockers ─────────────────────────────────────────────────────────────────

defineCheck({
  id: 'lan.satelliteHost',
  severity: 'blocker',
  label: 'Reports must run on the Main Computer',
  affects: ['*'],
  run(ctx) {
    // Defence in depth. Routing (lanClient FORCE_REMOTE_READ_CHANNELS) should
    // already have sent this request to Main; if analytics somehow executes on
    // a satellite, refuse rather than compute from an incomplete mirror. The
    // satellite never receives stock_movements at all and lags on sales, so its
    // numbers would be wrong without looking wrong.
    const isSatellite = !!ctx.opts.isSatellite
    return {
      passed: !isSatellite,
      count: isSatellite ? 1 : 0,
      exposure: 0,
      message:
        'These figures were requested on a till whose copy of the data is incomplete. ' +
        'Reports are produced on the Main Computer.',
    }
  },
})

defineCheck({
  id: 'movements.coverageGap',
  severity: 'blocker',
  label: 'Movement ledger starts after this period',
  affects: ['inventory.openingValue', 'inventory.closingValue'],
  run(ctx) {
    const earliest = earliestMovementDay(ctx.db)
    // Historical stock is reconstructed by rolling movements back from today's
    // quantity. Before the first movement there is nothing to roll back through,
    // so opening stock for that period is unknowable — not zero.
    const gap = !!earliest && earliest > ctx.period.start
    return {
      passed: !gap,
      count: gap ? 1 : 0,
      exposure: 0,
      detail: { earliestMovement: earliest },
      message: gap
        ? `Stock movements only start on ${earliest}, so opening stock for this period cannot be reconstructed.`
        : null,
    }
  },
})

// ── Warnings ─────────────────────────────────────────────────────────────────

defineCheck({
  id: 'saleItems.zeroCost',
  severity: 'warning',
  label: 'Items sold with no cost price',
  affects: ['cogs.total', 'profit.gross', 'profit.grossMargin', 'profit.net'],
  run(ctx) {
    const w = completedSalesIn(ctx.period, ctx.scope, 's')
    const row = ctx.db
      .prepare(
        `SELECT COUNT(*) AS n,
                COALESCE(SUM(si.quantity * si.selling_price), 0) AS revenue
           FROM sale_items si JOIN sales s ON s.id = si.sale_id
          WHERE ${w.sql} AND si.cost_price <= 0 AND si.quantity > 0`
      )
      .get(w.params)
    const net = ctx.db
      .prepare(`SELECT COALESCE(SUM(s.total),0) FROM sales s WHERE ${w.sql}`)
      .pluck()
      .get(w.params)

    return {
      passed: (row?.n || 0) === 0,
      count: row?.n || 0,
      exposure: row?.revenue || 0,
      // Weight is the share of revenue whose margin is fabricated. At 69% of
      // lines carrying no cost — which is Stocka's live state today — this
      // correctly drives confidence to the floor rather than shrugging.
      weight: net ? Math.min(1, (row?.revenue || 0) / net) : 0,
      message:
        row?.n > 0
          ? `${row.n} item${row.n === 1 ? '' : 's'} sold with no cost price on record ` +
            `($${(row.revenue || 0).toFixed(2)} of revenue). Their margin reads as 100%, which is not real.`
          : null,
      drill: 'saleItems.zeroCost',
    }
  },
})

defineCheck({
  id: 'products.noCostEver',
  severity: 'warning',
  label: 'Products with no cost on record',
  affects: ['inventory.valueAtCost'],
  run(ctx) {
    const row = ctx.db
      .prepare(
        `SELECT COUNT(*) AS n FROM products p
          WHERE p.current_quantity > 0
            AND NOT EXISTS (SELECT 1 FROM stock_receivings sr WHERE sr.product_id = p.id)`
      )
      .get()
    const total = ctx.db.prepare('SELECT COUNT(*) FROM products WHERE current_quantity > 0').pluck().get()
    return {
      passed: (row?.n || 0) === 0,
      count: row?.n || 0,
      exposure: 0,
      weight: total ? Math.min(1, (row?.n || 0) / total) * 0.5 : 0,
      message:
        row?.n > 0
          ? `${row.n} of ${total} products in stock have never had a cost recorded, so they contribute nothing to inventory value.`
          : null,
    }
  },
})

defineCheck({
  id: 'shifts.unreconciled',
  severity: 'warning',
  label: 'Drawers closed without a verified count',
  affects: ['cash.variance', 'cash.expectedAtClose'],
  run(ctx) {
    const p = shiftPeriodPredicate(ctx.period, 'sh')
    const row = ctx.db
      .prepare(
        `SELECT COUNT(*) AS n FROM shifts sh
          WHERE ${p.sql} AND sh.reconciliation_status IN ('unreconciled','unverified')`
      )
      .get(p.params)
    const total = ctx.db
      .prepare(`SELECT COUNT(*) AS n FROM shifts sh WHERE ${p.sql}`)
      .get(p.params)
    return {
      passed: (row?.n || 0) === 0,
      count: row?.n || 0,
      exposure: 0,
      weight: total?.n ? Math.min(1, (row?.n || 0) / total.n) * 0.5 : 0,
      message:
        row?.n > 0
          ? `${row.n} drawer${row.n === 1 ? ' was' : 's were'} closed without a verified count ` +
            `(auto-closed overnight, or closed while the till was unreachable). Their variance reads as 0 because there was nothing to compare against.`
          : null,
    }
  },
})

defineCheck({
  id: 'shifts.stillOpen',
  severity: 'warning',
  label: 'Shifts still open in this period',
  affects: ['cash.variance', 'cash.countedAtClose'],
  run(ctx) {
    const p = shiftPeriodPredicate(ctx.period, 'sh')
    const row = ctx.db
      .prepare(`SELECT COUNT(*) AS n FROM shifts sh WHERE ${p.sql} AND sh.status = 'open'`)
      .get(p.params)
    return {
      passed: (row?.n || 0) === 0,
      count: row?.n || 0,
      exposure: 0,
      weight: 0.1,
      message:
        row?.n > 0
          ? `${row.n} shift${row.n === 1 ? ' is' : 's are'} still open, so the cash figures are provisional.`
          : null,
    }
  },
})

defineCheck({
  id: 'stock.negativeQty',
  severity: 'warning',
  label: 'Products at negative stock',
  affects: ['inventory.valueAtCost'],
  run(ctx) {
    const rows = ctx.db
      .prepare('SELECT id, name, current_quantity FROM products WHERE current_quantity < 0')
      .all()
    return {
      passed: rows.length === 0,
      count: rows.length,
      exposure: 0,
      weight: rows.length ? 0.15 : 0,
      detail: { products: rows.slice(0, 10) },
      message: rows.length
        ? `${rows.length} product${rows.length === 1 ? ' is' : 's are'} at negative stock, which means more was sold than was ever received.`
        : null,
    }
  },
})

// ── Info ─────────────────────────────────────────────────────────────────────

defineCheck({
  id: 'sales.discountsNotCaptured',
  severity: 'info',
  label: 'Discounts not captured before this release',
  affects: ['sales.discounts'],
  run(ctx) {
    const w = completedSalesIn(ctx.period, ctx.scope, 's')
    const row = ctx.db
      .prepare(
        `SELECT COUNT(*) AS n, COALESCE(SUM(s.discount_total),0) AS d
           FROM sales s WHERE ${w.sql}`
      )
      .get(w.params)
    const noneRecorded = (row?.n || 0) > 0 && (row?.d || 0) === 0
    return {
      passed: !noneRecorded,
      count: 0,
      exposure: 0,
      weight: 0,
      message: noneRecorded
        ? 'No discounts are recorded for this period. Discounts were not captured before this release, so a discounted sale is indistinguishable from a lower price.'
        : null,
    }
  },
})

defineCheck({
  id: 'sales.legacyPaymentMethod',
  severity: 'info',
  label: 'Sales with a pre-normalisation payment method',
  affects: ['sales.byTender'],
  run(ctx) {
    const w = completedSalesIn(ctx.period, ctx.scope, 's')
    const known = [...pay.DRAWER_METHODS, ...pay.NON_DRAWER_METHODS, pay.SPLIT_METHOD]
      .map((m) => `'${m}'`)
      .join(', ')
    const rows = ctx.db
      .prepare(
        `SELECT s.payment_method AS m, COUNT(*) AS n FROM sales s
          WHERE ${w.sql} AND s.payment_method IS NOT NULL
            AND s.payment_method NOT IN (${known})
          GROUP BY s.payment_method`
      )
      .all(w.params)
    return {
      passed: rows.length === 0,
      count: rows.reduce((n, r) => n + r.n, 0),
      exposure: 0,
      weight: 0,
      detail: { values: rows },
      message: rows.length
        ? `Sales carry payment methods outside the standard set (${rows.map((r) => r.m).join(', ')}); they are counted as cash.`
        : null,
    }
  },
})

defineCheck({
  id: 'movements.unknownType',
  severity: 'warning',
  label: 'Unrecognised stock movement types',
  affects: ['inventory.openingValue'],
  run(ctx) {
    const rows = findUnknownTypes(ctx.db)
    return {
      passed: rows.length === 0,
      count: rows.reduce((n, r) => n + r.n, 0),
      exposure: 0,
      weight: rows.length ? 0.2 : 0,
      detail: { types: rows },
      message: rows.length
        ? `Stock movements of unrecognised type (${rows.map((r) => r.movement_type).join(', ')}) contribute nothing to the reconstruction, so historical stock may be understated.`
        : null,
    }
  },
})

defineCheck({
  id: 'staff.orphanedCashier',
  severity: 'info',
  label: 'Sales attributed to a deleted user',
  affects: ['staff.byCashier'],
  run(ctx) {
    const w = completedSalesIn(ctx.period, ctx.scope, 's')
    const rows = ctx.db
      .prepare(
        `SELECT DISTINCT s.cashier AS c FROM sales s
          WHERE ${w.sql} AND NOT EXISTS (SELECT 1 FROM users u WHERE u.username = s.cashier)`
      )
      .all(w.params)
    return {
      passed: rows.length === 0,
      count: rows.length,
      exposure: 0,
      weight: 0,
      message: rows.length
        ? `Sales are attributed to ${rows.length} name${rows.length === 1 ? '' : 's'} with no matching user (${rows.map((r) => r.c).join(', ')}). sales.cashier is a name, not a link, so a renamed or deleted user orphans their history.`
        : null,
    }
  },
})

defineCheck({
  id: 'eod.missingDays',
  severity: 'info',
  label: 'Trading days never signed off',
  affects: [],
  run(ctx) {
    const w = completedSalesIn(ctx.period, ctx.scope, 's')
    const rows = ctx.db
      .prepare(
        `SELECT DISTINCT ${saleDayExpr('s')} AS day FROM sales s
          WHERE ${w.sql}
            AND NOT EXISTS (SELECT 1 FROM end_of_day e WHERE e.date = ${saleDayExpr('s')})`
      )
      .all(w.params)
    return {
      passed: rows.length === 0,
      count: rows.length,
      exposure: 0,
      weight: 0,
      detail: { days: rows.map((r) => r.day).slice(0, 20) },
      message: rows.length
        ? `${rows.length} trading day${rows.length === 1 ? '' : 's'} in this period ${rows.length === 1 ? 'was' : 'were'} never closed off in End of Day.`
        : null,
    }
  },
})

module.exports = { defineCheck, allCheckIds, allChecks }
