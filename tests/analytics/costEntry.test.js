import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { freshDb, disposeDb, electronModule, domain, getDb } from '../helpers/db.js'
import { stockedProduct, sell, todayStr } from '../helpers/seed.js'

const costEntry = domain('costEntry')
const analytics = electronModule('analytics/index.js')
const { costResolverFor } = electronModule('analytics/sql/costResolver.js')

// Closing the cost gap. The engine can measure the damage a missing cost does,
// but only data entry can fix it — these are the tools that get it in, and the
// guarantees around correcting the history it has already distorted.

let day
beforeEach(() => {
  freshDb()
  day = todayStr()
})
afterAll(disposeDb)

/** A product with stock but no cost — the exact shape of the live problem. */
function uncostedProduct({ name, price = 10, units = 20 }) {
  const id = stockedProduct({ name, cost: 1, price, units })
  getDb().prepare('DELETE FROM stock_receivings WHERE product_id = ?').run(id)
  return id
}

describe('missing-cost list', () => {
  it('lists only products with no cost', () => {
    const costed = stockedProduct({ name: 'Costed', cost: 2, price: 5 })
    const missing = uncostedProduct({ name: 'Missing' })

    const rows = costEntry.getProductsMissingCost()
    const ids = rows.map((r) => r.id)
    expect(ids).toContain(missing)
    expect(ids).not.toContain(costed)
  })

  it('ranks by impact, not alphabetically', () => {
    // Told "224 products need costs" an owner gives up. Told which six matter,
    // they fix six. So the product whose absence has actually distorted the
    // reports must come first, regardless of name.
    const zebra = uncostedProduct({ name: 'Zebra', price: 50, units: 40 })
    const apple = uncostedProduct({ name: 'Apple', price: 1, units: 40 })
    sell({ lines: [{ productId: zebra, name: 'Zebra', qty: 20, cost: 0, price: 50 }] })

    const rows = costEntry.getProductsMissingCost()
    expect(rows[0].id).toBe(zebra)
    expect(rows[0].revenueAtRisk).toBeCloseTo(1000, 6)
    expect(rows.find((r) => r.id === apple).revenueAtRisk).toBe(0)
  })
})

describe('coverage summary', () => {
  it('reports the share of revenue whose cost is known', () => {
    const good = stockedProduct({ name: 'Good', cost: 2, price: 5 })
    const bad = uncostedProduct({ name: 'Bad', price: 5 })
    sell({ lines: [{ productId: good, name: 'Good', qty: 10, cost: 2, price: 5 }] })
    sell({ lines: [{ productId: bad, name: 'Bad', qty: 10, cost: 0, price: 5 }] })

    const s = costEntry.getCostCoverageSummary()
    expect(s.revenueCoverage).toBeCloseTo(0.5, 6)
    expect(s.revenueUncosted).toBeCloseTo(50, 6)
    expect(s.zeroCostLines).toBe(1)
    expect(s.productsMissingCost).toBe(1)
  })
})

describe('setting a cost', () => {
  it('makes the product resolvable and drops it off the missing list', () => {
    const id = uncostedProduct({ name: 'Soap', price: 9 })
    expect(costResolverFor(getDb()).costOf(id).source).toBe('none')

    costEntry.setProductCost(id, 4.25, 'jane')

    expect(costResolverFor(getDb()).costOf(id).cost).toBeCloseTo(4.25, 6)
    expect(costEntry.getProductsMissingCost().map((r) => r.id)).not.toContain(id)
  })

  it('refuses a zero cost, which is the state being fixed', () => {
    const id = uncostedProduct({ name: 'Soap', price: 9 })
    // Accepting 0 would let the screen report progress while changing nothing.
    expect(() => costEntry.setProductCost(id, 0, 'jane')).toThrow(/0 is what we are trying to replace/)
    expect(() => costEntry.setProductCost(id, -1, 'jane')).toThrow(/0 or more/)
  })

  it('records who entered it', () => {
    const id = uncostedProduct({ name: 'Soap', price: 9 })
    costEntry.setProductCost(id, 3, 'jane')
    const entry = getDb()
      .prepare(`SELECT * FROM transaction_audit_log WHERE action_type = 'SET_COST' ORDER BY id DESC`)
      .get()
    expect(entry.username).toBe('jane')
  })

  it('saves many at once, reporting per-row failures without losing the good ones', () => {
    const a = uncostedProduct({ name: 'A', price: 5 })
    const b = uncostedProduct({ name: 'B', price: 5 })
    const res = costEntry.setProductCosts(
      [{ productId: a, cost: 2 }, { productId: b, cost: 0 }],
      'jane'
    )
    expect(res.saved).toBe(1)
    expect(res.failed).toBe(1)
    expect(costResolverFor(getDb()).costOf(a).cost).toBeCloseTo(2, 6)
  })
})

