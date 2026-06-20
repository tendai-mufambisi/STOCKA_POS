const { getDb } = require('../index')
const bcrypt = require('bcryptjs')

function getShop() {
  return getDb().prepare('SELECT * FROM shops LIMIT 1').get() || null
}

function initializeShop(shopData) {
  const db = getDb()
  db.prepare(
    `INSERT INTO shops (name, address, phone, email, currency, setup_complete) VALUES (?, ?, ?, ?, ?, 1)`
  ).run(shopData.name, shopData.address || '', shopData.phone || '', shopData.email || '', shopData.currency || 'USD')

  const username = shopData.ownerName || shopData.adminUsername
  const credential = shopData.ownerPin || shopData.adminPassword

  if (username && credential) {
    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username)
    if (!existing) {
      const hash = bcrypt.hashSync(credential, 10)
      db.prepare(
        `INSERT INTO users (username, password, password_hash, role, is_active, created_by) VALUES (?, ?, ?, 'Admin', 1, 'system')`
      ).run(username, '', hash)
    }
    db.prepare(`DELETE FROM users WHERE username = 'admin' AND created_by = 'system' AND username != ?`).run(username)
  }
}

function updateShop(id, shopData) {
  getDb().prepare(
    `UPDATE shops SET
      name = ?, address = ?, phone = ?, email = ?, currency = ?,
      printer_name = ?, printer_port = ?, auto_print = ?, print_duplicate = ?,
      receipt_width_mm = ?, receipt_footer = ?, receipt_name_size = ?,
      vat_rate = ?, default_reorder_level = ?, variance_tolerance = ?
     WHERE id = ?`
  ).run(
    shopData.name || '',
    shopData.address || '',
    shopData.phone || '',
    shopData.email || '',
    shopData.currency || 'USD',
    shopData.printer_name || null,
    shopData.printer_port || null,
    shopData.auto_print !== undefined ? shopData.auto_print : 1,
    shopData.print_duplicate !== undefined ? shopData.print_duplicate : 0,
    shopData.receipt_width_mm || 58,
    shopData.receipt_footer !== undefined ? shopData.receipt_footer : 'Thank you for your business!',
    shopData.receipt_name_size || 'large',
    shopData.vat_rate !== undefined ? shopData.vat_rate : 0,
    shopData.default_reorder_level || 5,
    shopData.variance_tolerance !== undefined ? shopData.variance_tolerance : 0.01,
    id
  )
}

// Updates only printer-related columns — intentionally local-only so each
// machine keeps its own printer config regardless of LAN mode.
function updateShopPrinterSettings(data) {
  getDb().prepare(
    `UPDATE shops SET
      printer_name = ?, printer_port = ?,
      auto_print = ?, print_duplicate = ?, receipt_width_mm = ?`
  ).run(
    data.printer_name || null,
    data.printer_port || null,
    data.auto_print !== undefined ? data.auto_print : 1,
    data.print_duplicate !== undefined ? data.print_duplicate : 0,
    data.receipt_width_mm || 58
  )
}

function resetOwnerPin(username, newPin) {
  const db = getDb()
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username)
  if (!user) throw new Error('User not found')
  const hash = bcrypt.hashSync(newPin, 10)
  db.prepare(`UPDATE users SET password_hash = ?, password = '' WHERE id = ?`).run(hash, user.id)
  return true
}

module.exports = { getShop, initializeShop, updateShop, updateShopPrinterSettings, resetOwnerPin }
