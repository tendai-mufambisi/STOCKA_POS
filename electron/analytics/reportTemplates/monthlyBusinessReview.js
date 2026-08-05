const S = require('./_shared/sections')
const { barChart, lineChart, donutChart } = require('../render/svg/chart')

// The Monthly Business Intelligence Report.
//
// The philosophy, from the brief: every section answers one of five questions —
// how much did I make, where is my money, where am I losing money, what is
// making me money, and what should I do next. A section that answers none of
// them does not belong, however easy it would be to add.
//
// The template contains NO calculations. It names metric ids and arranges
// sections. Every figure on the page comes from the same definition the
// dashboard uses, so the two cannot disagree.

const METRICS = [
  'sales.gross', 'sales.net', 'sales.discounts', 'sales.transactionCount', 'sales.averageBasket',
  'sales.drawerTake', 'sales.electronicTake', 'sales.voidedValue', 'sales.voidedCount',
  'sales.byDay', 'sales.byTender', 'sales.byWeekday', 'sales.byHour',
  'cogs.total', 'cogs.coverage', 'cogs.zeroCostExposure', 'cogs.zeroCostLines',
  'cogs.byCategory', 'cogs.byProduct',
  'profit.gross', 'profit.grossMargin', 'profit.net', 'profit.netMargin', 'profit.expenseRatio',
  'expenses.total', 'expenses.byCategory', 'expenses.largestCategory',
  'inventory.valueAtCost', 'inventory.valueAtRetail', 'inventory.openingValue',
  'inventory.closingValue', 'inventory.purchases', 'inventory.expiryWriteOff',
  'inventory.adjustments', 'inventory.stockReconciliationResidual', 'inventory.reconciles',
  'inventory.turnover', 'inventory.deadStock', 'inventory.deadStockValue',
  'inventory.lowStockCount', 'inventory.outOfStockCount',
  'cash.openingFloats', 'cash.countedAtClose', 'cash.expectedAtClose', 'cash.variance',
  'cash.shiftCount', 'cash.unverifiedShiftCount', 'cash.varianceByShift',
  'staff.byCashier', 'staff.topCashier', 'staff.voidsByCashier',
]

