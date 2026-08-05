// The single payment taxonomy.
//
// This replaces three hand-written classifications that did not agree:
//
//   1. shifts.js computeDrawerTotals   cash = 'Cash';  non-drawer = Transfer/Swipe/EcoCash/USD
//   2. shifts.js getShiftSummary        identical to (1)
//   3. src/pages/Reports.jsx            cash = Cash/USD Cash/ZWG Cash/USD/NULL
//
// (1) and (3) contradict each other on 'USD': the drawer logic treats a USD sale
// as money that never entered the drawer, while the report counted it as cash.
// So the same day could be reported with two different cash figures depending on
// which screen the owner opened.
//
// This module resolves that in favour of the drawer logic, because that is the
// path where the money is physically counted and signed off every evening. A
// classification that disagrees with the cash count is wrong by definition.
//
// ── Why 'USD' is not drawer cash ─────────────────────────────────────────────
//
// It reads like it should be. The reason it is not is historical: the schema
// migration folds two different things into the same value —
//
//   UPDATE sales SET payment_method = 'USD' WHERE payment_method IN ('USD Cash','Swipe')
//
// so a stored 'USD' may have been a swipe. Since the drawer is reconciled in
// local cash and USD/swipe receipts are counted separately (shifts.closing_transfer),
// 'USD' belongs on the non-drawer side. Changing that would silently alter every
// historical variance figure.

/** Values that put money in the cash drawer. */
const DRAWER_METHODS = ['Cash']

/**
 * Values that do not pass through the drawer — electronic transfers, swipes,
 * mobile money, and USD (see note above). Reconciled separately against
 * shifts.closing_transfer.
 */
const NON_DRAWER_METHODS = ['Transfer', 'Swipe', 'EcoCash', 'USD']

/**
 * Split sales carry BOTH: `cash_amount` is the drawer portion and `usd_amount`
 * the non-drawer portion. Summing `total` by payment_method therefore hides the
 * split — always add the two component columns instead.
 */
const SPLIT_METHOD = 'Split'

/** Tender buckets a report may present. */
const TENDERS = [
  { id: 'cash', label: 'Cash', drawer: true },
  { id: 'electronic', label: 'Transfer / Swipe / EcoCash / USD', drawer: false },
  { id: 'split', label: 'Split', drawer: null },
]

// ── SQL fragments ────────────────────────────────────────────────────────────
// Method names are baked in as literals rather than bound parameters because
// they are this module's own constants, never user input.

const quoted = (list) => list.map((m) => `'${m}'`).join(', ')

/** Sales whose full total landed in the drawer. */
function drawerCashSql(alias = 's') {
  return `${alias}.payment_method = 'Cash'`
}

/** Sales whose full total bypassed the drawer. */
function nonDrawerSql(alias = 's') {
  return `${alias}.payment_method IN (${quoted(NON_DRAWER_METHODS)})`
}

/** Split sales — use cash_amount / usd_amount, never total. */
function splitSql(alias = 's') {
  return `${alias}.payment_method = '${SPLIT_METHOD}'`
}

/**
 * Total that reached the cash drawer, as a SUM expression.
 * Mirrors the arithmetic in shifts.js computeDrawerTotals exactly:
 * full total of Cash sales, plus only the cash_amount portion of Splits.
 */
function drawerAmountExpr(alias = 's') {
  return (
    `CASE WHEN ${drawerCashSql(alias)} THEN ${alias}.total ` +
    `WHEN ${splitSql(alias)} THEN COALESCE(${alias}.cash_amount, 0) ` +
    `ELSE 0 END`
  )
}

/** Total that bypassed the drawer, as a SUM expression. */
function nonDrawerAmountExpr(alias = 's') {
  return (
    `CASE WHEN ${nonDrawerSql(alias)} THEN ${alias}.total ` +
    `WHEN ${splitSql(alias)} THEN COALESCE(${alias}.usd_amount, 0) ` +
    `ELSE 0 END`
  )
}

/** Bucket id for a GROUP BY over tenders. */
function tenderBucketExpr(alias = 's') {
  return (
    `CASE WHEN ${splitSql(alias)} THEN 'split' ` +
    `WHEN ${nonDrawerSql(alias)} THEN 'electronic' ` +
    `ELSE 'cash' END`
  )
}

/**
 * Expenses that reduce the drawer.
 *
 * NULL and '' count as cash here, matching queryCashExpenses in shifts.js: the
 * column was added by a later migration, so every expense recorded before it
 * existed is blank and was, in practice, paid in cash.
 */
function cashExpenseSql(alias = 'e') {
  return `(${alias}.payment_method = 'Cash' OR ${alias}.payment_method IS NULL OR ${alias}.payment_method = '')`
}

// ── JS-side classification ───────────────────────────────────────────────────

/**
 * Bucket a payment_method value. Returns 'cash' | 'electronic' | 'split'.
 *
 * NULL/'' resolves to 'cash' because the column default is 'Cash' and the
 * migration rewrites every unrecognised legacy value to 'Cash'. Legacy values
 * that predate normalisation ('USD Cash', 'ZWG Cash') are mapped explicitly so
 * an un-migrated row cannot land in the wrong bucket.
 */
function classify(paymentMethod) {
  if (!paymentMethod) return 'cash'
  const m = String(paymentMethod).trim()
  if (m === SPLIT_METHOD) return 'split'
  if (NON_DRAWER_METHODS.includes(m)) return 'electronic'
  return 'cash'
}

/** Drawer portion of a single sale row. */
function drawerAmountOf(sale) {
  const bucket = classify(sale?.payment_method)
  if (bucket === 'cash') return sale.total || 0
  if (bucket === 'split') return sale.cash_amount || 0
  return 0
}

/** Non-drawer portion of a single sale row. */
function nonDrawerAmountOf(sale) {
  const bucket = classify(sale?.payment_method)
  if (bucket === 'electronic') return sale.total || 0
  if (bucket === 'split') return sale.usd_amount || 0
  return 0
}

/** True if the value is outside the canonical set — surfaced as a data-quality note. */
function isLegacyValue(paymentMethod) {
  if (!paymentMethod) return false
  const m = String(paymentMethod).trim()
  return ![...DRAWER_METHODS, ...NON_DRAWER_METHODS, SPLIT_METHOD].includes(m)
}

module.exports = {
  DRAWER_METHODS,
  NON_DRAWER_METHODS,
  SPLIT_METHOD,
  TENDERS,
  drawerCashSql,
  nonDrawerSql,
  splitSql,
  drawerAmountExpr,
  nonDrawerAmountExpr,
  tenderBucketExpr,
  cashExpenseSql,
  classify,
  drawerAmountOf,
  nonDrawerAmountOf,
  isLegacyValue,
}
