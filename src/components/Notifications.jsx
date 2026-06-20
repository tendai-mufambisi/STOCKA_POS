import { useState, useEffect, useCallback } from 'react'
import {
  getProducts, getAllNotifications, createNotification,
  clearNotificationsForProduct, markAllNotificationsAsRead,
  deleteNotification, deleteAllReadNotifications,
} from '../database/db'
import './Notifications.css'
import {
  FiBell, FiX, FiCheck, FiAlertOctagon, FiAlertTriangle,
  FiChevronRight, FiTrash2,
} from 'react-icons/fi'

const NOTIF_NAV = {
  OUT_OF_STOCK:   'stock',
  LOW_STOCK:      'stock',
  SHIFT_CLOSED:   'cashier-sessions',
  SHIFT_SHORTAGE: 'cashier-sessions',
  SHIFT_LONG:     'cashier-sessions',
}

const STOCK_TYPES = new Set(['OUT_OF_STOCK', 'LOW_STOCK'])

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins  = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days  = Math.floor(diff / 86400000)
  if (mins  <  1) return 'Just now'
  if (mins  < 60) return `${mins}m ago`
  if (hours < 24) return `${hours}h ago`
  return `${days}d ago`
}

function Notifications({ onNavigate }) {
  const [notifications, setNotifications] = useState([])
  const [showPanel, setShowPanel]         = useState(false)
  const [loading, setLoading]             = useState(false)
  const [unreadCount, setUnreadCount]     = useState(0)

  // ── Load all notifications (shown in panel) ──────────────────────────────────
  const loadNotifications = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true)
      const all = await getAllNotifications()
      setNotifications(all)
      setUnreadCount(all.filter(n => !n.is_read).length)
    } catch (err) {
      console.error('Failed to load notifications:', err)
    } finally {
      if (!silent) setLoading(false)
    }
  }, [])

  // ── Check stock and create alerts (deduped against ALL notifications) ────────
  const checkStockAlerts = useCallback(async () => {
    try {
      const [products, all] = await Promise.all([getProducts(), getAllNotifications()])

      // Use ALL existing notifications (read + unread) for dedup
      const existingProductIds = new Set(
        all.filter(n => n.product_id != null).map(n => n.product_id)
      )

      const alerts = []
      products.forEach(p => {
        if (p.current_quantity === 0) {
          alerts.push({ type: 'OUT_OF_STOCK', product_id: p.id, message: `${p.name} is out of stock` })
        } else if (p.current_quantity <= p.reorder_level) {
          alerts.push({ type: 'LOW_STOCK', product_id: p.id, message: `${p.name} is running low — ${p.current_quantity} left` })
        }
      })

      // Create only for products with no existing notification at all
      for (const alert of alerts) {
        if (!existingProductIds.has(alert.product_id)) {
          await createNotification(alert)
        }
      }

      // Clear notifications for products that are back to normal
      const alertIds = new Set(alerts.map(a => a.product_id))
      for (const n of all) {
        if (STOCK_TYPES.has(n.type) && n.product_id && !alertIds.has(n.product_id)) {
          await clearNotificationsForProduct(n.product_id)
        }
      }

      loadNotifications(true)
    } catch (err) {
      console.error('Failed to check stock alerts:', err)
    }
  }, [loadNotifications])

  useEffect(() => {
    checkStockAlerts()
    const interval = setInterval(checkStockAlerts, 30000)
    return () => clearInterval(interval)
  }, [checkStockAlerts])

  useEffect(() => {
    loadNotifications()
  }, [loadNotifications])

  // ── Open panel: mark everything as read immediately → badge clears ───────────
  const handleOpenPanel = async () => {
    setShowPanel(true)
    try {
      await markAllNotificationsAsRead()
      setUnreadCount(0)
      loadNotifications(true)
    } catch (_) {}
  }

  // ── Dismiss a single notification ────────────────────────────────────────────
  const handleDismiss = async (e, notif) => {
    e.stopPropagation()
    try {
      await deleteNotification(notif.id)
      setNotifications(prev => prev.filter(n => n.id !== notif.id))
    } catch (err) {
      console.error('Failed to dismiss notification:', err)
    }
  }

  // ── Clear all read notifications ─────────────────────────────────────────────
  const handleClearRead = async () => {
    try {
      await deleteAllReadNotifications()
      loadNotifications(true)
    } catch (err) {
      console.error('Failed to clear notifications:', err)
    }
  }

  // ── Click a notification: navigate and close panel ───────────────────────────
  const handleNotifClick = (notif) => {
    const targetPage = NOTIF_NAV[notif.type]
    if (targetPage && onNavigate) {
      setShowPanel(false)
      onNavigate(targetPage)
    }
  }

  const getNotifMeta = (type) => {
    switch (type) {
      case 'OUT_OF_STOCK':  return { icon: <FiAlertOctagon size={16} />,  color: '#ef4444', bg: '#fef2f2', bar: '#ef4444' }
      case 'SHIFT_SHORTAGE':return { icon: <FiAlertOctagon size={16} />,  color: '#dc2626', bg: '#fef2f2', bar: '#dc2626' }
      case 'SHIFT_CLOSED':  return { icon: <FiCheck size={16} />,         color: '#3b82f6', bg: '#eff6ff', bar: '#3b82f6' }
      case 'SHIFT_LONG':    return { icon: <FiAlertTriangle size={16} />, color: '#f59e0b', bg: '#fffbeb', bar: '#f59e0b' }
      default:              return { icon: <FiAlertTriangle size={16} />, color: '#f59e0b', bg: '#fffbeb', bar: '#f59e0b' }
    }
  }

  const hasRead = notifications.some(n => n.is_read)
  const targetable = (notif) => !!NOTIF_NAV[notif.type] && !!onNavigate

  return (
    <div className="nw-widget">
      {/* Bell button */}
      <button
        className={`nw-bell ${unreadCount > 0 ? 'has-unread' : ''}`}
        onClick={handleOpenPanel}
        title="Notifications"
      >
        <FiBell size={19} />
        {unreadCount > 0 && (
          <span className="nw-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>
        )}
      </button>

      {/* Panel */}
      {showPanel && (
        <>
          <div className="nw-backdrop" onClick={() => setShowPanel(false)} />
          <div className="nw-panel">

            {/* Header */}
            <div className="nw-header">
              <div className="nw-header-left">
                <span className="nw-title">Notifications</span>
                {notifications.length > 0 && (
                  <span className="nw-count">{notifications.length}</span>
                )}
              </div>
              <div className="nw-header-actions">
                {hasRead && (
                  <button className="nw-clear-btn" onClick={handleClearRead} title="Clear all read">
                    <FiTrash2 size={13} /> Clear read
                  </button>
                )}
                <button className="nw-close-btn" onClick={() => setShowPanel(false)}>
                  <FiX size={18} />
                </button>
              </div>
            </div>

            {/* Body */}
            <div className="nw-body">
              {loading ? (
                <div className="nw-empty"><div className="nw-spinner" /></div>
              ) : notifications.length === 0 ? (
                <div className="nw-empty">
                  <FiCheck size={32} color="#22c55e" />
                  <p>All clear — no notifications</p>
                </div>
              ) : (
                <div className="nw-list">
                  {notifications.map(notif => {
                    const meta = getNotifMeta(notif.type)
                    const canClick = targetable(notif)
                    const isRead = !!notif.is_read

                    return (
                      <div
                        key={notif.id}
                        className={`nw-item ${isRead ? 'read' : 'unread'} ${canClick ? 'clickable' : ''}`}
                        style={{ '--bar-color': meta.bar, '--bg': meta.bg }}
                        onClick={canClick ? () => handleNotifClick(notif) : undefined}
                        role={canClick ? 'button' : undefined}
                        tabIndex={canClick ? 0 : undefined}
                      >
                        <div className="nw-item-icon" style={{ color: meta.color }}>
                          {meta.icon}
                        </div>
                        <div className="nw-item-body">
                          <div className="nw-item-msg">{notif.message}</div>
                          <div className="nw-item-foot">
                            <span className="nw-item-time">{timeAgo(notif.created_at)}</span>
                            {canClick && (
                              <span className="nw-item-nav">
                                View <FiChevronRight size={11} />
                              </span>
                            )}
                          </div>
                        </div>
                        {!isRead && <div className="nw-unread-dot" />}
                        <button
                          className="nw-dismiss"
                          onClick={(e) => handleDismiss(e, notif)}
                          title="Dismiss"
                        >
                          <FiX size={13} />
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export default Notifications
