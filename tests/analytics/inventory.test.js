import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { freshDb, disposeDb, electronModule, domain, getDb } from '../helpers/db.js'
import { stockedProduct, sell, todayStr } from '../helpers/seed.js'

const analytics = electronModule('analytics/index.js')
const ledger = electronModule('analytics/sql/inventoryLedger.js')
const { costResolverFor } = electronModule('analytics/sql/costResolver.js')
const { addDays } = electronModule('analytics/kernel/time.js')
const stock = domain('stock')

// Historical inventory is the hardest claim the engine makes: the database
// stores only a live quantity, so "what was on the shelves on 30 June" has to
// be reconstructed. These tests are what make that a checked claim rather than
// an assumption.

let day
beforeEach(() => {
  freshDb()
  day = todayStr()
})
afterAll(disposeDb)

const qtyNow = (id) => getDb().prepare('SELECT current_quantity FROM products WHERE id = ?').pluck().get(id)

describe('inventory ledger', () => {
  describe('reconstruction', () => {
    it('rolls today back to itself exactly', () => {
      // The integrity property. If this fails, some code path changes stock
      // without logging a movement and every historical figure is suspect.
      const coke = stockedProduct({ name: 'Coke', cost: 2, price: 5, units: 100 })
      sell({ lines: [{ productId: coke, name: 'Coke', qty: 7, cost: 2, price: 5 }] })

      const res = ledger.rollbackResidual(getDb(), day)
      expect(res.passed).toBe(true)
      expect(res.mismatches).toEqual([])

      const asOfToday = ledger.quantitiesAsOf(getDb(), day)
      expect(asOfToday.get(coke).qty).toBe(qtyNow(coke))
    })

    it('reconstructs the quantity before today\'s trading', () => {
      const coke = stockedProduct({ name: 'Coke', cost: 2, price: 5, units: 100 })
      sell({ lines: [{ productId: coke, name: 'Coke', qty: 30, cost: 2, price: 5 }] })
      expect(qtyNow(coke)).toBe(70)

      // Yesterday: the receiving and the sale both happened today, so rolling
      // back past both leaves nothing.
      const yesterday = ledger.quantitiesAsOf(getDb(), addDays(day, -1))
      expect(yesterday.get(coke).qty).toBe(0)
    })

    it('handles the mixed sign conventions correctly', () => {
      // SOLD is stored positive though stock went down; EXPIRED_DISCARD is
      // stored negative; ADJUSTMENT is genuinely signed. A naive SUM(quantity)
      // produces a plausible, wrong answer here.
      const p = stockedProduct({ name: 'Milk', cost: 1, price: 3, units: 50 })
      sell({ lines: [{ productId: p, name: 'Milk', qty: 10, cost: 1, price: 3 }] })
      stock.reconcileProduct(p, 35, 'stock count', 'tester')

      const live = qtyNow(p)
      const res = ledger.rollbackResidual(getDb(), day)
      expect(res.passed).toBe(true)
      expect(ledger.quantitiesAsOf(getDb(), day).get(p).qty).toBe(live)
    })

    it('detects stock changed without a movement row', () => {
      const p = stockedProduct({ name: 'Rice', cost: 2, price: 5, units: 40 })
      // Exactly the bug the check exists to catch: quantity edited directly.
      getDb().prepare('UPDATE products SET current_quantity = 999 WHERE id = ?').run(p)

      const asOf = ledger.quantitiesAsOf(getDb(), addDays(day, -1))
      // Reconstruction now disagrees with reality — 999 minus the 40 received
      // today, rather than the 0 that was really there yesterday.
      expect(asOf.get(p).qty).not.toBe(0)
    })
  })

  describe('valuation', () => {
    it('values the shelves at the cost that applied', () => {
      const a = stockedProduct({ name: 'A', cost: 2, price: 5, units: 10 })
      const b = stockedProduct({ name: 'B', cost: 3, price: 7, units: 5 })

      const v = ledger.valuationAsOf(getDb(), day, costResolverFor(getDb()))
      expect(v.total).toBeCloseTo(10 * 2 + 5 * 3, 6)
      expect(v.unitsValued).toBe(15)
      expect(a && b).toBeTruthy()
    })

    it('names products with no cost instead of valuing them at zero', () => {
      const known = stockedProduct({ name: 'Known', cost: 2, price: 5, units: 10 })
      const unknown = stockedProduct({ name: 'Unknown', cost: 4, price: 9, units: 8 })
      getDb().prepare('DELETE FROM stock_receivings WHERE product_id = ?').run(unknown)

      const v = ledger.valuationAsOf(getDb(), day, costResolverFor(getDb()))
      expect(v.total).toBeCloseTo(20, 6) // only the costed product
      expect(v.unitsUnvalued).toBe(8)
      expect(v.productsWithoutCost.map((p) => p.name)).toContain('Unknown')
      expect(known).toBeTruthy()
    })
  })
})

