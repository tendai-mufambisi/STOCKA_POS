import { useState, useEffect } from 'react'
import { getExpiringProducts, getExpiredProducts, getExpiryReport } from '../database/db'
import './ExpiryTracking.css'
import { FiCalendar, FiAlertTriangle } from 'react-icons/fi'

function ExpiryTracking({ user }) {
  const [expiryReport, setExpiryReport] = useState({})
  const [expiringProducts, setExpiringProducts] = useState([])
  const [expiredProducts, setExpiredProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [activeTab, setActiveTab] = useState('expiring') // expiring | expired

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    try {
      setLoading(true)
      const [report, expiring, expired] = await Promise.all([
        getExpiryReport(),
        getExpiringProducts(7),
        getExpiredProducts()
      ])
      
      setExpiryReport(report)
      setExpiringProducts(expiring)
      setExpiredProducts(expired)
    } catch (err) {
      setError('Failed to load expiry data')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const getDaysUntilExpiry = (expiryDate) => {
    const expiry = new Date(expiryDate)
    const days = Math.ceil((expiry - new Date()) / (1000 * 60 * 60 * 24))
    return days
  }

  const getDaysExpired = (expiryDate) => {
    const expiry = new Date(expiryDate)
    const days = Math.ceil((new Date() - expiry) / (1000 * 60 * 60 * 24))
    return days
  }

  const getUrgencyClass = (daysUntilExpiry) => {
    if (daysUntilExpiry < 0) return 'critical'
    if (daysUntilExpiry === 0) return 'today'
    if (daysUntilExpiry <= 2) return 'urgent'
    if (daysUntilExpiry <= 5) return 'warning'
    return 'caution'
  }

  if (loading) return <div className="expiry-page"><div className="loading">Loading...</div></div>

  return (
    <div className="expiry-page">
      <div className="page-header">
        <h1>Expiry Tracking</h1>
        <p>Monitor product expiry dates - ensure food safety and minimize waste</p>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {/* Summary Cards */}
      <div className="summary-cards">
        <div className="summary-card critical-count">
          <div className="icon">
            <FiAlertTriangle />
          </div>
          <div className="content">
            <div className="label">Expired Items</div>
            <div className="value">{expiryReport.expired || 0}</div>
            <div className="details">Must be removed immediately</div>
          </div>
        </div>

        <div className="summary-card warning-count">
          <div className="icon">
            <FiCalendar />
          </div>
          <div className="content">
            <div className="label">Expiring This Week</div>
            <div className="value">{expiryReport.expiringThisWeek || 0}</div>
            <div className="details">Need immediate action</div>
          </div>
        </div>

        <div className="summary-card info-count">
          <div className="icon">
            <FiCalendar />
          </div>
          <div className="content">
            <div className="label">Expiring This Month</div>
            <div className="value">{expiryReport.expiringThisMonth || 0}</div>
            <div className="details">Plan promotions</div>
          </div>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="tab-navigation">
        <button
          className={`tab-btn ${activeTab === 'expiring' ? 'active' : ''}`}
          onClick={() => setActiveTab('expiring')}
        >
          ⏰ Expiring Soon ({expiringProducts.length})
        </button>
        <button
          className={`tab-btn ${activeTab === 'expired' ? 'active' : ''}`}
          onClick={() => setActiveTab('expired')}
        >
          🚫 Already Expired ({expiredProducts.length})
        </button>
      </div>

      {/* Expiring Products */}
      {activeTab === 'expiring' && (
        <div className="products-section">
          {expiringProducts.length > 0 ? (
            <div className="products-table">
              <table>
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Expiry Date</th>
                    <th>Days Until Expiry</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {expiringProducts.map(product => {
                    const daysUntil = getDaysUntilExpiry(product.expiry_date)
                    const urgency = getUrgencyClass(daysUntil)
                    const expiryDateStr = new Date(product.expiry_date).toLocaleDateString('en-ZW')
                    
                    return (
                      <tr key={product.id} className={`urgency-${urgency}`}>
                        <td className="product-name">
                          <span className="name">{product.name}</span>
                          <span className="details">ID: {product.id}</span>
                        </td>
                        <td className="date">
                          {expiryDateStr}
                        </td>
                        <td className="days">
                          {daysUntil === 0 ? (
                            <span className="expires-today">🔴 Today</span>
                          ) : daysUntil === 1 ? (
                            <span className="expires-tomorrow">🟠 Tomorrow</span>
                          ) : (
                            <span>{daysUntil} days</span>
                          )}
                        </td>
                        <td className={`status ${urgency}`}>
                          {urgency === 'critical' && '🚨 Critical'}
                          {urgency === 'today' && '⚠️ TODAY'}
                          {urgency === 'urgent' && '⚡ Urgent'}
                          {urgency === 'warning' && '📢 Warning'}
                          {urgency === 'caution' && '💡 Notice'}
                        </td>
                        <td className="action">
                          {daysUntil <= 3 && (
                            <button className="action-btn promote">Mark On Sale</button>
                          )}
                          {daysUntil <= 1 && (
                            <button className="action-btn discard">Discard</button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty-state">
              <FiCalendar className="icon" />
              <h3>No products expiring soon!</h3>
              <p>All items have plenty of shelf life remaining</p>
            </div>
          )}
        </div>
      )}

      {/* Expired Products */}
      {activeTab === 'expired' && (
        <div className="products-section">
          {expiredProducts.length > 0 ? (
            <div className="products-table">
              <table>
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Expiry Date</th>
                    <th>Days Expired</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {expiredProducts.map(product => {
                    const daysExpired = getDaysExpired(product.expiry_date)
                    const expiryDateStr = new Date(product.expiry_date).toLocaleDateString('en-ZW')
                    
                    return (
                      <tr key={product.id} className="urgency-critical">
                        <td className="product-name">
                          <span className="name">{product.name}</span>
                          <span className="details">ID: {product.id}</span>
                        </td>
                        <td className="date">
                          {expiryDateStr}
                        </td>
                        <td className="days">
                          <span className="expired-by">{daysExpired} days ago</span>
                        </td>
                        <td className="status critical">
                          🚫 Expired
                        </td>
                        <td className="action">
                          <button className="action-btn remove">Remove</button>
                          <button className="action-btn report">Report</button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty-state">
              <FiAlertTriangle className="icon green" />
              <h3>No expired products!</h3>
              <p>Great job keeping inventory fresh and safe</p>
            </div>
          )}
        </div>
      )}

      {/* Best Practices */}
      <div className="best-practices">
        <h3>🛡️ Best Practices</h3>
        <ul>
          <li><strong>Check daily:</strong> Review this page every morning to catch upcoming expirations</li>
          <li><strong>FIFO method:</strong> Use First-In-First-Out to minimize waste</li>
          <li><strong>Clear promotions:</strong> Run discounts on items expiring soon to move inventory</li>
          <li><strong>Proper disposal:</strong> Remove expired items immediately - never sell expired products</li>
          <li><strong>Track trends:</strong> If certain products expire frequently, reduce order quantities</li>
          <li><strong>Staff training:</strong> Ensure all employees understand expiry date importance</li>
        </ul>
      </div>
    </div>
  )
}

export default ExpiryTracking
