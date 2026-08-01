const { defineMetric } = require('../kernel/registry')
const { completedSalesIn, voidedSql } = require('../sql/fragments')
const { salePeriodPredicate } = require('../kernel/time')
const pay = require('../sql/paymentClassifier')
const { ratio } = require('../kernel/money')

// Staff performance.
//
// Caveat that belongs on any report using these: `sales.cashier` is a username
// TEXT column, not a foreign key to users.id. Renaming or deleting a user
// orphans their history — the sales stay, attributed to a name that no longer
// resolves. Reported as a quality note rather than silently merged into
// 'Unknown', because merging would misattribute one person's takings to another.

defineMetric({
  id: 'staff.byCashier',
  label: 'Performance by Cashier',
  unit: 'currency',
  grain: 'breakdown',
  sourceTable: 'sales',
  quality: ['staff.orphanedCashier'],
  sql(ctx) {
    const w = completedSalesIn(ctx.period, ctx.scope, 's')
    return {
      // COGS is pre-aggregated per sale before joining, so the join cannot
      // multiply the sale-level sums by the number of lines on each sale.
      text: `
        SELECT s.cashier                                          AS cashier,
               COUNT(*)                                           AS sale_count,
               COALESCE(SUM(s.total), 0)                          AS revenue,
               COALESCE(SUM(s.discount_total), 0)                 AS discounts,
               COALESCE(SUM(${pay.drawerAmountExpr('s')}), 0)     AS drawer,
               COALESCE(SUM(${pay.nonDrawerAmountExpr('s')}), 0)  AS non_drawer,
               COALESCE(SUM(ic.cogs), 0)                          AS cogs,
               (SELECT COUNT(*) FROM users u WHERE u.username = s.cashier) AS user_exists
        FROM sales s
        LEFT JOIN (
          SELECT si.sale_id, SUM(si.quantity * si.cost_price) AS cogs
            FROM sale_items si GROUP BY si.sale_id
        ) ic ON ic.sale_id = s.id
        WHERE ${w.sql}
        GROUP BY s.cashier
        ORDER BY revenue DESC`,
      params: w.params,
    }
  },
  reduce: (rows) =>
    rows.map((r) => ({
      key: r.cashier,
      label: r.cashier,
      saleCount: r.sale_count,
      revenue: r.revenue,
      cogs: r.cogs,
      profit: r.revenue - r.cogs,
      discounts: r.discounts,
      drawerTake: r.drawer,
      electronicTake: r.non_drawer,
      averageBasket: ratio(r.revenue, r.sale_count),
      // A cashier whose user record is gone: their history is still real, but
      // the name can no longer be resolved to a person.
      userExists: r.user_exists > 0,
    })),
})

defineMetric({
  id: 'staff.voidsByCashier',
  label: 'Voids by Cashier',
  unit: 'count',
  grain: 'breakdown',
  sourceTable: 'sales',
  sourceFilter: "status = 'voided'",
  sql(ctx) {
    const p = salePeriodPredicate(ctx.period, 's')
    const sc = ctx.scope.saleWhere('s')
    return {
      text: `SELECT s.cashier AS cashier, COUNT(*) AS n, COALESCE(SUM(s.total),0) AS value
             FROM sales s
             WHERE ${voidedSql('s')} AND ${p.sql}${sc.sql ? ` AND ${sc.sql}` : ''}
             GROUP BY s.cashier ORDER BY n DESC`,
      params: { ...p.params, ...sc.params },
    }
  },
  reduce: (rows) =>
    rows.map((r) => ({ key: r.cashier, label: r.cashier, value: r.n, voidedValue: r.value })),
})

defineMetric({
  id: 'staff.topCashier',
  label: 'Best Performing Cashier',
  unit: 'text',
  dependsOn: ['staff.byCashier'],
  compute(ctx, d) {
    const rows = d['staff.byCashier'].value
    if (!rows?.length) return null
    const top = rows[0]
    return {
      label: top.label,
      revenue: top.revenue,
      saleCount: top.saleCount,
      averageBasket: top.averageBasket,
    }
  },
})

defineMetric({
  id: 'staff.activeCashierCount',
  label: 'Cashiers Who Traded',
  unit: 'count',
  dependsOn: ['staff.byCashier'],
  compute: (ctx, d) => (d['staff.byCashier'].value || []).length,
})
