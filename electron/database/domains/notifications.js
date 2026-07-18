const { getDb } = require('../index')
const { eventNowSql } = require('../eventClock')

function createNotification(notification) {
  getDb().prepare(
    `INSERT INTO notifications (type, message, product_id, created_at) VALUES (?, ?, ?, ?)`
  ).run(notification.type, notification.message, notification.product_id || null, eventNowSql())
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

function markAllNotificationsAsRead() {
  getDb().prepare('UPDATE notifications SET is_read = 1').run()
}

function deleteNotification(id) {
  getDb().prepare('DELETE FROM notifications WHERE id = ?').run(id)
}

function deleteAllReadNotifications() {
  getDb().prepare('DELETE FROM notifications WHERE is_read = 1').run()
}

module.exports = {
  createNotification, getActiveNotifications, getAllNotifications,
  clearNotificationsForProduct, markNotificationAsRead,
  markAllNotificationsAsRead, deleteNotification, deleteAllReadNotifications,
}
