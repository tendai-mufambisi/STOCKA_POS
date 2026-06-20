import { useState, useEffect, useCallback } from 'react'
import {
  addEndOfDay, getEndOfDayRecords,
  getAllShifts, getShiftSummary, closeAllOpenShifts,
} from '../database/db'
import { useAuthStore } from '../store/useAuthStore'
import './EndOfDay.css'
import {
  FiCheckCircle, FiAlertCircle, FiAlertTriangle, FiClock,
  FiDollarSign, FiShoppingCart, FiUsers, FiTrendingDown,
  FiSun, FiChevronDown, FiChevronUp,
} from 'react-icons/fi'

// ─── helpers ──────────────────────────────────────────────────────────────────
const fmt = {
  money:    (n)         => `$${(n || 0).toFixed(2)}`,
  time:     (d)         => d ? new Date(d).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' }) : '—',
  date:     (d)         => d ? new Date(d).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' }) : '—',
  initials: (name)      => (name || '?').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2),
  dur: (start, end) => {
    const mins = Math.round((new Date(end || Date.now()) - new Date(start)) / 60000)
    if (mins < 0) return '—'
    const h = Math.floor(mins / 60), m = mins % 60
    return h === 0 ? `${m}m` : `${h}h ${m}m`
  },
}

function varianceStatus(v) {
  if (v === null || v === undefined) return 'neutral'
  if (Math.abs(v) < 0.01) return 'balanced'
  return v > 0 ? 'overage' : 'shortage'
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function EndOfDay() {
  const { user } = useAuthStore()
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState('')
  const [todaysRecord, setTodaysRecord] = useState(null)
  const [allRecords, setAllRecords] = useState([])
  const [shifts, setShifts]         = useState([])   // [{...shift, summary:{}}]
  const [cashInputs, setCashInputs] = useState({})   // {shiftId: string}
  const [notes, setNotes]           = useState('')
  const [closing, setClosing]       = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)

  const today = new Date().toISOString().split('T')[0]

  // ── Load ────────────────────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    try {
      setLoading(true)
      const [records, allRawShifts] = await Promise.all([
        getEndOfDayRecords(),
        getAllShifts(),
      ])

      setAllRecords(records)
      const record = records.find(r => r.date === today) || null
      setTodaysRecord(record)

      // Filter to today's shifts (started_at begins with today's date)
      const rawShifts = allRawShifts.filter(s => s.started_at && s.started_at.slice(0, 10) === today)

      // Load shift summaries in parallel
      const withSummaries = await Promise.all(
        rawShifts.map(async s => {
          const summary = await getShiftSummary(s.id)
          return {
            ...s,
            cashier_name: s.cashier_display_name || s.cashier_username || 'Unknown',
            summary,
          }
        })
      )

      setShifts(withSummaries)

      // Pre-fill cash inputs: open shifts get empty, closed shifts pre-fill with their closing_cash
      const inputs = {}
      for (const s of withSummaries) {
        if (s.status === 'closed' && s.closing_cash != null) {
          inputs[s.id] = s.closing_cash.toFixed(2)
        }
      }
      setCashInputs(inputs)
    } catch {
      setError('Failed to load end of day data')
    } finally {
      setLoading(false)
    }
  }, [today])

  useEffect(() => { loadData() }, [loadData])

  // ── Derived values ──────────────────────────────────────────────────────────
  const openShifts   = shifts.filter(s => s.status === 'open')
  const closedShifts = shifts.filter(s => s.status === 'closed')

  const totalSales    = shifts.reduce((sum, s) => sum + (s.summary?.total_sales    || 0), 0)
  const totalExpenses = shifts.reduce((sum, s) => sum + (s.summary?.total_expenses || 0), 0)
  const totalExpected = shifts.reduce((sum, s) => sum + (s.summary?.expected_cash  || 0), 0)
  const totalReceived = shifts.reduce((sum, s) => {
    const v = parseFloat(cashInputs[s.id])
    return sum + (isNaN(v) ? 0 : v)
  }, 0)
  const totalVariance = totalReceived - totalExpected
  const dayVarStatus  = varianceStatus(totalVariance)

  const allOpenInputted = openShifts.every(s => {
    const v = parseFloat(cashInputs[s.id])
    return !isNaN(v) && cashInputs[s.id] !== ''
  })
  const canClose = openShifts.length === 0 || allOpenInputted

  // ── Close Day handler ───────────────────────────────────────────────────────
  const handleCloseDay = async () => {
    if (!canClose) {
      setError('Enter cash received for every open shift before closing the day.')
      return
    }
    setClosing(true)
    setError('')
    try {
      // 1. Force-close all still-open shifts with the admin-entered cash
      if (openShifts.length > 0) {
        const closingData = openShifts.map(s => ({
          shiftId:     s.id,
          closingCash: parseFloat(cashInputs[s.id]) || 0,
        }))
        await closeAllOpenShifts(closingData, 'Closed by End of Day')
      }

      // 2. Recompute totals after closes (use inputs as source of truth for actual cash)
      const actualCash = shifts.reduce((sum, s) => {
        const v = parseFloat(cashInputs[s.id])
        return sum + (isNaN(v) ? 0 : v)
      }, 0)
      const diff   = actualCash - totalExpected
      const status = Math.abs(diff) < 0.01 ? 'Balanced' : diff > 0 ? 'Overage' : 'Shortage'

      // 3. Save EOD record
      await addEndOfDay({
        date:           today,
        cashier:        user?.username || 'System',
        total_sales:    totalSales,
        total_expenses: totalExpenses,
        expected_cash:  totalExpected,
        actual_cash:    actualCash,
        difference:     diff,
        status,
        notes,
      })

      setNotes('')
      try { await window.stocka.lan?.broadcastDayClosed(today, user?.username || 'Admin') } catch (_) {}
      await loadData()
    } catch (err) {
      setError('Failed to close day: ' + err.message)
    } finally {
      setClosing(false)
    }
  }

  // ── Loading state ───────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="eod-page">
        <div className="eod-loading"><div className="eod-spinner" /> Loading…</div>
      </div>
    )
  }

  return (
    <div className="eod-page">

      {/* ── Error banner ── */}
      {error && (
        <div className="eod-error-banner">
          <FiAlertCircle size={14} />
          <span>{error}</span>
          <button onClick={() => setError('')}>×</button>
        </div>
      )}

      {/* ── Stats strip ── */}
      <div className="eod-stats-strip">
        <div className="eod-stat">
          <FiShoppingCart size={15} className="eod-stat-icon" />
          <div>
            <div className="eod-stat-label">Total Sales</div>
            <div className="eod-stat-value">{fmt.money(totalSales)}</div>
          </div>
        </div>
        <div className="eod-stat">
          <FiTrendingDown size={15} className="eod-stat-icon neg" />
          <div>
            <div className="eod-stat-label">Expenses</div>
            <div className="eod-stat-value">{fmt.money(totalExpenses)}</div>
          </div>
        </div>
        <div className="eod-stat highlight">
          <FiDollarSign size={15} className="eod-stat-icon" />
          <div>
            <div className="eod-stat-label">Expected Cash</div>
            <div className="eod-stat-value">{fmt.money(totalExpected)}</div>
          </div>
        </div>
        <div className="eod-stat">
          <FiUsers size={15} className="eod-stat-icon" />
          <div>
            <div className="eod-stat-label">Shifts Today</div>
            <div className="eod-stat-value">{shifts.length}</div>
            {openShifts.length > 0 && (
              <div className="eod-stat-sub eod-open-tag">{openShifts.length} still open</div>
            )}
          </div>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════
          ACTIVE STATE — day not yet closed
         ══════════════════════════════════════════════════════ */}
      {!todaysRecord ? (
        <div className="eod-active">

          {shifts.length === 0 ? (
            <div className="eod-no-shifts">
              <FiSun size={44} />
              <h3>No shifts today</h3>
              <p>No cashier shifts were opened today — nothing to reconcile.</p>
            </div>
          ) : (
            <>
              {/* Open-shift warning */}
              {openShifts.length > 0 && (
                <div className="eod-warn-banner">
                  <FiAlertTriangle size={14} />
                  <strong>{openShifts.length} shift{openShifts.length > 1 ? 's' : ''} still open.</strong>
                  &nbsp;Enter the cash collected and Close Day — they will be auto-closed.
                </div>
              )}

              {/* Section title */}
              <div className="eod-section-hd">
                <div>
                  <h2>Cashier Cash Reconciliation</h2>
                  <p>For each cashier, verify the expected cash and enter the amount you collected from them.</p>
                </div>
              </div>

              {/* ── Cashier rows ── */}
              <div className="eod-cashier-list">
                {shifts.map(shift => (
                  <CashierRow
                    key={shift.id}
                    shift={shift}
                    inputVal={cashInputs[shift.id] || ''}
                    onChange={val => setCashInputs(prev => ({ ...prev, [shift.id]: val }))}
                  />
                ))}
              </div>

              {/* ── Totals bar ── */}
              <div className={`eod-totals-bar ${dayVarStatus}`}>
                <div className="eod-tb-item">
                  <span className="eod-tb-label">Total Expected</span>
                  <span className="eod-tb-val">{fmt.money(totalExpected)}</span>
                </div>
                <div className="eod-tb-divider" />
                <div className="eod-tb-item">
                  <span className="eod-tb-label">Total Received</span>
                  <span className="eod-tb-val">{fmt.money(totalReceived)}</span>
                </div>
                <div className="eod-tb-divider" />
                <div className={`eod-tb-item variance ${dayVarStatus}`}>
                  <span className="eod-tb-label">
                    {dayVarStatus === 'balanced' ? 'Balanced' : dayVarStatus === 'overage' ? 'Overage' : 'Shortage'}
                  </span>
                  <span className="eod-tb-val">
                    {totalVariance >= 0 ? '+' : ''}{fmt.money(totalVariance)}
                  </span>
                </div>
              </div>

              {/* ── Close Day section ── */}
              <div className="eod-close-card">
                <div className="eod-close-notes-row">
                  <label>Day Notes <span>(optional)</span></label>
                  <textarea
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                    placeholder="Any notes about the day — shortages, incidents, special events…"
                    rows={2}
                  />
                </div>
                <div className="eod-close-actions">
                  {!canClose && (
                    <span className="eod-close-hint">
                      <FiAlertCircle size={13} /> Enter cash for all open shifts first
                    </span>
                  )}
                  <button
                    className="eod-close-btn"
                    onClick={handleCloseDay}
                    disabled={closing || !canClose}
                  >
                    {closing
                      ? <><div className="eod-btn-spinner" /> Closing Day…</>
                      : <><FiCheckCircle size={15} /> Close Day & Save</>
                    }
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

      ) : (
        /* ══════════════════════════════════════════════════════
           CLOSED STATE — day already closed
           ══════════════════════════════════════════════════════ */
        <div className="eod-closed-view">

          {/* Hero */}
          <div className={`eod-closed-hero ${todaysRecord.status?.toLowerCase()}`}>
            <div className="eod-closed-hero-left">
              <FiCheckCircle size={28} className="eod-closed-hero-icon" />
              <div>
                <div className="eod-closed-hero-title">Day Closed</div>
                <div className="eod-closed-hero-date">{fmt.date(todaysRecord.date)}</div>
              </div>
            </div>
            <div className={`eod-day-badge ${todaysRecord.status?.toLowerCase()}`}>
              {todaysRecord.status}
            </div>
          </div>

          {/* Day totals */}
          <div className="eod-closed-totals">
            <div className="eod-ct-row">
              <span>Total Sales</span>
              <span className="pos">{fmt.money(todaysRecord.total_sales)}</span>
            </div>
            <div className="eod-ct-row">
              <span>Expenses</span>
              <span className="neg">−{fmt.money(todaysRecord.total_expenses)}</span>
            </div>
            <div className="eod-ct-row sep">
              <span>Total Expected Cash</span>
              <strong>{fmt.money(todaysRecord.expected_cash)}</strong>
            </div>
            <div className="eod-ct-row">
              <span>Total Cash Collected</span>
              <span>{fmt.money(todaysRecord.actual_cash)}</span>
            </div>
            <div className={`eod-ct-row final ${todaysRecord.status?.toLowerCase()}`}>
              <span>
                {todaysRecord.status === 'Balanced' ? 'Balanced' :
                 todaysRecord.status === 'Overage'  ? 'Overage' : 'Shortage'}
              </span>
              <span>{fmt.money(todaysRecord.difference)}</span>
            </div>
          </div>

          {todaysRecord.notes && (
            <div className="eod-closed-notes">{todaysRecord.notes}</div>
          )}

          {/* Per-cashier breakdown */}
          {shifts.length > 0 && (
            <div className="eod-breakdown">
              <h3>Per-Cashier Breakdown</h3>
              {shifts.map(shift => (
                <BreakdownRow key={shift.id} shift={shift} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── History ── */}
      {allRecords.length > 0 && (
        <div className="eod-history">
          <button className="eod-history-toggle" onClick={() => setHistoryOpen(h => !h)}>
            <span>History ({allRecords.length} records)</span>
            {historyOpen ? <FiChevronUp size={16} /> : <FiChevronDown size={16} />}
          </button>

          {historyOpen && (
            <div className="eod-history-table">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Sales</th>
                    <th>Expenses</th>
                    <th>Expected</th>
                    <th>Collected</th>
                    <th>Variance</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {allRecords.map(r => (
                    <tr key={r.id}>
                      <td>{fmt.date(r.date)}</td>
                      <td>{fmt.money(r.total_sales)}</td>
                      <td>{fmt.money(r.total_expenses)}</td>
                      <td>{fmt.money(r.expected_cash)}</td>
                      <td>{fmt.money(r.actual_cash)}</td>
                      <td className={r.difference >= 0 ? 'pos' : 'neg'}>{fmt.money(r.difference)}</td>
                      <td>
                        <span className={`eod-hist-badge ${r.status?.toLowerCase()}`}>
                          {r.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── CashierRow ────────────────────────────────────────────────────────────────
function CashierRow({ shift, inputVal, onChange }) {
  const s       = shift.summary || {}
  const parsed  = parseFloat(inputVal)
  const variance = inputVal !== '' && !isNaN(parsed) ? parsed - (s.expected_cash || 0) : null
  const varSt   = varianceStatus(variance)
  const isOpen  = shift.status === 'open'

  return (
    <div className={`eod-cr ${isOpen ? 'eod-cr-open' : 'eod-cr-closed'}`}>

      {/* Header row */}
      <div className="eod-cr-head">
        <div className="eod-cr-avatar">{fmt.initials(shift.cashier_name)}</div>
        <div className="eod-cr-identity">
          <div className="eod-cr-name">{shift.cashier_name}</div>
          <div className="eod-cr-time">
            {fmt.time(shift.started_at)}
            {' → '}
            {isOpen
              ? <span className="eod-cr-still-open">Still open</span>
              : fmt.time(shift.closed_at)
            }
            {' · '}{fmt.dur(shift.started_at, shift.closed_at)}
          </div>
        </div>
        {isOpen
          ? <span className="eod-cr-badge open"><FiClock size={10} /> Open</span>
          : <span className={`eod-cr-badge ${shift.reconciliation_status || 'closed'}`}>
              <FiCheckCircle size={10} /> Closed
            </span>
        }
      </div>

      {/* Metrics grid */}
      <div className="eod-cr-metrics">
        <div className="eod-cr-m">
          <span className="eod-cr-ml">Opening Float</span>
          <span className="eod-cr-mv">{fmt.money(shift.opening_cash)}</span>
        </div>
        <div className="eod-cr-m">
          <span className="eod-cr-ml">Sales</span>
          <span className="eod-cr-mv pos">{fmt.money(s.total_sales)}</span>
        </div>
        {(s.total_expenses || 0) > 0 && (
          <div className="eod-cr-m">
            <span className="eod-cr-ml">Expenses</span>
            <span className="eod-cr-mv neg">−{fmt.money(s.total_expenses)}</span>
          </div>
        )}
        <div className="eod-cr-m expected">
          <span className="eod-cr-ml">Expected Cash</span>
          <span className="eod-cr-mv">{fmt.money(s.expected_cash)}</span>
        </div>
      </div>

      {/* Cash input (open) or closed summary */}
      {isOpen ? (
        <div className="eod-cr-input-area">
          <label>Cash collected from cashier</label>
          <div className="eod-cr-input-row">
            <div className="eod-cr-input-wrap">
              <span className="eod-cr-prefix">$</span>
              <input
                type="number"
                step="any"
                min="0"
                value={inputVal}
                onChange={e => onChange(e.target.value)}
                placeholder="0.00"
                className="eod-cr-input"
                autoComplete="off"
              />
            </div>
            {variance !== null && (
              <div className={`eod-cr-var ${varSt}`}>
                {varSt === 'balanced' && <><FiCheckCircle size={12} /> Balanced</>}
                {varSt === 'overage'  && <><FiAlertCircle size={12} /> +{fmt.money(variance)} over</>}
                {varSt === 'shortage' && <><FiAlertCircle size={12} /> {fmt.money(variance)} short</>}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="eod-cr-settled">
          <div className="eod-cr-settled-row">
            <span>Cash submitted by cashier</span>
            <span className="eod-cr-settled-amt">{fmt.money(shift.closing_cash)}</span>
          </div>
          <div className={`eod-cr-settled-row var ${shift.reconciliation_status || ''}`}>
            <span>Variance</span>
            <span className={(shift.variance || 0) >= 0 ? 'pos' : 'neg'}>
              {(shift.variance || 0) > 0 ? '+' : ''}{fmt.money(shift.variance)}
              {' '}
              <span className="eod-cr-settled-label">
                {shift.reconciliation_status === 'balanced' ? '(Balanced)' :
                 shift.reconciliation_status === 'over'     ? '(Over)'     : '(Short)'}
              </span>
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── BreakdownRow (read-only, post-close) ─────────────────────────────────────
function BreakdownRow({ shift }) {
  const s       = shift.summary || {}
  const varSt   = shift.reconciliation_status || 'balanced'
  const variance = shift.variance || 0

  return (
    <div className={`eod-br-row ${varSt}`}>
      <div className="eod-br-left">
        <div className="eod-br-avatar">{fmt.initials(shift.cashier_name)}</div>
        <div>
          <div className="eod-br-name">{shift.cashier_name}</div>
          <div className="eod-br-time">
            {fmt.time(shift.started_at)} → {fmt.time(shift.closed_at)}
            {' · '}{fmt.dur(shift.started_at, shift.closed_at)}
          </div>
        </div>
      </div>

      <div className="eod-br-metrics">
        <span><em>Sales</em> {fmt.money(s.total_sales)}</span>
        <span><em>Expected</em> {fmt.money(s.expected_cash)}</span>
        <span><em>Collected</em> {fmt.money(shift.closing_cash)}</span>
      </div>

      <div className={`eod-br-status ${varSt}`}>
        {Math.abs(variance) < 0.01
          ? <><FiCheckCircle size={13} /> Balanced</>
          : variance > 0
            ? <><FiAlertCircle size={13} /> +{fmt.money(variance)}</>
            : <><FiAlertCircle size={13} /> {fmt.money(variance)}</>
        }
      </div>
    </div>
  )
}
