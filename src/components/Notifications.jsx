import { useState, useEffect } from 'react'
import { getProducts, getActiveNotifications, markNotificationAsRead, createNotification, clearNotificationsForProduct } from '../database/db'
import './Notifications.css'
import { FiBell, FiX, FiCheck, FiAlertOctagon, FiAlertTriangle } from 'react-icons/fi'

function Notifications({ user }) {
  const [notifications, setNotifications] = useState([])
  const [showPanel, setShowPanel] = useState(false)
  const [loading, setLoading] = useState(false)
  const [unreadCount, setUnreadCount] = useState(0)

  // Auto-check for stock alerts every 30 seconds
  useEffect(() => {
    checkStockAlerts()
    const interval = setInterval(checkStockAlerts, 30000)
    return () => clearInterval(interval)
  }, [])

  // Load notifications on mount and when panel opens
  useEffect(() => {
    loadNotifications()
  }, [showPanel])

  const checkStockAlerts = async () => {
    try {
      const products = await getProducts()
      const alerts = []

      products.forEach(product => {
        if (product.current_quantity === 0) {
          alerts.push({
            type: 'OUT_OF_STOCK',
            product_id: product.id,
            product_name: product.name,
            message: `${product.name} is OUT OF STOCK`,
            severity: 'critical'
          })
        } else if (product.current_quantity <= product.reorder_level) {
          alerts.push({
            type: 'LOW_STOCK',
            product_id: product.id,
            product_name: product.name,
            message: `${product.name} is running low — ${product.current_quantity} units remaining`,
            severity: 'warning'
          })
        }
      })

      // Check existing notifications and create new ones for new alerts
      const existingNotifications = await getActiveNotifications()
      const existingProductIds = existingNotifications.map(n => n.product_id)

      for (const alert of alerts) {
        if (!existingProductIds.includes(alert.product_id)) {
          await createNotification({
            type: alert.type,
            message: alert.message,
            product_id: alert.product_id
          })
        }
      }

      // Clear notifications for products that are no longer low/out of stock
      for (const notif of existingNotifications) {
        const product = products.find(p => p.id === notif.product_id)
        if (product && product.current_quantity > product.reorder_level) {
          await clearNotificationsForProduct(notif.product_id)
        }
      }

      loadNotifications()
    } catch (err) {
      console.error('Failed to check stock alerts:', err)
    }
  }

  const loadNotifications = async () => {
    try {
      setLoading(true)
      const active = await getActiveNotifications()
      setNotifications(active)
      setUnreadCount(active.filter(n => !n.is_read).length)
    } catch (err) {
      console.error('Failed to load notifications:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleMarkAsRead = async (id) => {
    try {
      await markNotificationAsRead(id)
      loadNotifications()
    } catch (err) {
      console.error('Failed to mark notification as read:', err)
    }
  }

  const handleDismiss = async (id, productId) => {
    try {
      await clearNotificationsForProduct(productId)
      loadNotifications()
    } catch (err) {
      console.error('Failed to dismiss notification:', err)
    }
  }

  return (
    <div className="notifications-widget">
      <button
        className="bell-icon"
        onClick={() => setShowPanel(!showPanel)}
        title="Notifications"
      >
        <FiBell size={20} />
        {unreadCount > 0 && <span className="badge">{unreadCount}</span>}
      </button>

      {showPanel && (
        <div className="notifications-panel">
          <div className="panel-header">
            <h3>Alerts & Notifications</h3>
            <button
              className="close-btn"
              onClick={() => setShowPanel(false)}
            >
              <FiX size={20} />
            </button>
          </div>

          <div className="panel-content">
            {loading ? (
              <div className="loading">Loading...</div>
            ) : notifications.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon"><FiCheck size={32} color="#4CAF50" /></div>
                <p>No active notifications</p>
              </div>
            ) : (
              <div className="notifications-list">
                {notifications.map(notif => (
                  <div
                    key={notif.id}
                    className={`notification-item ${notif.type === 'OUT_OF_STOCK' ? 'critical' : 'warning'}`}
                  >
                    <div className="notif-icon">
                      {notif.type === 'OUT_OF_STOCK' ? <FiAlertOctagon size={20} color="#FF5252" /> : <FiAlertTriangle size={20} color="#FFC107" />}
                    </div>
                    <div className="notif-content">
                      <div className="notif-message">{notif.message}</div>
                      <div className="notif-time">
                        {new Date(notif.created_at).toLocaleString('en-ZW')}
                      </div>
                    </div>
                    <button
                      className="dismiss-btn"
                      onClick={() => handleDismiss(notif.id, notif.product_id)}
                      title="Dismiss"
                    >
                      <FiX size={16} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default Notifications
