import { domain, getDb } from './db.js'

// Fixture builders that write through the REAL domain functions, so tests
// exercise the same code paths production does — including the cost frozen onto
// each sale line, the stock movements, and the shift counters.
//
// Nothing here inserts rows directly; a raw INSERT would let a test pass against
// data the app could never actually produce.

const products = domain('products')
const stock = domain('stock')
const sales = domain('sales')
const expenses = domain('expenses')
const shifts = domain('shifts')

export function addProduct({ name, category = 'Food', sellingPrice = 10, reorderLevel = 5 }) {
  products.addProduct({
    name, category, unit: 'each',
    selling_price: sellingPrice, reorder_level: reorderLevel,
  })
  return getDb().prepare('SELECT id FROM products WHERE name = ?').pluck().get(name)
}

export function receive(productId, { units, costPerUnit, dateReceived = '2026-07-01' }) {
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

/** A product that exists and has stock at a known cost. */
export function stockedProduct({ name, category = 'Food', cost = 2, price = 5, units = 100 }) {
  const id = addProduct({ name, category, sellingPrice: price })
  receive(id, { units, costPerUnit: cost })
  return id
}

/**
 * Ring up a completed sale.
 * @param lines [{ productId, name, qty, cost, price }]
 */
export function sell({ cashier = 'jane', lines, paymentMethod = 'Cash', tillCode = null, shiftId = null }) {
  const total = lines.reduce((n, l) => n + l.qty * l.price, 0)
  const isSplit = paymentMethod === 'Split'
  return sales.addSale(
    {
      cashier,
      total,
      cash_tendered: total,
      change_given: 0,
      payment_method: paymentMethod,
      cash_amount: isSplit ? Math.round(total * 0.6 * 100) / 100 : paymentMethod === 'Cash' ? total : 0,
      usd_amount: isSplit ? Math.round(total * 0.4 * 100) / 100 : paymentMethod === 'Cash' ? 0 : total,
      till_code: tillCode,
      shift_id: shiftId,
    },
    lines.map((l) => ({
      product_id: l.productId,
      product_name: l.name,
      quantity: l.qty,
      cost_price: l.cost,
      selling_price: l.price,
      subtotal: l.qty * l.price,
    }))
  )
}

export function addExpense({ description = 'Rent', amount, category = 'Rent', date, paymentMethod = 'Cash', shiftId = null }) {
  return expenses.addExpense({
    description,
    amount,
    category,
    date,
    recorded_by: 'jane',
    payment_method: paymentMethod,
    shift_id: shiftId,
  })
}

export function startShift({ username = 'jane', displayName = 'Jane', openingCash = 50 }) {
  return shifts.startShift({ username, display_name: displayName }, openingCash, null)
}

/** Today as a local 'YYYY-MM-DD' — the same bucketing the engine uses. */
export function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
