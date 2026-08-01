const { defineMetric } = require('../kernel/registry')
const { shiftPeriodPredicate } = require('../kernel/time')

// Cash and drawer reconciliation.
//
// ── The freeze contract, and why analytics must not recompute ────────────────
//
// getShiftSummary (electron/database/domains/shifts.js) LOCKS a closed shift's
// expected cash to `closing_cash − variance` rather than recomputing it from
// sales. That is deliberate: it means a void entered next week cannot silently
// rewrite the variance a cashier was held to last Tuesday.
//
// These metrics read the STORED shift columns for closed shifts for the same
// reason. Recomputing expected cash from live sales here would reintroduce
// exactly the drift the freeze was built to prevent, and would put the analytics
// engine at odds with the paper the money was counted against.
//
// Open shifts have nothing frozen yet, so their figures are provisional and are
// reported as such.

function shiftsIn(ctx) {
  const p = shiftPeriodPredicate(ctx.period, 'sh')
  const parts = [p.sql]
  const params = { ...p.params }
  if (ctx.scope.tillCodes?.length) {
    const names = ctx.scope.tillCodes.map((t, i) => {
      params[`cash_till${i}`] = t
      return `@cash_till${i}`
    })
    parts.push(`sh.till_code IN (${names.join(', ')})`)
  }
  if (ctx.scope.cashiers?.length) {
    const names = ctx.scope.cashiers.map((c, i) => {
      params[`cash_cashier${i}`] = c
      return `@cash_cashier${i}`
    })
    parts.push(`sh.cashier_username IN (${names.join(', ')})`)
  }
  return { sql: parts.join(' AND '), params }
}

defineMetric({
  id: 'cash.openingFloats',
  label: 'Opening Floats',
  unit: 'currency',
  sourceTable: 'shifts',
  sql(ctx) {
    const w = shiftsIn(ctx)
    return {
      text: `SELECT COALESCE(SUM(sh.opening_cash), 0) AS t FROM shifts sh WHERE ${w.sql}`,
      params: w.params,
    }
  },
  reduce: (rows) => rows[0]?.t || 0,
})

defineMetric({
  id: 'cash.countedAtClose',
  label: 'Cash Counted',
  unit: 'currency',
  sourceTable: 'shifts',
  sourceFilter: "status = 'closed'",
  sql(ctx) {
    const w = shiftsIn(ctx)
    return {
      text: `SELECT COALESCE(SUM(sh.closing_cash), 0) AS t
             FROM shifts sh WHERE ${w.sql} AND sh.status = 'closed'`,
      params: w.params,
    }
  },
  reduce: (rows) => rows[0]?.t || 0,
})

defineMetric({
  id: 'cash.variance',
  label: 'Cash Variance',
  unit: 'currency',
  sourceTable: 'shifts',
  quality: ['shifts.unreconciled', 'shifts.stillOpen'],
  sql(ctx) {
    const w = shiftsIn(ctx)
    // The STORED variance, as signed off at close — not a recomputation.
    return {
      text: `SELECT COALESCE(SUM(sh.variance), 0) AS t
             FROM shifts sh WHERE ${w.sql} AND sh.status = 'closed'`,
      params: w.params,
    }
  },
  reduce: (rows) => rows[0]?.t || 0,
})

defineMetric({
  id: 'cash.expectedAtClose',
  label: 'Expected Cash',
  unit: 'currency',
  dependsOn: ['cash.countedAtClose', 'cash.variance'],
  // The identity the freeze guarantees: variance = counted − expected.
  // Derived rather than re-queried so it can never disagree with the two
  // figures it sits between.
  compute: (ctx, d) => d['cash.countedAtClose'].value - d['cash.variance'].value,
})

defineMetric({
  id: 'cash.transferVariance',
  label: 'Transfer Variance',
  unit: 'currency',
  sourceTable: 'shifts',
  sql(ctx) {
    const w = shiftsIn(ctx)
    return {
      text: `SELECT COALESCE(SUM(sh.transfer_variance), 0) AS t
             FROM shifts sh WHERE ${w.sql} AND sh.status = 'closed'
                   AND sh.closing_transfer IS NOT NULL`,
      params: w.params,
    }
  },
  reduce: (rows) => rows[0]?.t || 0,
})

defineMetric({
  id: 'cash.shiftCount',
  label: 'Shifts',
  unit: 'count',
  sourceTable: 'shifts',
  sql(ctx) {
    const w = shiftsIn(ctx)
    return { text: `SELECT COUNT(*) AS n FROM shifts sh WHERE ${w.sql}`, params: w.params }
  },
  reduce: (rows) => rows[0]?.n || 0,
})

// Drawers that were never counted, or were counted while the owning till was
// unreachable. Their variance reads as 0 only because there was nothing to
// compare against — they must never be presented as balanced.
defineMetric({
  id: 'cash.unverifiedShiftCount',
  label: 'Unverified Drawers',
  unit: 'count',
  sourceTable: 'shifts',
  sql(ctx) {
    const w = shiftsIn(ctx)
    return {
      text: `SELECT COUNT(*) AS n FROM shifts sh WHERE ${w.sql}
               AND sh.reconciliation_status IN ('unreconciled', 'unverified')`,
      params: w.params,
    }
  },
  reduce: (rows) => rows[0]?.n || 0,
})

defineMetric({
  id: 'cash.varianceByShift',
  label: 'Variance by Shift',
  unit: 'currency',
  grain: 'breakdown',
  sourceTable: 'shifts',
  sql(ctx) {
    const w = shiftsIn(ctx)
    return {
      text: `SELECT sh.id, sh.cashier_display_name AS cashier, sh.cashier_username,
                    sh.till_code, sh.started_at, sh.closed_at, sh.status,
                    sh.opening_cash, sh.closing_cash, sh.variance,
                    sh.reconciliation_status
             FROM shifts sh WHERE ${w.sql} ORDER BY sh.started_at DESC`,
      params: w.params,
    }
  },
  reduce: (rows) =>
    rows.map((r) => ({
      key: r.id,
      label: r.cashier || r.cashier_username,
      tillCode: r.till_code,
      startedAt: r.started_at,
      closedAt: r.closed_at,
      openingCash: r.opening_cash,
      closingCash: r.closing_cash,
      variance: r.status === 'closed' ? r.variance : null,
      status: r.status,
      verified: !['unreconciled', 'unverified'].includes(r.reconciliation_status),
      reconciliationStatus: r.reconciliation_status,
    })),
})
