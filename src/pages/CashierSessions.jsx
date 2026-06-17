import { useState, useEffect } from 'react'
import { getActiveShifts, getAllShifts, getShiftById } from '../database/db'
import './CashierSessions.css'
import { FiClock, FiEye, FiFilter, FiRefreshCw, FiTrendingUp, FiX, FiCheckCircle, FiAlertCircle, FiInfo } from 'react-icons/fi'

function CashierSessions() {
  const [activeSection, setActiveSection] = useState('live') // 'live' | 'history'
  const [activeShifts, setActiveShifts] = useState([])
  const [allShifts, setAllShifts] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedShift, setSelectedShift] = useState(null)
  const [filterCashier, setFilterCashier] = useState('')
  const [filterStatus, setFilterStatus] = useState('all') // 'all' | 'balanced' | 'short' | 'over'
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [autoRefresh, setAutoRefresh] = useState(true)

  const loadActiveShifts = async () => {
    try {
      const shifts = await getActiveShifts()
      setActiveShifts(shifts || [])
    } catch {
      setActiveShifts([])
    }
  }

  const loadShiftHistory = async () => {
    try {
      const from = dateFrom ? new Date(dateFrom).toISOString() : null
      const to   = dateTo   ? new Date(new Date(dateTo).getTime() + 86400000).toISOString() : null
      let filtered = (await getAllShifts('closed', from, to)) || []

      if (filterCashier) {
        const q = filterCashier.toLowerCase()
        filtered = filtered.filter(s =>
          s.cashier_username?.toLowerCase().includes(q) ||
          s.cashier_display_name?.toLowerCase().includes(q)
        )
      }

      if (filterStatus !== 'all') {
        filtered = filtered.filter(s => s.reconciliation_status === filterStatus)
      }

      setAllShifts(filtered)
    } catch {
      setAllShifts([])
    }
  }

  useEffect(() => {
    const loadData = async () => {
      setLoading(true)
      if (activeSection === 'live') {
        await loadActiveShifts()
      } else {
        await loadShiftHistory()
      }
      setLoading(false)
    }
    
    loadData()
  }, [activeSection, filterCashier, filterStatus, dateFrom, dateTo])

  // Auto-refresh active shifts every 30 seconds
  useEffect(() => {
    if (!autoRefresh || activeSection !== 'live') return
    
    const timer = setInterval(() => {
      loadActiveShifts()
    }, 30000)
    
    return () => clearInterval(timer)
  }, [autoRefresh, activeSection])

  const formatTime = (dateString) => {
    if (!dateString) return '-'
    const date = new Date(dateString)
    return date.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })
  }

  const formatDate = (dateString) => {
    if (!dateString) return '-'
    const date = new Date(dateString)
    return date.toLocaleDateString('en-ZA')
  }

  const getShiftDuration = (shift) => {
    const startDate = new Date(shift.started_at)
    const endDate = shift.closed_at ? new Date(shift.closed_at) : new Date()
    const minutes = Math.floor((endDate - startDate) / 60000)
    const hours = Math.floor(minutes / 60)
    const mins = minutes % 60
    return `${hours}h ${mins}m`
  }

  const getVarianceIcon = (status) => {
    switch (status) {
      case 'balanced': return <FiCheckCircle size={13} />
      case 'short':    return <FiAlertCircle size={13} />
      case 'over':     return <FiInfo size={13} />
      default:         return null
    }
  }

  if (loading && activeShifts.length === 0 && allShifts.length === 0) {
    return <div className="cashier-sessions"><div className="loading">Loading...</div></div>
  }

  return (
    <div className="cashier-sessions">
      {/* Header */}
      <div className="sessions-header">
        <h1>Cashier Sessions</h1>
        <div className="header-actions">
          {activeSection === 'live' && (
            <>
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
            </>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="sessions-tabs">
        <button
          className={`tab ${activeSection === 'live' ? 'active' : ''}`}
          onClick={() => setActiveSection('live')}
        >
          <FiClock size={18} />
          Live Sessions ({activeShifts.length})
        </button>
        <button
          className={`tab ${activeSection === 'history' ? 'active' : ''}`}
          onClick={() => setActiveSection('history')}
        >
          <FiTrendingUp size={18} />
          Shift History
        </button>
      </div>

      {/* Content */}
      <div className="sessions-content">
        {activeSection === 'live' ? (
          <>
            {/* Live Sessions */}
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
          </>
        ) : (
          <>
            {/* Shift History with Filters */}
            <div className="filters-panel">
              <div className="filter-row">
                <div className="filter-group">
                  <label>Cashier Name</label>
                  <input
                    type="text"
                    value={filterCashier}
                    onChange={(e) => setFilterCashier(e.target.value)}
                    placeholder="Search cashier..."
                  />
                </div>
                <div className="filter-group">
                  <label>Reconciliation Status</label>
                  <select
                    value={filterStatus}
                    onChange={(e) => setFilterStatus(e.target.value)}
                  >
                    <option value="all">All</option>
                    <option value="balanced">Balanced</option>
                    <option value="short">Short</option>
                    <option value="over">Over</option>
                  </select>
                </div>
                <div className="filter-group">
                  <label>From Date</label>
                  <input
                    type="date"
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                  />
                </div>
                <div className="filter-group">
                  <label>To Date</label>
                  <input
                    type="date"
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                  />
                </div>
              </div>
            </div>

            {/* History Table */}
            {allShifts.length === 0 ? (
              <div className="empty-state">
                <FiFilter size={48} />
                <h2>No Shifts Found</h2>
                <p>Adjust your filters to see shift history</p>
              </div>
            ) : (
              <div className="table-container">
                <table className="shifts-table">
                  <thead>
                    <tr>
                      <th>Cashier</th>
                      <th>Date</th>
                      <th>Start Time</th>
                      <th>End Time</th>
                      <th>Transactions</th>
                      <th>Total Sales</th>
                      <th>Status</th>
                      <th>Variance</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allShifts.map(shift => (
                      <tr key={shift.id}>
                        <td>{shift.cashier_display_name || shift.cashier_username}</td>
                        <td>{formatDate(shift.started_at)}</td>
                        <td>{formatTime(shift.started_at)}</td>
                        <td>{formatTime(shift.closed_at)}</td>
                        <td>{shift.total_sales_count || 0}</td>
                        <td>${(shift.total_sales_value || 0).toFixed(2)}</td>
                        <td>
                          <span className={`variance-status ${shift.reconciliation_status || ''}`}>
                            {getVarianceIcon(shift.reconciliation_status)} {shift.reconciliation_status}
                          </span>
                        </td>
                        <td className={`variance-amount ${shift.reconciliation_status || ''}`}>
                          ${Math.abs(shift.overall_variance || 0).toFixed(2)}
                        </td>
                        <td>
                          <button className="btn btn-primary btn-sm" onClick={() => setSelectedShift(shift)}>
                            View Report
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>

      {/* Shift Detail Modal (to be implemented) */}
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

  useEffect(() => {
    const loadShift = async () => {
      const freshShift = await getShiftById(shift.id)
      if (freshShift) setShiftData(freshShift)
    }
    loadShift()
  }, [shift.id])

  const formatTime = (dateString) => {
    if (!dateString) return '-'
    return new Date(dateString).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })
  }

  const status = shiftData.reconciliation_status
  const variance = shiftData.variance || 0
  const isZero = Math.abs(variance) < 0.01

  const statusLabel = status === 'balanced'
    ? 'Balanced'
    : status === 'short'
      ? `Short — $${Math.abs(shiftData.overall_variance || 0).toFixed(2)}`
      : `Over — $${(shiftData.overall_variance || 0).toFixed(2)}`

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
              <div className="s-value">${(shiftData.total_sales_value || 0).toFixed(2)}</div>
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
                <td>${((shiftData.opening_cash || 0) + (shiftData.total_sales_value || 0)).toFixed(2)}</td>
                <td>${(shiftData.closing_cash || 0).toFixed(2)}</td>
                <td className={`recon-variance ${isZero ? 'zero' : variance > 0 ? 'positive' : 'negative'}`}>
                  {variance > 0 ? '+' : ''}${Math.abs(variance).toFixed(2)}
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

          <div className={`shift-status-banner ${status || ''}`}>
            <StatusIcon size={16} /> {statusLabel}
          </div>
        </div>

        <div className="shift-modal-footer">
          <button className="btn btn-primary" onClick={onClose}>Close</button>
        </div>

      </div>
    </div>
  )
}

export default CashierSessions
