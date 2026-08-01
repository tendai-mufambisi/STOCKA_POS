// Renderer-side mirror of electron/analytics/sql/paymentClassifier.js.
//
// The engine's classifier is CommonJS in the main process and cannot be
// imported by Vite, so the JS half is restated here. The two must agree, and
// tests/analytics/paymentClassifier.test.js asserts they do — if one is edited
// without the other, that test fails.
//
// The rule this fixes: Reports.jsx used to count a 'USD' sale as CASH while the
// drawer reconciliation counted it as NON-DRAWER, so the same day's cash figure
// differed depending on which screen the owner opened. The drawer wins, because
// that is the number physically counted and signed off each evening.
//
// 'USD' is not drawer cash because the schema migration folds two different
// things into it:
//   UPDATE sales SET payment_method='USD' WHERE payment_method IN ('USD Cash','Swipe')
// so a stored 'USD' may have been a swipe.

export const NON_DRAWER_METHODS = ['Transfer', 'Swipe', 'EcoCash', 'USD']
export const SPLIT_METHOD = 'Split'

/**
 * Bucket a payment_method value: 'cash' | 'electronic' | 'split'.
 * NULL/'' resolves to 'cash' — the column default is 'Cash' and the migration
 * rewrites unrecognised legacy values to 'Cash'.
 */
export function classifyTender(paymentMethod) {
  if (!paymentMethod) return 'cash'
  const m = String(paymentMethod).trim()
  if (m === SPLIT_METHOD) return 'split'
  if (NON_DRAWER_METHODS.includes(m)) return 'electronic'
  return 'cash'
}

/** Portion of a sale that reached the cash drawer. */
export function drawerAmountOf(sale) {
  const bucket = classifyTender(sale?.payment_method)
  if (bucket === 'cash') return sale?.total || 0
  if (bucket === 'split') return sale?.cash_amount || 0
  return 0
}

/** Portion of a sale that bypassed the drawer. */
export function nonDrawerAmountOf(sale) {
  const bucket = classifyTender(sale?.payment_method)
  if (bucket === 'electronic') return sale?.total || 0
  if (bucket === 'split') return sale?.usd_amount || 0
  return 0
}

/**
 * Tender breakdown for a set of sales.
 *
 * Splits are reported by their component amounts rather than by total, so the
 * buckets sum to revenue instead of double-counting or hiding the split.
 */
export function tenderBreakdown(sales) {
  let cash = 0
  let electronic = 0
  let split = 0
  for (const s of sales || []) {
    const bucket = classifyTender(s.payment_method)
    if (bucket === 'cash') cash += s.total || 0
    else if (bucket === 'electronic') electronic += s.total || 0
    else {
      split += s.total || 0
      cash += s.cash_amount || 0
      electronic += s.usd_amount || 0
    }
  }
  return {
    cash: round2(cash),
    electronic: round2(electronic),
    split: round2(split),
  }
}

function round2(n) {
  return Math.round(n * 100) / 100
}
