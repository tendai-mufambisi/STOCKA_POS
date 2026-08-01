// The only file in the analytics engine that knows how each table stores time.
//
// Stocka's tables do NOT agree on this, and the disagreement is the single
// easiest way to produce a wrong report:
//
//   sales.created_at         SQLite datetime('now')  → 'YYYY-MM-DD HH:MM:SS'  UTC
//   stock_movements.created_at   same                                          UTC
//   shifts.started_at        JS toISOString()        → 'YYYY-MM-DDTHH:MM:SSZ'  UTC
//   expenses.date            plain date              → 'YYYY-MM-DD'           ALREADY LOCAL
//   stock_receivings.date_received  plain date       → 'YYYY-MM-DD'           ALREADY LOCAL
//
// So a UTC column needs the 'localtime' modifier to be bucketed into the right
// business day, and a date-only column must NOT get it — applying 'localtime'
// to '2026-07-31' shifts it backwards into the 30th in any timezone east of
// UTC, which includes Zimbabwe. Getting this wrong moves an expense into the
// wrong month and silently changes the profit figure.
//
// Metrics never write these expressions themselves; the layering guard test
// fails any file under metrics/ that contains the string 'localtime'.

// ── Day-bucketing expressions ────────────────────────────────────────────────
// Each returns the SQL that converts a column into the LOCAL calendar day the
// business would consider it to belong to.

/** sales.created_at — UTC datetime */
function saleDayExpr(alias = 's') {
  return `date(${alias}.created_at, 'localtime')`
}

/** stock_movements.created_at — UTC datetime */
function movementDayExpr(alias = 'sm') {
  return `date(${alias}.created_at, 'localtime')`
}

/** shifts.started_at — UTC ISO string */
function shiftDayExpr(alias = 'sh') {
  return `date(${alias}.started_at, 'localtime')`
}

/** expenses.date — already a local calendar day. No 'localtime'. */
function expenseDayExpr(alias = 'e') {
  return `date(${alias}.date)`
}

/** stock_receivings.date_received — already a local calendar day. No 'localtime'. */
function receivingDayExpr(alias = 'sr') {
  return `date(${alias}.date_received)`
}

/** Local hour-of-day (0–23) a sale happened. */
function saleHourExpr(alias = 's') {
  return `CAST(strftime('%H', ${alias}.created_at, 'localtime') AS INTEGER)`
}

/** Local day-of-week a sale happened, 0 = Sunday (SQLite's %w convention). */
function saleWeekdayExpr(alias = 's') {
  return `CAST(strftime('%w', ${alias}.created_at, 'localtime') AS INTEGER)`
}

/** Earliest local day present in the movement ledger, or null if it is empty. */
function earliestMovementDay(db) {
  return db.prepare(`SELECT MIN(${movementDayExpr('sm')}) FROM stock_movements sm`).pluck().get()
}

// ── Period predicates ────────────────────────────────────────────────────────

// A UTC-stored column is filtered with TWO clauses, and both are required:
//
//   1. a raw comparison on the bare column, which an index can actually use
//   2. the exact date(...,'localtime') comparison, which defines the semantics
//
// `date(created_at,'localtime')` is a function applied to the column, so on its
// own it defeats every index on that column and forces a full table scan — the
// behaviour this database had for its entire history. The raw clause is widened
// by a day in each direction so it can never exclude a row the localtime clause
// would have included, whatever the machine's offset; the localtime clause then
// narrows the result to exactly the right days.
//
// Emitting only the raw clause would be wrong at the period edges. Emitting only
// the localtime clause would be correct but slow. Always emit both.
const EDGE_CUSHION_HOURS = 26

function utcPeriodPredicate(dayExpr, column, period, prefix) {
  const p = `${prefix}_`
  return {
    sql:
      `${column} >= @${p}rawLo AND ${column} < @${p}rawHi ` +
      `AND ${dayExpr} BETWEEN @${p}dayLo AND @${p}dayHi`,
    params: {
      [`${p}rawLo`]: shiftIso(period.start, -EDGE_CUSHION_HOURS),
      [`${p}rawHi`]: shiftIso(period.end, +EDGE_CUSHION_HOURS + 24),
      [`${p}dayLo`]: period.start,
      [`${p}dayHi`]: period.end,
    },
  }
}

/** Filter `sales` to a Period. */
function salePeriodPredicate(period, alias = 's', prefix = 'sale') {
  return utcPeriodPredicate(saleDayExpr(alias), `${alias}.created_at`, period, prefix)
}

/** Filter `stock_movements` to a Period. */
function movementPeriodPredicate(period, alias = 'sm', prefix = 'mov') {
  return utcPeriodPredicate(movementDayExpr(alias), `${alias}.created_at`, period, prefix)
}

/** Filter `shifts` to a Period by start day. */
function shiftPeriodPredicate(period, alias = 'sh', prefix = 'shift') {
  return utcPeriodPredicate(shiftDayExpr(alias), `${alias}.started_at`, period, prefix)
}

// Date-only columns need no cushion and no localtime — they are already the
// local day, so a plain BETWEEN is both exact and index-friendly.

/** Filter `expenses` to a Period. */
function expensePeriodPredicate(period, alias = 'e', prefix = 'exp') {
  const p = `${prefix}_`
  return {
    sql: `${expenseDayExpr(alias)} BETWEEN @${p}dayLo AND @${p}dayHi`,
    params: { [`${p}dayLo`]: period.start, [`${p}dayHi`]: period.end },
  }
}

/** Filter `stock_receivings` to a Period. */
function receivingPeriodPredicate(period, alias = 'sr', prefix = 'recv') {
  const p = `${prefix}_`
  return {
    sql: `${receivingDayExpr(alias)} BETWEEN @${p}dayLo AND @${p}dayHi`,
    params: { [`${p}dayLo`]: period.start, [`${p}dayHi`]: period.end },
  }
}

// ── Local-day helpers ────────────────────────────────────────────────────────

/** 'YYYY-MM-DD' for a JS Date in LOCAL time. Never use toISOString() for this. */
function localDayStr(d = new Date()) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Today as a local 'YYYY-MM-DD'. */
function today() {
  return localDayStr()
}

/** Parse 'YYYY-MM-DD' into a local-midnight Date. */
function parseDay(s) {
  const [y, m, d] = String(s).split('-').map(Number)
  return new Date(y, m - 1, d)
}

/** Add days to a 'YYYY-MM-DD', returning 'YYYY-MM-DD'. */
function addDays(dayStr, n) {
  const d = parseDay(dayStr)
  d.setDate(d.getDate() + n)
  return localDayStr(d)
}

/**
 * A 'YYYY-MM-DD HH:MM:SS' string offset from local midnight of `dayStr`, for
 * comparison against SQLite's UTC datetime format. Used only to widen the raw
 * index-friendly clause, never to define a boundary.
 */
function shiftIso(dayStr, hours) {
  const d = parseDay(dayStr)
  d.setHours(d.getHours() + hours)
  const pad = (n) => String(n).padStart(2, '0')
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
  )
}

module.exports = {
  saleDayExpr,
  movementDayExpr,
  shiftDayExpr,
  expenseDayExpr,
  receivingDayExpr,
  saleHourExpr,
  saleWeekdayExpr,
  earliestMovementDay,
  salePeriodPredicate,
  movementPeriodPredicate,
  shiftPeriodPredicate,
  expensePeriodPredicate,
  receivingPeriodPredicate,
  localDayStr,
  today,
  parseDay,
  addDays,
}
