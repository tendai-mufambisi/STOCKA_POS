const { defineMetric } = require('../kernel/registry')
const { expensePeriodPredicate } = require('../kernel/time')
const pay = require('../sql/paymentClassifier')

// Expenses.
//
// `expenses.date` is a bare local date, unlike `sales.created_at` which is UTC.
// Every predicate here goes through kernel/time.js, which is the only place that
// knows the difference. Applying 'localtime' to a date-only column shifts it
// backwards a day in Zimbabwe and quietly moves an expense into the wrong month.

function expenseWhere(ctx) {
  const p = expensePeriodPredicate(ctx.period, 'e')
  return { sql: p.sql, params: p.params }
}

defineMetric({
  id: 'expenses.total',
  label: 'Operating Expenses',
  unit: 'currency',
  sourceTable: 'expenses',
  sourceFilter: 'date in period',
  sql(ctx) {
    const w = expenseWhere(ctx)
    return {
      text: `SELECT COALESCE(SUM(e.amount), 0) AS total FROM expenses e WHERE ${w.sql}`,
      params: w.params,
    }
  },
  reduce: (rows) => rows[0]?.total || 0,
})

defineMetric({
  id: 'expenses.count',
  label: 'Expense Entries',
  unit: 'count',
  sourceTable: 'expenses',
  sql(ctx) {
    const w = expenseWhere(ctx)
    return {
      text: `SELECT COUNT(*) AS n FROM expenses e WHERE ${w.sql}`,
      params: w.params,
    }
  },
  reduce: (rows) => rows[0]?.n || 0,
})

// Only cash expenses reduce the drawer — a transfer-paid expense never touches
// it. Same rule as the shift reconciliation, from the same classifier.
defineMetric({
  id: 'expenses.cash',
  label: 'Cash Expenses',
  unit: 'currency',
  sourceTable: 'expenses',
  sql(ctx) {
    const w = expenseWhere(ctx)
    return {
      text: `SELECT COALESCE(SUM(e.amount), 0) AS total FROM expenses e
             WHERE ${w.sql} AND ${pay.cashExpenseSql('e')}`,
      params: w.params,
    }
  },
  reduce: (rows) => rows[0]?.total || 0,
})

defineMetric({
  id: 'expenses.byCategory',
  label: 'Expenses by Category',
  unit: 'currency',
  grain: 'breakdown',
  sourceTable: 'expenses',
  sql(ctx) {
    const w = expenseWhere(ctx)
    return {
      text: `SELECT COALESCE(NULLIF(TRIM(e.category), ''), 'Uncategorised') AS category,
                    COALESCE(SUM(e.amount), 0) AS total, COUNT(*) AS n
             FROM expenses e WHERE ${w.sql}
             GROUP BY category ORDER BY total DESC`,
      params: w.params,
    }
  },
  // `category` is free text, so 'Rent', 'rent' and ' Rent ' are three buckets in
  // the raw data. Trimming and bucketing blanks keeps the breakdown summing to
  // the total; the casing collision is surfaced as a quality note rather than
  // silently merged, because merging would be a guess about the user's intent.
  reduce: (rows) =>
    rows.map((r) => ({ key: r.category, label: r.category, value: r.total, count: r.n })),
})

defineMetric({
  id: 'expenses.largestCategory',
  label: 'Largest Expense Category',
  unit: 'text',
  dependsOn: ['expenses.byCategory', 'expenses.total'],
  compute(ctx, d) {
    const rows = d['expenses.byCategory'].value
    const total = d['expenses.total'].value
    if (!rows?.length || !total) return null
    const top = rows[0]
    return { label: top.label, value: top.value, share: top.value / total }
  },
})
