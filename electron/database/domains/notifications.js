const { getDb } = require('../index')

function createNotification(notification) {
  getDb().prepare(
    `INSERT INTO notifications (type, message, product_id) VALUES (?, ?, ?)`
  ).run(notification.type, notification.message, notification.product_id || null)
}

function getActiveNotifications() {
  return getDb().prepare('SELECT * FROM notifications WHERE is_read = 0 ORDER BY created_at DESC').all()
}

function getAllNotifications() {
  return getDb().prepare('SELECT * FROM notifications ORDER BY created_at DESC LIMIT 50').all()
}

function clearNotificationsForProduct(productId) {
  getDb().prepare('DELETE FROM notifications WHERE product_id = ?').run(productId)
}

function markNotificationAsRead(id) {
  getDb().prepare('UPDATE notifications SET is_read = 1 WHERE id = ?').run(id)
}

module.exports = { createNotification, getActiveNotifications, getAllNotifications, clearNotificationsForProduct, markNotificationAsRead }
