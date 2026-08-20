import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { freshDb, disposeDb, domain, electronModule } from '../helpers/db.js'

// The bug these tests pin down:
//
// A till keeps its open shift in renderer memory. When that shift is closed
// underneath it — the overnight sweep at 23:59, or an admin's End of Day — the
// renderer kept sending the now-dead shift id, and addSale wrote it through
// unchecked. A whole morning's takings were filed against yesterday's drawer, and
// the new day ended up with no shift row at all. In production one shift showed
// 340 transactions against a normal ~120, and five calendar days were missing.
//
// The rule now: the SERVER decides which shift a sale belongs to. A shift_id from
// a renderer is a hint, never authority.

const products = domain('products')
const stock    = domain('stock')
const sales    = domain('sales')
const shifts   = domain('shifts')
const eventClock = electronModule('database/eventClock.js')

let db

function stockedProduct(name = 'Bread', qty = 500, cost = 2) {
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

function ringUp(productId, { cashier = 'jane', shiftId = null, replayed = false, qty = 1 } = {}) {
  return sales.addSale(
    {
      cashier, total: qty * 4, cash_tendered: qty * 4, change_given: 0,
      payment_method: 'Cash', cash_amount: qty * 4,
      shift_id: shiftId, replayed,
    },
    [{ product_id: productId, product_name: 'Bread', quantity: qty, cost_price: 2, selling_price: 4, subtotal: qty * 4 }]
  )
}

const openShift = (username = 'jane') =>
  shifts.startShift({ username, name: username, id: 1 }, 50, null)

const movementCount = () => db.prepare('SELECT COUNT(*) FROM stock_movements').pluck().get()
const salesOn = (shiftId) => db.prepare('SELECT COUNT(*) FROM sales WHERE shift_id = ?').pluck().get(shiftId)
const shiftOf = (saleId) => db.prepare('SELECT shift_id FROM sales WHERE id = ?').pluck().get(saleId)

beforeEach(() => {
  db = freshDb()
  eventClock.clearEventTime()
})
afterAll(() => disposeDb())

describe('binding a sale to a shift', () => {
  it('refuses a sale stamped with a shift that has already been closed', () => {
    const pid = stockedProduct()
    const shift = openShift()
    shifts.closeShift(shift.id, { closing_cash: 50 }, '')

    const before = movementCount()

    // Precisely what the till was doing every morning after the overnight
    // auto-close.
    let caught
    try { ringUp(pid, { shiftId: shift.id }) } catch (err) { caught = err }

    expect(caught).toBeDefined()
    expect(caught.code).toBe('SHIFT_NOT_OPEN')

    // Refused before the transaction opens: no sale row, no stock moved, and the
    // closed shift's counters untouched.
    expect(salesOn(shift.id)).toBe(0)
    expect(movementCount()).toBe(before)
    expect(db.prepare('SELECT total_sales_count FROM shifts WHERE id = ?').pluck().get(shift.id)).toBe(0)
  })

  it('binds to the genuinely open shift when the claimed one is stale', () => {
    const pid = stockedProduct()
    const stale = openShift()
    shifts.closeShift(stale.id, { closing_cash: 50 }, '')
    const fresh = openShift()

    // The till is still shouting the old id; the server knows better.
    const saleId = ringUp(pid, { shiftId: stale.id })

    expect(shiftOf(saleId)).toBe(fresh.id)
    expect(salesOn(stale.id)).toBe(0)
  })

  it('never lets a stale id pull a sale onto another cashier drawer', () => {
    const pid = stockedProduct()
    const janes = openShift('jane')
    shifts.closeShift(janes.id, { closing_cash: 50 }, '')
    openShift('sam')

    // sam's till somehow claims jane's closed shift. Ownership is checked, so it
    // is not honoured; sam's own open shift is.
    const saleId = ringUp(pid, { cashier: 'sam', shiftId: janes.id })
    const bound = shiftOf(saleId)

    expect(bound).not.toBe(janes.id)
    expect(db.prepare('SELECT cashier_username FROM shifts WHERE id = ?').pluck().get(bound)).toBe('sam')
  })

  it('accepts a sale that claims no shift at all, leaving it for the reconciler', () => {
    const pid = stockedProduct()
    // The provisional/offline path: the cashier's shift-start is still queued, so
    // the till has no id to send. Refusing this would break selling on a satellite.
    const saleId = ringUp(pid, { shiftId: null })

    expect(saleId).toBeGreaterThan(0)
    expect(shiftOf(saleId)).toBeNull()
  })
})

describe('replayed sales from a satellite offline queue', () => {
  // A replay is history. lanClient treats any 4xx from Main as permanent and
  // archives the write into failed_writes.json, so a refusal here would silently
  // destroy a sale the cashier already took money for.

  it('keeps a closed shift when the sale really happened inside its window', () => {
    const pid = stockedProduct()
    const shift = openShift()
    // Sale happens now, while the drawer is open...
    const occurredAt = new Date().toISOString()
    shifts.closeShift(shift.id, { closing_cash: 50 }, '')

    // ...but only reaches Main after the drawer was cashed up.
    eventClock.setEventTime(occurredAt)
    const saleId = ringUp(pid, { shiftId: shift.id, replayed: true })
    eventClock.clearEventTime()

    expect(shiftOf(saleId)).toBe(shift.id)
  })

  it('is never refused even when nothing matches — it lands unlinked instead', () => {
    const pid = stockedProduct()
    const shift = openShift()
    shifts.closeShift(shift.id, { closing_cash: 50 }, '')

    // An hour after that shift closed. No open shift, no window match.
    eventClock.setEventTime(new Date(Date.now() + 60 * 60 * 1000).toISOString())
    const saleId = ringUp(pid, { shiftId: shift.id, replayed: true })
    eventClock.clearEventTime()

    expect(saleId).toBeGreaterThan(0)
    expect(shiftOf(saleId)).toBeNull()
  })
})

describe('completing a held sale', () => {
  it('refuses a closed shift without mutating the hold', () => {
    const pid = stockedProduct()
    const shift = openShift()
    const saleId = ringUp(pid, { shiftId: shift.id })
    sales.holdSale(saleId, 'Table 3')
    shifts.closeShift(shift.id, { closing_cash: 50 }, '')

    const countBefore = db.prepare('SELECT total_sales_count FROM shifts WHERE id = ?').pluck().get(shift.id)

    let caught
    try { sales.completeHeldSale(saleId, { cash_tendered: 4, change_given: 0, cash_amount: 4 }, shift.id) }
    catch (err) { caught = err }

    expect(caught?.code).toBe('SHIFT_NOT_OPEN')
    // Still held, so the cashier can re-tender the same recalled hold once they
    // open a new shift.
    expect(db.prepare('SELECT status FROM sales WHERE id = ?').pluck().get(saleId)).toBe('held')
    expect(db.prepare('SELECT total_sales_count FROM shifts WHERE id = ?').pluck().get(shift.id)).toBe(countBefore)
  })
})