describe('backfilling history', () => {
  function sellUncostedThenPriceIt() {
    const id = uncostedProduct({ name: 'Orphan', price: 10 })
    sell({ lines: [{ productId: id, name: 'Orphan', qty: 5, cost: 0, price: 10 }] })
    costEntry.setProductCost(id, 6, 'jane')
    return id
  }

  it('previews without changing anything', () => {
    sellUncostedThenPriceIt()
    const preview = costEntry.backfillSaleItemCosts({ dryRun: true })
    expect(preview.linesUpdated).toBe(1)
    expect(preview.cogsAdded).toBeCloseTo(30, 6)

    // This is the one action that changes an already-reported figure, so the
    // preview must be genuinely read-only.
    const stillZero = getDb()
      .prepare('SELECT COUNT(*) FROM sale_items WHERE cost_price <= 0')
      .pluck()
      .get()
    expect(stillZero).toBe(1)
  })

  it('fills the cost and corrects the margin', () => {
    sellUncostedThenPriceIt()
    const before = analytics.computeMetrics(['profit.grossMargin', 'cogs.total'], { type: 'day', date: day }).metrics
    expect(before['profit.grossMargin'].value).toBeCloseTo(1, 6) // the 100% fiction

    costEntry.backfillSaleItemCosts({ recordedBy: 'jane' })

    const after = analytics.computeMetrics(['profit.grossMargin', 'cogs.total'], { type: 'day', date: day }).metrics
    expect(after['cogs.total'].value).toBeCloseTo(30, 6)
    expect(after['profit.grossMargin'].value).toBeCloseTo(0.4, 6) // 50 revenue, 30 cost
  })

  it('never touches a cost that was actually recorded', () => {
    const real = stockedProduct({ name: 'Real', cost: 2, price: 5 })
    sell({ lines: [{ productId: real, name: 'Real', qty: 3, cost: 2, price: 5 }] })
    sellUncostedThenPriceIt()

    costEntry.backfillSaleItemCosts({ recordedBy: 'jane' })

    // The genuinely-recorded 2.00 must survive untouched, even though the
    // product's current cost could differ.
    const row = getDb()
      .prepare('SELECT cost_price, cost_backfilled_at FROM sale_items WHERE product_id = ?')
      .get(real)
    expect(row.cost_price).toBeCloseTo(2, 6)
    expect(row.cost_backfilled_at).toBeNull()
  })

  it('stamps every corrected line so a report can disclose it', () => {
    sellUncostedThenPriceIt()
    costEntry.backfillSaleItemCosts({ recordedBy: 'jane' })

    const stamped = getDb()
      .prepare('SELECT COUNT(*) FROM sale_items WHERE cost_backfilled_at IS NOT NULL')
      .pluck()
      .get()
    expect(stamped).toBe(1)
  })

  it('makes the report say the figures were corrected, not original', () => {
    sellUncostedThenPriceIt()
    costEntry.backfillSaleItemCosts({ recordedBy: 'jane' })

    const res = analytics.computeMetrics(['profit.grossMargin'], { type: 'day', date: day })
    const note = res.quality.notes.find((n) => n.id === 'saleItems.costBackfilled')
    expect(note).toBeTruthy()
    // The wording may change; what must not is that the report distinguishes a
    // corrected figure from an originally-recorded one.
    expect(note.message).toMatch(/corrected/i)
    expect(note.message).toMatch(/originally recorded/i)
  })

  it('never promises more corrections than it will actually make', () => {
    // Found by driving the real app: the summary counted every product in the
    // cost map while the backfill required a cost above zero, so the screen
    // offered "7 sales can be corrected" and then corrected none. A tool that
    // promises work it does not do is worse than one that offers nothing.
    const priceless = uncostedProduct({ name: 'Priceless', price: 8 })
    getDb()
      .prepare(
        `INSERT INTO stock_receivings
           (supplier_id, product_id, date_received, cartons, units_per_carton, total_units,
            cost_per_carton, cost_per_unit, total_value, recorded_by)
         VALUES (NULL, ?, '2026-07-10', 0, 0, 50, 0, 0, 0, 'import')`
      )
      .run(priceless)
    sell({ lines: [{ productId: priceless, name: 'Priceless', qty: 2, cost: 0, price: 8 }] })

    const promised = costEntry.getCostCoverageSummary().backfillableLines
    const actual = costEntry.backfillSaleItemCosts({ dryRun: true }).linesUpdated
    expect(promised).toBe(actual)
  })

  it('leaves products that still have no cost alone', () => {
    const stillMissing = uncostedProduct({ name: 'Nameless', price: 8 })
    sell({ lines: [{ productId: stillMissing, name: 'Nameless', qty: 2, cost: 0, price: 8 }] })

    const res = costEntry.backfillSaleItemCosts({ recordedBy: 'jane' })
    // Nothing is invented for a product whose cost is genuinely unknown.
    expect(res.linesUpdated).toBe(0)
  })

  it('writes what it changed to the audit log', () => {
    sellUncostedThenPriceIt()
    costEntry.backfillSaleItemCosts({ recordedBy: 'jane' })

    const entry = getDb()
      .prepare(`SELECT * FROM transaction_audit_log WHERE action_type = 'BACKFILL_COST'`)
      .get()
    expect(entry).toBeTruthy()
    expect(entry.username).toBe('jane')
    expect(entry.description).toMatch(/COGS increased by \$30\.00/)
  })

  it('is idempotent — running twice does not double the cost', () => {
    sellUncostedThenPriceIt()
    costEntry.backfillSaleItemCosts({ recordedBy: 'jane' })
    const second = costEntry.backfillSaleItemCosts({ recordedBy: 'jane' })
    expect(second.linesUpdated).toBe(0)

    const cogs = analytics.computeMetrics(['cogs.total'], { type: 'day', date: day }).metrics
    expect(cogs['cogs.total'].value).toBeCloseTo(30, 6)
  })
})
