const { getDb } = require('../index')
const { logAuditAction } = require('./audit')

function getProducts() {
  return getDb().prepare('SELECT * FROM products ORDER BY name ASC').all()
}

function getProductById(id) {
  return getDb().prepare('SELECT * FROM products WHERE id = ?').get(id) || null
}

function addProduct(product) {
  getDb().prepare(
    `INSERT INTO products (name, category, supplier_id, unit, selling_price, reorder_level, description, current_quantity, image_data)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    product.name,
    product.category || '',
    product.supplier_id || null,
    product.unit || 'each',
    product.selling_price || 0,
    product.reorder_level || 5,
    product.description || '',
    product.current_quantity || 0,
    product.image_data || null
  )
}

function updateProduct(id, product) {
  const oldProduct = getProductById(id)
  getDb().prepare(
    `UPDATE products SET name = ?, category = ?, supplier_id = ?, unit = ?, selling_price = ?, reorder_level = ?, description = ?, image_data = ? WHERE id = ?`
  ).run(product.name, product.category || '', product.supplier_id || null, product.unit || 'each', product.selling_price || 0, product.reorder_level || 5, product.description || '', product.image_data || null, id)
  try {
    if (oldProduct && oldProduct.name !== product.name) {
      logAuditAction('system', 'UPDATE_PRODUCT', 'PRODUCT', String(id),
        `Product updated: ${oldProduct.name} → ${product.name}`, oldProduct.name, product.name)
    }
  } catch (_) {}
}

function deleteProduct(id) {
  const product = getProductById(id)
  getDb().prepare('DELETE FROM products WHERE id = ?').run(id)
  try {
    if (product) logAuditAction('system', 'DELETE_PRODUCT', 'PRODUCT', String(id), `Product deleted: ${product.name}`)
  } catch (_) {}
}

function updateProductQuantity(productId, quantity) {
  getDb().prepare(`UPDATE products SET current_quantity = ? WHERE id = ?`).run(quantity, productId)
}

function updateProductImage(productId, imageData) {
  getDb().prepare(`UPDATE products SET image_data = ? WHERE id = ?`).run(imageData, productId)
}

function updateProductLastSoldDate(productId) {
  getDb().prepare('UPDATE products SET last_sold_date = ? WHERE id = ?').run(new Date().toISOString(), productId)
}

function getLatestProductPrice(productId) {
  const row = getDb().prepare('SELECT selling_price FROM products WHERE id = ?').get(productId)
  if (!row) return null
  const costRow = getDb().prepare(
    `SELECT cost_per_unit FROM stock_receivings WHERE product_id = ? ORDER BY date_received DESC LIMIT 1`
  ).get(productId)
  return { selling_price_per_unit: row.selling_price || 0, cost_per_unit: costRow?.cost_per_unit || 0 }
}

function getAllLatestCostPrices() {
  try {
    const rows = getDb().prepare(`
      SELECT sr.product_id, sr.cost_per_unit
      FROM stock_receivings sr
      WHERE sr.id = (SELECT MAX(id) FROM stock_receivings WHERE product_id = sr.product_id)
    `).all()
    return rows.reduce((map, row) => { map[row.product_id] = row.cost_per_unit || 0; return map }, {})
  } catch (_) { return {} }
}

function getMostSoldProducts(limit = 10) {
  try {
    return getDb().prepare(`
      SELECT p.id, p.name, p.category, p.current_quantity, p.selling_price, p.image_data,
             SUM(si.quantity) as total_sold
      FROM products p
      LEFT JOIN sale_items si ON p.id = si.product_id
      GROUP BY p.id
      ORDER BY total_sold DESC
      LIMIT ?
    `).all(limit)
  } catch (_) { return [] }
}

function addProductsBatch(rows) {
  const db = getDb()
  const insert = db.prepare(
    `INSERT INTO products (name, category, supplier_id, unit, selling_price, reorder_level, description, current_quantity)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
  const findSupplier = db.prepare(`SELECT id FROM suppliers WHERE LOWER(name) = LOWER(?) LIMIT 1`)
  let inserted = 0
  const runAll = db.transaction(() => {
    for (const row of rows) {
      let supplier_id = null
      if (row.supplier) {
        const s = findSupplier.get(row.supplier)
        if (s) supplier_id = s.id
      }
      insert.run(
        row.name,
        row.category || null,
        supplier_id,
        row.unit || 'each',
        parseFloat(row.selling_price) || 0,
        parseInt(row.reorder_level) || 5,
        row.description || '',
        parseInt(row.current_quantity) || 0
      )
      inserted++
    }
  })
  runAll()
  return { inserted }
}

module.exports = {
  getProducts, getProductById, addProduct, updateProduct, deleteProduct,
  updateProductQuantity, updateProductImage, updateProductLastSoldDate,
  getLatestProductPrice, getAllLatestCostPrices, getMostSoldProducts, addProductsBatch
}
