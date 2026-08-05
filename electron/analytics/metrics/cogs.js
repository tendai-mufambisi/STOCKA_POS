const { defineMetric, defineBundle } = require('../kernel/registry')
const { completedSalesIn } = require('../sql/fragments')
const { ratio } = require('../kernel/money')

// Cost of goods sold.
//
// COGS comes from `sale_items.cost_price`, the cost FROZEN onto the line at the
// moment of sale. That is the correct source and must not be replaced with a
// current-cost lookup: if a supplier raises a price in July, June's profit does
// not retrospectively fall.
//
// The known weakness is that a product with no receiving on record freezes a
// cost of 0, which reads as a 100% margin. This module measures that exposure
// instead of hiding it — see cogs.zeroCostExposure — so the report can say how
// much of its own margin figure is unreliable.

defineBundle({
  id: 'cogsPeriodAggregate',
  sql(ctx) {
    const w = completedSalesIn(ctx.period, ctx.scope, 's')
    const item = ctx.scope.itemWhere('si', 'p')
    return {
      text: `
        SELECT
          COALESCE(SUM(si.quantity * si.cost_price), 0)                              AS cogs,
          COALESCE(SUM(si.quantity), 0)                                              AS units,
          COUNT(*)                                                                   AS line_count,
          COALESCE(SUM(CASE WHEN si.cost_price <= 0 THEN 1 ELSE 0 END), 0)           AS zero_cost_lines,
          COALESCE(SUM(CASE WHEN si.cost_price <= 0
                            THEN si.quantity * si.selling_price ELSE 0 END), 0)      AS zero_cost_revenue
        FROM sale_items si
        JOIN sales s ON s.id = si.sale_id
        LEFT JOIN products p ON p.id = si.product_id
        WHERE ${w.sql}${item.sql ? ` AND ${item.sql}` : ''}`,
      params: { ...w.params, ...item.params },
    }
  },
})

const bundled = (id, extra) =>
  defineMetric({ bundle: 'cogsPeriodAggregate', sourceTable: 'sale_items', ...extra, id })

bundled('cogs.total', {
  label: 'Cost of Goods Sold',
  unit: 'currency',
  quality: ['saleItems.zeroCost'],
  pick: (row) => row.cogs || 0,
})

bundled('cogs.unitsSold', {
  label: 'Units Sold',
  unit: 'count',
  pick: (row) => row.units || 0,
})

bundled('cogs.lineCount', {
  label: 'Line Items',
  unit: 'count',
  pick: (row) => row.line_count || 0,
})

// How many sold lines carried no cost, and what revenue they represent.
// This is the honest measure of how much of the margin figure is guesswork.
bundled('cogs.zeroCostLines', {
  label: 'Lines Sold With No Cost Recorded',
  unit: 'count',
  pick: (row) => row.zero_cost_lines || 0,
})

bundled('cogs.zeroCostExposure', {
  label: 'Revenue From Products With No Cost',
  unit: 'currency',
  pick: (row) => row.zero_cost_revenue || 0,
})

defineMetric({
  id: 'cogs.coverage',
  label: 'Cost Coverage',
  unit: 'ratio',
  dependsOn: ['sales.net', 'cogs.zeroCostExposure'],
  // Share of revenue whose cost is actually known. A margin figure should never
  // be read without it: at 0.31 coverage, "37% margin" is close to meaningless.
  compute(ctx, d) {
    const net = d['sales.net'].value
    if (!net) return null
    return Math.max(0, Math.min(1, (net - d['cogs.zeroCostExposure'].value) / net))
  },
})

defineMetric({
  id: 'cogs.byCategory',
  label: 'COGS by Category',
  unit: 'currency',
  grain: 'breakdown',
  sourceTable: 'sale_items',
  sql(ctx) {
    const w = completedSalesIn(ctx.period, ctx.scope, 's')
    const item = ctx.scope.itemWhere('si', 'p')
    return {
      text: `
        SELECT COALESCE(p.category, 'Uncategorised')                    AS category,
               COALESCE(SUM(si.quantity * si.cost_price), 0)            AS cogs,
               COALESCE(SUM(si.quantity * si.selling_price), 0)         AS revenue,
               COALESCE(SUM(si.quantity), 0)                            AS units
        FROM sale_items si
        JOIN sales s ON s.id = si.sale_id
        LEFT JOIN products p ON p.id = si.product_id
        WHERE ${w.sql}${item.sql ? ` AND ${item.sql}` : ''}
        GROUP BY category ORDER BY revenue DESC`,
      params: { ...w.params, ...item.params },
    }
  },
  // NULL categories are bucketed as 'Uncategorised' rather than dropped, so the
  // breakdown still sums to the total. A breakdown that silently loses rows is
  // worse than no breakdown.
  reduce: (rows) =>
    rows.map((r) => ({
      key: r.category,
      label: r.category,
      revenue: r.revenue,
      cogs: r.cogs,
      profit: r.revenue - r.cogs,
      margin: ratio(r.revenue - r.cogs, r.revenue),
      units: r.units,
    })),
})

defineMetric({
  id: 'cogs.byProduct',
  label: 'Profit by Product',
  unit: 'currency',
  grain: 'breakdown',
  sourceTable: 'sale_items',
  sql(ctx) {
    const w = completedSalesIn(ctx.period, ctx.scope, 's')
    const item = ctx.scope.itemWhere('si', 'p')
    return {
      text: `
        SELECT si.product_id                                            AS product_id,
               COALESCE(p.name, si.product_name)                        AS name,
               COALESCE(p.category, 'Uncategorised')                    AS category,
               COALESCE(SUM(si.quantity), 0)                            AS units,
               COALESCE(SUM(si.quantity * si.selling_price), 0)         AS revenue,
               COALESCE(SUM(si.quantity * si.cost_price), 0)            AS cogs,
               SUM(CASE WHEN si.cost_price <= 0 THEN 1 ELSE 0 END)      AS zero_cost_lines
        FROM sale_items si
        JOIN sales s ON s.id = si.sale_id
        LEFT JOIN products p ON p.id = si.product_id
        WHERE ${w.sql}${item.sql ? ` AND ${item.sql}` : ''}
        GROUP BY si.product_id ORDER BY revenue DESC`,
      params: { ...w.params, ...item.params },
    }
  },
  reduce: (rows) =>
    rows.map((r) => ({
      key: r.product_id,
      label: r.name,
      category: r.category,
      units: r.units,
      revenue: r.revenue,
      cogs: r.cogs,
      profit: r.revenue - r.cogs,
      // Margin is withheld, not shown as 100%, when the cost was never recorded.
      margin: r.zero_cost_lines > 0 ? null : ratio(r.revenue - r.cogs, r.revenue),
      costKnown: r.zero_cost_lines === 0,
    })),
})
