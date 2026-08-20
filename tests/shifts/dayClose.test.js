import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { freshDb, disposeDb, domain, electronModule } from '../helpers/db.js'

// End of Day used to be today-only: a day the admin forgot could never be closed
// afterwards, and nothing anywhere said it was outstanding. Five such days exist in
// the production database.

const products = domain('products')
const stock    = domain('stock')
const sales    = domain('sales')
const eod      = domain('eod')
const eventClock = electronModule('database/eventClock.js')
const { localDayStr } = electronModule('analytics/kernel/time.js')

let db

const dayOffset = (n) => {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return localDayStr(d)
}
const middayOf = (day) => {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d, 12, 0, 0).toISOString()
}

function stockedProduct(name = 'Bread', qty = 500) {
  products.addProduct({ name, category: 'Food', unit: 'each', selling_price: 4 })
  const id = db.prepare('SELECT id FROM products WHERE name = ?').pluck().get(name)
  stock.addStockReceiving({
    supplier_id: null, product_id: id, date_received: '2026-07-01',
    cartons: 1, units_per_carton: qty, total_units: qty,
    cost_per_carton: qty * 2, cost_per_unit: 2, total_value: qty * 2,
    recorded_by: 'tester',
  })
  return id
}

function sellOn(day, pid, amount = 10) {
  eventClock.setEventTime(middayOf(day))
  try {
    return sales.addSale(
      { cashier: 'jane', total: amount, cash_tendered: amount, change_given: 0,
        payment_method: 'Cash', cash_amount: amount, shift_id: null, replayed: true },
      [{ product_id: pid, product_name: 'Bread', quantity: 1, cost_price: 2, selling_price: amount, subtotal: amount }]
    )
  } finally { eventClock.clearEventTime() }
}

const dayRecord = (date) => ({
  date, cashier: 'admin', total_sales: 10, total_expenses: 0,
  expected_cash: 10, actual_cash: 10, difference: 0, status: 'Balanced', notes: '',
})

beforeEach(() => { db = freshDb(); eventClock.clearEventTime() })
afterAll(() => disposeDb())

describe('finding days that were never signed off', () => {
  it('lists a past day that took money but has no end-of-day record', () => {
    const pid = stockedProduct()
    const missed = dayOffset(-2)
    sellOn(missed, pid, 25)

    const rows = eod.getUnclosedBusinessDays()
    const row = rows.find(r => r.day === missed)

    expect(row).toBeDefined()
    expect(row.sales_count).toBe(1)
    expect(row.sales_total).toBeCloseTo(25, 2)
  })

  it('stops listing a day once it has been closed retroactively', () => {
    const pid = stockedProduct()
    const missed = dayOffset(-2)
    sellOn(missed, pid, 25)

    eod.addEndOfDay(dayRecord(missed))

    expect(eod.getUnclosedBusinessDays().some(r => r.day === missed)).toBe(false)
    expect(eod.getEndOfDayByDate(missed)).not.toBeNull()
  })

  it('never lists today — the day is not over yet', () => {
    const pid = stockedProduct()
    sellOn(dayOffset(0), pid, 25)

    expect(eod.getUnclosedBusinessDays().some(r => r.day === dayOffset(0))).toBe(false)
  })

  it('does not confront a long-running shop with every day it never closed', () => {
    const pid = stockedProduct()
    // Trading well before the shop ever started using End of Day.
    sellOn(dayOffset(-40), pid, 5)
    sellOn(dayOffset(-2), pid, 5)
    // The first day it ever signed off.
    eod.addEndOfDay(dayRecord(dayOffset(-3)))

    const days = eod.getUnclosedBusinessDays().map(r => r.day)
    expect(days).toContain(dayOffset(-2))
    expect(days).not.toContain(dayOffset(-40))
  })
})

describe('closing a day retroactively', () => {
  it('refuses a date that has not happened yet', () => {
    expect(() => eod.addEndOfDay(dayRecord(dayOffset(1)))).toThrow(/not happened yet/i)
  })

  it('takes no inventory snapshot for a past date', () => {
    stockedProduct()
    const missed = dayOffset(-2)

    eod.addEndOfDay(dayRecord(missed))

    // A snapshot is a measurement of the shelves right now. Writing today's
    // quantities under last week's date would be a fabricated one — and it would
    // silently become that month's opening stock.
    const snaps = db.prepare('SELECT COUNT(*) FROM inventory_daily_snapshots WHERE date = ?').pluck().get(missed)
    expect(snaps).toBe(0)

    // The record still explains itself.
    const logged = db.prepare("SELECT COUNT(*) FROM transaction_audit_log WHERE action_type = 'EOD_RETROACTIVE'").pluck().get()
    expect(logged).toBe(1)
  })

  it('still snapshots when closing today', () => {
    stockedProduct()
    const today = dayOffset(0)

    eod.addEndOfDay(dayRecord(today))

    const snaps = db.prepare('SELECT COUNT(*) FROM inventory_daily_snapshots WHERE date = ?').pluck().get(today)
    expect(snaps).toBeGreaterThan(0)
  })
})
