import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { freshDb, disposeDb, electronModule, getDb } from '../helpers/db.js'
import { stockedProduct, sell, addExpense, todayStr } from '../helpers/seed.js'

const analytics = electronModule('analytics/index.js')

// The accounting identities. These are the tests that decide whether the engine
// can be trusted, and they are asserted to the cent — not "approximately".

let day
beforeEach(() => {
  freshDb()
  day = todayStr()
})
afterAll(disposeDb)

const period = () => ({ type: 'day', date: day })
const compute = (ids) => analytics.computeMetrics(ids, period()).metrics
const val = (m, id) => m[id].value

function seedTypicalDay() {
  const coke = stockedProduct({ name: 'Coke', category: 'Drinks', cost: 2, price: 5 })
  const bread = stockedProduct({ name: 'Bread', category: 'Food', cost: 1, price: 3 })
  const soap = stockedProduct({ name: 'Soap', category: 'Non-Food', cost: 4, price: 9 })

  sell({ lines: [{ productId: coke, name: 'Coke', qty: 4, cost: 2, price: 5 }] })
  sell({ lines: [{ productId: bread, name: 'Bread', qty: 3, cost: 1, price: 3 }], paymentMethod: 'EcoCash' })
  sell({
    lines: [
      { productId: soap, name: 'Soap', qty: 2, cost: 4, price: 9 },
      { productId: coke, name: 'Coke', qty: 1, cost: 2, price: 5 },
    ],
    paymentMethod: 'Split',
  })
  addExpense({ amount: 12.5, date: day })
  return { coke, bread, soap }
}

