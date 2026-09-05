import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { freshDb, disposeDb, domain, electronModule } from '../helpers/db.js'

// The cash ledger exists because the app could not answer "how much cash does
// this business have?". Cash was reconciled per shift and per day and then
// forgotten; nothing carried a balance forward, and money that moved for any
// other reason — the owner taking cash out, putting it in, taking cash to buy
// stock, banking the takings — was invisible.
//
// These tests pin the arithmetic that answers it, and the boundaries where it
// is easiest to get wrong: what counts as drawer cash, what an opening balance
// includes, and the rule that none of this touches profit.

const cash     = domain('cashMovements')
const products = domain('products')
const stock    = domain('stock')
const sales    = domain('sales')
const expenses = domain('expenses')
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

function stockedProduct(name = 'Bread', qty = 1000) {
  products.addProduct({ name, category: 'Food', unit: 'each', selling_price: 10 })
  const id = db.prepare('SELECT id FROM products WHERE name = ?').pluck().get(name)
  stock.addStockReceiving({
    supplier_id: null, product_id: id, date_received: dayOffset(-30),
    cartons: 1, units_per_carton: qty, total_units: qty,
    cost_per_carton: qty * 4, cost_per_unit: 4, total_value: qty * 4,
    recorded_by: 'tester',
  })
  return id
}

/** A completed sale of `amount`, tendered by `method`, on `day`. */
function sellOn(day, pid, amount, method = 'Cash') {
  eventClock.setEventTime(middayOf(day))
  try {
    return sales.addSale(
      { cashier: 'tester', total: amount, cash_tendered: amount, change_given: 0,
        payment_method: method,
        cash_amount: method === 'Cash' ? amount : 0,
        usd_amount:  method === 'Cash' ? 0 : amount,
        shift_id: null, replayed: true },
      [{ product_id: pid, product_name: 'Bread', quantity: 1,
         cost_price: 4, selling_price: amount, subtotal: amount }]
    )
  } finally { eventClock.clearEventTime() }
}

function record(type, amount, day, extra = {}) {
  return cash.addCashMovement({
    type, amount, date: day, recorded_by: 'owner', ...extra,
  })
}