describe('inventory metrics', () => {
  const period = () => ({ type: 'day', date: day })
  const compute = (ids) => analytics.computeMetrics(ids, period()).metrics

  it('reports value at cost and at retail as different, named figures', () => {
    stockedProduct({ name: 'Coke', cost: 2, price: 5, units: 10 })

    const m = compute(['inventory.valueAtCost', 'inventory.valueAtRetail'])
    expect(m['inventory.valueAtCost'].value).toBeCloseTo(20, 6)
    expect(m['inventory.valueAtRetail'].value).toBeCloseTo(50, 6)
    // The old bug was calling both of these "stock value".
    expect(m['inventory.valueAtCost'].label).toMatch(/at cost/i)
    expect(m['inventory.valueAtRetail'].label).toMatch(/at retail/i)
  })

  describe('the reconciliation identity', () => {
    it('balances: opening + purchases − closing === COGS + write-offs', () => {
      const coke = stockedProduct({ name: 'Coke', cost: 2, price: 5, units: 100 })
      sell({ lines: [{ productId: coke, name: 'Coke', qty: 20, cost: 2, price: 5 }] })

      const m = compute([
        'inventory.openingValue', 'inventory.purchases', 'inventory.closingValue',
        'cogs.total', 'inventory.expiryWriteOff', 'inventory.adjustments',
        'inventory.stockReconciliationResidual', 'inventory.reconciles',
      ])

      // opening 0 + purchases 200 − closing 160 = 40 = COGS
      expect(m['inventory.openingValue'].value).toBeCloseTo(0, 6)
      expect(m['inventory.purchases'].value).toBeCloseTo(200, 6)
      expect(m['inventory.closingValue'].value).toBeCloseTo(160, 6)
      expect(m['cogs.total'].value).toBeCloseTo(40, 6)
      expect(m['inventory.stockReconciliationResidual'].value).toBeCloseTo(0, 6)
      expect(m['inventory.reconciles'].value.reconciles).toBe(true)
    })

    it('accounts for expired stock written off', () => {
      const p = stockedProduct({
        name: 'Yoghurt', cost: 2, price: 5, units: 50, expiryDate: '2026-07-20',
      })
      sell({ lines: [{ productId: p, name: 'Yoghurt', qty: 10, cost: 2, price: 5 }] })
      // Those 5 units left the shelves without being sold. The identity must
      // absorb them, not report them as unexplained shrinkage.
      stock.discardExpiredBatch(p, '2026-07-20', 5, 'tester')

      const m = compute([
        'inventory.expiryWriteOff', 'inventory.stockReconciliationResidual', 'inventory.reconciles',
      ])
      expect(m['inventory.expiryWriteOff'].value).toBeCloseTo(10, 6)
      expect(m['inventory.reconciles'].value.reconciles).toBe(true)
    })

    it('scales its tolerance with turnover rather than using a flat figure', () => {
      const quiet = stockedProduct({ name: 'Quiet', cost: 2, price: 5, units: 20 })
      sell({ lines: [{ productId: quiet, name: 'Quiet', qty: 5, cost: 2, price: 5 }] })
      const smallTolerance = compute(['inventory.reconciles'])['inventory.reconciles'].value.tolerance

      freshDb()
      const busy = stockedProduct({ name: 'Busy', cost: 2, price: 5, units: 10000 })
      sell({ lines: [{ productId: busy, name: 'Busy', qty: 5000, cost: 2, price: 5 }] })
      const bigTolerance = compute(['inventory.reconciles'])['inventory.reconciles'].value.tolerance

      // A flat cash tolerance is too tight for a busy shop and meaningless for
      // a quiet one, so it scales with COGS.
      expect(bigTolerance).toBeGreaterThan(smallTolerance)
    })
  })

  it('computes turnover from average stock held', () => {
    const coke = stockedProduct({ name: 'Coke', cost: 2, price: 5, units: 100 })
    sell({ lines: [{ productId: coke, name: 'Coke', qty: 50, cost: 2, price: 5 }] })

    const m = compute(['inventory.turnover', 'cogs.total', 'inventory.openingValue', 'inventory.closingValue'])
    const avg = (m['inventory.openingValue'].value + m['inventory.closingValue'].value) / 2
    expect(m['inventory.turnover'].value).toBeCloseTo(m['cogs.total'].value / avg, 6)
  })

  it('withholds dead-stock capital when the cost is unknown', () => {
    const p = stockedProduct({ name: 'Polish', cost: 3, price: 8, units: 20 })
    getDb().prepare('DELETE FROM stock_receivings WHERE product_id = ?').run(p)
    getDb()
      .prepare("UPDATE products SET last_sold_date = date('now','-200 days') WHERE id = ?")
      .run(p)

    const m = compute(['inventory.deadStock', 'inventory.deadStockValue'])
    const row = m['inventory.deadStock'].value.find((r) => r.label === 'Polish')
    expect(row).toBeTruthy()
    // Reporting $0 of dead capital would make the worst case look like the best.
    expect(row.capitalTiedUp).toBeNull()
    expect(row.costKnown).toBe(false)
  })

  describe('when the movement ledger starts after the period', () => {
    // The engine cannot reconstruct a day that predates its own ledger: the
    // movements between that day and the ledger's first entry were never
    // recorded, so there is nothing to roll back through.
    const monthPeriod = { type: 'month', year: 2026, month: 7 }

    function seedLedgerStartingMidMonth() {
      const p = stockedProduct({ name: 'Coke', cost: 2, price: 5, units: 100 })
      sell({ lines: [{ productId: p, name: 'Coke', qty: 10, cost: 2, price: 5 }] })
      // Push every movement to mid-July, after the period opens on the 1st.
      getDb().prepare(`UPDATE stock_movements SET created_at = '2026-07-15 12:00:00'`).run()
      return p
    }

    it('withholds opening stock rather than reporting it as zero', () => {
      seedLedgerStartingMidMonth()
      const m = analytics.computeMetrics(['inventory.openingValue'], monthPeriod).metrics
      expect(m['inventory.openingValue'].value).toBeNull()
      expect(m['inventory.openingValue'].unavailable).toBeTruthy()
    })

    it('still reports closing stock, which sits inside the ledger', () => {
      seedLedgerStartingMidMonth()
      const m = analytics.computeMetrics(['inventory.closingValue'], monthPeriod).metrics
      // Blocking this too would withhold a figure the engine can actually prove.
      expect(m['inventory.closingValue'].value).toBeCloseTo(180, 6)
    })

    it('does not let the withheld opening figure leak into the residual', () => {
      // The bug this pins: the reconciliation residual subtracted an opening
      // stock the engine had just declared unknowable, and presented the
      // difference as shrinkage.
      seedLedgerStartingMidMonth()
      const m = analytics.computeMetrics(
        ['inventory.stockReconciliationResidual', 'inventory.reconciles'],
        monthPeriod
      ).metrics
      expect(m['inventory.stockReconciliationResidual'].value).toBeNull()
      expect(m['inventory.stockReconciliationResidual'].unavailable).toBeTruthy()
    })
  })

  it('raises a warning when stock cannot be reconstructed', () => {
    const p = stockedProduct({ name: 'Ghost', cost: 2, price: 5, units: 10 })
    getDb().prepare('UPDATE products SET current_quantity = 555 WHERE id = ?').run(p)
    // Force a movement after today so the rollback has something to disagree on.
    getDb()
      .prepare(
        `INSERT INTO stock_movements (product_id, product_name, movement_type, quantity, recorded_by, created_at)
         VALUES (?, 'Ghost', 'ADJUSTMENT', 5, 'tester', datetime('now','+2 days'))`
      )
      .run(p)

    const res = analytics.computeMetrics(['inventory.openingValue'], period())
    expect(res.quality.warnings.map((w) => w.id)).toContain('inventory.rollbackResidual')
  })
})
