const { defineMetric } = require('../kernel/registry')
const ledger = require('../sql/inventoryLedger')
const { costResolverFor } = require('../sql/costResolver')
const { ratio, reconciliationTolerance } = require('../kernel/money')
const { addDays } = require('../kernel/time')

// Inventory metrics.
//
// Opening and closing stock are the backbone of a real profit statement, and
// they are the figures Stocka has never been able to produce: the database
// stores only a live quantity, overwritten on every movement. These are
// reconstructed from the movement ledger — see sql/inventoryLedger.js for why
// that is trustworthy and how it is checked.

// ── Point-in-time valuation ──────────────────────────────────────────────────

defineMetric({
  id: 'inventory.valueAtCost',
  label: 'Inventory Value (at cost)',
  unit: 'currency',
  sourceTable: 'products',
  quality: ['products.noCostEver'],
  sql: () => ({ text: 'SELECT 1', params: {} }), // valuation needs the resolver, not a single query
  reduce(rows, ctx) {
    // Valued as at the period end, at the cost that applied then.
    return ledger.valuationAsOf(ctx.db, ctx.period.end, ctx.costResolver).total
  },
})

// The SAME shelves valued at selling price. Both figures are legitimate and
// answer different questions — what the stock cost, versus what it will fetch.
// The bug was never having both; it was calling both of them "stock value".
defineMetric({
  id: 'inventory.valueAtRetail',
  label: 'Inventory Value (at retail)',
  unit: 'currency',
  sourceTable: 'products',
  sql: () => ({ text: 'SELECT 1', params: {} }),
  reduce(rows, ctx) {
    const quantities = ledger.quantitiesAsOf(ctx.db, ctx.period.end)
    const prices = new Map(
      ctx.db.prepare('SELECT id, selling_price FROM products').all().map((p) => [p.id, p.selling_price || 0])
    )
    let total = 0
    for (const rec of quantities.values()) {
      if (rec.qty > 0) total += rec.qty * (prices.get(rec.productId) || 0)
    }
    return total
  },
})

defineMetric({
  id: 'inventory.openingValue',
  label: 'Opening Stock',
  unit: 'currency',
  sourceTable: 'stock_movements',
  // A blocker when the movement ledger starts after the period does: there is
  // nothing to roll back through, so opening stock is unknowable, not zero.
  quality: ['movements.coverageGap', 'movements.unknownType', 'inventory.rollbackResidual'],
  sql: () => ({ text: 'SELECT 1', params: {} }),
  reduce(rows, ctx) {
    // Opening = the close of the day before the period began, valued at the
    // cost that applied on that day.
    const openingDay = addDays(ctx.period.start, -1)
    const resolver = costResolverFor(ctx.db, { asOf: openingDay, mode: ctx.costResolver.mode })
    return ledger.valuationAsOf(ctx.db, openingDay, resolver).total
  },
})

defineMetric({
  id: 'inventory.closingValue',
  label: 'Closing Stock',
  unit: 'currency',
  dependsOn: ['inventory.valueAtCost'],
  compute: (ctx, d) => d['inventory.valueAtCost'].value,
})

// ── Movements through the period ─────────────────────────────────────────────

// Stock that physically arrived, from the movement ledger — the term the
// reconciliation identity needs.
defineMetric({
  id: 'inventory.purchases',
  label: 'Stock Received',
  unit: 'currency',
  sourceTable: 'stock_movements',
  sql: () => ({ text: 'SELECT 1', params: {} }),
  reduce: (rows, ctx) => ledger.purchasesIn(ctx.db, ctx.period, ctx.costResolver).value,
})

// Money committed to stock, by the business date on the receiving. Differs from
// the above whenever a receiving is backdated; both are correct answers to
// different questions, so both are named.
defineMetric({
  id: 'inventory.purchasesInvoiced',
  label: 'Stock Purchased (invoiced)',
  unit: 'currency',
  sourceTable: 'stock_receivings',
  sql: () => ({ text: 'SELECT 1', params: {} }),
  reduce: (rows, ctx) => ledger.purchasesInvoicedIn(ctx.db, ctx.period).value,
})

defineMetric({
  id: 'inventory.expiryWriteOff',
  label: 'Expired Stock Written Off',
  unit: 'currency',
  sourceTable: 'stock_movements',
  sql: () => ({ text: 'SELECT 1', params: {} }),
  reduce: (rows, ctx) => ledger.expiryDiscardsIn(ctx.db, ctx.period, ctx.costResolver).value,
})

defineMetric({
  id: 'inventory.adjustments',
  label: 'Stock Count Adjustments',
  unit: 'currency',
  sourceTable: 'stock_movements',
  sql: () => ({ text: 'SELECT 1', params: {} }),
  // Signed: negative means a count found less than the books said.
  reduce: (rows, ctx) => ledger.adjustmentsIn(ctx.db, ctx.period, ctx.costResolver).value,
})

// ── The reconciliation identity ──────────────────────────────────────────────
//
// opening + purchases − closing  ≈  COGS + write-offs + adjustments
//
// Everything that left the shelves is either sold, thrown away, or found
// missing. This single number tells an owner whether the books hang together,
// and it costs nothing beyond metrics already computed.

