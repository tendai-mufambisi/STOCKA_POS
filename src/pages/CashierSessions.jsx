import { useState, useEffect } from 'react'
import { getActiveShifts, getAllShifts, getShiftById } from '../database/db'
import './CashierSessions.css'
import { FiClock, FiEye, FiFilter, FiRefreshCw, FiTrendingUp } from 'react-icons/fi'

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

  // Load active shifts
  const loadActiveShifts = async () => {
    try {
      console.log('Loading active shifts...')
      const shifts = await getActiveShifts()
      console.log(`Loaded ${shifts?.length || 0} active shifts:`, shifts)
      setActiveShifts(shifts || [])
    } catch (err) {
      console.error('Failed to load active shifts:', err)
      setActiveShifts([])
    }
  }

  // Load shift history
  const loadShiftHistory = async () => {
    try {
      console.log('Loading shift history with filters:', { filterCashier, filterStatus, dateFrom, dateTo })
      let from = dateFrom ? new Date(dateFrom).toISOString() : null
      let to = dateTo ? new Date(new Date(dateTo).getTime() + 86400000).toISOString() : null
      
      const shifts = await getAllShifts('closed', from, to)
      console.log(`Loaded ${shifts?.length || 0} closed shifts, filtering...`)
      let filtered = shifts || []
      
      if (filterCashier) {
        filtered = filtered.filter(s => 
          s.cashier_username?.toLowerCase().includes(filterCashier.toLowerCase()) ||
          s.cashier_display_name?.toLowerCase().includes(filterCashier.toLowerCase())
        )
      }
      
      if (filterStatus !== 'all') {
        filtered = filtered.filter(s => s.reconciliation_status === filterStatus)
      }
      
      console.log(`After filtering: ${filtered.length} shifts`)
      setAllShifts(filtered)
    } catch (err) {
      console.error('Failed to load shift history:', err)
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

  const getVarianceColor = (status) => {
    switch (status) {
      case 'balanced':
        return '#4CAF50'
      case 'short':
        return '#f44336'
      case 'over':
        return '#2196F3'
      default:
        return '#666'
    }
  }

  const getVarianceIcon = (status) => {
    switch (status) {
      case 'balanced':
        return '✅'
      case 'short':
        return '⚠️'
      case 'over':
        return 'ℹ️'
      default:
        return ''
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
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={autoRefresh}
                  onChange={(e) => setAutoRefresh(e.target.checked)}
                />
                Auto-refresh
              </label>
              <button 
                onClick={() => loadActiveShifts()}
                style={{
                  padding: '8px 16px',
                  border: '1px solid #ddd',
                  borderRadius: '4px',
                  backgroundColor: '#fff',
                  color: '#333',
                  cursor: 'pointer',
                  fontSize: '14px',
                  fontWeight: '500',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px'
                }}
              >
                <FiRefreshCw size={16} />
                Refresh Now
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
                  const totalExpected_usd = (shift.opening_usd_cash || 0) + (shift.sales_usd_cash || 0)
                  const totalExpected_zwg = (shift.opening_zwg_cash || 0) + (shift.sales_zwg_cash || 0)
                  const totalExpected_swipe_usd = (shift.opening_swipe_usd || 0) + (shift.sales_swipe_usd || 0)
                  const totalExpected_swipe_zwg = (shift.opening_swipe_zwg || 0) + (shift.sales_swipe_zwg || 0)
                  const totalExpected_ecocash_usd = (shift.opening_ecocash_usd || 0) + (shift.sales_ecocash_usd || 0)
                  const totalExpected_ecocash_zwg = (shift.opening_ecocash_zwg || 0) + (shift.sales_ecocash_zwg || 0)
                  
                  return (
                    <div key={shift.id} className="shift-card active-card">
                      <div className="card-header">
                        <h3>{shift.cashier_display_name || shift.cashier_username}</h3>
                        <span className="status-badge active">🔴 CLOCK IN</span>
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
                          <h4 style={{ fontSize: '12px', fontWeight: '600', color: '#666', marginTop: '12px', marginBottom: '8px' }}>Payment Method Breakdown:</h4>
                          <div style={{ fontSize: '12px', color: '#666', lineHeight: '1.6' }}>
                            <div>USD Cash: ${totalExpected_usd.toFixed(2)}</div>
                            <div>ZWG Cash: ZWG{totalExpected_zwg.toFixed(0)}</div>
                            <div>Swipe USD: ${totalExpected_swipe_usd.toFixed(2)}</div>
                            <div>Swipe ZWG: ZWG{totalExpected_swipe_zwg.toFixed(0)}</div>
                            <div>EcoCash USD: ${totalExpected_ecocash_usd.toFixed(2)}</div>
                            <div>EcoCash ZWG: ZWG{totalExpected_ecocash_zwg.toFixed(0)}</div>
                          </div>
                        </div>
                      </div>

                      <div className="card-footer">
                        <button
                          onClick={() => setSelectedShift(shift)}
                          style={{
                            flex: 1,
                            padding: '10px',
                            backgroundColor: '#2196F3',
                            color: 'white',
                            border: 'none',
                            borderRadius: '4px',
                            fontSize: '13px',
                            fontWeight: '500',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '6px'
                          }}
                        >
                          <FiEye size={16} />
                          View Details
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
                    style={{
                      padding: '8px 12px',
                      border: '1px solid #ddd',
                      borderRadius: '4px',
                      fontSize: '14px'
                    }}
                  />
                </div>
                <div className="filter-group">
                  <label>Reconciliation Status</label>
                  <select
                    value={filterStatus}
                    onChange={(e) => setFilterStatus(e.target.value)}
                    style={{
                      padding: '8px 12px',
                      border: '1px solid #ddd',
                      borderRadius: '4px',
                      fontSize: '14px',
                      backgroundColor: '#fff'
                    }}
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
                    style={{
                      padding: '8px 12px',
                      border: '1px solid #ddd',
                      borderRadius: '4px',
                      fontSize: '14px'
                    }}
                  />
                </div>
                <div className="filter-group">
                  <label>To Date</label>
                  <input
                    type="date"
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                    style={{
                      padding: '8px 12px',
                      border: '1px solid #ddd',
                      borderRadius: '4px',
                      fontSize: '14px'
                    }}
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
                          <span style={{ color: getVarianceColor(shift.reconciliation_status) }}>
                            {getVarianceIcon(shift.reconciliation_status)} {shift.reconciliation_status}
                          </span>
                        </td>
                        <td style={{ color: getVarianceColor(shift.reconciliation_status) }}>
                          ${Math.abs(shift.overall_variance || 0).toFixed(2)}
                        </td>
                        <td>
                          <button
                            onClick={() => setSelectedShift(shift)}
                            style={{
                              padding: '6px 12px',
                              backgroundColor: '#2196F3',
                              color: 'white',
                              border: 'none',
                              borderRadius: '4px',
                              fontSize: '12px',
                              cursor: 'pointer'
                            }}
                          >
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

// Simple detail modal
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
    const date = new Date(dateString)
    return date.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })
  }

  const VarianceRow = ({ label, expected, actual, variance, isUSD = false }) => {
    const isZero = Math.abs(variance) < 0.01
    return (
      <tr>
        <td style={{ padding: '12px' }}>{label}</td>
        <td style={{ padding: '12px', textAlign: 'right', fontFamily: 'monospace' }}>
          {isUSD ? '$' : 'ZWG'}{expected.toFixed(isUSD ? 2 : 0)}
        </td>
        <td style={{ padding: '12px', textAlign: 'right', fontFamily: 'monospace' }}>
          {isUSD ? '$' : 'ZWG'}{actual.toFixed(isUSD ? 2 : 0)}
        </td>
        <td style={{
          padding: '12px',
          textAlign: 'right',
          fontFamily: 'monospace',
          color: isZero ? '#666' : (variance > 0 ? '#4CAF50' : '#f44336'),
          fontWeight: '500'
        }}>
          {variance > 0 ? '+' : ''}{isUSD ? '$' : 'ZWG'}{Math.abs(variance).toFixed(isUSD ? 2 : 0)}
        </td>
      </tr>
    )
  }

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 2000
    }}>
      <div style={{
        backgroundColor: 'white',
        borderRadius: '8px',
        maxWidth: '900px',
        width: '90%',
        maxHeight: '90vh',
        overflow: 'auto',
        boxShadow: '0 10px 40px rgba(0, 0, 0, 0.2)'
      }}>
        {/* Modal Header */}
        <div style={{
          padding: '24px',
          borderBottom: '1px solid #eee',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <div>
            <h2 style={{ margin: '0 0 8px 0', fontSize: '22px', fontWeight: '600' }}>
              Shift Report: {shiftData.cashier_display_name || shiftData.cashier_username}
            </h2>
            <p style={{ margin: '0', fontSize: '14px', color: '#666' }}>
              {new Date(shiftData.started_at).toLocaleDateString('en-ZA')}
            </p>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              fontSize: '28px',
              cursor: 'pointer',
              color: '#ccc'
            }}
          >
            ✕
          </button>
        </div>

        {/* Modal Body */}
        <div style={{ padding: '24px' }}>
          {/* Summary */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr 1fr 1fr',
            gap: '16px',
            marginBottom: '24px'
          }}>
            <div style={{ padding: '12px', backgroundColor: '#f5f5f5', borderRadius: '4px' }}>
              <div style={{ fontSize: '12px', color: '#666' }}>Start Time</div>
              <div style={{ fontSize: '16px', fontWeight: '600', marginTop: '4px' }}>
                {formatTime(shiftData.started_at)}
              </div>
            </div>
            <div style={{ padding: '12px', backgroundColor: '#f5f5f5', borderRadius: '4px' }}>
              <div style={{ fontSize: '12px', color: '#666' }}>End Time</div>
              <div style={{ fontSize: '16px', fontWeight: '600', marginTop: '4px' }}>
                {formatTime(shiftData.closed_at)}
              </div>
            </div>
            <div style={{ padding: '12px', backgroundColor: '#f5f5f5', borderRadius: '4px' }}>
              <div style={{ fontSize: '12px', color: '#666' }}>Transactions</div>
              <div style={{ fontSize: '16px', fontWeight: '600', marginTop: '4px' }}>
                {shiftData.total_sales_count || 0}
              </div>
            </div>
            <div style={{ padding: '12px', backgroundColor: '#f5f5f5', borderRadius: '4px' }}>
              <div style={{ fontSize: '12px', color: '#666' }}>Total Sales</div>
              <div style={{ fontSize: '16px', fontWeight: '600', marginTop: '4px' }}>
                ${(shiftData.total_sales_value || 0).toFixed(2)}
              </div>
            </div>
          </div>

          {/* Reconciliation Table */}
          <h3 style={{ fontSize: '16px', fontWeight: '600', marginTop: '24px', marginBottom: '12px' }}>
            Float Reconciliation
          </h3>
          <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '24px' }}>
            <thead>
              <tr style={{ backgroundColor: '#f5f5f5' }}>
                <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', fontSize: '13px' }}>Payment Method</th>
                <th style={{ padding: '12px', textAlign: 'right', fontWeight: '600', fontSize: '13px' }}>Expected</th>
                <th style={{ padding: '12px', textAlign: 'right', fontWeight: '600', fontSize: '13px' }}>Actual</th>
                <th style={{ padding: '12px', textAlign: 'right', fontWeight: '600', fontSize: '13px' }}>Variance</th>
              </tr>
            </thead>
            <tbody>
              <VarianceRow
                label="USD Cash"
                expected={(shiftData.opening_usd_cash || 0) + (shiftData.sales_usd_cash || 0)}
                actual={shiftData.closing_usd_cash || 0}
                variance={shiftData.variance_usd_cash || 0}
                isUSD={true}
              />
              <VarianceRow
                label="ZWG Cash"
                expected={(shiftData.opening_zwg_cash || 0) + (shiftData.sales_zwg_cash || 0)}
                actual={shiftData.closing_zwg_cash || 0}
                variance={shiftData.variance_zwg_cash || 0}
                isUSD={false}
              />
              <VarianceRow
                label="Swipe USD"
                expected={(shiftData.opening_swipe_usd || 0) + (shiftData.sales_swipe_usd || 0)}
                actual={shiftData.closing_swipe_usd || 0}
                variance={shiftData.variance_swipe_usd || 0}
                isUSD={true}
              />
              <VarianceRow
                label="Swipe ZWG"
                expected={(shiftData.opening_swipe_zwg || 0) + (shiftData.sales_swipe_zwg || 0)}
                actual={shiftData.closing_swipe_zwg || 0}
                variance={shiftData.variance_swipe_zwg || 0}
                isUSD={false}
              />
              <VarianceRow
                label="EcoCash USD"
                expected={(shiftData.opening_ecocash_usd || 0) + (shiftData.sales_ecocash_usd || 0)}
                actual={shiftData.closing_ecocash_usd || 0}
                variance={shiftData.variance_ecocash_usd || 0}
                isUSD={true}
              />
              <VarianceRow
                label="EcoCash ZWG"
                expected={(shiftData.opening_ecocash_zwg || 0) + (shiftData.sales_ecocash_zwg || 0)}
                actual={shiftData.closing_ecocash_zwg || 0}
                variance={shiftData.variance_ecocash_zwg || 0}
                isUSD={false}
              />
            </tbody>
          </table>

          {/* Overall Status */}
          {shiftData.notes && (
            <div style={{
              padding: '12px',
              backgroundColor: '#f5f5f5',
              borderRadius: '4px',
              marginBottom: '16px'
            }}>
              <strong style={{ fontSize: '13px' }}>Cashier Notes:</strong><br />
              <span style={{ fontSize: '13px', color: '#666' }}>{shiftData.notes}</span>
            </div>
          )}

          <div style={{
            padding: '16px',
            backgroundColor: shiftData.reconciliation_status === 'balanced' ? '#f1f8f4' : 
                           shiftData.reconciliation_status === 'short' ? '#fff3e0' : '#f3e5f5',
            borderLeft: `4px solid ${
              shiftData.reconciliation_status === 'balanced' ? '#4CAF50' :
              shiftData.reconciliation_status === 'short' ? '#ff9800' : '#9c27b0'
            }`,
            borderRadius: '4px'
          }}>
            <div style={{ fontSize: '16px', fontWeight: '600' }}>
              {shiftData.reconciliation_status === 'balanced' ? '✅ BALANCED' :
               shiftData.reconciliation_status === 'short' ? `⚠️ SHORT $${Math.abs(shiftData.overall_variance || 0).toFixed(2)}` :
               `ℹ️ OVER $${(shiftData.overall_variance || 0).toFixed(2)}`}
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div style={{
          padding: '16px 24px',
          borderTop: '1px solid #eee',
          textAlign: 'right'
        }}>
          <button
            onClick={onClose}
            style={{
              padding: '10px 20px',
              backgroundColor: '#2196F3',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              fontSize: '14px',
              fontWeight: '500',
              cursor: 'pointer'
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

export default CashierSessions
