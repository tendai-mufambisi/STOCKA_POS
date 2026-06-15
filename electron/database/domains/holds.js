const { getDb } = require('../index')

function createHold(shiftId, productId, quantity) {
  const db = getDb()
  db.prepare(
    `INSERT INTO sale_holds (shift_id, product_id, quantity) VALUES (?, ?, ?)`
  ).run(shiftId, productId, quantity)
  return db.prepare(
    `SELECT * FROM sale_holds WHERE shift_id = ? AND product_id = ? ORDER BY id DESC LIMIT 1`
  ).get(shiftId, productId) || null
}

function getHoldsByShift(shiftId) {
  return getDb().prepare(`
    SELECT sh.*, p.name as product_name, p.current_quantity
    FROM sale_holds sh
    LEFT JOIN products p ON sh.product_id = p.id
    WHERE sh.shift_id = ?
    ORDER BY sh.held_at DESC
  `).all(shiftId)
}

function deleteHoldsOnLogout(shiftId) {
  getDb().prepare('DELETE FROM sale_holds WHERE shift_id = ?').run(shiftId)
}

function releaseHold(holdId) {
  getDb().prepare('DELETE FROM sale_holds WHERE id = ?').run(holdId)
}

module.exports = { createHold, getHoldsByShift, deleteHoldsOnLogout, releaseHold }