defineMetric({
  id: 'inventory.stockReconciliationResidual',
  label: 'Unexplained Stock Movement',
  unit: 'currency',
  dependsOn: [
    'inventory.openingValue',
    'inventory.purchases',
    'inventory.closingValue',
    'cogs.total',
    'inventory.expiryWriteOff',
    'inventory.adjustments',
  ],
  compute(ctx, d) {
    const leftTheShelves =
      d['inventory.openingValue'].value +
      d['inventory.purchases'].value -
      d['inventory.closingValue'].value
    const accountedFor =
      d['cogs.total'].value +
      d['inventory.expiryWriteOff'].value -
      d['inventory.adjustments'].value
    return leftTheShelves - accountedFor
  },
})

defineMetric({
  id: 'inventory.reconciles',
  label: 'Stock Reconciles',
  unit: 'text',
  dependsOn: ['inventory.stockReconciliationResidual', 'cogs.total'],
  compute(ctx, d) {
    const residual = d['inventory.stockReconciliationResidual'].value
    // Tolerance scales with turnover: a flat cash figure is too tight for a
    // busy shop and meaningless for a quiet one.
    const tolerance = reconciliationTolerance(d['cogs.total'].value)
    return {
      residual,
      tolerance,
      reconciles: Math.abs(residual) <= tolerance,
    }
  },
})

// ── Health ───────────────────────────────────────────────────────────────────

defineMetric({
  id: 'inventory.turnover',
  label: 'Inventory Turnover',
  unit: 'ratio',
  dependsOn: ['cogs.total', 'inventory.openingValue', 'inventory.closingValue'],
  compute(ctx, d) {
    // COGS over average stock held. Average of opening and closing rather than
    // closing alone, so a month that ended mid-restock is not flattered.
    const avg = (d['inventory.openingValue'].value + d['inventory.closingValue'].value) / 2
    return ratio(d['cogs.total'].value, avg)
  },
})

defineMetric({
  id: 'inventory.daysOfStock',
  label: 'Days of Stock Remaining',
  unit: 'days',
  dependsOn: ['inventory.closingValue', 'cogs.total'],
  compute(ctx, d) {
    const cogs = d['cogs.total'].value
    if (!cogs) return null
    const dailyCogs = cogs / ctx.period.lengthDays()
    return dailyCogs > 0 ? d['inventory.closingValue'].value / dailyCogs : null
  },
})

defineMetric({
  id: 'inventory.lowStockCount',
  label: 'Products Below Reorder Level',
  unit: 'count',
  sourceTable: 'products',
  sql: () => ({
    text: 'SELECT COUNT(*) AS n FROM products WHERE current_quantity <= reorder_level',
    params: {},
  }),
  reduce: (rows) => rows[0]?.n || 0,
})

defineMetric({
  id: 'inventory.outOfStockCount',
  label: 'Out of Stock',
  unit: 'count',
  sourceTable: 'products',
  sql: () => ({
    text: 'SELECT COUNT(*) AS n FROM products WHERE current_quantity <= 0',
    params: {},
  }),
  reduce: (rows) => rows[0]?.n || 0,
})

defineMetric({
  id: 'inventory.negativeStockCount',
  label: 'Products at Negative Stock',
  unit: 'count',
  sourceTable: 'products',
  quality: ['stock.negativeQty'],
  sql: () => ({
    text: 'SELECT COUNT(*) AS n FROM products WHERE current_quantity < 0',
    params: {},
  }),
  reduce: (rows) => rows[0]?.n || 0,
})

// ── Dead stock ───────────────────────────────────────────────────────────────

defineMetric({
  id: 'inventory.deadStock',
  label: 'Dead Stock',
  unit: 'currency',
  grain: 'breakdown',
  sourceTable: 'products',
  sql: (ctx) => ({
    text: `SELECT p.id, p.name, p.category, p.current_quantity AS qty,
                  p.last_sold_date,
                  CAST(julianday(@asOf) - julianday(COALESCE(p.last_sold_date, p.created_at)) AS INTEGER) AS days_idle
             FROM products p
            WHERE p.current_quantity > 0
              AND (p.last_sold_date IS NULL OR date(p.last_sold_date) <= date(@cutoff))
            ORDER BY days_idle DESC`,
    params: {
      asOf: ctx.period.end,
      cutoff: addDays(ctx.period.end, -(ctx.opts.deadStockDays || 60)),
    },
  }),
  reduce(rows, ctx) {
    return rows.map((r) => {
      const cost = ctx.costResolver.costOf(r.id)
      return {
        key: r.id,
        label: r.name,
        category: r.category,
        qty: r.qty,
        daysIdle: r.days_idle,
        lastSold: r.last_sold_date,
        // Capital tied up. null when the cost is unknown — reporting $0 of dead
        // capital would make the worst case look like the best one.
        capitalTiedUp: cost.source === 'receiving' ? r.qty * cost.cost : null,
        costKnown: cost.source === 'receiving',
      }
    })
  },
})

defineMetric({
  id: 'inventory.deadStockValue',
  label: 'Capital Tied Up in Dead Stock',
  unit: 'currency',
  dependsOn: ['inventory.deadStock'],
  compute: (ctx, d) =>
    (d['inventory.deadStock'].value || []).reduce((n, r) => n + (r.capitalTiedUp || 0), 0),
})
