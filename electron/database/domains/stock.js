const { getDb } = require('../index')
const { getProductById } = require('./products')

function addStockReceiving(receiving) {
  const db = getDb()
  const product = getProductById(receiving.product_id)
  if (!product) throw new Error(`Product with ID ${receiving.product_id} not found`)

  db.transaction(() => {
    db.prepare(
      `INSERT INTO stock_receivings (supplier_id, product_id, date_received, cartons, units_per_carton, total_units, cost_per_carton, cost_per_unit, total_value, recorded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(receiving.supplier_id, receiving.product_id, receiving.date_received, receiving.cartons,
      receiving.units_per_carton, receiving.total_units, receiving.cost_per_carton,
      receiving.cost_per_unit, receiving.total_value, receiving.recorded_by)
    db.prepare(`UPDATE products SET current_quantity = ? WHERE id = ?`)
      .run((product.current_quantity || 0) + receiving.total_units, receiving.product_id)
    db.prepare(
      `INSERT INTO stock_movements (product_id, product_name, movement_type, quantity, recorded_by) VALUES (?, ?, 'RECEIVED', ?, ?)`
    ).run(receiving.product_id, product.name, receiving.total_units, receiving.recorded_by)
  })()
}

function getStockReceivings() {
  return getDb().prepare(`
    SELECT sr.*, p.name as product_name, s.name as supplier_name
    FROM stock_receivings sr
    LEFT JOIN products p ON sr.product_id = p.id
    LEFT JOIN suppliers s ON sr.supplier_id = s.id
    ORDER BY sr.date_received DESC
  `).all()
}

function getStockReceivingById(id) {
  return getDb().prepare(`
    SELECT sr.*, p.name as product_name, s.name as supplier_name
    FROM stock_receivings sr
    LEFT JOIN products p ON sr.product_id = p.id
    LEFT JOIN suppliers s ON sr.supplier_id = s.id
    WHERE sr.id = ?
  `).get(id) || null
}

function getAllPurchaseHistory() {
  return getDb().prepare(`
    SELECT sr.id, sr.date_received, p.name as product_name,
           COALESCE(s.name, 'Direct Purchase') as supplier_name,
           sr.cartons, sr.units_per_carton, sr.total_units,
           sr.cost_per_unit, sr.cost_per_carton, sr.total_value,
           CASE WHEN sr.supplier_id IS NULL THEN 'direct' ELSE 'supplier' END as purchase_type
    FROM stock_receivings sr
    LEFT JOIN products p ON sr.product_id = p.id
    LEFT JOIN suppliers s ON sr.supplier_id = s.id
    ORDER BY sr.created_at DESC, sr.date_received DESC
  `).all()
}

function recordDirectPurchase(purchase) {
  const db = getDb()
  const product = getProductById(purchase.product_id)
  if (!product) throw new Error(`Product with ID ${purchase.product_id} not found`)

  const qty = purchase.quantity || 0
  const cpu = parseFloat(purchase.cost_per_unit) || 0
  const totalCost = qty * cpu
  const dateReceived = purchase.date_received || new Date().toISOString().split('T')[0]

  db.transaction(() => {
    db.prepare(
      `INSERT INTO stock_receivings (supplier_id, product_id, date_received, cartons, units_per_carton, total_units, cost_per_carton, cost_per_unit, total_value, recorded_by)
       VALUES (NULL, ?, ?, 1, ?, ?, ?, ?, ?, ?)`
    ).run(purchase.product_id, dateReceived, qty, qty, totalCost, cpu, totalCost, purchase.recorded_by || 'System')
    db.prepare(`UPDATE products SET current_quantity = ? WHERE id = ?`)
      .run((product.current_quantity || 0) + qty, purchase.product_id)
    db.prepare(
      `INSERT INTO stock_movements (product_id, product_name, movement_type, quantity, note, recorded_by) VALUES (?, ?, 'DIRECT_PURCHASE', ?, ?, ?)`
    ).run(purchase.product_id, product.name, qty, purchase.notes || '', purchase.recorded_by || 'System')
  })()
}

function getDeadStockProducts(days = 30) {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
  return getDb().prepare(`
    SELECT p.*,
      COALESCE((SELECT cost_per_unit FROM stock_receivings WHERE product_id = p.id ORDER BY date_received DESC LIMIT 1), 0) as latest_cost_per_unit
    FROM products p
    WHERE p.current_quantity > 0 AND (p.last_sold_date IS NULL OR p.last_sold_date < ?)
    ORDER BY p.last_sold_date ASC
  `).all(cutoff)
}

function getRestockNeeded() {
  return getDb().prepare(`
    SELECT p.*, (p.reorder_level - p.current_quantity) as shortfall,
           COALESCE(s.name, 'No Supplier') as supplier_name
    FROM products p
    LEFT JOIN suppliers s ON p.supplier_id = s.id
    WHERE p.current_quantity <= p.reorder_level
    ORDER BY shortfall DESC
  `).all()
}

function getProductSalesVelocity(days = 30) {
  const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
  return getDb().prepare(`
    SELECT p.id, p.name, p.current_quantity, p.reorder_level,
           COALESCE(SUM(si.quantity), 0) as total_quantity_sold,
           ROUND(CAST(COALESCE(SUM(si.quantity), 0) AS FLOAT) / ?, 2) as velocity_per_day
    FROM products p
    LEFT JOIN (
      SELECT si.product_id, si.quantity FROM sale_items si
      JOIN sales s ON si.sale_id = s.id
      WHERE s.status = 'completed' AND s.created_at >= ?
    ) si ON p.id = si.product_id
    GROUP BY p.id
    HAVING total_quantity_sold > 0
    ORDER BY velocity_per_day DESC
  `).all(days, startDate)
}

function getExpiringProducts(days = 7) {
  const cutoff = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()
  const today = new Date().toISOString().split('T')[0]
  return getDb().prepare(`
    SELECT p.*, si.expiry_date,
           (julianday(si.expiry_date) - julianday('now')) as days_until_expiry
    FROM products p
    JOIN sale_items si ON p.id = si.product_id
    WHERE si.expiry_date IS NOT NULL AND si.expiry_date <= ? AND si.expiry_date >= ?
    ORDER BY si.expiry_date ASC
  `).all(cutoff, today)
}

function getExpiredProducts() {
  const today = new Date().toISOString().split('T')[0]
  return getDb().prepare(`
    SELECT p.*, si.expiry_date,
           (julianday('now') - julianday(si.expiry_date)) as days_expired
    FROM products p
    JOIN sale_items si ON p.id = si.product_id
    WHERE si.expiry_date IS NOT NULL AND si.expiry_date < ?
    GROUP BY p.id
    ORDER BY si.expiry_date DESC
  `).all(today)
}

function getExpiryReport() {
  const db = getDb()
  const week = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
  const month = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
  const expired = db.prepare(`SELECT COUNT(*) FROM sale_items WHERE expiry_date IS NOT NULL AND expiry_date < date('now')`).pluck().get() || 0
  const expiringWeek = db.prepare(`SELECT COUNT(*) FROM sale_items WHERE expiry_date IS NOT NULL AND expiry_date >= date('now') AND expiry_date <= ?`).pluck().get(week) || 0
  const expiringMonth = db.prepare(`SELECT COUNT(*) FROM sale_items WHERE expiry_date IS NOT NULL AND expiry_date > ? AND expiry_date <= ?`).pluck().get(week, month) || 0
  return { expired, expiringThisWeek: expiringWeek, expiringThisMonth: expiringMonth }
}

function importStockReceivings(rows, recordedBy) {
  const db = getDb()
  const findProduct    = db.prepare(`SELECT id, name FROM products WHERE LOWER(name) = LOWER(?) LIMIT 1`)
  const insertProduct  = db.prepare(`INSERT INTO products (name, category, unit, selling_price, reorder_level, current_quantity, description) VALUES (?, '', 'each', 0, 5, 0, '')`)
  const findSupplier   = db.prepare(`SELECT id FROM suppliers WHERE LOWER(name) = LOWER(?) LIMIT 1`)
  const insertSupplier = db.prepare(`INSERT INTO suppliers (name) VALUES (?)`)
  const insertReceiving = db.prepare(
    `INSERT INTO stock_receivings (supplier_id, product_id, date_received, cartons, units_per_carton, total_units, cost_per_carton, cost_per_unit, total_value, recorded_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  const updateQty      = db.prepare(`UPDATE products SET current_quantity = current_quantity + ? WHERE id = ?`)
  const insertMovementReceived = db.prepare(
    `INSERT INTO stock_movements (product_id, product_name, movement_type, quantity, recorded_by) VALUES (?, ?, 'RECEIVED', ?, ?)`
  )
  const insertMovementDirect = db.prepare(
    `INSERT INTO stock_movements (product_id, product_name, movement_type, quantity, note, recorded_by) VALUES (?, ?, 'DIRECT_PURCHASE', ?, ?, ?)`
  )

  let inserted = 0, created_products = 0, created_suppliers = 0
  const errors = []

  const run = db.transaction(() => {
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      try {
        const productName = String(row.product_name || '').trim()
        if (!productName) { errors.push(`Row ${i + 2}: product name is required`); continue }
        const qty = parseInt(row.quantity) || 0
        if (qty <= 0) { errors.push(`Row ${i + 2}: quantity must be > 0`); continue }

        const cpu  = parseFloat(row.cost_per_unit) || 0
        const date = row.date_received || new Date().toISOString().split('T')[0]
        const type = String(row.purchase_type || 'supplier').toLowerCase().trim() === 'direct' ? 'direct' : 'supplier'
        const by   = recordedBy || 'Import'

        let product = findProduct.get(productName)
        if (!product) {
          insertProduct.run(productName)
          product = findProduct.get(productName)
          created_products++
        }

        let supplierId = null
        if (type === 'supplier') {
          const sName = String(row.supplier_name || '').trim()
          if (sName) {
            let supplier = findSupplier.get(sName)
            if (!supplier) { insertSupplier.run(sName); supplier = findSupplier.get(sName); created_suppliers++ }
            supplierId = supplier.id
          }
        }

        const totalValue = qty * cpu
        if (type === 'supplier') {
          insertReceiving.run(supplierId, product.id, date, 0, 0, qty, 0, cpu, totalValue, by)
          updateQty.run(qty, product.id)
          insertMovementReceived.run(product.id, product.name, qty, by)
        } else {
          insertReceiving.run(null, product.id, date, 1, qty, qty, totalValue, cpu, totalValue, by)
          updateQty.run(qty, product.id)
          insertMovementDirect.run(product.id, product.name, qty, row.notes || '', by)
        }
        inserted++
      } catch (err) {
        errors.push(`Row ${i + 2}: ${err.message}`)
      }
    }
  })

  run()
  return { inserted, created_products, created_suppliers, errors }
}

function reconcileProduct(productId, countedQty, notes, recordedBy) {
  const db = getDb()
  const product = getProductById(productId)
  if (!product) throw new Error(`Product not found`)
  const adjustment = countedQty - (product.current_quantity || 0)
  db.transaction(() => {
    db.prepare(`UPDATE products SET current_quantity = ? WHERE id = ?`).run(countedQty, productId)
    db.prepare(
      `INSERT INTO stock_movements (product_id, product_name, movement_type, quantity, note, recorded_by) VALUES (?, ?, 'ADJUSTMENT', ?, ?, ?)`
    ).run(productId, product.name, adjustment, notes || '', recordedBy || 'System')
  })()
  return { product_id: productId, product_name: product.name, previous_qty: product.current_quantity || 0, new_qty: countedQty, adjustment }
}

function reconcileProducts(adjustments, recordedBy) {
  const db = getDb()
  const updateQty = db.prepare(`UPDATE products SET current_quantity = ? WHERE id = ?`)
  const insertMovement = db.prepare(
    `INSERT INTO stock_movements (product_id, product_name, movement_type, quantity, note, recorded_by) VALUES (?, ?, 'ADJUSTMENT', ?, ?, ?)`
  )
  const getProduct = db.prepare(`SELECT id, name, current_quantity FROM products WHERE id = ?`)
  const results = []
  db.transaction(() => {
    for (const adj of adjustments) {
      const product = getProduct.get(adj.product_id)
      if (!product) continue
      const adjustment = adj.counted_qty - (product.current_quantity || 0)
      updateQty.run(adj.counted_qty, adj.product_id)
      insertMovement.run(adj.product_id, product.name, adjustment, adj.notes || '', recordedBy || 'System')
      results.push({ product_id: adj.product_id, product_name: product.name, previous_qty: product.current_quantity || 0, new_qty: adj.counted_qty, adjustment })
    }
  })()
  return results
}

module.exports = {
  addStockReceiving, getStockReceivings, getStockReceivingById, getAllPurchaseHistory,
  recordDirectPurchase, getDeadStockProducts, getRestockNeeded, getProductSalesVelocity,
  getExpiringProducts, getExpiredProducts, getExpiryReport, importStockReceivings,
  reconcileProduct, reconcileProducts
}
