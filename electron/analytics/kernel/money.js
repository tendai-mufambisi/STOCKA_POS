// Money arithmetic for the analytics engine.
//
// Prices are stored as REAL, so binary floating point is already in the data and
// cannot be legislated away. What CAN be prevented is compounding: summing a few
// thousand line items in floating point and then comparing the result against
// another such sum produces residuals like 0.000000001 that make an exact
// accounting identity fail for no business reason.
//
// So: sum in integer cents, and compare with an explicit tolerance. A report
// that claims gross profit equals net sales minus COGS must be able to prove it.

const CENTS = 100

/** A REAL currency value → integer cents. */
function toCents(v) {
  if (v == null || Number.isNaN(v)) return 0
  return Math.round(Number(v) * CENTS)
}

/** Integer cents → a REAL currency value. */
function fromCents(c) {
  return (c || 0) / CENTS
}

/** Sum currency values without accumulating float error. */
function sumMoney(values) {
  let cents = 0
  for (const v of values) cents += toCents(v)
  return fromCents(cents)
}

/** Round a currency value to 2dp for display or storage. */
function roundMoney(v) {
  return fromCents(toCents(v))
}

// Two money figures are equal if they agree to the cent. Anything finer is
// float noise, not a discrepancy.
const MONEY_EPSILON = 0.005

function moneyEquals(a, b, epsilon = MONEY_EPSILON) {
  return Math.abs((a || 0) - (b || 0)) < epsilon
}

/**
 * Tolerance for the stock reconciliation identity
 * (opening + purchases − closing ≈ COGS + shrinkage + expiry).
 *
 * A flat cash figure is wrong at both ends: too tight for a busy shop, and
 * meaninglessly loose for a quiet one. Scale with turnover, with a floor so a
 * near-zero month does not flag on rounding alone.
 */
function reconciliationTolerance(cogs) {
  return Math.max(1, Math.abs(cogs || 0) * 0.005)
}

/**
 * Percentage change, as a ratio (0.14 = +14%).
 *
 * Returns null when there is no baseline to grow from. A shop whose first month
 * of drinks sales is $400 has not grown "infinitely" — the comparison simply
 * does not exist, and the report must say so rather than print ∞ or a
 * meaningless 100%.
 */
function pctChange(current, previous) {
  if (previous == null || current == null) return null
  if (previous === 0) return null
  return (current - previous) / Math.abs(previous)
}

/** Safe ratio — null rather than NaN/Infinity when the denominator is empty. */
function ratio(numerator, denominator) {
  if (!denominator) return null
  if (numerator == null) return null
  return numerator / denominator
}

module.exports = {
  toCents,
  fromCents,
  sumMoney,
  roundMoney,
  moneyEquals,
  MONEY_EPSILON,
  reconciliationTolerance,
  pctChange,
  ratio,
}
