import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { freshDb, disposeDb, electronModule, domain, getDb } from '../helpers/db.js'
import { stockedProduct, addProduct, receive, sell, todayStr } from '../helpers/seed.js'

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

    it('accounts for breakages recorded as stock losses', () => {
      const p = stockedProduct({ name: 'Coke', cost: 2, price: 5, units: 100 })
      sell({ lines: [{ productId: p, name: 'Coke', qty: 20, cost: 2, price: 5 }] })
      // The whole point of the feature: 5 units the shop KNOWS about must not
      // come back as unexplained shrinkage.
      stock.recordStockLoss({ product_id: p, quantity: 5, reason_code: 'BROKEN', recorded_by: 'tester' })

      const m = compute([
        'inventory.stockLossWriteOff', 'inventory.stockLossUnits',
        'inventory.stockReconciliationResidual', 'inventory.reconciles',
      ])
      expect(m['inventory.stockLossUnits'].value).toBe(5)
      expect(m['inventory.stockLossWriteOff'].value).toBeCloseTo(10, 6)
      expect(m['inventory.stockReconciliationResidual'].value).toBeCloseTo(0, 6)
      expect(m['inventory.reconciles'].value.reconciles).toBe(true)
    })

    it('nets a reversed loss back out of the period that recorded it', () => {
      const p = stockedProduct({ name: 'Coke', cost: 2, price: 5, units: 100 })
      const loss = stock.recordStockLoss({ product_id: p, quantity: 8, reason_code: 'DAMAGED', recorded_by: 'tester' })
      stock.reverseStockLoss(loss.id, 'wrong product', 'tester')

      // Both halves fall in the same period here, so the write-off nets to zero
      // rather than being counted twice. SUM(ABS(...)) would report 16 units lost.
      const m = compute(['inventory.stockLossUnits', 'inventory.stockLossWriteOff', 'inventory.reconciles'])
      expect(m['inventory.stockLossUnits'].value).toBe(0)
      expect(m['inventory.stockLossWriteOff'].value).toBeCloseTo(0, 6)
      expect(m['inventory.reconciles'].value.reconciles).toBe(true)
      expect(qtyNow(p)).toBe(100)
    })

    it('keeps breakages and expiry write-offs as separate terms', () => {
      const p = stockedProduct({
        name: 'Yoghurt', cost: 2, price: 5, units: 50, expiryDate: '2026-07-20',
      })
      stock.discardExpiredBatch(p, '2026-07-20', 4, 'tester')
      stock.recordStockLoss({ product_id: p, quantity: 3, reason_code: 'SPILLED', recorded_by: 'tester' })

      // Neither term may absorb the other's units, or the identity balances by
      // double-counting one and ignoring the other.
      const m = compute([
        'inventory.expiryWriteOff', 'inventory.stockLossWriteOff', 'inventory.reconciles',
      ])
      expect(m['inventory.expiryWriteOff'].value).toBeCloseTo(8, 6)
      expect(m['inventory.stockLossWriteOff'].value).toBeCloseTo(6, 6)
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

  describe('recording a stock loss', () => {
    it('leaves the ledger reconstructable', () => {
      // A write path that moves stock without a matching movement row is exactly
      // what rollbackResidual exists to catch. This is that check, for the new path.
      const p = stockedProduct({ name: 'Coke', cost: 2, price: 5, units: 40 })
      stock.recordStockLoss({ product_id: p, quantity: 6, reason_code: 'BROKEN', recorded_by: 'tester' })

      expect(qtyNow(p)).toBe(34)
      expect(ledger.rollbackResidual(getDb(), todayStr()).passed).toBe(true)
    })

    it('is not a movement type the engine has to guess at', () => {
      // An unregistered type contributes 0 to every historical figure and trips
      // movements.unknownType, downgrading confidence on reports that never
      // mentioned breakages.
      const p = stockedProduct({ name: 'Coke', cost: 2, price: 5, units: 40 })
      stock.recordStockLoss({ product_id: p, quantity: 6, reason_code: 'BROKEN', recorded_by: 'tester' })

      const { findUnknownTypes } = electronModule('analytics/sql/movementSign.js')
      expect(findUnknownTypes(getDb()).map((r) => r.movement_type)).not.toContain('STOCK_LOSS')
    })

    it('refuses to write off more units than are in stock', () => {
      const p = stockedProduct({ name: 'Coke', cost: 2, price: 5, units: 3 })
      expect(() =>
        stock.recordStockLoss({ product_id: p, quantity: 5, reason_code: 'BROKEN', recorded_by: 'tester' })
      ).toThrow(/only 3 in stock/i)
      // The refusal must be total — a partial write-off would silently disagree
      // with the number the operator was told they were recording.
      expect(qtyNow(p)).toBe(3)
    })

    it('rejects a reason it cannot report on', () => {
      const p = stockedProduct({ name: 'Coke', cost: 2, price: 5, units: 10 })
      expect(() =>
        stock.recordStockLoss({ product_id: p, quantity: 1, reason_code: 'ATE_IT', recorded_by: 'tester' })
      ).toThrow(/not a valid loss reason/i)
      // EXPIRED belongs to discardExpiredBatch, which also clears the batch from
      // expiry tracking. Accepting it here would create a second write path.
      expect(() =>
        stock.recordStockLoss({ product_id: p, quantity: 1, reason_code: 'EXPIRED', recorded_by: 'tester' })
      ).toThrow(/not a valid loss reason/i)
    })

    it('freezes the cost at the time of the loss', () => {
      // costResolver returns the LATEST cost. Resolving at report time would let
      // a delivery booked next week silently revalue a write-off already made.
      const p = stockedProduct({ name: 'Coke', cost: 2, price: 5, units: 40 })
      const loss = stock.recordStockLoss({ product_id: p, quantity: 5, reason_code: 'BROKEN', recorded_by: 'tester' })
      expect(loss.unit_cost_at_loss).toBeCloseTo(2, 6)

      receive(p, { units: 100, costPerUnit: 9, dateReceived: todayStr() })

      const m = analytics.computeMetrics(['inventory.stockLossWriteOff'], period()).metrics
      expect(m['inventory.stockLossWriteOff'].value).toBeCloseTo(10, 6) // 5 × 2, not 5 × 9
    })

    it('corrects a mistake by reversal, never by deletion', () => {
      const p = stockedProduct({ name: 'Coke', cost: 2, price: 5, units: 40 })
      const loss = stock.recordStockLoss({ product_id: p, quantity: 5, reason_code: 'BROKEN', recorded_by: 'tester' })
      stock.reverseStockLoss(loss.id, 'wrong product', 'manager')

      expect(qtyNow(p)).toBe(40)
      // The original stays on the record, marked — a shop owner needs to see
      // that units were written off and put back, not a tidy history.
      const rows = stock.getStockLosses({})
      expect(rows).toHaveLength(1)
      expect(rows[0].id).toBe(loss.id)
      expect(rows[0].reversed).toBe(true)
      expect(rows[0].reversed_by).toBe('manager')

      expect(() => stock.reverseStockLoss(loss.id, 'again', 'manager')).toThrow(/already been reversed/i)
    })

    it('shows expiry write-offs alongside breakages without merging them', () => {
      const p = stockedProduct({
        name: 'Yoghurt', cost: 2, price: 5, units: 50, expiryDate: '2026-07-20',
      })
      stock.discardExpiredBatch(p, '2026-07-20', 4, 'tester')
      stock.recordStockLoss({ product_id: p, quantity: 3, reason_code: 'SPILLED', recorded_by: 'tester' })

      const rows = stock.getStockLosses({})
      expect(rows).toHaveLength(2)
      // One list answers "what did we lose?", but each row still says where it
      // came from, so the expiry write-off stays read-only on the losses page.
      expect(rows.filter((r) => r.source === 'expiry')).toHaveLength(1)
      expect(rows.find((r) => r.source === 'expiry').reason_code).toBe('EXPIRED')

      const summary = stock.getStockLossSummary({})
      expect(summary.units).toBe(7)
      expect(summary.products_affected).toBe(1)
    })

    it('reports unvalued units rather than costing them at zero', () => {
      // Most of this catalogue has no cost on record. A summary that treats
      // unknown as zero looks authoritative and understates the loss.
      const priced = stockedProduct({ name: 'Coke', cost: 2, price: 5, units: 20 })
      const unpriced = addProduct({ name: 'Mystery', sellingPrice: 5 })
      getDb().prepare('UPDATE products SET current_quantity = 10 WHERE id = ?').run(unpriced)

      stock.recordStockLoss({ product_id: priced, quantity: 5, reason_code: 'BROKEN', recorded_by: 'tester' })
      stock.recordStockLoss({ product_id: unpriced, quantity: 4, reason_code: 'LOST', recorded_by: 'tester' })

      const summary = stock.getStockLossSummary({})
      expect(summary.units).toBe(9)
      expect(summary.valued_units).toBe(5)
      expect(summary.unvalued_units).toBe(4)
      expect(summary.value).toBeCloseTo(10, 6)
      expect(stock.getStockLosses({}).find((r) => r.product_id === unpriced).total_cost).toBeNull()
    })
  })

  describe('reconciliation', () => {
    const snapshotFor = (id) =>
      stock.getReconciliationSnapshot({ start: todayStr(), end: todayStr() })
        .products.find((p) => p.id === id)

    it('shows how the expected figure was reached, not just the figure', () => {
      // The difference between a reconciliation and an overwrite. An operator
      // who cannot see the derivation can only accept or overwrite the number.
      const p = stockedProduct({ name: 'Coke', cost: 2, price: 5, units: 100 })
      sell({ lines: [{ productId: p, name: 'Coke', qty: 30, cost: 2, price: 5 }] })
      stock.recordStockLoss({ product_id: p, quantity: 5, reason_code: 'BROKEN', recorded_by: 'tester' })

      const row = snapshotFor(p)
      expect(row.movements.received).toBe(100)
      expect(row.movements.sold).toBe(30)
      expect(row.movements.lost).toBe(5)
      // opening 0 + 100 − 30 − 5 = 65, and that must equal the live figure.
      expect(row.expected).toBe(65)
      expect(qtyNow(p)).toBe(65)
    })

    it('does not count a reversed breakage against the shelf', () => {
      const p = stockedProduct({ name: 'Coke', cost: 2, price: 5, units: 40 })
      const loss = stock.recordStockLoss({ product_id: p, quantity: 6, reason_code: 'BROKEN', recorded_by: 'tester' })
      stock.reverseStockLoss(loss.id, 'wrong product', 'manager')

      expect(snapshotFor(p).movements.lost).toBe(0)
      expect(snapshotFor(p).expected).toBe(40)
    })

    it('records an explained shortfall as a loss, keeping the books balanced', () => {
      const p = stockedProduct({ name: 'Coke', cost: 2, price: 5, units: 50 })
      const res = stock.reconcileProductExplained(
        p, 47, { type: 'loss', reason_code: 'BROKEN', note: 'crate dropped' }, 'tester'
      )

      expect(res.outcome).toBe('explained')
      expect(res.variance).toBe(-3)
      expect(qtyNow(p)).toBe(47)

      // The units are accounted for, so they belong in the breakage term and
      // NOT in unexplained shrinkage.
      const m = analytics.computeMetrics(
        ['inventory.stockLossUnits', 'inventory.adjustments', 'inventory.reconciles'], period()
      ).metrics
      expect(m['inventory.stockLossUnits'].value).toBe(3)
      expect(m['inventory.adjustments'].value).toBeCloseTo(0, 6)
      expect(m['inventory.reconciles'].value.reconciles).toBe(true)
    })

    it('records an unexplained shortfall as shrinkage instead', () => {
      const p = stockedProduct({ name: 'Coke', cost: 2, price: 5, units: 50 })
      const res = stock.reconcileProductExplained(p, 47, { type: 'adjustment' }, 'tester')

      expect(res.outcome).toBe('unexplained')
      expect(qtyNow(p)).toBe(47)

      const m = analytics.computeMetrics(
        ['inventory.stockLossUnits', 'inventory.adjustments'], period()
      ).metrics
      // Same 3 units, different meaning — and only one of them is a management
      // problem the shop can already explain.
      expect(m['inventory.stockLossUnits'].value).toBe(0)
      expect(m['inventory.adjustments'].value).toBeCloseTo(-6, 6)
    })

    it('writes exactly one movement, so a variance cannot be counted twice', () => {
      const p = stockedProduct({ name: 'Coke', cost: 2, price: 5, units: 50 })
      const before = getDb()
        .prepare(`SELECT COUNT(*) FROM stock_movements WHERE product_id = ?`).pluck().get(p)
      stock.reconcileProductExplained(p, 45, { type: 'loss', reason_code: 'THEFT' }, 'tester')
      const after = getDb()
        .prepare(`SELECT COUNT(*) FROM stock_movements WHERE product_id = ?`).pluck().get(p)

      // A loss AND an adjustment for the same shortfall would balance the books
      // by deducting the stock twice.
      expect(after - before).toBe(1)
      expect(qtyNow(p)).toBe(45)
    })

    it('writes nothing at all when the count matches', () => {
      const p = stockedProduct({ name: 'Coke', cost: 2, price: 5, units: 50 })
      const before = getDb()
        .prepare(`SELECT COUNT(*) FROM stock_movements WHERE product_id = ?`).pluck().get(p)
      const res = stock.reconcileProductExplained(p, 50, { type: 'adjustment' }, 'tester')

      expect(res.outcome).toBe('matched')
      // A zero-quantity movement is a lie in the ledger and would appear in
      // every "what happened this month" list.
      expect(getDb().prepare(`SELECT COUNT(*) FROM stock_movements WHERE product_id = ?`).pluck().get(p))
        .toBe(before)
    })

    it('refuses to call a surplus a loss', () => {
      const p = stockedProduct({ name: 'Coke', cost: 2, price: 5, units: 50 })
      expect(() =>
        stock.reconcileProductExplained(p, 55, { type: 'loss', reason_code: 'BROKEN' }, 'tester')
      ).toThrow(/surplus cannot be recorded as a loss/i)
      expect(qtyNow(p)).toBe(50)
    })

    it('finishes the rest of a count when one row fails', () => {
      const a = stockedProduct({ name: 'A', cost: 2, price: 5, units: 20 })
      const b = stockedProduct({ name: 'B', cost: 2, price: 5, units: 20 })
      const out = stock.reconcileProductsExplained([
        { product_id: a, counted_qty: 18, explanation: { type: 'loss', reason_code: 'BROKEN' } },
        { product_id: b, counted_qty: 25, explanation: { type: 'loss', reason_code: 'BROKEN' } },
        { product_id: b, counted_qty: 19, explanation: { type: 'adjustment' } },
      ], 'tester')

      // A stock count takes an hour; one bad row must not discard the rest.
      expect(out.results).toHaveLength(2)
      expect(out.errors).toHaveLength(1)
      expect(qtyNow(a)).toBe(18)
      expect(qtyNow(b)).toBe(19)
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
