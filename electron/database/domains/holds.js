const { getDb, saveDb } = require('../index')
const { extractResults } = require('../utils')

function createHold(shiftId, productId, quantity) {
  const db = getDb()
  db.run(
    `INSERT INTO sale_holds (shift_id, product_id, quantity) VALUES (?, ?, ?)`,
    [shiftId, productId, quantity]
  )
  saveDb()
  const rows = extractResults(db.exec(
    `SELECT * FROM sale_holds WHERE shift_id = ? AND product_id = ? ORDER BY id DESC LIMIT 1`,
    [shiftId, productId]
  ))
  return rows[0] || null
}

function getHoldsByShift(shiftId) {
  return extractResults(getDb().exec(`
    SELECT sh.*, p.name as product_name, p.current_quantity
    FROM sale_holds sh
    LEFT JOIN products p ON sh.product_id = p.id
    WHERE sh.shift_id = ?
    ORDER BY sh.held_at DESC
  `, [shiftId]))
}

function deleteHoldsOnLogout(shiftId) {
  getDb().run('DELETE FROM sale_holds WHERE shift_id = ?', [shiftId])
  saveDb()
}

function releaseHold(holdId) {
  getDb().run('DELETE FROM sale_holds WHERE id = ?', [holdId])
  saveDb()
}

module.exports = { createHold, getHoldsByShift, deleteHoldsOnLogout, releaseHold }
