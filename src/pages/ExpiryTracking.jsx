import { useState, useEffect } from 'react'
import { getExpiringProducts, getExpiredProducts, getExpiryReport, discardExpiredBatch } from '../database/db'
import { useAuthStore } from '../store/useAuthStore'
import { useLanSync } from '../hooks/useLanSync'
import './ExpiryTracking.css'
import { FiCalendar, FiAlertTriangle, FiClock, FiShield, FiTrash2, FiX, FiCheck } from 'react-icons/fi'

function ExpiryTracking() {
  const [expiryReport, setExpiryReport] = useState({})
  const [expiringProducts, setExpiringProducts] = useState([])
  const [expiredProducts, setExpiredProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const [activeTab, setActiveTab] = useState('expiring') // expiring | expired
  const { user } = useAuthStore()

  // Discarding writes off stock — same privilege bar as receiving corrections
  const canDiscard = user?.role === 'Admin' || user?.role === 'Manager'
  const [discardTarget, setDiscardTarget] = useState(null) // batch row being discarded
  const [discardUnits, setDiscardUnits] = useState('')
  const [discardError, setDiscardError] = useState('')
  const [discardSaving, setDiscardSaving] = useState(false)

  useEffect(() => {
    loadData()
  }, [])
  useLanSync(() => loadData(true))

  const loadData = async (silent = false) => {
    try {
      if (!silent) setLoading(true)
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
      if (!silent) setLoading(false)
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

  const openDiscard = (batch) => {
    // Batch units may already be partly sold — default to what can actually be removed
    const suggested = Math.min(batch.batch_units || 0, batch.current_quantity || 0)
    setDiscardTarget(batch)
    setDiscardUnits(String(suggested))
    setDiscardError('')
  }

  const closeDiscard = () => {
    if (discardSaving) return
    setDiscardTarget(null)
    setDiscardError('')
  }

  const handleDiscardConfirm = async () => {
    if (!discardTarget) return
    const units = parseInt(discardUnits)
    if (discardUnits === '' || !Number.isFinite(units) || units < 0) {
      setDiscardError('Enter how many units to remove (0 or more)')
      return
    }
    setDiscardSaving(true)
    setDiscardError('')
    try {
      const result = await discardExpiredBatch(
        discardTarget.id,
        discardTarget.expiry_date,
        units,
        user?.username || 'System'
      )
      setDiscardTarget(null)
      setSuccessMessage(
        `Batch of "${result.product_name}" (expiry ${new Date(result.expiry_date).toLocaleDateString('en-ZW')}) discarded — ` +
        `${result.written_off} unit${result.written_off !== 1 ? 's' : ''} written off, stock is now ${result.new_stock_qty}.`
      )
      setTimeout(() => setSuccessMessage(''), 6000)
      await loadData(true)
    } catch (err) {
      setDiscardError(err.message || 'Failed to discard batch')
    } finally {
      setDiscardSaving(false)
    }
  }

  if (loading) return <div className="expiry-page"><div className="loading">Loading...</div></div>

  return (
    <div className="expiry-page">
      {error && <div className="error-banner">{error}</div>}
      {successMessage && <div className="success-banner">{successMessage}</div>}

      {/* Summary Cards */}
      <div className="summary-cards">
        <div className="summary-card critical-count">
          <div className="icon">
            <FiAlertTriangle />
          </div>
          <div className="content">
            <div className="label">Expired Batches</div>
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
          <FiClock size={14} /> Expiring Soon ({expiringProducts.length})
        </button>
        <button
          className={`tab-btn ${activeTab === 'expired' ? 'active' : ''}`}
          onClick={() => setActiveTab('expired')}
        >
          <FiAlertTriangle size={14} /> Already Expired ({expiredProducts.length})
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
                    <th>Batch Units</th>
                    <th>Days Until Expiry</th>
                    <th>Status</th>
                    {canDiscard && <th>Action</th>}
                  </tr>
                </thead>
                <tbody>
                  {expiringProducts.map(product => {
                    const daysUntil = getDaysUntilExpiry(product.expiry_date)
                    const urgency = getUrgencyClass(daysUntil)
                    const expiryDateStr = new Date(product.expiry_date).toLocaleDateString('en-ZW')

                    return (
                      <tr key={`${product.id}-${product.expiry_date}`} className={`urgency-${urgency}`}>
                        <td className="product-name">
                          <span className="name">{product.name}</span>
                          <span className="details">{product.current_quantity} in stock</span>
                        </td>
                        <td className="date">
                          {expiryDateStr}
                        </td>
                        <td className="days">
                          {product.batch_units} units
                        </td>
                        <td className="days">
                          {daysUntil === 0 ? (
                            <span className="expires-today">Today</span>
                          ) : daysUntil === 1 ? (
                            <span className="expires-tomorrow">Tomorrow</span>
                          ) : (
                            <span>{daysUntil} days</span>
                          )}
                        </td>
                        <td className={`status ${urgency}`}>
                          {urgency === 'critical' && 'Critical'}
                          {urgency === 'today' && 'TODAY'}
                          {urgency === 'urgent' && 'Urgent'}
                          {urgency === 'warning' && 'Warning'}
                          {urgency === 'caution' && 'Notice'}
                        </td>
                        {canDiscard && (
                          <td className="action">
                            <button className="action-btn discard" onClick={() => openDiscard(product)}>
                              <FiTrash2 size={12} /> Discard
                            </button>
                          </td>
                        )}
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
              <p>All items have plenty of shelf life remaining. Record expiry dates when receiving stock to track batches here.</p>
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
                    <th>Batch Units</th>
                    <th>Days Expired</th>
                    <th>Status</th>
                    {canDiscard && <th>Action</th>}
                  </tr>
                </thead>
                <tbody>
                  {expiredProducts.map(product => {
                    const daysExpired = getDaysExpired(product.expiry_date)
                    const expiryDateStr = new Date(product.expiry_date).toLocaleDateString('en-ZW')

                    return (
                      <tr key={`${product.id}-${product.expiry_date}`} className="urgency-critical">
                        <td className="product-name">
                          <span className="name">{product.name}</span>
                          <span className="details">{product.current_quantity} in stock</span>
                        </td>
                        <td className="date">
                          {expiryDateStr}
                        </td>
                        <td className="days">
                          {product.batch_units} units
                        </td>
                        <td className="days">
                          <span className="expired-by">{daysExpired} days ago</span>
                        </td>
                        <td className="status critical">
                          Expired
                        </td>
                        {canDiscard && (
                          <td className="action">
                            <button className="action-btn remove" onClick={() => openDiscard(product)}>
                              <FiTrash2 size={12} /> Remove
                            </button>
                          </td>
                        )}
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

      {/* ── Discard Batch Modal ── */}
      {discardTarget && (
        <div className="form-overlay" onClick={closeDiscard}>
          <div className="product-form discard-modal" onClick={e => e.stopPropagation()}>
            <div className="form-header">
              <h2>Discard Batch</h2>
              <button className="close-btn" onClick={closeDiscard}><FiX size={14} /></button>
            </div>

            <div className="discard-summary">
              <div className="ds-row"><span className="ds-label">Product</span><span>{discardTarget.name}</span></div>
              <div className="ds-row"><span className="ds-label">Expiry date</span><span>{new Date(discardTarget.expiry_date).toLocaleDateString('en-ZW')}</span></div>
              <div className="ds-row"><span className="ds-label">Batch received</span><span>{discardTarget.batch_units} units</span></div>
              <div className="ds-row"><span className="ds-label">Currently in stock</span><span>{discardTarget.current_quantity} units (all batches)</span></div>
            </div>

            {discardError && <div className="error-banner">{discardError}</div>}

            <div className="form-row">
              <div className="form-group">
                <label>Units to Remove from Stock *</label>
                <input
                  type="number" min="0" step="1" autoFocus
                  max={discardTarget.current_quantity || 0}
                  value={discardUnits}
                  onChange={e => { setDiscardUnits(e.target.value); if (discardError) setDiscardError('') }}
                />
                <p className="field-hint">
                  Some of this batch may already be sold — enter what you are actually throwing away.
                  Enter 0 to clear the batch from tracking without changing stock.
                </p>
              </div>
            </div>

            <div className="form-actions">
              <button className="btn btn-secondary" onClick={closeDiscard} disabled={discardSaving}>Cancel</button>
              <button className="btn btn-primary" onClick={handleDiscardConfirm} disabled={discardSaving}>
                {discardSaving ? 'Saving…' : <><FiCheck size={14} /> Confirm Discard</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Best Practices */}
      <div className="best-practices">
        <h3><FiShield size={16} /> Best Practices</h3>
        <ul>
          <li><strong>Record expiry on receiving:</strong> Enter the expiry date in Stock Control when goods arrive so batches show up here automatically</li>
          <li><strong>Check daily:</strong> Review this page every morning to catch upcoming expirations</li>
          <li><strong>FIFO method:</strong> Use First-In-First-Out to minimize waste</li>
          <li><strong>Clear promotions:</strong> Run discounts on items expiring soon to move inventory</li>
          <li><strong>Proper disposal:</strong> Remove expired items immediately - never sell expired products</li>
          <li><strong>Track trends:</strong> If certain products expire frequently, reduce order quantities</li>
        </ul>
      </div>
    </div>
  )
}

export default ExpiryTracking
