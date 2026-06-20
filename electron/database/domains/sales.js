const { getDb } = require('../index')
const { getProductById, updateProductQuantity } = require('./products')
const { logAuditAction } = require('./audit')

function addSale(sale, saleItems) {
  const db = getDb()

  // Validate all products and stock levels before any write
  for (const item of saleItems) {
    const product = getProductById(item.product_id)
    if (!product) throw new Error(`Product with ID ${item.product_id} not found`)
    if (product.current_quantity < item.quantity)
      throw new Error(`Insufficient stock for "${product.name}": ${product.current_quantity} available, ${item.quantity} requested`)
  }

  const insertSale = db.prepare(
    `INSERT INTO sales (cashier, branch_id, total, cash_tendered, change_given, payment_method, cash_amount, usd_amount, currency, note, status, shift_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?)`
  )
  const insertItem = db.prepare(
    `INSERT INTO sale_items (sale_id, product_id, product_name, quantity, cost_price, selling_price, subtotal) VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
  const updateQty = db.prepare(`UPDATE products SET current_quantity = ?, last_sold_date = ? WHERE id = ?`)
  const insertMovement = db.prepare(
    `INSERT INTO stock_movements (product_id, product_name, movement_type, quantity, recorded_by) VALUES (?, ?, 'SOLD', ?, ?)`
  )
  const updateShift = db.prepare(
    `UPDATE shifts SET total_sales_count = total_sales_count + 1, total_sales_value = total_sales_value + ? WHERE id = ?`
  )

  const doSale = db.transaction(() => {
    const cashAmt = parseFloat(sale.cash_amount) || 0
    const usdAmt  = parseFloat(sale.usd_amount)  || 0
    let method = sale.payment_method
    if (!method) {
      if (cashAmt > 0 && usdAmt > 0) method = 'Split'
      else if (usdAmt > 0) method = 'USD'
      else method = 'Cash'
    }
    const saleId = insertSale.run(
      sale.cashier, sale.branch_id || null, sale.total, sale.cash_tendered, sale.change_given,
      method, cashAmt, usdAmt, sale.currency || 'USD', sale.note || '', sale.shift_id || null
    ).lastInsertRowid

    const now = new Date().toISOString()
    for (const item of saleItems) {
      insertItem.run(saleId, item.product_id, item.product_name, item.quantity, item.cost_price, item.selling_price, item.subtotal)
      const product = getProductById(item.product_id)
      updateQty.run((product.current_quantity || 0) - item.quantity, now, item.product_id)
      insertMovement.run(item.product_id, item.product_name, item.quantity, sale.cashier)
    }

    if (sale.shift_id) updateShift.run(sale.total, sale.shift_id)
    return saleId
  })

  const saleId = doSale()

  try {
    const summary = saleItems.map(i => `${i.product_name} x${i.quantity}`).join(', ')
    logAuditAction(sale.cashier, 'CREATE_SALE', 'SALE', String(saleId), `Sale ${saleId}: ${summary} | Total: $${sale.total}`)
  } catch (_) {}

  return saleId
}

function getSales() {
  return getDb().prepare(
    `SELECT s.*, (SELECT COUNT(*) FROM sale_items si WHERE si.sale_id = s.id) AS items_count
     FROM sales s ORDER BY s.created_at DESC`
  ).all()
}

function getSaleById(id) {
  return getDb().prepare('SELECT * FROM sales WHERE id = ?').get(id) || null
}

function getSaleItems(saleId) {
  if (saleId) return getDb().prepare('SELECT * FROM sale_items WHERE sale_id = ?').all(saleId)
  return getDb().prepare('SELECT * FROM sale_items ORDER BY id DESC').all()
}

function holdSale(saleId, heldName) {
  getDb().prepare(
    `UPDATE sales SET status = 'held', held_name = ?, held_at = ?, sync_updated_at = datetime('now') WHERE id = ?`
  ).run(heldName || `Hold-${saleId}`, new Date().toISOString(), saleId)
}

function getHeldSales() {
  return getDb().prepare(`SELECT * FROM sales WHERE status = 'held' ORDER BY held_at DESC`).all()
}

function recallHeldSale(saleId) {
  getDb().prepare(
    `UPDATE sales SET status = 'pending', released_from_hold_at = ?, sync_updated_at = datetime('now') WHERE id = ?`
  ).run(new Date().toISOString(), saleId)
  const sale = getSaleById(saleId)
  const items = getSaleItems(saleId)
  return { ...sale, items }
}

function discardHeldSale(saleId) {
  const db = getDb()
  const items = getSaleItems(saleId)
  db.transaction(() => {
    for (const item of items) {
      const product = getProductById(item.product_id)
      if (product) updateProductQuantity(item.product_id, (product.current_quantity || 0) + item.quantity)
    }
    db.prepare('DELETE FROM sale_items WHERE sale_id = ?').run(saleId)
    db.prepare('DELETE FROM sales WHERE id = ?').run(saleId)
  })()
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

  const updateQty = db.prepare(`UPDATE products SET current_quantity = ? WHERE id = ?`)
  const insertMovement = db.prepare(
    `INSERT INTO stock_movements (product_id, product_name, movement_type, quantity, note, recorded_by) VALUES (?, ?, 'VOIDED', ?, ?, ?)`
  )

  db.transaction(() => {
    const now = new Date().toISOString()
    for (const item of items) {
      const product = getProductById(item.product_id)
      updateQty.run((product.current_quantity || 0) + item.quantity, item.product_id)
      insertMovement.run(item.product_id, item.product_name, item.quantity, `Void sale #${saleId}: ${voidReason}`, voidedBy)
    }
    db.prepare(`UPDATE sales SET status = 'voided', void_reason = ?, voided_by = ?, voided_at = ?, sync_updated_at = datetime('now') WHERE id = ?`)
      .run(voidReason, voidedBy, now, saleId)
    if (sale.shift_id) {
      db.prepare(`UPDATE shifts SET total_sales_count = MAX(0, total_sales_count - 1), total_sales_value = MAX(0, total_sales_value - ?) WHERE id = ?`)
        .run(sale.total, sale.shift_id)
    }
  })()

  try { logAuditAction(voidedBy, 'VOID_SALE', 'SALE', String(saleId), `Sale ${saleId} voided: ${voidReason}`) } catch (_) {}
  return true
}

