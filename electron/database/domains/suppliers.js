const { getDb, saveDb } = require('../index')
const { extractResults } = require('../utils')

function getSuppliers() {
  return extractResults(getDb().exec('SELECT * FROM suppliers ORDER BY name ASC'))
}

function getSupplierById(id) {
  const rows = extractResults(getDb().exec('SELECT * FROM suppliers WHERE id = ?', [id]))
  return rows[0] || null
}

function addSupplier(supplier) {
  getDb().run(
    `INSERT INTO suppliers (name, contact_person, phone, email, address, notes) VALUES (?, ?, ?, ?, ?, ?)`,
    [supplier.name, supplier.contact_person || '', supplier.phone || '', supplier.email || '', supplier.address || '', supplier.notes || '']
  )
  saveDb()
}

function updateSupplier(id, supplier) {
  getDb().run(
    `UPDATE suppliers SET name = ?, contact_person = ?, phone = ?, email = ?, address = ?, notes = ? WHERE id = ?`,
    [supplier.name, supplier.contact_person || '', supplier.phone || '', supplier.email || '', supplier.address || '', supplier.notes || '', id]
  )
  saveDb()
}

function deleteSupplier(id) {
  getDb().run('DELETE FROM suppliers WHERE id = ?', [id])
  saveDb()
}

function getSupplierPurchaseHistory(supplierId) {
  return extractResults(getDb().exec(`
    SELECT sr.*, p.name as product_name, p.current_quantity
    FROM stock_receivings sr
    LEFT JOIN products p ON sr.product_id = p.id
    WHERE sr.supplier_id = ?
    ORDER BY sr.date_received DESC
  `, [supplierId]))
}

function getProductPurchaseHistory(productId) {
  return extractResults(getDb().exec(`
    SELECT sr.*, s.name as supplier_name, s.contact_person, s.phone
    FROM stock_receivings sr
    LEFT JOIN suppliers s ON sr.supplier_id = s.id
    WHERE sr.product_id = ?
    ORDER BY sr.date_received DESC
  `, [productId]))
}

module.exports = { getSuppliers, getSupplierById, addSupplier, updateSupplier, deleteSupplier, getSupplierPurchaseHistory, getProductPurchaseHistory }
