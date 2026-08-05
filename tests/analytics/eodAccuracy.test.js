import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { freshDb, disposeDb, electronModule, domain, getDb } from '../helpers/db.js'
import { stockedProduct, sell, addExpense, todayStr } from '../helpers/seed.js'

const analytics = electronModule('analytics/index.js')
const shifts = domain('shifts')
const sales = domain('sales')

// THE ACCURACY GATE.
//
// End of Day is the one place in Stocka where the numbers are already trusted:
// a human counts the cash against them and signs the day off. If the analytics
// engine cannot reproduce those figures, it has no business producing a monthly
// report — so this suite is what earns the right to build one.
//
// It also pins the freeze contract. getShiftSummary locks a closed shift's
// expected cash to `closing_cash − variance` rather than recomputing it, so that
// a void entered next week cannot rewrite last Tuesday's variance. The engine
// must respect that, not quietly disagree with the paper.

let day
beforeEach(() => {
  freshDb()
  day = todayStr()
})
afterAll(disposeDb)

const period = () => ({ type: 'day', date: day })
const compute = (ids) => analytics.computeMetrics(ids, period()).metrics

/** A full trading day: one shift, mixed tenders, an expense, then cashed up. */
function tradeAndCloseDay({ openingCash = 50, countedCash = null } = {}) {
  // startShift returns the shift ROW, not an id.
  const shiftId = shifts.startShift({ username: 'jane', display_name: 'Jane' }, openingCash, null).id

  const coke = stockedProduct({ name: 'Coke', category: 'Drinks', cost: 2, price: 5 })
  const bread = stockedProduct({ name: 'Bread', category: 'Food', cost: 1, price: 3 })

  sell({ lines: [{ productId: coke, name: 'Coke', qty: 4, cost: 2, price: 5 }], shiftId })
  sell({ lines: [{ productId: bread, name: 'Bread', qty: 5, cost: 1, price: 3 }], shiftId })
  sell({
    lines: [{ productId: coke, name: 'Coke', qty: 2, cost: 2, price: 5 }],
    paymentMethod: 'EcoCash',
    shiftId,
  })
  sell({
    lines: [{ productId: bread, name: 'Bread', qty: 10, cost: 1, price: 3 }],
    paymentMethod: 'Split',
    shiftId,
  })

  addExpense({ amount: 8, date: day, shiftId, paymentMethod: 'Cash' })

  const summaryBeforeClose = shifts.getShiftSummary(shiftId)
  const counted = countedCash == null ? summaryBeforeClose.expected_cash : countedCash
  shifts.closeShift(
    shiftId,
    { closing_cash: counted, closing_transfer: summaryBeforeClose.expected_transfer },
    'end of day'
  )

  return { shiftId, summaryBeforeClose, counted }
}

