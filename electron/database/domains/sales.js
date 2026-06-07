const { getDb, saveDb } = require('../index')
const { extractResults } = require('../utils')
const { getProductById, updateProductQuantity } = require('./products')
const { logAuditAction } = require('./audit')

function addSale(sale, saleItems) {
  const db = getDb()

  // Validate all products first
  for (const item of saleItems) {
    if (!getProductById(item.product_id)) throw new Error(`Product with ID ${item.product_id} not found`)
  }

  db.run('BEGIN TRANSACTION')
  let saleId = null
  try {
    db.run(
      `INSERT INTO sales (cashier, branch_id, total, cash_tendered, change_given, payment_method, currency, note, status, shift_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?)`,
      [sale.cashier, sale.branch_id || null, sale.total, sale.cash_tendered, sale.change_given,
       sale.payment_method || 'USD Cash', sale.currency || 'USD', sale.note || '', sale.shift_id || null]
    )
    saleId = extractResults(db.exec('SELECT last_insert_rowid() as id'))[0].id

    const now = new Date().toISOString()
    for (const item of saleItems) {
      db.run(
        `INSERT INTO sale_items (sale_id, product_id, product_name, quantity, cost_price, selling_price, subtotal) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [saleId, item.product_id, item.product_name, item.quantity, item.cost_price, item.selling_price, item.subtotal]
      )
      const product = getProductById(item.product_id)
      const newQty = (product.current_quantity || 0) - item.quantity
      db.run(`UPDATE products SET current_quantity = ?, last_sold_date = ? WHERE id = ?`, [newQty, now, item.product_id])
      db.run(
        `INSERT INTO stock_movements (product_id, product_name, movement_type, quantity, recorded_by) VALUES (?, ?, 'SOLD', ?, ?)`,
        [item.product_id, item.product_name, item.quantity, sale.cashier]
      )
    }

    if (sale.shift_id) {
      db.run(`UPDATE shifts SET total_sales_count = total_sales_count + 1, total_sales_value = total_sales_value + ? WHERE id = ?`,
        [sale.total, sale.shift_id])
    }

    db.run('COMMIT')
  } catch (err) {
    try { db.run('ROLLBACK') } catch (_) {}
    throw err
  }

  saveDb()
  try {
    const summary = saleItems.map(i => `${i.product_name} x${i.quantity}`).join(', ')
    logAuditAction(sale.cashier, 'CREATE_SALE', 'SALE', String(saleId), `Sale ${saleId}: ${summary} | Total: $${sale.total}`)
  } catch (_) {}

  return saleId
}

function getSales() {
  return extractResults(getDb().exec('SELECT * FROM sales ORDER BY created_at DESC'))
}

function getSaleById(id) {
  const rows = extractResults(getDb().exec('SELECT * FROM sales WHERE id = ?', [id]))
  return rows[0] || null
}

function getSaleItems(saleId) {
  if (saleId) return extractResults(getDb().exec('SELECT * FROM sale_items WHERE sale_id = ?', [saleId]))
  return extractResults(getDb().exec('SELECT * FROM sale_items ORDER BY id DESC'))
}

function holdSale(saleId, heldName) {
  getDb().run(
    `UPDATE sales SET status = 'held', held_name = ?, held_at = ? WHERE id = ?`,
    [heldName || `Hold-${saleId}`, new Date().toISOString(), saleId]
  )
  saveDb()
}

function getHeldSales() {
  return extractResults(getDb().exec(`SELECT * FROM sales WHERE status = 'held' ORDER BY held_at DESC`))
}

function recallHeldSale(saleId) {
  getDb().run(
    `UPDATE sales SET status = 'pending', released_from_hold_at = ? WHERE id = ?`,
    [new Date().toISOString(), saleId]
  )
  saveDb()
  const sale = getSaleById(saleId)
  const items = getSaleItems(saleId)
  return { ...sale, items }
}

function discardHeldSale(saleId) {
  const items = getSaleItems(saleId)
  for (const item of items) {
    const product = getProductById(item.product_id)
    if (product) updateProductQuantity(item.product_id, (product.current_quantity || 0) + item.quantity)
  }
  getDb().run('DELETE FROM sale_items WHERE sale_id = ?', [saleId])
  getDb().run('DELETE FROM sales WHERE id = ?', [saleId])
  saveDb()
}

function voidSale(saleId, voidReason, voidedBy) {
  const db = getDb()
  const sale = getSaleById(saleId)
  if (!sale) throw new Error('Sale not found')

  const hoursDiff = (Date.now() - new Date(sale.created_at)) / (1000 * 60 * 60)
  if (hoursDiff > 24) throw new Error('Cannot void sales older than 24 hours')

  const items = getSaleItems(saleId)
  for (const item of items) {
    if (!getProductById(item.product_id)) throw new Error(`Product with ID ${item.product_id} not found`)
  }

  db.run('BEGIN TRANSACTION')
  try {
    const now = new Date().toISOString()
    for (const item of items) {
      const product = getProductById(item.product_id)
      const newQty = (product.current_quantity || 0) + item.quantity
      db.run(`UPDATE products SET current_quantity = ? WHERE id = ?`, [newQty, item.product_id])
      db.run(
        `INSERT INTO stock_movements (product_id, product_name, movement_type, quantity, note, recorded_by) VALUES (?, ?, 'VOIDED', ?, ?, ?)`,
        [item.product_id, item.product_name, item.quantity, `Void sale #${saleId}: ${voidReason}`, voidedBy]
      )
    }
    db.run(`UPDATE sales SET status = 'voided', void_reason = ?, voided_by = ?, voided_at = ? WHERE id = ?`,
      [voidReason, voidedBy, now, saleId])
    if (sale.shift_id) {
      db.run(`UPDATE shifts SET total_sales_count = MAX(0, total_sales_count - 1), total_sales_value = MAX(0, total_sales_value - ?) WHERE id = ?`,
        [sale.total, sale.shift_id])
    }
    db.run('COMMIT')
  } catch (err) {
    try { db.run('ROLLBACK') } catch (_) {}
    throw err
  }

  saveDb()
  try { logAuditAction(voidedBy, 'VOID_SALE', 'SALE', String(saleId), `Sale ${saleId} voided: ${voidReason}`) } catch (_) {}
  return true
}

