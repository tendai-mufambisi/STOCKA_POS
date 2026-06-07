const { getDb, saveDb } = require('../index')
const { extractResults } = require('../utils')
const { getProductById } = require('./products')

function addStockReceiving(receiving) {
  const db = getDb()
  const product = getProductById(receiving.product_id)
  if (!product) throw new Error(`Product with ID ${receiving.product_id} not found`)

  db.run('BEGIN TRANSACTION')
  try {
    db.run(
      `INSERT INTO stock_receivings (supplier_id, product_id, date_received, cartons, units_per_carton, total_units, cost_per_carton, cost_per_unit, total_value, recorded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [receiving.supplier_id, receiving.product_id, receiving.date_received, receiving.cartons,
       receiving.units_per_carton, receiving.total_units, receiving.cost_per_carton,
       receiving.cost_per_unit, receiving.total_value, receiving.recorded_by]
    )
    const newQty = (product.current_quantity || 0) + receiving.total_units
    db.run(`UPDATE products SET current_quantity = ? WHERE id = ?`, [newQty, receiving.product_id])
    db.run(
      `INSERT INTO stock_movements (product_id, product_name, movement_type, quantity, recorded_by) VALUES (?, ?, 'RECEIVED', ?, ?)`,
      [receiving.product_id, product.name, receiving.total_units, receiving.recorded_by]
    )
    db.run('COMMIT')
  } catch (err) {
    try { db.run('ROLLBACK') } catch (_) {}
    throw err
  }
  saveDb()
}

function getStockReceivings() {
  return extractResults(getDb().exec(`
    SELECT sr.*, p.name as product_name, s.name as supplier_name
    FROM stock_receivings sr
    LEFT JOIN products p ON sr.product_id = p.id
    LEFT JOIN suppliers s ON sr.supplier_id = s.id
    ORDER BY sr.date_received DESC
  `))
}

function getStockReceivingById(id) {
  const rows = extractResults(getDb().exec(`
    SELECT sr.*, p.name as product_name, s.name as supplier_name
    FROM stock_receivings sr
    LEFT JOIN products p ON sr.product_id = p.id
    LEFT JOIN suppliers s ON sr.supplier_id = s.id
    WHERE sr.id = ?
  `, [id]))
  return rows[0] || null
}

function getAllPurchaseHistory() {
  return extractResults(getDb().exec(`
    SELECT sr.id, sr.date_received, p.name as product_name,
           COALESCE(s.name, 'Direct Purchase') as supplier_name,
           sr.cartons, sr.units_per_carton, sr.total_units,
           sr.cost_per_unit, sr.cost_per_carton, sr.total_value,
           CASE WHEN sr.supplier_id IS NULL THEN 'direct' ELSE 'supplier' END as purchase_type
    FROM stock_receivings sr
    LEFT JOIN products p ON sr.product_id = p.id
    LEFT JOIN suppliers s ON sr.supplier_id = s.id
    ORDER BY sr.created_at DESC, sr.date_received DESC
  `))
}

function recordDirectPurchase(purchase) {
  const db = getDb()
  const product = getProductById(purchase.product_id)
  if (!product) throw new Error(`Product with ID ${purchase.product_id} not found`)

  const qty = purchase.quantity || 0
  const cpu = parseFloat(purchase.cost_per_unit) || 0
  const totalCost = qty * cpu
  const dateReceived = purchase.date_received || new Date().toISOString().split('T')[0]

  db.run('BEGIN TRANSACTION')
  try {
    db.run(
      `INSERT INTO stock_receivings (supplier_id, product_id, date_received, cartons, units_per_carton, total_units, cost_per_carton, cost_per_unit, total_value, recorded_by)
       VALUES (NULL, ?, ?, 1, ?, ?, ?, ?, ?, ?)`,
      [purchase.product_id, dateReceived, qty, qty, totalCost, cpu, totalCost, purchase.recorded_by || 'System']
    )
    const newQty = (product.current_quantity || 0) + qty
    db.run(`UPDATE products SET current_quantity = ? WHERE id = ?`, [newQty, purchase.product_id])
    db.run(
      `INSERT INTO stock_movements (product_id, product_name, movement_type, quantity, note, recorded_by) VALUES (?, ?, 'DIRECT_PURCHASE', ?, ?, ?)`,
      [purchase.product_id, product.name, qty, purchase.notes || '', purchase.recorded_by || 'System']
    )
    db.run('COMMIT')
  } catch (err) {
    try { db.run('ROLLBACK') } catch (_) {}
    throw err
  }
  saveDb()
}

function getDeadStockProducts(days = 30) {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
  return extractResults(getDb().exec(`
    SELECT p.*,
      COALESCE((SELECT cost_per_unit FROM stock_receivings WHERE product_id = p.id ORDER BY date_received DESC LIMIT 1), 0) as latest_cost_per_unit
    FROM products p
    WHERE p.current_quantity > 0 AND (p.last_sold_date IS NULL OR p.last_sold_date < ?)
    ORDER BY p.last_sold_date ASC
  `, [cutoff]))
}

function getRestockNeeded() {
  return extractResults(getDb().exec(`
    SELECT p.*, (p.reorder_level - p.current_quantity) as shortfall,
           COALESCE(s.name, 'No Supplier') as supplier_name
    FROM products p
    LEFT JOIN suppliers s ON p.supplier_id = s.id
    WHERE p.current_quantity <= p.reorder_level
    ORDER BY shortfall DESC
  `))
}

function getProductSalesVelocity(days = 30) {
  const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
  return extractResults(getDb().exec(`
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
  `, [days, startDate]))
}

function getExpiringProducts(days = 7) {
  const cutoff = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()
  const today = new Date().toISOString().split('T')[0]
  return extractResults(getDb().exec(`
    SELECT p.*, si.expiry_date,
           (julianday(si.expiry_date) - julianday('now')) as days_until_expiry
    FROM products p
    JOIN sale_items si ON p.id = si.product_id
    WHERE si.expiry_date IS NOT NULL AND si.expiry_date <= ? AND si.expiry_date >= ?
    ORDER BY si.expiry_date ASC
  `, [cutoff, today]))
}

function getExpiredProducts() {
  const today = new Date().toISOString().split('T')[0]
  return extractResults(getDb().exec(`
    SELECT p.*, si.expiry_date,
           (julianday('now') - julianday(si.expiry_date)) as days_expired
    FROM products p
    JOIN sale_items si ON p.id = si.product_id
    WHERE si.expiry_date IS NOT NULL AND si.expiry_date < ?
    GROUP BY p.id
    ORDER BY si.expiry_date DESC
  `, [today]))
}

function getExpiryReport() {
  const week = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
  const month = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
  const expired = extractResults(getDb().exec(`SELECT COUNT(*) as count FROM sale_items WHERE expiry_date IS NOT NULL AND expiry_date < date('now')`))[0]?.count || 0
  const expiringWeek = extractResults(getDb().exec(`SELECT COUNT(*) as count FROM sale_items WHERE expiry_date IS NOT NULL AND expiry_date >= date('now') AND expiry_date <= ?`, [week]))[0]?.count || 0
  const expiringMonth = extractResults(getDb().exec(`SELECT COUNT(*) as count FROM sale_items WHERE expiry_date IS NOT NULL AND expiry_date > ? AND expiry_date <= ?`, [week, month]))[0]?.count || 0
  return { expired, expiringThisWeek: expiringWeek, expiringThisMonth: expiringMonth }
}

module.exports = {
  addStockReceiving, getStockReceivings, getStockReceivingById, getAllPurchaseHistory,
  recordDirectPurchase, getDeadStockProducts, getRestockNeeded, getProductSalesVelocity,
  getExpiringProducts, getExpiredProducts, getExpiryReport
}
