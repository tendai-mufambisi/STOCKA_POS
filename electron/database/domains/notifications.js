const { getDb, saveDb } = require('../index')
const { extractResults } = require('../utils')

function createNotification(notification) {
  getDb().run(
    `INSERT INTO notifications (type, message, product_id) VALUES (?, ?, ?)`,
    [notification.type, notification.message, notification.product_id || null]
  )
  saveDb()
}

function getActiveNotifications() {
  return extractResults(getDb().exec('SELECT * FROM notifications WHERE is_read = 0 ORDER BY created_at DESC'))
}

function getAllNotifications() {
  return extractResults(getDb().exec('SELECT * FROM notifications ORDER BY created_at DESC LIMIT 50'))
}

function clearNotificationsForProduct(productId) {
  getDb().run('DELETE FROM notifications WHERE product_id = ?', [productId])
  saveDb()
}

function markNotificationAsRead(id) {
  getDb().run('UPDATE notifications SET is_read = 1 WHERE id = ?', [id])
  saveDb()
}

module.exports = { createNotification, getActiveNotifications, getAllNotifications, clearNotificationsForProduct, markNotificationAsRead }