function completeHeldSale(saleId, cashTendered, changeGiven, shiftId) {
  const db = getDb()
  db.run(
    `UPDATE sales SET status = 'completed', cash_tendered = ?, change_given = ?, payment_method = 'USD Cash', shift_id = COALESCE(?, shift_id)
     WHERE id = ? AND (status = 'pending' OR status = 'held')`,
    [cashTendered, changeGiven, shiftId || null, saleId]
  )
  if (shiftId) {
    const sale = getSaleById(saleId)
    if (sale) db.run(`UPDATE shifts SET total_sales_count = total_sales_count + 1, total_sales_value = total_sales_value + ? WHERE id = ?`,
      [sale.total, shiftId])
  }
  saveDb()
  try { logAuditAction('system', 'COMPLETE_HELD_SALE', 'SALE', String(saleId), `Held sale ${saleId} completed`) } catch (_) {}
  return saleId
}

function getVoidedSales() {
  return extractResults(getDb().exec(`SELECT * FROM sales WHERE status = 'voided' ORDER BY voided_at DESC`))
}

function getLastReceiptNumber() {
  const rows = extractResults(getDb().exec(`SELECT receipt_number FROM sales WHERE receipt_number IS NOT NULL ORDER BY created_at DESC LIMIT 1`))
  return rows[0]?.receipt_number || null
}

function getReceiptBySaleId(saleId) {
  const sale = getSaleById(saleId)
  if (!sale) return null
  const items = getSaleItems(saleId)
  return { ...sale, items }
}

function updateSaleReceiptNumber(saleId, receiptNumber) {
  getDb().run('UPDATE sales SET receipt_number = ? WHERE id = ?', [receiptNumber, saleId])
  saveDb()
}

module.exports = {
  addSale, getSales, getSaleById, getSaleItems, holdSale, getHeldSales,
  recallHeldSale, discardHeldSale, voidSale, completeHeldSale, getVoidedSales,
  getLastReceiptNumber, getReceiptBySaleId, updateSaleReceiptNumber
}
