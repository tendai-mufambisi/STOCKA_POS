const { defineMetric, defineBundle } = require('../kernel/registry')
const { completedSalesIn, voidedSql } = require('../sql/fragments')
const { salePeriodPredicate, saleDayExpr, saleHourExpr, saleWeekdayExpr } = require('../kernel/time')
const pay = require('../sql/paymentClassifier')
const { ratio } = require('../kernel/money')

// Sales metrics.
//
// One SQL pass produces the headline figures, because a monthly report asks for
// most of them at once and this database has, until now, been read with a full
// table scan per question.

defineBundle({
  id: 'salesPeriodAggregate',
  sql(ctx) {
    const w = completedSalesIn(ctx.period, ctx.scope, 's')
    return {
      text: `
        SELECT
          COUNT(*)                                          AS sale_count,
          COALESCE(SUM(s.total), 0)                         AS gross,
          COALESCE(SUM(s.discount_total), 0)                AS discounts,
          COALESCE(SUM(s.tax_amount), 0)                    AS tax,
          COALESCE(SUM(${pay.drawerAmountExpr('s')}), 0)    AS drawer,
          COALESCE(SUM(${pay.nonDrawerAmountExpr('s')}), 0) AS non_drawer,
          COUNT(DISTINCT s.cashier)                         AS cashier_count
        FROM sales s
        WHERE ${w.sql}`,
      params: w.params,
    }
  },
})

const bundled = (id, extra) =>
  defineMetric({ bundle: 'salesPeriodAggregate', sourceTable: 'sales', ...extra, id })

bundled('sales.transactionCount', {
  label: 'Transactions',
  unit: 'count',
  pick: (row) => row.sale_count || 0,
})

bundled('sales.gross', {
  label: 'Gross Sales',
  unit: 'currency',
  pick: (row) => row.gross || 0,
})

// Discounts were not recorded before schema v5, so for any period before that
// this is 0 because none were captured — not because none were given. The
// quality check says so rather than the metric pretending otherwise.
bundled('sales.discounts', {
  label: 'Discounts',
  unit: 'currency',
  quality: ['sales.discountsNotCaptured'],
  pick: (row) => row.discounts || 0,
})

defineMetric({
  id: 'sales.net',
  label: 'Net Sales',
  unit: 'currency',
  dependsOn: ['sales.gross', 'sales.discounts'],
  // Net of discounts. NOT net of tax: no per-sale tax was stored before v5, so
  // subtracting it here would silently mix taxed and untaxed periods.
  compute: (ctx, d) => d['sales.gross'].value - d['sales.discounts'].value,
})

bundled('sales.drawerTake', {
  label: 'Cash Received',
  unit: 'currency',
  // Includes only the cash_amount portion of split sales — see paymentClassifier.
  pick: (row) => row.drawer || 0,
})

bundled('sales.electronicTake', {
  label: 'Transfer / Swipe / EcoCash / USD',
  unit: 'currency',
  pick: (row) => row.non_drawer || 0,
})

defineMetric({
  id: 'sales.averageBasket',
  label: 'Average Basket',
  unit: 'currency',
  dependsOn: ['sales.net', 'sales.transactionCount'],
  // ratio() returns null rather than NaN on a day with no sales, so the report
  // prints '—' instead of 'NaN' or a misleading 0.00.
  compute: (ctx, d) => ratio(d['sales.net'].value, d['sales.transactionCount'].value),
})

// ── Voids ────────────────────────────────────────────────────────────────────
// Reported as their own figure and never labelled "returns". A void reverses a
// mistake, usually within the same shift; a return is a customer bringing goods
// back later. Stocka has no returns table, and conflating the two corrupts both
// COGS and margin.

defineMetric({
  id: 'sales.voidedValue',
  label: 'Voided Sales',
  unit: 'currency',
  sourceTable: 'sales',
  sourceFilter: "status = 'voided'",
  sql(ctx) {
    const p = salePeriodPredicate(ctx.period, 's')
    const sc = ctx.scope.saleWhere('s')
    return {
      text: `SELECT COALESCE(SUM(s.total), 0) AS v FROM sales s
             WHERE ${voidedSql('s')} AND ${p.sql}${sc.sql ? ` AND ${sc.sql}` : ''}`,
      params: { ...p.params, ...sc.params },
    }
  },
  reduce: (rows) => rows[0]?.v || 0,
})

