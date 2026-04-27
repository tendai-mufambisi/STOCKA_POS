import { useState, useEffect } from 'react'
import { getAllShifts, getShiftSummary, closeShift, getCurrentShift } from '../database/db'
import './ShiftDashboard.css'
import { FiClock, FiCheckCircle, FiAlertCircle, FiEye, FiX } from 'react-icons/fi'

function ShiftDashboard({ user }) {
  const [allShifts, setAllShifts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedShift, setSelectedShift] = useState(null)
  const [shiftDetail, setShiftDetail] = useState(null)
  const [closeNotes, setCloseNotes] = useState('')
  const [endCash, setEndCash] = useState('')
  const [closingShiftId, setClosingShiftId] = useState(null)
  const [isClosing, setIsClosing] = useState(false)
  const [filterStatus, setFilterStatus] = useState('all') // 'all', 'open', 'closed'
  const [activeTab, setActiveTab] = useState('list') // 'list', 'detail'

  useEffect(() => {
    loadShifts()
  }, [filterStatus])

  const loadShifts = async () => {
    try {
      setLoading(true)
      const status = filterStatus === 'all' ? null : filterStatus
      const rawShifts = await getAllShifts(status)
      // Map database fields to display fields (USD-only)
      const shifts = rawShifts.map(shift => ({
        ...shift,
        cashier_name: shift.cashier_display_name || shift.cashier_username,
        start_time: shift.started_at,
        end_time: shift.closed_at,
        total_sales: shift.total_sales_value || 0
      }))
      setAllShifts(shifts)
    } catch (err) {
      setError('Failed to load shifts')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const handleViewShift = async (shift) => {
    try {
      const summary = await getShiftSummary(shift.id)
      setShiftDetail(summary)
      setSelectedShift(shift)
      setActiveTab('detail')
    } catch (err) {
      setError('Failed to load shift details')
      console.error(err)
    }
  }

  const handleCloseShift = async (shiftId) => {
    if (!endCash) {
      setError('Please enter end cash amount')
      return
    }

    setIsClosing(true)
    try {
      const result = await closeShift(shiftId, parseFloat(endCash), closeNotes)
      setError(`✓ Shift closed. Balance: $${result.balance.toFixed(2)}`)
      setCloseNotes('')
      setEndCash('')
      setClosingShiftId(null)
      await loadShifts()
      if (selectedShift?.id === shiftId) {
        setSelectedShift(null)
        setActiveTab('list')
      }
    } catch (err) {
      setError(`Failed to close shift: ${err.message}`)
    } finally {
      setIsClosing(false)
    }
  }

  const formatTime = (dateString) => {
    const date = new Date(dateString)
    return date.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })
  }

  const formatDate = (dateString) => {
    const date = new Date(dateString)
    return date.toLocaleDateString('en-ZA')
  }

  const getDurationMinutes = (startTime, endTime) => {
    if (!endTime) {
      const now = new Date()
      return Math.round((now - new Date(startTime)) / (1000 * 60))
    }
    return Math.round((new Date(endTime) - new Date(startTime)) / (1000 * 60))
  }

  const formatDuration = (minutes) => {
    const hours = Math.floor(minutes / 60)
    const mins = minutes % 60
    if (hours === 0) return `${mins}m`
    return `${hours}h ${mins}m`
  }

  if (!user || (user.role !== 'Admin' && user.role !== 'Manager')) {
    return (
      <div className="shift-dashboard-page">
        <div className="unauthorized">
          <FiAlertCircle size={48} />
          <h2>Access Denied</h2>
          <p>Only Admins and Managers can view shifts</p>
        </div>
      </div>
    )
  }

  return (
    <div className="shift-dashboard-page">
      <div className="dashboard-header">
        <h1>Shift Management</h1>
        <div className="header-info">
          <div className="stat-card">
            <span className="stat-label">Open Shifts</span>
            <span className="stat-value">
              {allShifts.filter(s => s.status === 'open').length}
            </span>
          </div>
          <div className="stat-card">
            <span className="stat-label">Closed Today</span>
            <span className="stat-value">
              {allShifts.filter(s => s.status === 'closed' && new Date(s.end_time).toDateString() === new Date().toDateString()).length}
            </span>
          </div>
        </div>
      </div>

      {error && (
        <div className={`message ${error.includes('✓') ? 'success' : 'error'}`}>
          {error}
          <button onClick={() => setError('')}>×</button>
        </div>
      )}

      {/* Tab Navigation */}
      <div className="tab-navigation">
        <button
          className={`tab-btn ${activeTab === 'list' ? 'active' : ''}`}
          onClick={() => setActiveTab('list')}
        >
          All Shifts
        </button>
        {selectedShift && (
          <button
            className={`tab-btn ${activeTab === 'detail' ? 'active' : ''}`}
            onClick={() => setActiveTab('detail')}
          >
            Shift Detail
          </button>
        )}
      </div>

      {/* Shifts List View */}
      {activeTab === 'list' && (
        <div className="shifts-list-container">
          <div className="filter-bar">
            <button
              className={`filter-btn ${filterStatus === 'all' ? 'active' : ''}`}
              onClick={() => setFilterStatus('all')}
            >
              All Shifts
            </button>
            <button
              className={`filter-btn ${filterStatus === 'open' ? 'active' : ''}`}
              onClick={() => setFilterStatus('open')}
            >
              Open
            </button>
            <button
              className={`filter-btn ${filterStatus === 'closed' ? 'active' : ''}`}
              onClick={() => setFilterStatus('closed')}
            >
              Closed
            </button>
          </div>

          {loading ? (
            <div className="loading">Loading shifts...</div>
          ) : allShifts.length === 0 ? (
            <div className="no-shifts">No shifts found</div>
          ) : (
            <div className="shifts-table">
              <div className="table-header">
                <div className="col col-cashier">Cashier</div>
                <div className="col col-date">Date</div>
                <div className="col col-time">Time</div>
                <div className="col col-duration">Duration</div>
                <div className="col col-sales">Sales</div>
                <div className="col col-balance">Balance</div>
                <div className="col col-status">Status</div>
                <div className="col col-actions">Actions</div>
              </div>

              {allShifts.map(shift => (
                <div key={shift.id} className="table-row">
                  <div className="col col-cashier">
                    <strong>{shift.cashier_name}</strong>
                  </div>
                  <div className="col col-date">
                    {formatDate(shift.start_time)}
                  </div>
                  <div className="col col-time">
                    {formatTime(shift.start_time)}
                    {shift.end_time && ` - ${formatTime(shift.end_time)}`}
                  </div>
                  <div className="col col-duration">
                    {formatDuration(getDurationMinutes(shift.start_time, shift.end_time))}
                  </div>
                  <div className="col col-sales">
                    <span className="sales-badge">
                      ${(shift.total_sales || 0).toFixed(2)}
                    </span>
                  </div>
                  <div className="col col-balance">
                    {shift.status === 'closed' ? (
                      <span className={`balance-badge ${shift.total_sales >= 0 ? 'positive' : 'negative'}`}>
                        {shift.total_sales >= 0 ? '+' : ''}${(shift.total_sales || 0).toFixed(2)}
                      </span>
                    ) : (
                      <span className="balance-badge pending">Open</span>
                    )}
                  </div>
                  <div className="col col-status">
                    <span className={`status-badge ${shift.status}`}>
                      {shift.status === 'open' ? (
                        <>
                          <FiClock size={14} /> Open
                        </>
                      ) : (
                        <>
                          <FiCheckCircle size={14} /> Closed
                        </>
                      )}
                    </span>
                  </div>
                  <div className="col col-actions">
                    <button
                      className="action-btn view"
                      onClick={() => handleViewShift(shift)}
                      title="View details"
                    >
                      <FiEye size={16} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Shift Detail View */}
      {activeTab === 'detail' && shiftDetail && (
        <div className="shift-detail-container">
          <div className="detail-header">
            <h2>{shiftDetail.cashier_name}'s Shift</h2>
            <button
              className="close-detail-btn"
              onClick={() => {
                setActiveTab('list')
                setSelectedShift(null)
                setShiftDetail(null)
              }}
            >
              <FiX size={24} />
            </button>
          </div>

          <div className="detail-grid">
            {/* Shift Info Card */}
            <div className="detail-card">
              <h3>Shift Information</h3>
              <div className="info-row">
                <span className="label">Date:</span>
                <span className="value">{formatDate(shiftDetail.start_time)}</span>
              </div>
              <div className="info-row">
                <span className="label">Start Time:</span>
                <span className="value">{formatTime(shiftDetail.start_time)}</span>
              </div>
              {shiftDetail.end_time && (
                <>
                  <div className="info-row">
                    <span className="label">End Time:</span>
                    <span className="value">{formatTime(shiftDetail.end_time)}</span>
                  </div>
                  <div className="info-row">
                    <span className="label">Duration:</span>
                    <span className="value">
                      {formatDuration(getDurationMinutes(shiftDetail.start_time, shiftDetail.end_time))}
                    </span>
                  </div>
                </>
              )}
              <div className="info-row">
                <span className="label">Status:</span>
                <span className={`status-badge ${shiftDetail.status}`}>
                  {shiftDetail.status === 'open' ? 'Open' : 'Closed'}
                </span>
              </div>
            </div>

            {/* Cash Card */}
            <div className="detail-card">
              <h3>Cash</h3>
              <div className="info-row">
                <span className="label">Opening Float:</span>
                <span className="value">${shiftDetail.start_float.toFixed(2)}</span>
              </div>
              {shiftDetail.status === 'closed' && (
                <>
                  <div className="info-row">
                    <span className="label">Closing Float:</span>
                    <span className="value">${shiftDetail.end_float.toFixed(2)}</span>
                  </div>
                  <div className="info-row">
                    <span className="label">Expected Cash:</span>
                    <span className="value">${shiftDetail.expected_cash.toFixed(2)}</span>
                  </div>
                  <div className="info-row">
                    <span className="label">Actual Cash:</span>
                    <span className="value">${shiftDetail.actual_cash.toFixed(2)}</span>
                  </div>
                  <div className="info-row balance-row">
                    <span className="label">Balance:</span>
                    <span className={`balance-value ${shiftDetail.balance >= -0.01 ? 'positive' : 'negative'}`}>
                      {shiftDetail.balance >= 0 ? '+' : ''}${shiftDetail.balance.toFixed(2)}
                    </span>
                  </div>
                  {shiftDetail.is_balanced && (
                    <div className="balanced-indicator">
                      <FiCheckCircle size={18} /> Cash Balanced ✓
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Sales Card */}
            <div className="detail-card">
              <h3>Sales</h3>
              <div className="info-row">
                <span className="label">Transactions:</span>
                <span className="value">{shiftDetail.sales.count}</span>
              </div>
              <div className="info-row">
                <span className="label">Total Sales:</span>
                <span className="value sales-total">${shiftDetail.sales.total.toFixed(2)}</span>
              </div>
              {shiftDetail.held_count > 0 && (
                <div className="info-row">
                  <span className="label">Held Sales:</span>
                  <span className="value pending">{shiftDetail.held_count}</span>
                </div>
              )}
            </div>

            {/* Expenses Card */}
            <div className="detail-card">
              <h3>Expenses</h3>
              <div className="info-row">
                <span className="label">Transactions:</span>
                <span className="value">{shiftDetail.expenses.count}</span>
              </div>
              <div className="info-row">
                <span className="label">Total Expenses:</span>
                <span className="value expenses-total">${shiftDetail.expenses.total.toFixed(2)}</span>
              </div>
            </div>
          </div>

          {/* Close Shift Section */}
          {shiftDetail.status === 'open' && (
            <div className="close-shift-section">
              <h3>Close Shift</h3>
              {closingShiftId === shiftDetail.id ? (
                <div className="close-form">
                  <div className="form-group">
                    <label>Closing Cash Amount</label>
                    <input
                      type="number"
                      step="any"
                      value={endCash}
                      onChange={(e) => setEndCash(e.target.value)}
                      placeholder="Enter actual cash in drawer"
                      className="form-input"
                      autoFocus
                    />
                  </div>
                  <div className="form-group">
                    <label>Notes (optional)</label>
                    <textarea
                      value={closeNotes}
                      onChange={(e) => setCloseNotes(e.target.value)}
                      placeholder="Any notes about this shift..."
                      className="form-textarea"
                      rows={3}
                    />
                  </div>
                  <div className="form-actions">
                    <button
                      className="btn btn-primary"
                      onClick={() => handleCloseShift(shiftDetail.id)}
                      disabled={isClosing || !endCash}
                    >
                      {isClosing ? 'Closing...' : 'Close Shift'}
                    </button>
                    <button
                      className="btn btn-secondary"
                      onClick={() => setClosingShiftId(null)}
                      disabled={isClosing}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  className="btn btn-primary"
                  onClick={() => setClosingShiftId(shiftDetail.id)}
                >
                  Close This Shift
                </button>
              )}
            </div>
          )}

          {shiftDetail.notes && (
            <div className="detail-card">
              <h3>Notes</h3>
              <p className="notes-text">{shiftDetail.notes}</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default ShiftDashboard