describe('accounting identities', () => {
  it('gross profit === net sales − COGS, to the cent', () => {
    seedTypicalDay()
    const m = compute(['sales.net', 'cogs.total', 'profit.gross'])
    expect(val(m, 'profit.gross')).toBeCloseTo(val(m, 'sales.net') - val(m, 'cogs.total'), 10)
  })

  it('net profit === gross profit − expenses', () => {
    seedTypicalDay()
    const m = compute(['profit.gross', 'expenses.total', 'profit.net'])
    expect(val(m, 'profit.net')).toBeCloseTo(val(m, 'profit.gross') - val(m, 'expenses.total'), 10)
  })

  it('gross sales === the sum of every sale_item subtotal', () => {
    seedTypicalDay()
    const m = compute(['sales.gross'])
    const fromItems = getDb()
      .prepare(
        `SELECT COALESCE(SUM(si.subtotal),0) FROM sale_items si
           JOIN sales s ON s.id = si.sale_id WHERE s.status='completed'`
      )
      .pluck()
      .get()
    expect(val(m, 'sales.gross')).toBeCloseTo(fromItems, 10)
  })

  describe('breakdown closure', () => {
    // A breakdown that does not sum to its total is either double-counting or
    // silently dropping rows — usually a NULL bucket. One helper, every axis.
    const closes = (rows, pick, total) =>
      expect(rows.reduce((n, r) => n + (pick(r) || 0), 0)).toBeCloseTo(total, 6)

    it('sales by day sums to gross sales', () => {
      seedTypicalDay()
      const m = compute(['sales.byDay', 'sales.gross'])
      closes(val(m, 'sales.byDay'), (r) => r.y, val(m, 'sales.gross'))
    })

    it('sales by hour sums to gross sales', () => {
      seedTypicalDay()
      const m = compute(['sales.byHour', 'sales.gross'])
      closes(val(m, 'sales.byHour'), (r) => r.y, val(m, 'sales.gross'))
    })

    it('sales by weekday sums to gross sales', () => {
      seedTypicalDay()
      const m = compute(['sales.byWeekday', 'sales.gross'])
      closes(val(m, 'sales.byWeekday'), (r) => r.y, val(m, 'sales.gross'))
    })

    it('COGS by category sums to total COGS', () => {
      seedTypicalDay()
      const m = compute(['cogs.byCategory', 'cogs.total'])
      closes(val(m, 'cogs.byCategory'), (r) => r.cogs, val(m, 'cogs.total'))
    })

    it('profit by product sums to gross profit', () => {
      seedTypicalDay()
      const m = compute(['cogs.byProduct', 'profit.gross'])
      closes(val(m, 'cogs.byProduct'), (r) => r.profit, val(m, 'profit.gross'))
    })

    it('staff breakdown sums to gross sales', () => {
      seedTypicalDay()
      const m = compute(['staff.byCashier', 'sales.gross'])
      closes(val(m, 'staff.byCashier'), (r) => r.revenue, val(m, 'sales.gross'))
    })

    it('expenses by category sums to total expenses', () => {
      seedTypicalDay()
      addExpense({ description: 'Fuel', amount: 7, category: 'Transport', date: day })
      addExpense({ description: 'Odd', amount: 3, category: '', date: day })
      const m = compute(['expenses.byCategory', 'expenses.total'])
      closes(val(m, 'expenses.byCategory'), (r) => r.value, val(m, 'expenses.total'))
    })

    it('tender breakdown parts reconcile to revenue without double-counting splits', () => {
      seedTypicalDay()
      const m = compute(['sales.byTender', 'sales.gross'])
      const rows = val(m, 'sales.byTender')
      // Drawer + non-drawer across all buckets must equal revenue: a split sale
      // contributes its cash_amount to one side and usd_amount to the other,
      // never its full total to both.
      const reconciled = rows.reduce((n, r) => n + r.drawer + r.nonDrawer, 0)
      expect(reconciled).toBeCloseTo(val(m, 'sales.gross'), 6)
    })

    it('keeps NULL categories as a bucket rather than dropping them', () => {
      const ghost = stockedProduct({ name: 'Ghost', cost: 1, price: 4 })
      getDb().prepare('UPDATE products SET category = NULL WHERE id = ?').run(ghost)
      sell({ lines: [{ productId: ghost, name: 'Ghost', qty: 2, cost: 1, price: 4 }] })

      const m = compute(['cogs.byCategory', 'cogs.total'])
      const rows = val(m, 'cogs.byCategory')
      expect(rows.some((r) => r.key === 'Uncategorised')).toBe(true)
      closes(rows, (r) => r.cogs, val(m, 'cogs.total'))
    })
  })

  describe('voids', () => {
    it('excludes voided sales from revenue and COGS together', () => {
      const { coke } = seedTypicalDay()
      const before = compute(['sales.net', 'cogs.total', 'profit.gross'])

      const saleId = sell({ lines: [{ productId: coke, name: 'Coke', qty: 10, cost: 2, price: 5 }] })
      const withSale = compute(['sales.net', 'cogs.total'])
      expect(val(withSale, 'sales.net')).toBeCloseTo(val(before, 'sales.net') + 50, 6)

      electronModule('database/domains/sales.js').voidSale(saleId, 'mistake', 'jane')

      const after = compute(['sales.net', 'cogs.total', 'profit.gross'])
      // Voided sale_items rows still exist, so a COGS query that forgets
      // status='completed' would leave the cost behind and destroy the margin.
      expect(val(after, 'sales.net')).toBeCloseTo(val(before, 'sales.net'), 6)
      expect(val(after, 'cogs.total')).toBeCloseTo(val(before, 'cogs.total'), 6)
      expect(val(after, 'profit.gross')).toBeCloseTo(val(before, 'profit.gross'), 6)
    })

    it('reports voids as their own figure, never as returns', () => {
      const { coke } = seedTypicalDay()
      const saleId = sell({ lines: [{ productId: coke, name: 'Coke', qty: 2, cost: 2, price: 5 }] })
      electronModule('database/domains/sales.js').voidSale(saleId, 'mistake', 'jane')

      const m = compute(['sales.voidedValue', 'sales.voidedCount'])
      expect(val(m, 'sales.voidedValue')).toBeCloseTo(10, 6)
      expect(val(m, 'sales.voidedCount')).toBe(1)
    })
  })

  describe('the zero-cost defect', () => {
    it('flags a never-received product instead of reporting 100% margin', () => {
      // The exact shape of Stocka's live data: sold, but no cost ever recorded.
      const orphan = stockedProduct({ name: 'Orphan', cost: 3, price: 10 })
      getDb().prepare('DELETE FROM stock_receivings WHERE product_id = ?').run(orphan)
      sell({ lines: [{ productId: orphan, name: 'Orphan', qty: 5, cost: 0, price: 10 }] })

      const m = compute([
        'cogs.zeroCostLines', 'cogs.zeroCostExposure', 'cogs.coverage', 'cogs.byProduct',
      ])
      expect(val(m, 'cogs.zeroCostLines')).toBe(1)
      expect(val(m, 'cogs.zeroCostExposure')).toBeCloseTo(50, 6)
      expect(val(m, 'cogs.coverage')).toBeCloseTo(0, 6)

      // The product row withholds margin rather than claiming 100%.
      const row = val(m, 'cogs.byProduct').find((r) => r.label === 'Orphan')
      expect(row.margin).toBeNull()
      expect(row.costKnown).toBe(false)
    })

    it('scales the confidence penalty with the exposure, not a flat constant', () => {
      // Set up one costed product and one with no cost on record, then vary how
      // much revenue flows through the uncosted one. A flat penalty would score
      // both scenarios identically; a proportional one must not.
      const scoreWithBadRevenue = (badQty) => {
        freshDb()
        const good = stockedProduct({ name: 'Good', cost: 2, price: 5 })
        const bad = stockedProduct({ name: 'Bad', cost: 3, price: 5 })
        getDb().prepare('DELETE FROM stock_receivings WHERE product_id = ?').run(bad)
        sell({ lines: [{ productId: good, name: 'Good', qty: 20, cost: 2, price: 5 }] })
        sell({ lines: [{ productId: bad, name: 'Bad', qty: badQty, cost: 0, price: 5 }] })
        return analytics.computeMetrics(['profit.grossMargin'], period()).quality.score
      }

      const small = scoreWithBadRevenue(1) // ~5% of revenue uncosted
      const large = scoreWithBadRevenue(80) // ~80% of revenue uncosted
      expect(large).toBeLessThan(small)
      expect(small).toBeLessThan(1)
    })

    it('marks a report low-confidence and says why when cost is missing', () => {
      const good = stockedProduct({ name: 'Good', cost: 2, price: 5 })
      const bad = stockedProduct({ name: 'Bad', cost: 3, price: 5 })
      getDb().prepare('DELETE FROM stock_receivings WHERE product_id = ?').run(bad)
      sell({ lines: [{ productId: good, name: 'Good', qty: 1, cost: 2, price: 5 }] })
      sell({ lines: [{ productId: bad, name: 'Bad', qty: 1, cost: 0, price: 5 }] })

      const res = analytics.computeMetrics(['profit.grossMargin'], period())
      expect(res.quality.confidence).toBe('low')
      // The margin figure itself carries the reason, so a renderer cannot show
      // the number without access to the caveat.
      expect(res.metrics['profit.grossMargin'].notes.join(' ')).toMatch(/no cost price/i)
      expect(res.quality.warnings.map((w) => w.id)).toContain('saleItems.zeroCost')
    })
  })

  describe('empty periods', () => {
    it('reports an average basket of nothing as unavailable, not 0.00', () => {
      const m = compute(['sales.averageBasket', 'sales.transactionCount'])
      expect(val(m, 'sales.transactionCount')).toBe(0) // a real, true zero
      expect(m['sales.averageBasket'].value).toBeNull() // not a claim of $0.00
      expect(m['sales.averageBasket'].unavailable).toBeTruthy()
    })

    it('reports margin on no sales as unavailable', () => {
      const m = compute(['profit.grossMargin'])
      expect(m['profit.grossMargin'].value).toBeNull()
    })
  })

  it('never lets an unavailable dependency become a zero', () => {
    // profit.net depends on profit.gross; with no sales there is no margin, and
    // a naive implementation would report profit.net as -expenses.
    addExpense({ amount: 40, date: day })
    const m = compute(['profit.grossMargin', 'profit.netMargin'])
    expect(m['profit.netMargin'].unavailable?.code).toBeTruthy()
  })
})