module.exports = {
  id: 'monthly-business-review',
  title: 'Monthly Business Intelligence Report',
  granularities: ['month', 'quarter', 'year', 'custom'],
  metrics: METRICS,

  build({ bundle, insights, health, narrative, ctx }) {
    const v = (id) => bundle.value(id)
    const d = (id) => bundle.delta(id)
    const sections = []

    // ── Executive summary ────────────────────────────────────────────────────
    sections.push(
      S.narrative(narrative.paragraphs.map(S.paragraph), { title: 'Executive Summary' })
    )

    sections.push(
      S.kpiGrid(
        [
          S.kpi(bundle, 'sales.net', { label: 'Revenue', delta: d('sales.net') }),
          S.kpi(bundle, 'profit.gross', { label: 'Gross Profit', delta: d('profit.gross') }),
          S.kpi(bundle, 'profit.net', { label: 'Operating Profit', delta: d('profit.net') }),
          S.kpi(bundle, 'profit.grossMargin', { label: 'Gross Margin' }),
          S.kpi(bundle, 'sales.transactionCount', { label: 'Transactions', delta: d('sales.transactionCount') }),
          S.kpi(bundle, 'sales.averageBasket', { label: 'Average Basket', delta: d('sales.averageBasket') }),
          S.kpi(bundle, 'inventory.valueAtCost', { label: 'Stock at Cost' }),
          S.kpi(bundle, 'cash.variance', { label: 'Cash Variance', hint: 'Counted less expected' }),
        ],
        { title: null }
      )
    )

    // ── Business health ──────────────────────────────────────────────────────
    if (health.computable) {
      sections.push(
        S.keyValue(
          [
            {
              label: `Overall — ${health.grade}`,
              value: health.score,
              unit: 'ratio',
            },
            ...health.pillars.map((p) => ({
              label: p.label + (p.unavailable ? ` (${p.unavailable})` : ''),
              value: p.score,
              unit: 'ratio',
            })),
          ],
          { title: 'Business Health' }
        )
      )
    }

    sections.push(S.pageBreak())

    // ── 1. How much did I make? ──────────────────────────────────────────────
    sections.push(
      S.statement(
        [
          S.metricLine(bundle, 'sales.gross', 'Gross Sales'),
          S.metricLine(bundle, 'sales.discounts', 'Less Discounts', { kind: 'deduction' }),
          S.metricLine(bundle, 'sales.net', 'Net Sales', { kind: 'subtotal' }),
          S.metricLine(bundle, 'cogs.total', 'Cost of Goods Sold', { kind: 'deduction' }),
          S.metricLine(bundle, 'profit.gross', 'Gross Profit', { kind: 'subtotal' }),
          S.metricLine(bundle, 'expenses.total', 'Operating Expenses', { kind: 'deduction' }),
          S.metricLine(bundle, 'profit.net', 'Operating Profit', { kind: 'total' }),
        ],
        {
          title: 'Financial Performance',
          // Named honestly: Stocka records no depreciation, interest or tax, so
          // this is not a bottom line and must not claim to be.
          note:
            'Operating profit only — Stocka does not record depreciation, interest or tax. ' +
            (v('cogs.coverage') != null && v('cogs.coverage') < 0.9
              ? `Cost of goods covers only ${(v('cogs.coverage') * 100).toFixed(0)}% of sales, so profit here is overstated.`
              : ''),
        }
      )
    )

    const byDay = v('sales.byDay') || []
    sections.push(
      S.chart('line', [{ name: 'Daily sales', points: byDay }], {
        title: 'Sales Through the Period',
        svg: lineChart([{ name: 'Daily sales', points: byDay }], {
          title: 'Daily sales',
          unit: 'currency',
        }),
      })
    )

    // ── 2. Where is my money? ────────────────────────────────────────────────
    const tender = v('sales.byTender') || []
    sections.push(
      S.chart('donut', tender.map((t) => ({ x: t.label, y: t.value })), {
        title: 'How Customers Paid',
        svg: donutChart(tender.map((t) => ({ label: t.label, value: t.value }))),
      })
    )

    sections.push(
      S.keyValue(
        [
          { label: 'Opening floats', value: v('cash.openingFloats'), unit: 'currency' },
          { label: 'Cash taken', value: v('sales.drawerTake'), unit: 'currency' },
          { label: 'Transfer / swipe / mobile', value: v('sales.electronicTake'), unit: 'currency' },
          { label: 'Expected in drawer', value: v('cash.expectedAtClose'), unit: 'currency' },
          { label: 'Actually counted', value: v('cash.countedAtClose'), unit: 'currency' },
          { label: 'Variance', value: v('cash.variance'), unit: 'currency' },
          { label: 'Drawers reconciled', value: v('cash.shiftCount'), unit: 'count' },
          { label: 'Closed unverified', value: v('cash.unverifiedShiftCount'), unit: 'count' },
        ],
        { title: 'Cash Reconciliation' }
      )
    )

    sections.push(S.pageBreak())

    // ── Inventory ────────────────────────────────────────────────────────────
    sections.push(
      S.statement(
        [
          S.metricLine(bundle, 'inventory.openingValue', 'Opening Stock'),
          S.metricLine(bundle, 'inventory.purchases', 'Stock Received'),
          S.metricLine(bundle, 'cogs.total', 'Cost of Goods Sold', { kind: 'deduction' }),
          S.metricLine(bundle, 'inventory.expiryWriteOff', 'Expired / Written Off', { kind: 'deduction' }),
          S.metricLine(bundle, 'inventory.closingValue', 'Closing Stock', { kind: 'subtotal' }),
          S.metricLine(bundle, 'inventory.stockReconciliationResidual', 'Unexplained Difference', { kind: 'total' }),
        ],
        {
          title: 'Stock Movement',
          note:
            'Everything that left the shelves is either sold, written off, or unexplained. ' +
            'A large unexplained figure means a counting error or stock leaving unrecorded.',
        }
      )
    )

    sections.push(
      S.keyValue(
        [
          { label: 'Stock at cost', value: v('inventory.valueAtCost'), unit: 'currency' },
          { label: 'Stock at retail', value: v('inventory.valueAtRetail'), unit: 'currency' },
          { label: 'Inventory turnover', value: v('inventory.turnover'), unit: 'ratio' },
          { label: 'Capital in dead stock', value: v('inventory.deadStockValue'), unit: 'currency' },
          { label: 'Below reorder level', value: v('inventory.lowStockCount'), unit: 'count' },
          { label: 'Out of stock', value: v('inventory.outOfStockCount'), unit: 'count' },
        ],
        { title: 'Inventory Health' }
      )
    )

    const dead = (v('inventory.deadStock') || []).slice(0, 10)
    if (dead.length) {
      sections.push(
        S.table(
          [
            { key: 'label', label: 'Product' },
            { key: 'category', label: 'Category' },
            { key: 'qty', label: 'In stock', unit: 'count' },
            { key: 'daysIdle', label: 'Days idle', unit: 'count' },
            { key: 'capitalTiedUp', label: 'Cash tied up', unit: 'currency' },
          ],
          dead,
          {
            title: 'Money Sitting Still',
            note: 'Products with stock that have not sold recently. A dash means no cost is recorded, so the tied-up cash cannot be valued.',
          }
        )
      )
    }

    sections.push(S.pageBreak())

    // ── 3. What is making me money? ──────────────────────────────────────────
    const byCategory = v('cogs.byCategory') || []
    if (byCategory.length) {
      sections.push(
        S.table(
          [
            { key: 'label', label: 'Category' },
            { key: 'revenue', label: 'Sales', unit: 'currency' },
            { key: 'cogs', label: 'Cost', unit: 'currency' },
            { key: 'profit', label: 'Profit', unit: 'currency' },
            { key: 'margin', label: 'Margin', unit: 'ratio' },
          ],
          byCategory,
          {
            title: 'Profitability by Category',
            totals: {
              label: 'Total',
              revenue: byCategory.reduce((n, r) => n + (r.revenue || 0), 0),
              cogs: byCategory.reduce((n, r) => n + (r.cogs || 0), 0),
              profit: byCategory.reduce((n, r) => n + (r.profit || 0), 0),
            },
          }
        )
      )
    }

    const byProduct = v('cogs.byProduct') || []
    if (byProduct.length) {
      sections.push(
        S.table(
          [
            { key: 'label', label: 'Product' },
            { key: 'units', label: 'Sold', unit: 'count' },
            { key: 'revenue', label: 'Revenue', unit: 'currency' },
            { key: 'profit', label: 'Profit', unit: 'currency' },
            { key: 'margin', label: 'Margin', unit: 'ratio' },
          ],
          [...byProduct].sort((a, b) => b.revenue - a.revenue).slice(0, 12),
          {
            title: 'Top Products by Revenue',
            note: 'A dash in the margin column means no cost price is recorded for that product.',
          }
        )
      )
    }

    // ── Trading patterns ─────────────────────────────────────────────────────
    const byWeekday = v('sales.byWeekday') || []
    if (byWeekday.some((p) => p.y > 0)) {
      sections.push(
        S.chart('bar', [{ name: 'By day of week', points: byWeekday }], {
          title: 'Which Days Trade Best',
          svg: barChart([{ name: 'By day of week', points: byWeekday }], { unit: 'currency' }),
          note: 'Useful for deciding when to add or reduce staff.',
        })
      )
    }

    const byHour = (v('sales.byHour') || []).filter((p) => p.y > 0)
    if (byHour.length) {
      sections.push(
        S.chart('bar', [{ name: 'By hour', points: byHour.map((p) => ({ x: `${p.x}:00`, y: p.y })) }], {
          title: 'Busiest Hours',
          svg: barChart([{ name: 'By hour', points: byHour.map((p) => ({ x: `${p.x}:00`, y: p.y })) }], {
            unit: 'currency',
          }),
        })
      )
    }

    // ── People ───────────────────────────────────────────────────────────────
    const staff = v('staff.byCashier') || []
    if (staff.length) {
      sections.push(
        S.table(
          [
            { key: 'label', label: 'Cashier' },
            { key: 'saleCount', label: 'Sales', unit: 'count' },
            { key: 'revenue', label: 'Revenue', unit: 'currency' },
            { key: 'averageBasket', label: 'Avg basket', unit: 'currency' },
            { key: 'drawerTake', label: 'Cash taken', unit: 'currency' },
          ],
          staff,
          { title: 'Staff Performance' }
        )
      )
    }

    // ── 4. Where am I losing money? ──────────────────────────────────────────
    const expenses = v('expenses.byCategory') || []
    if (expenses.length) {
      sections.push(
        S.table(
          [
            { key: 'label', label: 'Category' },
            { key: 'count', label: 'Entries', unit: 'count' },
            { key: 'value', label: 'Amount', unit: 'currency' },
          ],
          expenses,
          {
            title: 'Where the Money Went',
            totals: { label: 'Total', value: v('expenses.total') },
          }
        )
      )
    }

    sections.push(
      S.keyValue(
        [
          { label: 'Voided sales', value: v('sales.voidedValue'), unit: 'currency' },
          { label: 'Number of voids', value: v('sales.voidedCount'), unit: 'count' },
          { label: 'Cash variance', value: v('cash.variance'), unit: 'currency' },
          { label: 'Stock written off', value: v('inventory.expiryWriteOff'), unit: 'currency' },
          { label: 'Stock adjustments', value: v('inventory.adjustments'), unit: 'currency' },
          { label: 'Unexplained stock', value: v('inventory.stockReconciliationResidual'), unit: 'currency' },
        ],
        { title: 'Loss Prevention' }
      )
    )

    // ── 5. What should I do next? — the Owner's Dashboard ────────────────────
    // Deliberately last and on its own page. This is the page an owner
    // photographs and takes to a meeting, so it must stand alone and say only
    // what matters.
    sections.push(S.pageBreak())

    const wins = insights.filter((i) => i.severity === 'opportunity')
    const watch = insights.filter((i) => i.severity === 'warning')
    const urgent = insights.filter((i) => i.severity === 'critical')

    sections.push(
      S.narrative([S.paragraph(narrative.executiveSummary)], { title: "Owner's Dashboard" })
    )

    if (urgent.length) {
      sections.push(S.insightList(urgent.map((i) => i.id), { title: 'Needs Attention Now' }))
    }
    sections.push(
      S.insightList(wins.map((i) => i.id), {
        title: 'Opportunities',
        emptyMessage: 'No standout opportunities surfaced this period.',
      })
    )
    sections.push(
      S.insightList(watch.map((i) => i.id), {
        title: 'Watch Closely',
        emptyMessage: 'Nothing is trending the wrong way.',
      })
    )

    const actions = insights
      .filter((i) => i.recommendedAction?.text)
      .slice(0, 6)
      .map((i) => i.recommendedAction.text)
    if (actions.length) {
      sections.push(
        S.narrative([S.bullets(actions)], { title: 'Take Action Next Month' })
      )
    }

    return {
      sections,
      footnotes: buildFootnotes(bundle, ctx),
    }
  },
}

function buildFootnotes(bundle, ctx) {
  const notes = [
    'Figures cover completed sales only. Held, discarded and voided sales are excluded from revenue and cost of goods.',
    'Days are counted in local time, so a sale rung up late at night belongs to the day it was made.',
  ]

  const coverage = bundle.value('cogs.coverage')
  if (coverage != null && coverage < 1) {
    notes.push(
      `Cost prices are recorded for ${(coverage * 100).toFixed(0)}% of what was sold. Products without a cost ` +
        'are counted as pure profit, so gross profit and margin are overstated by an unknown amount.'
    )
  }

  if (ctx.quality?.byId?.['saleItems.costBackfilled']?.passed === false) {
    notes.push(ctx.quality.byId['saleItems.costBackfilled'].message)
  }
  if (ctx.quality?.byId?.['movements.coverageGap']?.passed === false) {
    notes.push(
      'Opening stock could not be reconstructed because the stock movement log begins after this period started.'
    )
  }

  notes.push(
    'Operating profit excludes depreciation, interest and tax, none of which Stocka records.'
  )
  return notes
}
