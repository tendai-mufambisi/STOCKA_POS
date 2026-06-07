const { getDb, saveDb } = require('../index')
const { extractResults } = require('../utils')
const { logAuditAction } = require('./audit')

function getProducts() {
  return extractResults(getDb().exec('SELECT * FROM products ORDER BY name ASC'))
}

function getProductById(id) {
  const rows = extractResults(getDb().exec('SELECT * FROM products WHERE id = ?', [id]))
  return rows[0] || null
}

function addProduct(product) {
  getDb().run(
    `INSERT INTO products (name, category, supplier_id, unit, selling_price, reorder_level, description, current_quantity, image_data)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      product.name,
      product.category || '',
      product.supplier_id || null,
      product.unit || 'each',
      product.selling_price || 0,
      product.reorder_level || 5,
      product.description || '',
      product.current_quantity || 0,
      product.image_data || null
    ]
  )
  saveDb()
}

function updateProduct(id, product) {
  const oldProduct = getProductById(id)
  getDb().run(
    `UPDATE products SET name = ?, category = ?, supplier_id = ?, unit = ?, selling_price = ?, reorder_level = ?, description = ?, image_data = ? WHERE id = ?`,
    [product.name, product.category || '', product.supplier_id || null, product.unit || 'each', product.selling_price || 0, product.reorder_level || 5, product.description || '', product.image_data || null, id]
  )
  saveDb()
  try {
    if (oldProduct && oldProduct.name !== product.name) {
      logAuditAction('system', 'UPDATE_PRODUCT', 'PRODUCT', String(id),
        `Product updated: ${oldProduct.name} → ${product.name}`, oldProduct.name, product.name)
    }
  } catch (_) {}
}

function deleteProduct(id) {
  const product = getProductById(id)
  getDb().run('DELETE FROM products WHERE id = ?', [id])
  saveDb()
  try {
    if (product) logAuditAction('system', 'DELETE_PRODUCT', 'PRODUCT', String(id), `Product deleted: ${product.name}`)
  } catch (_) {}
}

function updateProductQuantity(productId, quantity) {
  getDb().run(`UPDATE products SET current_quantity = ? WHERE id = ?`, [quantity, productId])
  saveDb()
}

function updateProductImage(productId, imageData) {
  getDb().run(`UPDATE products SET image_data = ? WHERE id = ?`, [imageData, productId])
  saveDb()
}

function updateProductLastSoldDate(productId) {
  getDb().run('UPDATE products SET last_sold_date = ? WHERE id = ?', [new Date().toISOString(), productId])
  saveDb()
}

function getLatestProductPrice(productId) {
  const rows = extractResults(getDb().exec('SELECT selling_price FROM products WHERE id = ?', [productId]))
  if (!rows[0]) return null
  const costRows = extractResults(getDb().exec(
    `SELECT cost_per_unit FROM stock_receivings WHERE product_id = ? ORDER BY date_received DESC LIMIT 1`,
    [productId]
  ))
  return { selling_price_per_unit: rows[0].selling_price || 0, cost_per_unit: costRows[0]?.cost_per_unit || 0 }
}

function getAllLatestCostPrices() {
  try {
    const rows = extractResults(getDb().exec(`
      SELECT sr.product_id, sr.cost_per_unit
      FROM stock_receivings sr
      WHERE sr.id = (SELECT MAX(id) FROM stock_receivings WHERE product_id = sr.product_id)
    `))
    return rows.reduce((map, row) => { map[row.product_id] = row.cost_per_unit || 0; return map }, {})
  } catch (_) { return {} }
}

function getMostSoldProducts(limit = 10) {
  try {
    return extractResults(getDb().exec(`
      SELECT p.id, p.name, p.category, p.current_quantity, p.selling_price, p.image_data,
             SUM(si.quantity) as total_sold
      FROM products p
      LEFT JOIN sale_items si ON p.id = si.product_id
      GROUP BY p.id
      ORDER BY total_sold DESC
      LIMIT ?
    `, [limit]))
  } catch (_) { return [] }
}

module.exports = {
  getProducts, getProductById, addProduct, updateProduct, deleteProduct,
  updateProductQuantity, updateProductImage, updateProductLastSoldDate,
  getLatestProductPrice, getAllLatestCostPrices, getMostSoldProducts
}
