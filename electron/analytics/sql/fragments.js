const time = require('../kernel/time')

// Shared SQL building blocks.
//
// These exist so that the rules every query must obey are stated once. The two
// that matter most:
//
//   1. status = 'completed'
//      `sales` also holds held, pending, discarded and voided rows, and a VOIDED
//      sale keeps its sale_items. Any revenue or COGS query that forgets this
//      filter counts cancelled business as real.
//
//   2. the double period predicate (see kernel/time.js)
//      An indexable raw comparison AND the exact localtime day comparison.

const COMPLETED = 'completed'

/** The only sale status that represents real business. */
function completedSql(alias = 's') {
  return `${alias}.status = '${COMPLETED}'`
}

/** Voided sales — reported honestly as their own figure, never as returns. */
function voidedSql(alias = 's') {
  return `${alias}.status = 'voided'`
}

/**
 * Completed sales within a period, optionally scoped.
 * Returns { sql, params } where sql is a full WHERE body (no 'WHERE' keyword).
 */
function completedSalesIn(period, scope, alias = 's') {
  const parts = [completedSql(alias)]
  let params = {}

  const p = time.salePeriodPredicate(period, alias)
  parts.push(p.sql)
  params = { ...params, ...p.params }

  if (scope) {
    const s = scope.saleWhere(alias)
    if (s.sql) {
      parts.push(s.sql)
      params = { ...params, ...s.params }
    }
  }

  return { sql: parts.join(' AND '), params }
}

/** Expenses within a period. */
function expensesIn(period, alias = 'e') {
  return time.expensePeriodPredicate(period, alias)
}

/** Stock receivings within a period. */
function receivingsIn(period, alias = 'sr') {
  return time.receivingPeriodPredicate(period, alias)
}

/**
 * Combine { sql, params } fragments into a WHERE clause.
 * Empty fragments are dropped, so callers need no conditionals.
 */
function where(...fragments) {
  const parts = []
  let params = {}
  for (const f of fragments) {
    if (!f) continue
    const sql = typeof f === 'string' ? f : f.sql
    if (!sql) continue
    parts.push(sql)
    if (f.params) params = { ...params, ...f.params }
  }
  return { sql: parts.length ? `WHERE ${parts.join(' AND ')}` : '', params }
}

module.exports = {
  COMPLETED,
  completedSql,
  voidedSql,
  completedSalesIn,
  expensesIn,
  receivingsIn,
  where,
}
