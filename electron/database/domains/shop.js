const { getDb, saveDb } = require('../index')
const { extractResults } = require('../utils')
const bcrypt = require('bcryptjs')

function getShop() {
  const rows = extractResults(getDb().exec('SELECT * FROM shops LIMIT 1'))
  return rows[0] || null
}

function initializeShop(shopData) {
  const db = getDb()
  db.run(
    `INSERT INTO shops (name, address, phone, email, currency, setup_complete) VALUES (?, ?, ?, ?, ?, 1)`,
    [shopData.name, shopData.address || '', shopData.phone || '', shopData.email || '', shopData.currency || 'USD']
  )

  const username = shopData.ownerName || shopData.adminUsername
  const credential = shopData.ownerPin || shopData.adminPassword

  if (username && credential) {
    // Check if user already exists (e.g., from a failed setup attempt)
    const existingUsers = extractResults(db.exec('SELECT id FROM users WHERE username = ?', [username]))
    if (!existingUsers.length) {
      const hash = bcrypt.hashSync(credential, 10)
      db.run(
        `INSERT INTO users (username, password, password_hash, role, is_active, created_by) VALUES (?, ?, ?, 'Admin', 1, 'system')`,
        [username, '', hash]
      )
    }
    db.run(`DELETE FROM users WHERE username = 'admin' AND created_by = 'system' AND username != ?`, [username])
  }

  saveDb()
}

function updateShop(id, shopData) {
  getDb().run(
    `UPDATE shops SET name = ?, address = ?, phone = ?, email = ?, currency = ?, printer_name = ?, printer_port = ?, auto_print = ?, print_duplicate = ? WHERE id = ?`,
    [
      shopData.name || '',
      shopData.address || '',
      shopData.phone || '',
      shopData.email || '',
      shopData.currency || 'USD',
      shopData.printer_name || null,
      shopData.printer_port || null,
      shopData.auto_print !== undefined ? shopData.auto_print : 1,
      shopData.print_duplicate !== undefined ? shopData.print_duplicate : 0,
      id
    ]
  )
  saveDb()
}

function resetOwnerPin(username, newPin) {
  const db = getDb()
  const rows = extractResults(db.exec('SELECT * FROM users WHERE username = ?', [username]))
  const user = rows[0]
  if (!user) throw new Error('User not found')
  const hash = bcrypt.hashSync(newPin, 10)
  db.run(`UPDATE users SET password_hash = ?, password = '' WHERE id = ?`, [hash, user.id])
  saveDb()
  return true
}

module.exports = { getShop, initializeShop, updateShop, resetOwnerPin }
