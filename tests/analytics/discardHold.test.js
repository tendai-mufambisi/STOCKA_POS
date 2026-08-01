import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { freshDb, disposeDb, domain } from '../helpers/db.js'

const products = domain('products')
const stock = domain('stock')
const sales = domain('sales')
const audit = domain('audit')

let db

function seedProduct(name, qty, cost = 2) {
  products.addProduct({ name, category: 'Food', unit: 'each', selling_price: cost * 2 })
  const id = db.prepare('SELECT id FROM products WHERE name = ?').pluck().get(name)
  stock.addStockReceiving({
    supplier_id: null, product_id: id, date_received: '2026-07-01',
    cartons: 1, units_per_carton: qty, total_units: qty,
    cost_per_carton: qty * cost, cost_per_unit: cost, total_value: qty * cost,
    recorded_by: 'tester',
  })
  return id
}

function ringUpSale(productId, qty, name = 'X') {
  return sales.addSale(
    {
      cashier: 'jane',
      total: qty * 4,
      cash_tendered: qty * 4,
      change_given: 0,
      payment_method: 'Cash',
      cash_amount: qty * 4,
    },
    [{ product_id: productId, product_name: name, quantity: qty, cost_price: 2, selling_price: 4, subtotal: qty * 4 }]
  )
}

function ringUpHold(productId, qty) {
  const saleId = ringUpSale(productId, qty)
  sales.holdSale(saleId, 'Table 3')
  return saleId
}

const qtyOf = (id) => db.prepare('SELECT current_quantity FROM products WHERE id = ?').pluck().get(id)

beforeEach(() => { db = freshDb() })
afterAll(disposeDb)

describe('discardHeldSale', () => {
  it('returns the stock to the shelf', () => {
    const pid = seedProduct('Coke', 20)
    expect(qtyOf(pid)).toBe(20)

    const saleId = ringUpHold(pid, 5)
    expect(qtyOf(pid)).toBe(15) // reserved by the hold

    sales.discardHeldSale(saleId, 'jane')
    expect(qtyOf(pid)).toBe(20) // returned
  })

  it('keeps the row instead of deleting it', () => {
    // The audit hole: a cashier repeatedly ringing up and abandoning large
    // holds used to leave no trace whatsoever.
    const pid = seedProduct('Bread', 10)
    const saleId = ringUpHold(pid, 3)

    sales.discardHeldSale(saleId, 'jane')

    const row = db.prepare('SELECT * FROM sales WHERE id = ?').get(saleId)
    expect(row).toBeTruthy()
    expect(row.status).toBe('discarded')
    expect(row.voided_by).toBe('jane')
    expect(row.voided_at).toBeTruthy()

    const items = db.prepare('SELECT COUNT(*) FROM sale_items WHERE sale_id = ?').pluck().get(saleId)
    expect(items).toBe(1)
  })

  it('writes an audit entry naming who discarded it', () => {
    const pid = seedProduct('Sugar', 10)
    const saleId = ringUpHold(pid, 2)
    sales.discardHeldSale(saleId, 'jane')

    const entries = audit.getRecentAuditActions
      ? audit.getRecentAuditActions(50)
      : db.prepare('SELECT * FROM transaction_audit_log ORDER BY id DESC').all()
    const entry = entries.find((e) => e.action_type === 'DISCARD_HOLD')
    expect(entry).toBeTruthy()
    expect(entry.username).toBe('jane')
    expect(entry.entity_id).toBe(String(saleId))
  })

  it('stays out of the transaction list, which never showed discards before', () => {
    const pid = seedProduct('Rice', 10)
    const saleId = ringUpHold(pid, 2)
    sales.discardHeldSale(saleId, 'jane')

    expect(sales.getSales().some((s) => s.id === saleId)).toBe(false)
    expect(sales.getHeldSales().some((s) => s.id === saleId)).toBe(false)
    // ...but is retrievable on purpose
    expect(sales.getDiscardedHolds().some((s) => s.id === saleId)).toBe(true)
  })

  it('is excluded from revenue, because only completed sales are real', () => {
    const pid = seedProduct('Milk', 10)
    const saleId = ringUpHold(pid, 2)
    sales.discardHeldSale(saleId, 'jane')

    const revenue = db
      .prepare("SELECT COALESCE(SUM(total),0) FROM sales WHERE status = 'completed'")
      .pluck()
      .get()
    expect(revenue).toBe(0)
  })

  it('refuses to discard anything that is not a hold', () => {
    const pid = seedProduct('Salt', 10)
    const saleId = ringUpSale(pid, 2, 'Salt')
    // Discarding a completed sale would return stock for a sale that really
    // happened, quietly inflating inventory.
    expect(() => sales.discardHeldSale(saleId, 'jane')).toThrow(/Only held sales/)
  })

  it('cannot be double-discarded into returning the stock twice', () => {
    const pid = seedProduct('Beans', 10)
    const saleId = ringUpHold(pid, 4)
    sales.discardHeldSale(saleId, 'jane')
    expect(qtyOf(pid)).toBe(10)

    expect(() => sales.discardHeldSale(saleId, 'jane')).toThrow(/Only held sales/)
    expect(qtyOf(pid)).toBe(10) // unchanged
  })
})
