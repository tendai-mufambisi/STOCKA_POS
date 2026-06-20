import { useState, useEffect } from 'react'
import { getAllShifts, getShiftSummary, closeShift, getSalesByShift, reopenShift } from '../database/db'
import { useAuthStore } from '../store/useAuthStore'
import { useLanSync } from '../hooks/useLanSync'
import ConfirmModal from '../components/ConfirmModal'
import './ShiftDashboard.css'
import {
  FiClock, FiCheckCircle, FiAlertCircle, FiEye, FiX,
  FiDollarSign, FiShoppingCart, FiChevronLeft, FiCalendar,
  FiTrendingUp, FiAlertTriangle, FiRefreshCw
} from 'react-icons/fi'
import ReceiptModal from '../components/ReceiptModal'

function ShiftDashboard() {
  const { user } = useAuthStore()
  const [allShifts, setAllShifts]     = useState([])
  const [loading, setLoading]         = useState(true)
  const [error, setError]             = useState('')
  const [selectedShift, setSelectedShift] = useState(null)
  const [shiftDetail, setShiftDetail] = useState(null)
  const [closeNotes, setCloseNotes]   = useState('')
  const [endCash, setEndCash]         = useState('')
  const [closingShiftId, setClosingShiftId] = useState(null)
  const [isClosing, setIsClosing]     = useState(false)
  const [filterStatus, setFilterStatus] = useState('all')
  const [activeTab, setActiveTab]     = useState('list')
  const [shiftSales, setShiftSales]   = useState([])
  const [selectedReceipt, setSelectedReceipt] = useState(null)
  const [isReopening, setIsReopening] = useState(false)
  const [confirmReopen, setConfirmReopen] = useState(null) // shiftId

  useEffect(() => { loadShifts() }, [filterStatus])
  useLanSync(() => loadShifts(true))

  const loadShifts = async (silent = false) => {
    try {
      if (!silent) setLoading(true)
      const status = filterStatus === 'all' ? null : filterStatus
      const raw = await getAllShifts(status)
      setAllShifts(raw.map(s => ({
        ...s,
        cashier_name: s.cashier_display_name || s.cashier_username || 'Unknown',
        start_time:   s.started_at,
        end_time:     s.closed_at,
        total_sales:  s.total_sales_value || 0,
      })))
    } catch {
      setError('Failed to load shifts')
    } finally {
      if (!silent) setLoading(false)
    }
  }

  const handleViewShift = async (shift) => {
    try {
      const [summary, sales] = await Promise.all([
        getShiftSummary(shift.id),
        getSalesByShift(shift.id),
      ])
      setShiftDetail({
        ...summary,
        cashier_name: summary.cashier_display_name || summary.cashier_username,
        start_time:   summary.started_at,
        end_time:     summary.closed_at,
      })
      setShiftSales(sales || [])
      setSelectedShift(shift)
      setActiveTab('detail')
    } catch {
      setError('Failed to load shift details')
    }
  }

  const handleBackToList = () => {
    setActiveTab('list')
    setSelectedShift(null)
    setShiftDetail(null)
    setShiftSales([])
    setSelectedReceipt(null)
    setClosingShiftId(null)
    setEndCash('')
    setCloseNotes('')
  }

  const handleCloseShift = async (shiftId) => {
    if (!endCash) { setError('Please enter the cash counted'); return }
    setIsClosing(true)
    try {
      const result = await closeShift(shiftId, { closing_cash: parseFloat(endCash) || 0 }, closeNotes)
      const variance = result?.variance ?? 0
      setError(`✓ Shift closed. Variance: ${variance >= 0 ? '+$' : '-$'}${Math.abs(variance).toFixed(2)}`)
      setCloseNotes('')
      setEndCash('')
      setClosingShiftId(null)
      await loadShifts()
      handleBackToList()
    } catch (err) {
      setError(`Failed to close shift: ${err.message}`)
    } finally {
      setIsClosing(false)
    }
  }

  const handleReopenShift = (shiftId) => {
    setConfirmReopen(shiftId)
  }

  const handleConfirmReopen = async () => {
    const shiftId = confirmReopen
    setConfirmReopen(null)
    setIsReopening(true)
    try {
      await reopenShift(shiftId)
      await loadShifts()
      handleBackToList()
    } catch (err) {
      setError(`Failed to reopen shift: ${err.message}`)
    } finally {
      setIsReopening(false)
    }
  }

  const fmt = {
    time: (d) => d ? new Date(d).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' }) : '—',
    date: (d) => d ? new Date(d).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' }) : '—',
    dur:  (start, end) => {
      const mins = Math.round((new Date(end || Date.now()) - new Date(start)) / 60000)
      if (mins < 0) return '—'
      const h = Math.floor(mins / 60), m = mins % 60
      return h === 0 ? `${m}m` : `${h}h ${m}m`
    },
    initials: (name) => (name || '?').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2),
    money:  (n) => `$${Math.abs(n || 0).toFixed(2)}`,
    signed: (n) => `${(n ?? 0) >= 0 ? '+$' : '-$'}${Math.abs(n ?? 0).toFixed(2)}`,
  }

  if (!user || (user.role !== 'Admin' && user.role !== 'Manager')) {
    return (
      <div className="sd-page">
        <div className="sd-unauthorized">
          <FiAlertCircle size={48} />
          <h2>Access Denied</h2>
          <p>Only Admins and Managers can view shifts</p>
        </div>
      </div>
    )
  }

  const today = new Date().toDateString()
  const openCount    = allShifts.filter(s => s.status === 'open').length
  const closedToday  = allShifts.filter(s => s.status === 'closed' && s.end_time && new Date(s.end_time).toDateString() === today).length
  const todaySales   = allShifts
    .filter(s => s.start_time && new Date(s.start_time).toDateString() === today)
    .reduce((sum, s) => sum + (s.total_sales || 0), 0)

  return (
    <>
    <div className="sd-page">

      {/* ── Summary strip ── */}
      <div className="sd-summary-strip">
        <div className="sd-summary-card">
          <span className="sd-summary-dot open" />
          <div>
            <div className="sd-summary-label">Open Shifts</div>
            <div className="sd-summary-value">{openCount}</div>
          </div>
        </div>
        <div className="sd-summary-card">
          <span className="sd-summary-dot closed" />
          <div>
            <div className="sd-summary-label">Closed Today</div>
            <div className="sd-summary-value">{closedToday}</div>
          </div>
        </div>
        <div className="sd-summary-card">
          <FiDollarSign size={15} className="sd-summary-icon" />
          <div>
            <div className="sd-summary-label">Today's Sales</div>
            <div className="sd-summary-value">{fmt.money(todaySales)}</div>
          </div>
        </div>
      </div>

      {/* ── Error / success banner ── */}
      {error && (
        <div className={`sd-banner ${error.startsWith('✓') ? 'success' : 'error'}`}>
          {error}
          <button onClick={() => setError('')}><FiX size={14} /></button>
        </div>
      )}

      {/* ── Tabs ── */}
      <div className="sd-tabs">
        <button className={`sd-tab ${activeTab === 'list' ? 'active' : ''}`} onClick={() => setActiveTab('list')}>
          All Shifts
        </button>
        {selectedShift && (
          <button className={`sd-tab ${activeTab === 'detail' ? 'active' : ''}`} onClick={() => setActiveTab('detail')}>
            {selectedShift.cashier_name}'s Shift
          </button>
        )}
      </div>

      {/* ═══ LIST VIEW ═══ */}
      {activeTab === 'list' && (
        <div className="sd-list-card">
          <div className="sd-filter-bar">
            {[['all', 'All Shifts'], ['open', 'Open'], ['closed', 'Closed']].map(([val, label]) => (
              <button key={val} className={`sd-chip ${filterStatus === val ? 'active' : ''}`} onClick={() => setFilterStatus(val)}>
                {label}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="sd-empty"><div className="sd-spinner" />Loading shifts…</div>
          ) : allShifts.length === 0 ? (
            <div className="sd-empty">
              <FiClock size={40} />
              <p>No shifts found</p>
            </div>
          ) : (
            <div className="sd-table">
              <div className="sd-thead">
                <div className="sd-th c-cashier">Cashier</div>
                <div className="sd-th c-date">Date</div>
                <div className="sd-th c-time">Time</div>
                <div className="sd-th c-dur">Duration</div>
                <div className="sd-th c-txn">Txns</div>
                <div className="sd-th c-sales">Sales</div>
                <div className="sd-th c-status">Status</div>
                <div className="sd-th c-action" />
              </div>

              {allShifts.map(shift => (
                <div key={shift.id} className="sd-row" onClick={() => handleViewShift(shift)}>
                  <div className="sd-td c-cashier">
                    <div className="sd-avatar">{fmt.initials(shift.cashier_name)}</div>
                    <span className="sd-cashier-name">{shift.cashier_name}</span>
                  </div>
                  <div className="sd-td c-date">{fmt.date(shift.start_time)}</div>
                  <div className="sd-td c-time">
                    {fmt.time(shift.start_time)}
                    {shift.end_time && <> — {fmt.time(shift.end_time)}</>}
                  </div>
                  <div className="sd-td c-dur">{fmt.dur(shift.start_time, shift.end_time)}</div>
                  <div className="sd-td c-txn">{shift.total_sales_count || 0}</div>
                  <div className="sd-td c-sales">
                    <span className="sd-sales-pill">{fmt.money(shift.total_sales)}</span>
                  </div>
                  <div className="sd-td c-status">
                    {shift.status === 'open'
                      ? <span className="sd-badge open"><FiClock size={11} /> Open</span>
                      : shift.reconciliation_status === 'short'
                        ? <span className="sd-badge recon-short"><FiAlertCircle size={11} /> Short</span>
                        : shift.reconciliation_status === 'over'
                          ? <span className="sd-badge recon-over"><FiAlertCircle size={11} /> Over</span>
                          : <span className="sd-badge closed"><FiCheckCircle size={11} /> Balanced</span>
                    }
                  </div>
                  <div className="sd-td c-action">
                    <span className="sd-view-btn" title="View details"><FiEye size={15} /></span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ═══ DETAIL VIEW ═══ */}
      {activeTab === 'detail' && shiftDetail && (
        <div className="sd-detail">

          {/* Hero banner */}
          <div className="sd-hero">
            <button className="sd-back-btn" onClick={handleBackToList}>
              <FiChevronLeft size={17} /> Back to Shifts
            </button>

            <div className="sd-hero-main">
              <div className="sd-hero-avatar">{fmt.initials(shiftDetail.cashier_name)}</div>
              <div className="sd-hero-info">
                <h2 className="sd-hero-name">{shiftDetail.cashier_name}'s Shift</h2>
                <div className="sd-hero-meta">
                  <FiCalendar size={13} />
                  {fmt.date(shiftDetail.start_time)} &nbsp;·&nbsp;
                  {fmt.time(shiftDetail.start_time)}
                  {shiftDetail.end_time && <> — {fmt.time(shiftDetail.end_time)}</>}
                </div>
              </div>
              {shiftDetail.status === 'open'
                ? <span className="sd-badge open lg"><FiClock size={13} /> Active</span>
                : <span className="sd-badge closed lg"><FiCheckCircle size={13} /> Closed</span>
              }
            </div>

            {/* Key metrics row */}
            <div className="sd-metrics">
              <div className="sd-metric">
                <FiClock size={16} className="sd-metric-icon" />
                <div className="sd-metric-label">Duration</div>
                <div className="sd-metric-val">{fmt.dur(shiftDetail.start_time, shiftDetail.end_time)}</div>
              </div>
              <div className="sd-metric">
                <FiShoppingCart size={16} className="sd-metric-icon" />
                <div className="sd-metric-label">Transactions</div>
                <div className="sd-metric-val">{shiftDetail.sales?.count ?? 0}</div>
              </div>
              <div className="sd-metric">
                <FiDollarSign size={16} className="sd-metric-icon" />
                <div className="sd-metric-label">Total Sales</div>
                <div className="sd-metric-val">{fmt.money(shiftDetail.sales?.total)}</div>
              </div>
              {shiftDetail.status === 'closed' && (
                <div className={`sd-metric ${(shiftDetail.balance ?? 0) >= -0.01 ? 'pos' : 'neg'}`}>
                  <FiTrendingUp size={16} className="sd-metric-icon" />
                  <div className="sd-metric-label">Variance</div>
                  <div className="sd-metric-val">{fmt.signed(shiftDetail.balance)}</div>
                </div>
              )}
            </div>
          </div>

          {/* Detail body — two-column grid */}
          <div className="sd-body-grid">

            {/* Cash reconciliation */}
            <div className="sd-section-card">
              <div className="sd-section-header">
                <FiDollarSign size={15} />
                Reconciliation
              </div>
              <table className="sd-recon">
                <tbody>
                  <tr>
                    <td>Opening Float</td>
                    <td>{fmt.money(shiftDetail.start_float)}</td>
                  </tr>
                  <tr>
                    <td>Cash Sales</td>
                    <td className="pos">+{fmt.money(shiftDetail.cash_sales)}</td>
                  </tr>
                  {(shiftDetail.transfer_sales ?? 0) > 0 && (
                    <tr>
                      <td style={{ color: '#1d4ed8' }}>Transfer Sales</td>
                      <td style={{ color: '#1d4ed8' }}>{fmt.money(shiftDetail.transfer_sales)}</td>
                    </tr>
                  )}
                  {(shiftDetail.total_expenses ?? 0) > 0 && (
                    <tr><td>Expenses</td><td className="neg">−{fmt.money(shiftDetail.total_expenses)}</td></tr>
                  )}
                  <tr className="separator">
                    <td>Expected Cash</td>
                    <td className="strong">{fmt.money(shiftDetail.expected_cash)}</td>
                  </tr>
                  {(shiftDetail.expected_transfer ?? 0) > 0 && (
                    <tr className="separator">
                      <td style={{ color: '#1d4ed8' }}>Expected Transfer</td>
                      <td className="strong" style={{ color: '#1d4ed8' }}>{fmt.money(shiftDetail.expected_transfer)}</td>
                    </tr>
                  )}
                  {shiftDetail.status === 'closed' && (
                    <tr>
                      <td>Cash Counted</td>
                      <td>{fmt.money(shiftDetail.actual_cash)}</td>
                    </tr>
                  )}
                  {shiftDetail.status === 'closed' && (
                    <tr className={`balance-row ${(shiftDetail.balance ?? 0) >= -0.01 ? 'pos' : 'neg'}`}>
                      <td>Cash Variance</td>
                      <td className="balance-amt">
                        {fmt.signed(shiftDetail.balance)}
                        {(shiftDetail.balance ?? 0) >= -0.01 && <FiCheckCircle size={12} style={{ marginLeft: 6 }} />}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Sales & expenses */}
            <div className="sd-section-card">
              <div className="sd-section-header">
                <FiShoppingCart size={15} />
                Sales &amp; Expenses
              </div>
              <div className="sd-info-rows">
                <div className="sd-info-row">
                  <span>Completed Sales</span>
                  <span className="strong">{shiftDetail.sales?.count ?? 0}</span>
                </div>
                <div className="sd-info-row">
                  <span>Sales Revenue</span>
                  <span className="pos">{fmt.money(shiftDetail.sales?.total)}</span>
                </div>
                {(shiftDetail.held_count ?? 0) > 0 && (
                  <div className="sd-info-row">
                    <span>Held / Pending</span>
                    <span className="warn">{shiftDetail.held_count}</span>
                  </div>
                )}
                <div className="sd-info-row sep">
                  <span>Expenses ({shiftDetail.expenses?.count ?? 0})</span>
                  <span className="neg">{fmt.money(shiftDetail.expenses?.total)}</span>
                </div>
              </div>

              {shiftDetail.notes && (
                <div className="sd-notes">
                  <div className="sd-notes-label">Notes</div>
                  <div className="sd-notes-text">{shiftDetail.notes}</div>
                </div>
              )}
            </div>
          </div>

          {/* ── Transactions list ── */}
          {shiftSales.length > 0 && (
            <div className="sd-section-card sd-transactions">
              <div className="sd-section-header">
                <FiShoppingCart size={15} />
                Transactions ({shiftSales.length})
              </div>
              <div className="sd-txn-list">
                <div className="sd-txn-head">
                  <span>Receipt #</span>
                  <span>Time</span>
                  <span>Items</span>
                  <span>Total</span>
                  <span />
                </div>
                {shiftSales.map(sale => (
                  <div key={sale.id} className="sd-txn-row" onClick={() => setSelectedReceipt(sale)}>
                    <span className="sd-txn-ref">
                      {sale.receipt_number || `#${sale.id}`}
                    </span>
                    <span className="sd-txn-time">
                      {fmt.time(sale.created_at)}
                    </span>
                    <span>{(sale.items || []).length} item{(sale.items || []).length !== 1 ? 's' : ''}</span>
                    <span className="sd-txn-total">{fmt.money(sale.total)}</span>
                    <span className="sd-view-btn"><FiEye size={14} /></span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Reopen shift (admin only, closed shifts) ── */}
          {shiftDetail.status === 'closed' && (user?.role === 'Admin' || user?.role === 'Manager') && (
            <div className="sd-reopen-card">
              <div className="sd-reopen-info">
                <FiRefreshCw size={15} />
                <span>Need to reopen this shift? The cashier will be able to log back in and continue selling.</span>
              </div>
              <button
                className="sd-btn ghost outline sd-reopen-btn"
                onClick={() => handleReopenShift(shiftDetail.id)}
                disabled={isReopening}
              >
                <FiRefreshCw size={14} />
                {isReopening ? 'Reopening…' : 'Reopen Shift'}
              </button>
            </div>
          )}

          {/* ── Close shift section (only if still open) ── */}
          {shiftDetail.status === 'open' && (
            <div className="sd-close-card">
              <div className="sd-close-header">
                <FiAlertTriangle size={16} className="sd-close-icon" />
                <div>
                  <div className="sd-close-title">Close This Shift</div>
                  <div className="sd-close-hint">
                    Expected Cash: <strong>{fmt.money(shiftDetail.expected_cash)}</strong>
                    {(shiftDetail.expected_transfer ?? 0) > 0 && (
                      <> &nbsp;·&nbsp; Expected Transfer: <strong style={{ color: '#1d4ed8' }}>{fmt.money(shiftDetail.expected_transfer)}</strong></>
                    )}
                  </div>
                </div>
              </div>

              {closingShiftId === shiftDetail.id ? (
                <div className="sd-close-form">
                  <div className="sd-form-row">
                    <div className="sd-form-group">
                      <label>Cash counted ($)</label>
                      <input
                        type="number" step="any"
                        value={endCash}
                        onChange={e => setEndCash(e.target.value)}
                        placeholder="0.00"
                        className="sd-input"
                        autoFocus
                      />
                    </div>
                  </div>
                  <div className="sd-form-group">
                    <label>Notes (optional)</label>
                    <textarea
                      value={closeNotes}
                      onChange={e => setCloseNotes(e.target.value)}
                      placeholder="Any discrepancies or handover notes…"
                      className="sd-textarea"
                      rows={3}
                    />
                  </div>
                  <div className="sd-close-actions">
                    <button
                      className="sd-btn danger"
                      onClick={() => handleCloseShift(shiftDetail.id)}
                      disabled={isClosing || !endCash}
                    >
                      {isClosing ? 'Closing…' : 'Confirm & Close Shift'}
                    </button>
                    <button className="sd-btn ghost" onClick={() => setClosingShiftId(null)} disabled={isClosing}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button className="sd-btn danger outline" onClick={() => setClosingShiftId(shiftDetail.id)}>
                  Close This Shift
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>

    {selectedReceipt && (
      <ReceiptModal
        sale={selectedReceipt}
        onClose={() => setSelectedReceipt(null)}
      />
    )}

    {confirmReopen && (
      <ConfirmModal
        message="Reopen this shift?"
        detail="The cashier will be able to log in and continue selling."
        confirmLabel="Reopen"
        onConfirm={handleConfirmReopen}
        onCancel={() => setConfirmReopen(null)}
      />
    )}
    </>
  )
}

export default ShiftDashboard
