import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { freshDb, disposeDb, domain, electronModule } from '../helpers/db.js'

// The production symptom this pins down:
//
//   17 Jul 2026 | 17:11 — 13:58 | 20h 46m | 145 txns
//   23 Jul 2026 | 09:10 — 08:48 | 47h 38m | 183 txns
//   14 Aug 2026 | 08:38 — 23:59 | 340 txns | $1035.95
//
// A drawer left open across midnight kept running, so 18 Jul, 24 Jul and 15 Aug
// had no shift row of their own and their takings were reported under the previous
// date. Closing the drawer alone was not enough either — the cashier was left with
// nothing open, so the next morning's sales had nowhere correct to go.

const products = domain('products')
const stock    = domain('stock')
const sales    = domain('sales')
const shifts   = domain('shifts')
const users    = domain('users')
const eventClock = electronModule('database/eventClock.js')
const { localDayStr } = electronModule('analytics/kernel/time.js')

let db

const dayOffset = (n) => {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return localDayStr(d)
}

// A UTC instant that lands at local midday on the given day, so the local-day
// bucketing is never ambiguous regardless of the machine's timezone.
const middayOf = (day) => {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d, 12, 0, 0).toISOString()
}

function stockedProduct(name = 'Bread', qty = 2000, cost = 2) {
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

// Ring up a sale as if it happened on a given local day, by borrowing the LAN
// replay clock — the same mechanism a satellite uses to record the true time.
function sellOn(day, pid, shiftId, amount = 4) {
  eventClock.setEventTime(middayOf(day))
  try {
    return sales.addSale(
      {
        cashier: 'jane', total: amount, cash_tendered: amount, change_given: 0,
        payment_method: 'Cash', cash_amount: amount, shift_id: shiftId, replayed: true,
      },
      [{ product_id: pid, product_name: 'Bread', quantity: 1, cost_price: 2, selling_price: amount, subtotal: amount }]
    )
  } finally { eventClock.clearEventTime() }
}

// A shift that opened on a past day and is still open — the runaway drawer.
function openShiftOn(day, openingCash = 50) {
  eventClock.setEventTime(middayOf(day))
  try {
    return shifts.startShift({ username: 'jane', name: 'Jane' }, openingCash, null)
  } finally { eventClock.clearEventTime() }
}

const shiftRow = (id) => db.prepare('SELECT * FROM shifts WHERE id = ?').get(id)
const openShifts = () => db.prepare("SELECT * FROM shifts WHERE status = 'open' ORDER BY id").all()
const allShifts = () => db.prepare('SELECT * FROM shifts ORDER BY id').all()

beforeEach(() => {
  db = freshDb()
  eventClock.clearEventTime()
  users.addUser({ username: 'jane', name: 'Jane', role: 'Cashier', password: '1234' })
})
afterAll(() => disposeDb())

describe('rolling a drawer over midnight', () => {
  it('closes yesterday and opens a continuation for today carrying the cash', () => {
    const pid = stockedProduct()
    const yesterday = dayOffset(-1)
    const shift = openShiftOn(yesterday, 50)
    sellOn(yesterday, pid, shift.id, 30)

    const res = shifts.rollOverOpenShifts()
    expect(res[0].success).toBe(true)

    const old = shiftRow(shift.id)
    expect(old.status).toBe('closed')
    expect(old.reconciliation_status).toBe('unreconciled')
    // Backdated to the end of the day it belongs to, so the recorded duration is
    // honest rather than growing forever.
    expect(localDayStr(new Date(old.closed_at))).toBe(yesterday)
    expect(old.notes).toMatch(/never counted/i)

    const live = openShifts()
    expect(live).toHaveLength(1)
    expect(live[0].business_date).toBe(dayOffset(0))
    expect(live[0].carried_from_shift_id).toBe(shift.id)
    // No cash appears or disappears across the boundary: the float carried in is
    // exactly the drawer figure carried out.
    expect(live[0].opening_cash).toBeCloseTo(old.closing_cash, 2)
    expect(live[0].opening_cash).toBeCloseTo(80, 2)   // 50 float + 30 cash sales
    expect(live[0].till_code).toBe(old.till_code)
    expect(live[0].notes).toMatch(/not been physically counted/i)

    // The cashier is pointed at the new drawer, so the next sale binds correctly.
    expect(db.prepare('SELECT current_shift_id FROM users WHERE username = ?').pluck().get('jane'))
      .toBe(live[0].id)
  })

  it('is idempotent — running it again opens nothing further', () => {
    const pid = stockedProduct()
    const yesterday = dayOffset(-1)
    const shift = openShiftOn(yesterday, 50)
    sellOn(yesterday, pid, shift.id, 10)

    shifts.rollOverOpenShifts()
    const after = allShifts().length
    const second = shifts.rollOverOpenShifts()

    expect(second).toHaveLength(0)
    expect(allShifts()).toHaveLength(after)
    expect(openShifts()).toHaveLength(1)
  })

  it('moves sales already rung up today onto the new drawer', () => {
    const pid = stockedProduct()
    const yesterday = dayOffset(-1)
    const today = dayOffset(0)
    const shift = openShiftOn(yesterday, 50)
    sellOn(yesterday, pid, shift.id, 10)
    // The app was asleep through midnight, so this morning's sales landed on the
    // stale drawer before the rollover caught up.
    sellOn(today, pid, shift.id, 7)

    shifts.rollOverOpenShifts()

    const live = openShifts()[0]
    const salesOn = (id) => db.prepare("SELECT COUNT(*) FROM sales WHERE shift_id = ? AND status = 'completed'").pluck().get(id)
    expect(salesOn(shift.id)).toBe(1)
    expect(salesOn(live.id)).toBe(1)
    // Cached counters were recomputed, not left stale.
    expect(shiftRow(shift.id).total_sales_count).toBe(1)
    expect(live.total_sales_count ?? shiftRow(live.id).total_sales_count).toBe(1)
  })
})

describe('the previous day is not inflated by the next day', () => {
  // The operational symptom: the 14 Aug drawer held 15 Aug's takings too, so its
  // expected cash, its transaction count and the End of Day figure the shop
  // reconciled against were all overstated — and there was no honest answer to
  // "what should the cashier have handed over on the 14th?"
  it('closes yesterday on that day money only', () => {
    const pid = stockedProduct()
    const yesterday = dayOffset(-1)
    const today = dayOffset(0)
    const shift = openShiftOn(yesterday, 50)
    sellOn(yesterday, pid, shift.id, 30)
    // Trading continued past midnight on the same stale drawer.
    sellOn(today, pid, shift.id, 500)

    shifts.rollOverOpenShifts()

    const old = shiftRow(shift.id)
    // 50 float + 30 taken yesterday. NOT 580.
    expect(old.closing_cash).toBeCloseTo(80, 2)
    expect(old.total_sales_value).toBeCloseTo(30, 2)
    expect(old.total_sales_count).toBe(1)

    // And today's drawer opens on yesterday's real closing figure, carrying
    // today's takings — no money invented, none lost.
    const live = openShifts()[0]
    expect(live.opening_cash).toBeCloseTo(80, 2)
    expect(shiftRow(live.id).total_sales_value).toBeCloseTo(500, 2)

    // Nothing was stranded by the parking step.
    const orphans = db.prepare(
      "SELECT COUNT(*) FROM sales WHERE shift_id IS NULL AND status = 'completed'"
    ).pluck().get()
    expect(orphans).toBe(0)
  })

  it('keeps each swallowed day on its own money across several days', () => {
    const pid = stockedProduct()
    const days = [dayOffset(-3), dayOffset(-2), dayOffset(-1), dayOffset(0)]
    const shift = openShiftOn(days[0], 50)
    const amounts = { [days[0]]: 11, [days[1]]: 22, [days[2]]: 33, [days[3]]: 44 }
    for (const d of days) sellOn(d, pid, shift.id, amounts[d])

    shifts.rollOverOpenShifts()

    // Each drawer closes on its own day's takings, and each float is the previous
    // drawer's real closing figure — the cash chain never double-counts.
    let expectedFloat = 50
    for (const d of days) {
      const row = db.prepare('SELECT * FROM shifts WHERE business_date = ?').get(d)
      expect(row.opening_cash, `float for ${d}`).toBeCloseTo(expectedFloat, 2)
      expect(row.total_sales_value, `takings for ${d}`).toBeCloseTo(amounts[d], 2)
      expectedFloat += amounts[d]
      if (row.status === 'closed') expect(row.closing_cash, `closing for ${d}`).toBeCloseTo(expectedFloat, 2)
    }
  })
})

describe('a drawer left open across several days', () => {
  // The real 47h 38m row: one shift covering 23, 24 and 25 Jul.
  it('gives every day that took money a shift of its own', () => {
    const pid = stockedProduct()
    const days = [dayOffset(-3), dayOffset(-2), dayOffset(-1), dayOffset(0)]
    const shift = openShiftOn(days[0], 50)
    const amounts = { [days[0]]: 11, [days[1]]: 22, [days[2]]: 33, [days[3]]: 44 }
    for (const d of days) sellOn(d, pid, shift.id, amounts[d])

    shifts.rollOverOpenShifts()

    // This is the assertion the production data would have failed: no day that
    // took money is left without a drawer.
    for (const d of days) {
      const rows = db.prepare('SELECT * FROM shifts WHERE business_date = ?').all(d)
      expect(rows.length, `no shift for ${d}`).toBeGreaterThanOrEqual(1)
    }

    // And each day's takings sit on that day's drawer — not merged onto the first.
    for (const d of days) {
      const viaShifts = db.prepare(
        `SELECT COALESCE(SUM(sh.total_sales_value), 0) FROM shifts sh WHERE sh.business_date = ?`
      ).pluck().get(d)
      expect(viaShifts, `totals for ${d}`).toBeCloseTo(amounts[d], 2)
    }

    // Exactly one drawer is live, and it is today's.
    const live = openShifts()
    expect(live).toHaveLength(1)
    expect(live[0].business_date).toBe(days[3])

    // Past continuations are closed unreconciled — nobody counted them at the time
    // and the system must not claim they balanced.
    const past = db.prepare(
      "SELECT * FROM shifts WHERE business_date IN (?, ?) AND carried_from_shift_id IS NOT NULL"
    ).all(days[1], days[2])
    expect(past).toHaveLength(2)
    for (const row of past) {
      expect(row.status).toBe('closed')
      expect(row.reconciliation_status).toBe('unreconciled')
    }
  })

  it('does not invent a drawer for a day the shop never traded', () => {
    const pid = stockedProduct()
    const start = dayOffset(-3)
    const shift = openShiftOn(start, 50)
    sellOn(start, pid, shift.id, 10)
    // Nothing at all on the two days in between.

    shifts.rollOverOpenShifts()

    expect(db.prepare('SELECT COUNT(*) FROM shifts WHERE business_date = ?').pluck().get(dayOffset(-2))).toBe(0)
    expect(db.prepare('SELECT COUNT(*) FROM shifts WHERE business_date = ?').pluck().get(dayOffset(-1))).toBe(0)
    expect(openShifts()).toHaveLength(1)
  })
})

describe('the business day stamped on a shift', () => {
  it('always matches the local day the drawer opened', () => {
    openShiftOn(dayOffset(-1))
    shifts.startShift({ username: 'jane', name: 'Jane' }, 20, null)
    shifts.rollOverOpenShifts()

    for (const row of allShifts()) {
      expect(row.business_date).toBe(localDayStr(new Date(row.started_at)))
    }
  })
})
