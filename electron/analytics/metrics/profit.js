const { defineMetric } = require('../kernel/registry')
const { ratio } = require('../kernel/money')

// Profit.
//
// Every metric here is DERIVED — not one of them touches the database. That is
// deliberate and is the core of the whole design: gross profit is defined once,
// as net sales minus COGS, and if either input changes it follows automatically.
// There is no second SQL statement anywhere that could compute it differently.

defineMetric({
  id: 'profit.gross',
  label: 'Gross Profit',
  unit: 'currency',
  dependsOn: ['sales.net', 'cogs.total'],
  quality: ['saleItems.zeroCost'],
  compute: (ctx, d) => d['sales.net'].value - d['cogs.total'].value,
})

defineMetric({
  id: 'profit.grossMargin',
  label: 'Gross Margin',
  unit: 'ratio',
  dependsOn: ['profit.gross', 'sales.net'],
  quality: ['saleItems.zeroCost'],
  compute: (ctx, d) => ratio(d['profit.gross'].value, d['sales.net'].value),
})

defineMetric({
  id: 'profit.net',
  label: 'Net Profit',
  unit: 'currency',
  dependsOn: ['profit.gross', 'expenses.total'],
  // Operating expenses only. Stocka records no depreciation, interest or tax,
  // so this is operating profit — the reports label it accordingly rather than
  // claiming a bottom line the data cannot support.
  compute: (ctx, d) => d['profit.gross'].value - d['expenses.total'].value,
})

defineMetric({
  id: 'profit.netMargin',
  label: 'Net Margin',
  unit: 'ratio',
  dependsOn: ['profit.net', 'sales.net'],
  compute: (ctx, d) => ratio(d['profit.net'].value, d['sales.net'].value),
})

defineMetric({
  id: 'profit.expenseRatio',
  label: 'Expenses as Share of Sales',
  unit: 'ratio',
  dependsOn: ['expenses.total', 'sales.net'],
  compute: (ctx, d) => ratio(d['expenses.total'].value, d['sales.net'].value),
})

defineMetric({
  id: 'profit.perTransaction',
  label: 'Profit per Transaction',
  unit: 'currency',
  dependsOn: ['profit.gross', 'sales.transactionCount'],
  compute: (ctx, d) => ratio(d['profit.gross'].value, d['sales.transactionCount'].value),
})
