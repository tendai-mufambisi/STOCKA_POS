import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { freshDb, disposeDb, domain, electronModule } from '../helpers/db.js'

const { costResolverFor } = electronModule('analytics/sql/costResolver.js')
const products = domain('products')
const stock = domain('stock')
const reports = domain('reports')

// Seeded through the REAL domain write paths (addStockReceiving,
// correctStockReceiving), not raw INSERTs — so these tests exercise the same
// rows production actually produces, including the correction delta arithmetic.

let db

function addProduct(name, sellingPrice = 10) {
  products.addProduct({ name, category: 'Food', unit: 'each', selling_price: sellingPrice })
  return db.prepare('SELECT id FROM products WHERE name = ?').pluck().get(name)
}

function receive(productId, { units, costPerUnit, dateReceived }) {
  return stock.addStockReceiving({
    supplier_id: null,
    product_id: productId,
    date_received: dateReceived,
    cartons: 1,
    units_per_carton: units,
    total_units: units,
    cost_per_carton: units * costPerUnit,
    cost_per_unit: costPerUnit,
    total_value: units * costPerUnit,
    recorded_by: 'tester',
  })
}

beforeEach(() => {
  db = freshDb()
})
afterAll(disposeDb)

describe('costResolver', () => {
  it('returns the cost of a single receiving', () => {
    const id = addProduct('Sugar')
    receive(id, { units: 10, costPerUnit: 2.5, dateReceived: '2026-07-01' })

    const rec = costResolverFor(db).costOf(id)
    expect(rec.cost).toBeCloseTo(2.5, 6)
    expect(rec.source).toBe('receiving')
    expect(rec.corrected).toBe(false)
  })

  it('uses the most recent receiving by date', () => {
    const id = addProduct('Bread')
    receive(id, { units: 10, costPerUnit: 1.0, dateReceived: '2026-07-01' })
    receive(id, { units: 10, costPerUnit: 1.5, dateReceived: '2026-07-20' })

    expect(costResolverFor(db).costOf(id).cost).toBeCloseTo(1.5, 6)
  })

  describe('the disagreement it exists to settle', () => {
    // The legacy MAX(id) rule, run directly so the test still demonstrates what
    // the old code would have answered now that the app no longer uses it.
    const legacyMaxIdCost = (productId) =>
      db
        .prepare(
          `SELECT sr.cost_per_unit FROM stock_receivings sr
            WHERE sr.id = (SELECT MAX(id) FROM stock_receivings WHERE product_id = sr.product_id)
              AND sr.product_id = ?`
        )
        .pluck()
        .get(productId)

    // A BACKDATED receiving: entered later (higher id) for stock that arrived
    // earlier (older date_received). This is where the two rules diverged.
    it('prefers date over insertion order for a backdated receiving', () => {
      const id = addProduct('Rice')
      receive(id, { units: 10, costPerUnit: 3.0, dateReceived: '2026-07-20' }) // newest arrival
      receive(id, { units: 10, costPerUnit: 9.99, dateReceived: '2026-07-01' }) // entered later, older stock

      // The old MAX(id) rule picked the backdated row — the wrong one.
      expect(legacyMaxIdCost(id)).toBeCloseTo(9.99, 6)

      // The canonical resolver sides with date: a backdated receiving is older
      // stock, whatever order someone got round to typing it in.
      expect(costResolverFor(db).costOf(id).cost).toBeCloseTo(3.0, 6)
    })

    it('makes both legacy entry points agree, which was the whole problem', () => {
      const id = addProduct('Maize')
      receive(id, { units: 10, costPerUnit: 3.0, dateReceived: '2026-07-20' })
      receive(id, { units: 10, costPerUnit: 9.99, dateReceived: '2026-07-01' })

      // These two used to return 9.99 and 3.00 for the same product, so stock
      // valuation and the price shown against a product disagreed.
      const viaMap = products.getAllLatestCostPrices()[id]
      const viaSingle = products.getLatestProductPrice(id).cost_per_unit
      expect(viaMap).toBeCloseTo(viaSingle, 6)
      expect(viaMap).toBeCloseTo(costResolverFor(db).costOf(id).cost, 6)
    })

    it('breaks a same-date tie by id, as MAX(id) did', () => {
      const id = addProduct('Salt')
      receive(id, { units: 5, costPerUnit: 1.0, dateReceived: '2026-07-10' })
      receive(id, { units: 5, costPerUnit: 2.0, dateReceived: '2026-07-10' })
      expect(costResolverFor(db).costOf(id).cost).toBeCloseTo(2.0, 6)
    })
  })

  describe('corrections', () => {
    it('returns the corrected cost, not the original', () => {
      const id = addProduct('Oil')
      const recvId = receive(id, { units: 10, costPerUnit: 5.0, dateReceived: '2026-07-05' })

      stock.correctStockReceiving(recvId, { total_units: 10, cost_per_unit: 6.5, reason: 'typo' }, 'tester')

      const rec = costResolverFor(db).costOf(id)
      expect(rec.cost).toBeCloseTo(6.5, 6)
      expect(rec.corrected).toBe(true)
    })

    it('nets out repeated corrections', () => {
      const id = addProduct('Flour')
      const recvId = receive(id, { units: 20, costPerUnit: 4.0, dateReceived: '2026-07-05' })

      stock.correctStockReceiving(recvId, { total_units: 24, cost_per_unit: 4.25, reason: 'miscount' }, 'tester')
      stock.correctStockReceiving(recvId, { total_units: 22, cost_per_unit: 4.75, reason: 'recount' }, 'tester')

      // Batch weighted average must equal the latest corrected cost exactly.
      expect(costResolverFor(db).costOf(id).cost).toBeCloseTo(4.75, 6)
    })

    it('does not let a correction row masquerade as a newer receiving', () => {
      // A correction inherits the ORIGINAL date_received but gets a newer id.
      // Under MAX(id) it would outrank a genuinely later delivery.
      const id = addProduct('Beans')
      const oldRecv = receive(id, { units: 10, costPerUnit: 2.0, dateReceived: '2026-07-01' })
      receive(id, { units: 10, costPerUnit: 8.0, dateReceived: '2026-07-25' }) // the real latest

      stock.correctStockReceiving(oldRecv, { total_units: 10, cost_per_unit: 2.2, reason: 'fix' }, 'tester')

      // The July 25 delivery is still the current cost.
      expect(costResolverFor(db).costOf(id).cost).toBeCloseTo(8.0, 6)

      // MAX(id) would have picked the correction row — it has the highest id but
      // carries the July 1 batch's date — and reported 2.20 as the current cost.
      const viaLegacyMaxId = db
        .prepare(
          `SELECT cost_per_unit FROM stock_receivings
            WHERE product_id = ? ORDER BY id DESC LIMIT 1`
        )
        .pluck()
        .get(id)
      expect(viaLegacyMaxId).toBeCloseTo(2.2, 6)

      // The shipped lookup no longer does that.
      expect(products.getAllLatestCostPrices()[id]).toBeCloseTo(8.0, 6)
    })
  })

  describe('missing cost', () => {
    it('reports source "none" rather than a fabricated 0', () => {
      // The silent-100%-margin bug: a product sold for $5 with cost 0 looks
      // like the best performer in the shop.
      const id = addProduct('Never Received')
      const rec = costResolverFor(db).costOf(id)
      expect(rec.cost).toBeNull()
      expect(rec.source).toBe('none')
    })

    it('omits costless products from costLookup so callers fail visibly', () => {
      const known = addProduct('Known')
      const unknown = addProduct('Unknown')
      receive(known, { units: 1, costPerUnit: 3.0, dateReceived: '2026-07-01' })

      const lookup = costResolverFor(db).costLookup()
      expect(lookup[known]).toBeCloseTo(3.0, 6)
      expect(unknown in lookup).toBe(false) // absent, not 0
    })

    it('honours a zero-unit receiving used purely to seed a cost', () => {
      // recordInitialCost writes a 0-unit row so a product that has never been
      // delivered still has a cost. Batch units net to 0, so the weighted
      // average must fall back rather than divide by zero.
      const id = addProduct('Seeded')
      stock.recordInitialCost(id, 7.25, 'tester')

      const rec = costResolverFor(db).costOf(id)
      expect(rec.cost).toBeCloseTo(7.25, 6)
      expect(rec.source).toBe('receiving')
    })
  })

  describe('as-of resolution', () => {
    it('ignores receivings that arrived after the as-of day', () => {
      const id = addProduct('Milk')
      receive(id, { units: 10, costPerUnit: 1.0, dateReceived: '2026-07-01' })
      receive(id, { units: 10, costPerUnit: 2.0, dateReceived: '2026-07-20' })

      expect(costResolverFor(db, { asOf: '2026-07-10' }).costOf(id).cost).toBeCloseTo(1.0, 6)
      expect(costResolverFor(db, { asOf: '2026-07-31' }).costOf(id).cost).toBeCloseTo(2.0, 6)
    })

    it('business mode applies corrections when restating a past day', () => {
      const id = addProduct('Tea')
      const recvId = receive(id, { units: 10, costPerUnit: 5.0, dateReceived: '2026-07-05' })
      stock.correctStockReceiving(recvId, { total_units: 10, cost_per_unit: 6.0, reason: 'fix' }, 'tester')

      // Restating the books: the cost on 7 July really was 6.00; we know that now.
      expect(costResolverFor(db, { asOf: '2026-07-07' }).costOf(id).cost).toBeCloseTo(6.0, 6)
    })

    it('rejects an unknown mode rather than guessing', () => {
      expect(() => costResolverFor(db, { mode: 'whatever' })).toThrow(/unknown mode/)
    })
  })

  it('costMap does one pass for bulk valuation', () => {
    const a = addProduct('A')
    const b = addProduct('B')
    receive(a, { units: 5, costPerUnit: 1.5, dateReceived: '2026-07-01' })
    receive(b, { units: 5, costPerUnit: 2.5, dateReceived: '2026-07-01' })

    const map = costResolverFor(db).costMap()
    expect(map.get(a).cost).toBeCloseTo(1.5, 6)
    expect(map.get(b).cost).toBeCloseTo(2.5, 6)
  })

  it('agrees with getStockValue once both use the same resolver', () => {
    const id = addProduct('Widget')
    receive(id, { units: 10, costPerUnit: 3.0, dateReceived: '2026-07-01' })

    const resolver = costResolverFor(db)
    const qty = db.prepare('SELECT current_quantity FROM products WHERE id = ?').pluck().get(id)
    const expected = qty * resolver.costOf(id).cost

    expect(reports.getStockValue()).toBeCloseTo(expected, 6)
  })
})