describe('cash position', () => {
  beforeEach(() => {
    db = freshDb()
  })

  afterAll(() => disposeDb())

  it('starts a shop with no money rather than an undefined balance', () => {
    const pos = cash.getCashPosition({ from: dayOffset(-7), to: dayOffset(0) })
    expect(pos.total_money).toBe(0)
    expect(pos.cash_in_hand).toBe(0)
    expect(pos.opening_balance).toBe(0)
  })

  // The parts must always add up to the headline. If a pocket is dropped or
  // double counted the owner is shown a total that nothing explains.
  it('always has its pockets sum exactly to the total', () => {
    const pid = stockedProduct()
    sellOn(dayOffset(-1), pid, 100, 'Cash')
    sellOn(dayOffset(-1), pid, 250, 'EcoCash')
    record('owner_draw', 40, dayOffset(-1), { payment_method: 'EcoCash' })
    record('capital_in', 60, dayOffset(-1), { payment_method: 'Transfer' })

    const pos = cash.getCashPosition({ from: dayOffset(-7), to: dayOffset(0) })
    const summed = pos.by_tender.reduce((n, t) => n + t.balance, 0)
    expect(summed).toBeCloseTo(pos.total_money, 6)
  })

  it('adds cash sales and subtracts cash expenses', () => {
    const pid = stockedProduct()
    sellOn(dayOffset(-1), pid, 100)
    expenses.addExpense({
      description: 'Electricity', amount: 30, category: 'Utilities',
      date: dayOffset(-1), recorded_by: 'owner', payment_method: 'Cash',
    })

    const pos = cash.getCashPosition({ from: dayOffset(-7), to: dayOffset(0) })
    expect(pos.movement.sales).toBe(100)
    expect(pos.movement.expenses).toBe(30)
    expect(pos.total_money).toBe(70)
    expect(pos.cash_in_hand).toBe(70)
  })

  it('subtracts what the owner takes out and adds what they put in', () => {
    const pid = stockedProduct()
    sellOn(dayOffset(-1), pid, 200)

    record('owner_draw', 50, dayOffset(-1))
    record('capital_in', 20, dayOffset(-1))

    const pos = cash.getCashPosition({ from: dayOffset(-7), to: dayOffset(0) })
    expect(pos.movement.money_out).toBe(50)
    expect(pos.movement.money_in).toBe(20)
    expect(pos.total_money).toBe(170)
    expect(pos.cash_in_hand).toBe(170)
  })

  it('treats cash taken to buy stock as money leaving the drawer', () => {
    const pid = stockedProduct()
    sellOn(dayOffset(-1), pid, 300)
    record('stock_purchase', 120, dayOffset(-1), { counterparty: 'Mai Rudo Wholesalers' })

    const pos = cash.getCashPosition({ from: dayOffset(-7), to: dayOffset(0) })
    expect(pos.total_money).toBe(180)

    const byType = pos.by_type.find(t => t.type === 'stock_purchase')
    expect(byType.direction).toBe('out')
    expect(byType.total).toBe(120)
  })

  // The defect this model was rebuilt to fix. Money taken out by EcoCash left
  // the business, so it must reduce what the business has. The earlier version
  // counted only the drawer, so this drawing vanished from every headline.
  it('counts money taken out by EcoCash against the EcoCash pocket', () => {
    const pid = stockedProduct()
    sellOn(dayOffset(-1), pid, 100, 'Cash')
    sellOn(dayOffset(-1), pid, 300, 'EcoCash')

    record('owner_draw', 40, dayOffset(-1), { payment_method: 'EcoCash' })

    const pos = cash.getCashPosition({ from: dayOffset(-7), to: dayOffset(0) })
    const byId = Object.fromEntries(pos.by_tender.map(t => [t.id, t]))

    // It comes off EcoCash, not the drawer...
    expect(byId.ecocash.balance).toBe(260)
    expect(byId.cash.balance).toBe(100)
    // ...and it genuinely reduces the business's money.
    expect(pos.total_money).toBe(360)
    expect(pos.movement.money_out).toBe(40)
  })

  it('keeps electronic takings in the total, in their own pocket', () => {
    const pid = stockedProduct()
    sellOn(dayOffset(-1), pid, 80, 'Cash')
    sellOn(dayOffset(-1), pid, 150, 'EcoCash')

    const pos = cash.getCashPosition({ from: dayOffset(-7), to: dayOffset(0) })
    const byId = Object.fromEntries(pos.by_tender.map(t => [t.id, t]))

    expect(pos.cash_in_hand).toBe(80)
    expect(byId.ecocash.balance).toBe(150)
    // The whole 230 is the business's money — none of it is a footnote.
    expect(pos.total_money).toBe(230)
  })

  it('keeps foreign-currency cash out of the drawer total', () => {
    const pid = stockedProduct()
    sellOn(dayOffset(-1), pid, 50, 'Cash')
    sellOn(dayOffset(-1), pid, 20, 'ZAR Cash')

    const pos = cash.getCashPosition({ from: dayOffset(-7), to: dayOffset(0) })
    const byId = Object.fromEntries(pos.by_tender.map(t => [t.id, t]))

    // Rand is physically cash but not dollars; folding it into cash in hand
    // would report a drawer figure the shop could never count to.
    expect(pos.cash_in_hand).toBe(50)
    expect(byId.zar.balance).toBe(20)
  })

  it('carries everything before the window into the opening balance', () => {
    const pid = stockedProduct()
    sellOn(dayOffset(-20), pid, 500)   // before the window
    record('owner_draw', 100, dayOffset(-20))
    sellOn(dayOffset(-2), pid, 60)     // inside it

    const pos = cash.getCashPosition({ from: dayOffset(-7), to: dayOffset(0) })
    expect(pos.opening_balance).toBe(400)
    expect(pos.movement.sales).toBe(60)
    expect(pos.total_money).toBe(460)
  })

  it('reports a negative position rather than hiding an overdrawn till', () => {
    const pid = stockedProduct()
    sellOn(dayOffset(-1), pid, 50)
    record('owner_draw', 200, dayOffset(-1))

    const pos = cash.getCashPosition({ from: dayOffset(-7), to: dayOffset(0) })
    expect(pos.total_money).toBe(-150)
  })

  it('drops a deleted movement out of the position but keeps the row', () => {
    const pid = stockedProduct()
    sellOn(dayOffset(-1), pid, 100)
    const { id } = record('owner_draw', 40, dayOffset(-1))

    expect(cash.getCashPosition({ from: dayOffset(-7), to: dayOffset(0) }).total_money).toBe(60)

    cash.deleteCashMovement(id, 'owner')

    expect(cash.getCashPosition({ from: dayOffset(-7), to: dayOffset(0) }).total_money).toBe(100)
    expect(cash.getCashMovements({})).toHaveLength(0)
    // Soft delete: the row survives so the removal can reach other devices.
    expect(db.prepare('SELECT COUNT(*) FROM cash_movements').pluck().get()).toBe(1)
  })
})

