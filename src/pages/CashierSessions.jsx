import { useState, useEffect } from 'react'
import { getActiveShifts, getShiftById, getSalesByShift, getShiftSummary } from '../database/db'
import { useLanSync } from '../hooks/useLanSync'
import './CashierSessions.css'
import { FiClock, FiEye, FiRefreshCw, FiX, FiCheckCircle, FiAlertCircle, FiInfo } from 'react-icons/fi'
import ReceiptModal from '../components/ReceiptModal'

function CashierSessions() {
  const [activeShifts, setActiveShifts] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedShift, setSelectedShift] = useState(null)
  const [autoRefresh, setAutoRefresh] = useState(true)

  const loadActiveShifts = async () => {
    try {
      const shifts = await getActiveShifts()
      setActiveShifts(shifts || [])
    } catch {
      setActiveShifts([])
    }
  }

  useEffect(() => {
    const init = async () => {
      setLoading(true)
      await loadActiveShifts()
      setLoading(false)
    }
    init()
  }, [])

  useEffect(() => {
    if (!autoRefresh) return
    const timer = setInterval(() => loadActiveShifts(), 30000)
    return () => clearInterval(timer)
  }, [autoRefresh])

  useLanSync(loadActiveShifts)

  const formatTime = (dateString) => {
    if (!dateString) return '-'
    return new Date(dateString).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })
  }

  const getShiftDuration = (shift) => {
    const startDate = new Date(shift.started_at)
    const minutes = Math.floor((new Date() - startDate) / 60000)
    const hours = Math.floor(minutes / 60)
    const mins = minutes % 60
    return `${hours}h ${mins}m`
  }

  if (loading && activeShifts.length === 0) {
    return <div className="cashier-sessions"><div className="loading">Loading...</div></div>
  }

  return (
    <div className="cashier-sessions">
      <div className="sessions-header">
        <h1>Cashier Sessions</h1>
        <div className="header-actions">
          <label>
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
            />
            Auto-refresh
          </label>
          <button className="btn btn-secondary" onClick={() => loadActiveShifts()}>
            <FiRefreshCw size={16} /> Refresh Now
          </button>
        </div>
      </div>

      <div className="sessions-content">
        {activeShifts.length === 0 ? (
          <div className="empty-state">
            <FiClock size={48} />
            <h2>No Active Sessions</h2>
            <p>No cashiers are currently clocked in</p>
          </div>
        ) : (
          <div className="shifts-grid">
            {activeShifts.map(shift => {
              const totalExpected_usd = (shift.opening_cash || 0) + (shift.total_sales_value || 0)
              return (
                <div key={shift.id} className="shift-card active-card">
                  <div className="card-header">
                    <h3>{shift.cashier_display_name || shift.cashier_username}</h3>
                    <span className="status-badge live"><span className="live-dot" />Live</span>
                  </div>
                  <div className="card-body">
                    <div className="info-row">
                      <span className="label">Started:</span>
                      <span className="value">{formatTime(shift.started_at)}</span>
                    </div>
                    <div className="info-row">
                      <span className="label">Duration:</span>
                      <span className="value">{getShiftDuration(shift)}</span>
                    </div>
                    <div className="info-row">
                      <span className="label">Transactions:</span>
                      <span className="value">{shift.total_sales_count || 0}</span>
                    </div>
                    <div className="info-row">
                      <span className="label">Total Sales:</span>
                      <span className="value">${(shift.total_sales_value || 0).toFixed(2)}</span>
                    </div>
                    <div className="payment-breakdown">
                      <h4>USD Cash Expected:</h4>
                      <div className="bd-amount">
                        <div>${totalExpected_usd.toFixed(2)}</div>
                      </div>
                    </div>
                  </div>
                  <div className="card-footer">
                    <button className="btn btn-primary btn-block" onClick={() => setSelectedShift(shift)}>
                      <FiEye size={16} /> View Details
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {selectedShift && (
        <ShiftDetailModal
          shift={selectedShift}
          onClose={() => setSelectedShift(null)}
        />
      )}
    </div>
  )
}

function ShiftDetailModal({ shift, onClose }) {
  const [shiftData, setShiftData] = useState(shift)
  const [shiftSales, setShiftSales] = useState([])
  const [selectedReceipt, setSelectedReceipt] = useState(null)

  useEffect(() => {
    const loadShift = async () => {
      const [summary, sales] = await Promise.all([
        getShiftSummary(shift.id),
        getSalesByShift(shift.id),
      ])
      if (summary) setShiftData(summary)
      setShiftSales(sales || [])
    }
    loadShift()
  }, [shift.id])

  const formatTime = (dateString) => {
    if (!dateString) return '-'
    return new Date(dateString).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })
  }

  // Use balance from getShiftSummary (computed from actual sales rows, never stale)
  const status = shiftData.reconciliation_status
  const variance = shiftData.balance ?? shiftData.variance ?? 0
  const isZero = Math.abs(variance) < 0.01

  const statusLabel = status === 'balanced'
    ? 'Balanced'
    : status === 'short'
      ? `Short — $${Math.abs(variance).toFixed(2)}`
      : `Over — $${Math.abs(variance).toFixed(2)}`

  const StatusIcon = status === 'balanced' ? FiCheckCircle : status === 'short' ? FiAlertCircle : FiInfo

  return (
    <div className="shift-modal-overlay" onClick={onClose}>
      <div className="shift-modal" onClick={e => e.stopPropagation()}>

        <div className="shift-modal-header">
          <div>
            <h2>Shift Report: {shiftData.cashier_display_name || shiftData.cashier_username}</h2>
            <p>{new Date(shiftData.started_at).toLocaleDateString('en-ZA')}</p>
          </div>
          <button className="shift-modal-close" onClick={onClose}><FiX size={16} /></button>
        </div>

        <div className="shift-modal-body">
          <div className="shift-summary-grid">
            <div className="shift-summary-item">
              <div className="s-label">Start Time</div>
              <div className="s-value">{formatTime(shiftData.started_at)}</div>
            </div>
            <div className="shift-summary-item">
              <div className="s-label">End Time</div>
              <div className="s-value">{formatTime(shiftData.closed_at)}</div>
            </div>
            <div className="shift-summary-item">
              <div className="s-label">Transactions</div>
              <div className="s-value">{shiftData.total_sales_count || 0}</div>
            </div>
            <div className="shift-summary-item">
              <div className="s-label">Total Sales</div>
              <div className="s-value">${(shiftData.total_sales ?? shiftData.total_sales_value ?? 0).toFixed(2)}</div>
            </div>
          </div>

          <h3 className="recon-title">Float Reconciliation</h3>
          <table className="recon-table">
            <thead>
              <tr>
                <th>Payment Method</th>
                <th>Expected</th>
                <th>Actual</th>
                <th>Variance</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>USD Cash</td>
                <td>${(shiftData.expected_cash ?? (shiftData.opening_cash || 0) + (shiftData.total_sales_value || 0)).toFixed(2)}</td>
                <td>${(shiftData.closing_cash || 0).toFixed(2)}</td>
                <td className={`recon-variance ${isZero ? 'zero' : variance > 0 ? 'positive' : 'negative'}`}>
                  {variance > 0 ? '+' : variance < 0 ? '-' : ''}${Math.abs(variance).toFixed(2)}
                </td>
              </tr>
            </tbody>
          </table>

          {shiftData.notes && (
            <div className="cashier-notes-box">
              <span className="notes-label">Cashier Notes</span>
              <span className="notes-text">{shiftData.notes}</span>
            </div>
          )}

          {status && shiftData.status === 'closed' && (
            <div className={`shift-status-banner ${status || ''}`}>
              <StatusIcon size={16} /> {statusLabel}
            </div>
          )}

          {shiftSales.length > 0 && (
            <>
              <h3 className="recon-title">Transactions ({shiftSales.length})</h3>
              <div className="cs-txn-list">
                <div className="cs-txn-head">
                  <span>Receipt #</span>
                  <span>Time</span>
                  <span>Items</span>
                  <span>Total</span>
                  <span />
                </div>
                {shiftSales.map(sale => (
                  <div key={sale.id} className="cs-txn-row" onClick={() => setSelectedReceipt(sale)}>
                    <span className="cs-txn-ref">{sale.receipt_number || `#${sale.id}`}</span>
                    <span className="cs-txn-time">
                      {new Date(sale.created_at).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <span>{(sale.items || []).length} item{(sale.items || []).length !== 1 ? 's' : ''}</span>
                    <span className="cs-txn-total">${(sale.total || 0).toFixed(2)}</span>
                    <span className="cs-txn-eye"><FiEye size={14} /></span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="shift-modal-footer">
          <button className="btn btn-primary" onClick={onClose}>Close</button>
        </div>

      </div>

      {selectedReceipt && (
        <ReceiptModal
          sale={selectedReceipt}
          onClose={() => setSelectedReceipt(null)}
        />
      )}
    </div>
  )
}

export default CashierSessions
