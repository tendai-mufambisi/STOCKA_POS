const { getDb } = require('../index')

function getSuppliers() {
  return getDb().prepare('SELECT * FROM suppliers ORDER BY name ASC').all()
}

function getSupplierById(id) {
  return getDb().prepare('SELECT * FROM suppliers WHERE id = ?').get(id) || null
}

function addSupplier(supplier) {
  getDb().prepare(
    `INSERT INTO suppliers (name, contact_person, phone, email, address, notes) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(supplier.name, supplier.contact_person || '', supplier.phone || '', supplier.email || '', supplier.address || '', supplier.notes || '')
}

function updateSupplier(id, supplier) {
  getDb().prepare(
    `UPDATE suppliers SET name = ?, contact_person = ?, phone = ?, email = ?, address = ?, notes = ? WHERE id = ?`
  ).run(supplier.name, supplier.contact_person || '', supplier.phone || '', supplier.email || '', supplier.address || '', supplier.notes || '', id)
}

function deleteSupplier(id) {
  getDb().prepare('DELETE FROM suppliers WHERE id = ?').run(id)
}

function getSupplierPurchaseHistory(supplierId) {
  return getDb().prepare(`
    SELECT sr.*, p.name as product_name, p.current_quantity
    FROM stock_receivings sr
    LEFT JOIN products p ON sr.product_id = p.id
    WHERE sr.supplier_id = ?
    ORDER BY sr.date_received DESC
  `).all(supplierId)
}

function getProductPurchaseHistory(productId) {
  return getDb().prepare(`
    SELECT sr.*, s.name as supplier_name, s.contact_person, s.phone
    FROM stock_receivings sr
    LEFT JOIN suppliers s ON sr.supplier_id = s.id
    WHERE sr.product_id = ?
    ORDER BY sr.date_received DESC
  `).all(productId)
}

module.exports = { getSuppliers, getSupplierById, addSupplier, updateSupplier, deleteSupplier, getSupplierPurchaseHistory, getProductPurchaseHistory }