describe('movement types', () => {
  beforeEach(() => { db = freshDb() })
  afterAll(() => disposeDb())

  it('infers direction from the type so a drawing cannot be filed as income', () => {
    expect(cash.resolveDirection('owner_draw')).toBe('out')
    expect(cash.resolveDirection('capital_in')).toBe('in')
    // Even if a caller insists otherwise.
    expect(cash.resolveDirection('owner_draw', 'in')).toBe('out')
  })

  it('asks for a direction only on a correction, which could go either way', () => {
    expect(cash.resolveDirection('adjustment')).toBeNull()
    expect(cash.resolveDirection('adjustment', 'in')).toBe('in')
    expect(cash.resolveDirection('adjustment', 'out')).toBe('out')
  })

  it('refuses an unknown type instead of writing an unclassifiable row', () => {
    expect(cash.resolveDirection('nonsense', 'in')).toBeNull()
    expect(() => record('nonsense', 10, dayOffset(0))).toThrow(/Unknown movement type/)
  })

  it('refuses a zero or negative amount, since direction carries the sign', () => {
    expect(() => record('owner_draw', 0, dayOffset(0))).toThrow(/greater than zero/)
    expect(() => record('owner_draw', -5, dayOffset(0))).toThrow(/greater than zero/)
  })
})

describe('the ledger never touches profit', () => {
  beforeEach(() => { db = freshDb() })
  afterAll(() => disposeDb())

  // The whole point of a separate table. Owners currently have to file a
  // drawing as an "Other" expense, which understates profit by that amount.
  it('leaves recorded expenses alone when money moves', () => {
    const pid = stockedProduct()
    sellOn(dayOffset(-1), pid, 500)
    expenses.addExpense({
      description: 'Rent', amount: 100, category: 'Rent',
      date: dayOffset(-1), recorded_by: 'owner', payment_method: 'Cash',
    })

    record('owner_draw', 200, dayOffset(-1))
    record('stock_purchase', 150, dayOffset(-1))

    // The money position reflects all of it...
    expect(cash.getCashPosition({ from: dayOffset(-7), to: dayOffset(0) }).total_money).toBe(50)

    // ...but the expense ledger — the only thing that reduces profit — sees
    // only the rent.
    const recorded = expenses.getExpenses()
    expect(recorded).toHaveLength(1)
    expect(recorded[0].description).toBe('Rent')
    expect(recorded.reduce((n, e) => n + e.amount, 0)).toBe(100)
  })
})