describe('End of Day accuracy gate', () => {
  it('reproduces the shift summary figures the day was signed off against', () => {
    const { shiftId } = tradeAndCloseDay()
    const summary = shifts.getShiftSummary(shiftId)

    const m = compute([
      'sales.gross', 'sales.transactionCount', 'sales.drawerTake',
      'sales.electronicTake', 'expenses.cash',
    ])

    // These are the figures End of Day prints and the cash is counted against.
    expect(m['sales.gross'].value).toBeCloseTo(summary.total_sales, 6)
    expect(m['sales.transactionCount'].value).toBe(summary.sales_count)
    expect(m['sales.drawerTake'].value).toBeCloseTo(summary.cash_sales, 6)
    expect(m['sales.electronicTake'].value).toBeCloseTo(summary.transfer_sales, 6)
    expect(m['expenses.cash'].value).toBeCloseTo(summary.cash_expenses, 6)
  })

  it('reproduces the drawer arithmetic: expected = float + cash sales − cash expenses', () => {
    const { shiftId } = tradeAndCloseDay()
    const summary = shifts.getShiftSummary(shiftId)

    const m = compute(['cash.openingFloats', 'sales.drawerTake', 'expenses.cash', 'cash.expectedAtClose'])
    const derived =
      m['cash.openingFloats'].value + m['sales.drawerTake'].value - m['expenses.cash'].value

    expect(derived).toBeCloseTo(summary.expected_cash, 6)
    expect(m['cash.expectedAtClose'].value).toBeCloseTo(summary.expected_cash, 6)
  })

  it('satisfies variance === counted − expected for every closed shift', () => {
    tradeAndCloseDay({ countedCash: 100 })
    const m = compute(['cash.countedAtClose', 'cash.variance', 'cash.expectedAtClose'])
    expect(m['cash.variance'].value).toBeCloseTo(
      m['cash.countedAtClose'].value - m['cash.expectedAtClose'].value,
      6
    )
  })

  describe('the freeze contract', () => {
    it('does not let a later void rewrite a signed-off drawer', () => {
      const { shiftId } = tradeAndCloseDay()
      const before = shifts.getShiftSummary(shiftId)
      const beforeMetrics = compute(['cash.expectedAtClose', 'cash.variance'])

      // A void entered after the day was closed and the cash counted.
      const anySale = getDb()
        .prepare(`SELECT id FROM sales WHERE shift_id = ? AND status='completed' LIMIT 1`)
        .pluck()
        .get(shiftId)
      sales.voidSale(anySale, 'entered in error', 'admin')

      const after = shifts.getShiftSummary(shiftId)
      const afterMetrics = compute(['cash.expectedAtClose', 'cash.variance'])

      // The shift's signed-off figures are unchanged...
      expect(after.expected_cash).toBeCloseTo(before.expected_cash, 6)
      expect(after.cash_variance).toBeCloseTo(before.cash_variance, 6)
      // ...and so are the engine's, because it reads the stored columns rather
      // than recomputing from live sales.
      expect(afterMetrics['cash.expectedAtClose'].value).toBeCloseTo(
        beforeMetrics['cash.expectedAtClose'].value, 6
      )
      expect(afterMetrics['cash.variance'].value).toBeCloseTo(
        beforeMetrics['cash.variance'].value, 6
      )
    })

    it('still moves live revenue when a void lands, so the divergence is visible', () => {
      // The other half of the contract: the drawer is frozen, but revenue is
      // not. A report must be able to show that the day's takings changed after
      // sign-off rather than pretending nothing happened.
      const { shiftId } = tradeAndCloseDay()
      const before = compute(['sales.gross'])
      const anySale = getDb()
        .prepare(`SELECT id, total FROM sales WHERE shift_id = ? AND status='completed' LIMIT 1`)
        .get(shiftId)
      sales.voidSale(anySale.id, 'entered in error', 'admin')

      const after = compute(['sales.gross', 'sales.voidedValue'])
      expect(after['sales.gross'].value).toBeCloseTo(before['sales.gross'].value - anySale.total, 6)
      expect(after['sales.voidedValue'].value).toBeCloseTo(anySale.total, 6)
    })
  })

  describe('honesty about unverified drawers', () => {
    it('counts a drawer nobody verified rather than reporting it as balanced', () => {
      const { shiftId } = tradeAndCloseDay()
      getDb()
        .prepare(`UPDATE shifts SET reconciliation_status = 'unreconciled' WHERE id = ?`)
        .run(shiftId)

      const res = analytics.computeMetrics(['cash.unverifiedShiftCount', 'cash.varianceByShift'], period())
      expect(res.metrics['cash.unverifiedShiftCount'].value).toBe(1)
      expect(res.metrics['cash.varianceByShift'].value[0].verified).toBe(false)
      expect(res.quality.warnings.map((w) => w.id)).toContain('shifts.unreconciled')
    })

    it('flags a still-open shift as provisional', () => {
      shifts.startShift({ username: 'sam', display_name: 'Sam' }, 20, null)
      // eslint-disable-next-line no-unused-expressions
      const res = analytics.computeMetrics(['cash.shiftCount'], period())
      expect(res.quality.warnings.map((w) => w.id)).toContain('shifts.stillOpen')
    })
  })

  it('flags a trading day that was never signed off', () => {
    const coke = stockedProduct({ name: 'Coke', cost: 2, price: 5 })
    sell({ lines: [{ productId: coke, name: 'Coke', qty: 1, cost: 2, price: 5 }] })

    const res = analytics.computeMetrics(['sales.gross'], period())
    expect(res.quality.notes.map((n) => n.id)).toContain('eod.missingDays')
  })

  it('is deterministic — the same period computed twice gives identical figures', () => {
    tradeAndCloseDay()
    const ids = ['sales.gross', 'cogs.total', 'profit.gross', 'cash.expectedAtClose']
    const a = compute(ids)
    const b = compute(ids)
    for (const id of ids) expect(a[id].value).toBe(b[id].value)
  })
})