defineMetric({
  id: 'sales.voidedCount',
  label: 'Voids',
  unit: 'count',
  sourceTable: 'sales',
  sourceFilter: "status = 'voided'",
  sql(ctx) {
    const p = salePeriodPredicate(ctx.period, 's')
    const sc = ctx.scope.saleWhere('s')
    return {
      text: `SELECT COUNT(*) AS n FROM sales s
             WHERE ${voidedSql('s')} AND ${p.sql}${sc.sql ? ` AND ${sc.sql}` : ''}`,
      params: { ...p.params, ...sc.params },
    }
  },
  reduce: (rows) => rows[0]?.n || 0,
})

// ── Breakdowns ───────────────────────────────────────────────────────────────

defineMetric({
  id: 'sales.byDay',
  label: 'Sales by Day',
  unit: 'currency',
  grain: 'series',
  sourceTable: 'sales',
  sql(ctx) {
    const w = completedSalesIn(ctx.period, ctx.scope, 's')
    return {
      text: `SELECT ${saleDayExpr('s')} AS day, COALESCE(SUM(s.total),0) AS total, COUNT(*) AS n
             FROM sales s WHERE ${w.sql}
             GROUP BY day ORDER BY day`,
      params: w.params,
    }
  },
  // Days with no trading are filled in as zeros. Here a 0 is a genuine claim —
  // the shop was open to the ledger and took nothing — and a line chart that
  // skips them misrepresents the shape of the month.
  reduce(rows, ctx) {
    const byDay = new Map(rows.map((r) => [r.day, r]))
    return ctx.period.days().map((day) => ({
      x: day,
      y: byDay.get(day)?.total || 0,
      count: byDay.get(day)?.n || 0,
    }))
  },
})

defineMetric({
  id: 'sales.byTender',
  label: 'Sales by Payment Method',
  unit: 'currency',
  grain: 'breakdown',
  sourceTable: 'sales',
  sql(ctx) {
    const w = completedSalesIn(ctx.period, ctx.scope, 's')
    return {
      text: `SELECT ${pay.tenderBucketExpr('s')} AS bucket,
                    COALESCE(SUM(s.total),0) AS total,
                    COALESCE(SUM(${pay.drawerAmountExpr('s')}),0) AS drawer,
                    COALESCE(SUM(${pay.nonDrawerAmountExpr('s')}),0) AS non_drawer,
                    COUNT(*) AS n
             FROM sales s WHERE ${w.sql} GROUP BY bucket`,
      params: w.params,
    }
  },
  reduce: (rows) =>
    rows.map((r) => ({
      key: r.bucket,
      label: pay.TENDERS.find((t) => t.id === r.bucket)?.label || r.bucket,
      value: r.total,
      drawer: r.drawer,
      nonDrawer: r.non_drawer,
      count: r.n,
    })),
})

defineMetric({
  id: 'sales.byHour',
  label: 'Sales by Hour',
  unit: 'currency',
  grain: 'series',
  sourceTable: 'sales',
  sql(ctx) {
    const w = completedSalesIn(ctx.period, ctx.scope, 's')
    return {
      text: `SELECT ${saleHourExpr('s')} AS hour,
                    COALESCE(SUM(s.total),0) AS total, COUNT(*) AS n
             FROM sales s WHERE ${w.sql} GROUP BY hour ORDER BY hour`,
      params: w.params,
    }
  },
  reduce(rows) {
    const byHour = new Map(rows.map((r) => [r.hour, r]))
    return Array.from({ length: 24 }, (_, h) => ({
      x: h,
      y: byHour.get(h)?.total || 0,
      count: byHour.get(h)?.n || 0,
    }))
  },
})

defineMetric({
  id: 'sales.byWeekday',
  label: 'Sales by Day of Week',
  unit: 'currency',
  grain: 'series',
  sourceTable: 'sales',
  sql(ctx) {
    const w = completedSalesIn(ctx.period, ctx.scope, 's')
    return {
      text: `SELECT ${saleWeekdayExpr('s')} AS dow,
                    COALESCE(SUM(s.total),0) AS total, COUNT(*) AS n
             FROM sales s WHERE ${w.sql} GROUP BY dow ORDER BY dow`,
      params: w.params,
    }
  },
  reduce(rows) {
    const NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
    const byDow = new Map(rows.map((r) => [r.dow, r]))
    return NAMES.map((name, i) => ({
      x: name,
      y: byDow.get(i)?.total || 0,
      count: byDow.get(i)?.n || 0,
    }))
  },
})
