import { useState, useEffect } from 'react'
import { getProducts, getActiveNotifications, markNotificationAsRead, createNotification, clearNotificationsForProduct } from '../database/db'
import { useAuthStore } from '../store/useAuthStore'
import './Notifications.css'
import { FiBell, FiX, FiCheck, FiAlertOctagon, FiAlertTriangle, FiChevronRight } from 'react-icons/fi'

// Maps notification type → the dashboard page to navigate to when clicked
const NOTIF_NAV = {
  OUT_OF_STOCK:   'stock',
  LOW_STOCK:      'stock',
  SHIFT_CLOSED:   'cashier-sessions',
  SHIFT_SHORTAGE: 'cashier-sessions',
  SHIFT_LONG:     'cashier-sessions',
}

function Notifications({ onNavigate }) {
  const { user }                 = useAuthStore()
  const [notifications, setNotifications] = useState([])
  const [showPanel, setShowPanel] = useState(false)
  const [loading, setLoading]    = useState(false)
  const [unreadCount, setUnreadCount] = useState(0)

  useEffect(() => {
    checkStockAlerts()
    const interval = setInterval(checkStockAlerts, 30000)
    return () => clearInterval(interval)
  }, [])

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
            message: `${product.name} is OUT OF STOCK`,
          })
        } else if (product.current_quantity <= product.reorder_level) {
          alerts.push({
            type: 'LOW_STOCK',
            product_id: product.id,
            message: `${product.name} is running low — ${product.current_quantity} units remaining`,
          })
        }
      })

      const existing = await getActiveNotifications()
      const existingIds = existing.map(n => n.product_id)

      for (const alert of alerts) {
        if (!existingIds.includes(alert.product_id)) {
          await createNotification({ type: alert.type, message: alert.message, product_id: alert.product_id })
        }
      }

      for (const notif of existing) {
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

  const handleDismiss = async (e, id, productId) => {
    e.stopPropagation()
    try {
      await clearNotificationsForProduct(productId)
      loadNotifications()
    } catch (err) {
      console.error('Failed to dismiss notification:', err)
    }
  }

  const handleNotifClick = async (notif) => {
    // Mark as read
    if (!notif.is_read) {
      try { await markNotificationAsRead(notif.id) } catch (_) {}
    }
    // Navigate if there's a target page and a handler was given
    const targetPage = NOTIF_NAV[notif.type]
    if (targetPage && onNavigate) {
      setShowPanel(false)
      onNavigate(targetPage)
    }
  }

  const getNotifMeta = (type) => {
    switch (type) {
      case 'OUT_OF_STOCK':
        return { kind: 'critical', icon: <FiAlertOctagon size={18} />, color: '#ef4444' }
      case 'SHIFT_CLOSED':
        return { kind: 'info',     icon: <FiCheck size={18} />,        color: '#3b82f6' }
      case 'SHIFT_SHORTAGE':
        return { kind: 'critical', icon: <FiAlertOctagon size={18} />, color: '#dc2626' }
      case 'SHIFT_LONG':
        return { kind: 'warning',  icon: <FiAlertTriangle size={18} />, color: '#f59e0b' }
      default: // LOW_STOCK
        return { kind: 'warning',  icon: <FiAlertTriangle size={18} />, color: '#f59e0b' }
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
            <h3>Alerts &amp; Notifications</h3>
            <button className="close-btn" onClick={() => setShowPanel(false)}>
              <FiX size={20} />
            </button>
          </div>

          <div className="panel-content">
            {loading ? (
              <div className="loading">Loading…</div>
            ) : notifications.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon"><FiCheck size={32} color="#4CAF50" /></div>
                <p>No active notifications</p>
              </div>
            ) : (
              <div className="notifications-list">
                {notifications.map(notif => {
                  const { kind, icon, color } = getNotifMeta(notif.type)
                  const targetPage = NOTIF_NAV[notif.type]
                  const isClickable = !!targetPage && !!onNavigate

                  return (
                    <div
                      key={notif.id}
                      className={`notification-item ${kind} ${!notif.is_read ? 'unread' : ''} ${isClickable ? 'clickable' : ''}`}
                      onClick={() => handleNotifClick(notif)}
                      role={isClickable ? 'button' : undefined}
                      tabIndex={isClickable ? 0 : undefined}
                      onKeyDown={isClickable ? (e) => (e.key === 'Enter' || e.key === ' ') && handleNotifClick(notif) : undefined}
                    >
                      <div className="notif-icon" style={{ color }}>
                        {icon}
                      </div>
                      <div className="notif-content">
                        <div className="notif-message">{notif.message}</div>
                        <div className="notif-meta">
                          <span className="notif-time">
                            {new Date(notif.created_at).toLocaleString('en-ZW')}
                          </span>
                          {isClickable && (
                            <span className="notif-nav-hint">
                              <FiChevronRight size={12} /> View
                            </span>
                          )}
                        </div>
                      </div>
                      <button
                        className="dismiss-btn"
                        onClick={(e) => handleDismiss(e, notif.id, notif.product_id)}
                        title="Dismiss"
                      >
                        <FiX size={15} />
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default Notifications