function completeHeldSale(saleId, paymentData, shiftId) {
  const db = getDb()
  const cashAmt = parseFloat(paymentData?.cash_amount) || 0
  const usdAmt  = parseFloat(paymentData?.usd_amount)  || 0
  let method = paymentData?.payment_method
  if (!method) {
    if (cashAmt > 0 && usdAmt > 0) method = 'Split'
    else if (usdAmt > 0) method = 'USD'
    else method = 'Cash'
  }
  db.prepare(
    `UPDATE sales SET status = 'completed', cash_tendered = ?, change_given = ?, payment_method = ?, cash_amount = ?, usd_amount = ?, shift_id = COALESCE(?, shift_id), sync_updated_at = datetime('now')
     WHERE id = ? AND (status = 'pending' OR status = 'held')`
  ).run(paymentData?.cash_tendered || 0, paymentData?.change_given || 0, method, cashAmt, usdAmt, shiftId || null, saleId)
  if (shiftId) {
    const sale = getSaleById(saleId)
    if (sale) db.prepare(`UPDATE shifts SET total_sales_count = total_sales_count + 1, total_sales_value = total_sales_value + ? WHERE id = ?`)
      .run(sale.total, shiftId)
  }
  try { logAuditAction('system', 'COMPLETE_HELD_SALE', 'SALE', String(saleId), `Held sale ${saleId} completed`) } catch (_) {}
  return saleId
}

function getVoidedSales() {
  return getDb().prepare(`SELECT * FROM sales WHERE status = 'voided' ORDER BY voided_at DESC`).all()
}

function getLastReceiptNumber() {
  return getDb().prepare(`SELECT receipt_number FROM sales WHERE receipt_number IS NOT NULL ORDER BY created_at DESC LIMIT 1`).pluck().get() || null
}

function getSalesByShift(shiftId) {
  const sales = getDb().prepare(
    `SELECT * FROM sales WHERE shift_id = ? AND status = 'completed' ORDER BY created_at DESC`
  ).all(shiftId)
  return sales.map(sale => ({ ...sale, items: getSaleItems(sale.id) }))
}

function getReceiptBySaleId(saleId) {
  const sale = getSaleById(saleId)
  if (!sale) return null
  return { ...sale, items: getSaleItems(saleId) }
}

function updateSaleReceiptNumber(saleId, receiptNumber) {
  getDb().prepare(`UPDATE sales SET receipt_number = ?, sync_updated_at = datetime('now') WHERE id = ?`).run(receiptNumber, saleId)
}

module.exports = {
  addSale, getSales, getSaleById, getSaleItems, holdSale, getHeldSales,
  recallHeldSale, discardHeldSale, voidSale, completeHeldSale, getVoidedSales,
  getLastReceiptNumber, getReceiptBySaleId, updateSaleReceiptNumber, getSalesByShift
}
