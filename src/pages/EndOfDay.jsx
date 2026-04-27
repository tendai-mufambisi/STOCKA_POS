import { useState, useEffect } from 'react'
import { getSales, getExpenses, addEndOfDay, getEndOfDayRecords, getAllShifts, getShiftSummary } from '../database/db'
import './EndOfDay.css'
import { FiCheckCircle, FiAlertCircle } from 'react-icons/fi'

function EndOfDay({ user }) {
  const [records, setRecords] = useState([])
  const [todaysSales, setTodaysSales] = useState([])
  const [todaysExpenses, setTodaysExpenses] = useState([])
  const [todaysShifts, setTodaysShifts] = useState([])
  const [shiftSummaries, setShiftSummaries] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [error, setError] = useState('')
  const [actualCash, setActualCash] = useState('')
  const [notes, setNotes] = useState('')
  const [viewMode, setViewMode] = useState('shifts') // 'shifts' | 'legacy'

  const today = new Date().toISOString().split('T')[0]

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    try {
      setLoading(true)
      const [recordsData, salesData, expensesData, shiftsData] = await Promise.all([
        getEndOfDayRecords(),
        getSales(),
        getExpenses(),
        getAllShifts(null, today, today)
      ])
      
      setRecords(recordsData)
      
      // Filter today's transactions
      const todayStart = new Date(today).getTime()
      const todayEnd = todayStart + 24 * 60 * 60 * 1000
      
      // Filter completed sales only (exclude held, pending, voided)
      const todaysSalesData = salesData.filter(s => {
        const saleDate = new Date(s.created_at).getTime()
        const isToday = saleDate >= todayStart && saleDate < todayEnd
        const isCompleted = !s.status || s.status === 'completed'
        return isToday && isCompleted
      })
      
      const todaysExpensesData = expensesData.filter(e => {
        const expenseDate = new Date(e.date).getTime()
        return expenseDate >= todayStart && expenseDate < todayEnd
      })
      
      // Filter today's shifts (those that started today)
      const todaysShiftsData = shiftsData.filter(shift => {
        const shiftDate = new Date(shift.start_time).toISOString().split('T')[0]
        return shiftDate === today
      })
      
      setTodaysSales(todaysSalesData)
      setTodaysExpenses(todaysExpensesData)
      setTodaysShifts(todaysShiftsData)
      
      // Load summaries for each shift
      if (todaysShiftsData.length > 0) {
        const summaries = await Promise.all(
          todaysShiftsData.map(shift => getShiftSummary(shift.id))
        )
        setShiftSummaries(summaries)
      }
    } catch (err) {
      setError('Failed to load end of day data')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const totalSales = todaysSales.reduce((sum, s) => sum + (s.total || 0), 0)
  const totalExpenses = todaysExpenses.reduce((sum, e) => sum + (e.amount || 0), 0)
  const expectedCash = totalSales - totalExpenses
  const difference = parseFloat(actualCash || 0) - expectedCash
  const status = difference > 0 ? 'Overage' : difference < 0 ? 'Shortage' : 'Balanced'

  const handleCloseDay = async () => {
    if (!actualCash) {
      setError('Enter actual cash counted')
      return
    }

    try {
      await addEndOfDay({
        date: today,
        cashier: user?.username || 'System',
        total_sales: totalSales,
        total_expenses: totalExpenses,
        expected_cash: expectedCash,
        actual_cash: parseFloat(actualCash),
        difference: difference,
        status: status,
        notes: notes
      })
      await loadData()
      setActualCash('')
      setNotes('')
      setShowForm(false)
    } catch (err) {
      setError('Failed to close end of day')
    }
  }

  const todaysRecord = records.find(r => r.date === today)

  if (loading) return <div className="eod-page"><div className="loading">Loading...</div></div>

  return (
    <div className="eod-page">
      <div className="page-header">
        <h1>End of Day</h1>
        <p>Daily reconciliation and cash count</p>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {/* View Toggle */}
      {todaysShifts.length > 0 && (
        <div className="view-toggle">
          <button
            className={`toggle-btn ${viewMode === 'shifts' ? 'active' : ''}`}
            onClick={() => setViewMode('shifts')}
          >
            Shift View
          </button>
          <button
            className={`toggle-btn ${viewMode === 'legacy' ? 'active' : ''}`}
            onClick={() => setViewMode('legacy')}
          >
            Legacy View
          </button>
        </div>
      )}

      {/* Shifts Reconciliation View */}
      {viewMode === 'shifts' && todaysShifts.length > 0 ? (
        <div className="shifts-reconciliation">
          <h3>Shift-Based Reconciliation</h3>
          <div className="shifts-grid">
            {todaysShifts.map(shift => {
              const summary = shiftSummaries.find(s => s.id === shift.id)
              if (!summary) return null

              const startTime = new Date(shift.start_time)
              const endTime = shift.end_time ? new Date(shift.end_time) : null
              const durationMs = endTime ? endTime - startTime : Date.now() - startTime
              const durationHours = Math.floor(durationMs / (1000 * 60 * 60))
              const durationMins = Math.floor((durationMs % (1000 * 60 * 60)) / (1000 * 60))
              const timeStr = `${durationHours}h ${durationMins}m`

              const balance = summary.balance || 0
              const isBalanced = Math.abs(balance) < 0.01
              const balanceStatus = isBalanced ? 'balanced' : balance > 0 ? 'overage' : 'shortage'

              return (
                <div key={shift.id} className={`shift-card ${balanceStatus}`}>
                  <div className="shift-header">
                    <div className="shift-cashier">{shift.cashier_name}</div>
                    <div className={`shift-status ${shift.status}`}>{shift.status}</div>
                  </div>

                  <div className="shift-time">
                    <span>{startTime.toLocaleTimeString('en-ZW', { hour: '2-digit', minute: '2-digit' })}</span>
                    <span>→</span>
                    <span>{endTime ? endTime.toLocaleTimeString('en-ZW', { hour: '2-digit', minute: '2-digit' }) : 'Open'}</span>
                    <span className="duration">({timeStr})</span>
                  </div>

                  <div className="shift-metrics">
                    <div className="metric-row">
                      <span>Opening Float</span>
                      <span className="amount">${(shift.start_float || 0).toFixed(2)}</span>
                    </div>
                    <div className="metric-row">
                      <span>Sales</span>
                      <span className="amount positive">${(summary.total_sales || 0).toFixed(2)}</span>
                    </div>
                    <div className="metric-row">
                      <span>Expenses</span>
                      <span className="amount negative">-${(summary.total_expenses || 0).toFixed(2)}</span>
                    </div>
                    <div className="metric-row">
                      <span>Expected Cash</span>
                      <span className="amount">${(summary.expected_cash || 0).toFixed(2)}</span>
                    </div>
                    <div className="metric-row">
                      <span>Actual Cash</span>
                      <span className="amount">${(shift.end_float || 0).toFixed(2)}</span>
                    </div>
                  </div>

                  <div className={`shift-balance ${balanceStatus}`}>
                    <div className="balance-status">
                      {isBalanced ? (
                        <><FiCheckCircle className="icon" /> Balanced</>
                      ) : balance > 0 ? (
                        <><FiAlertCircle className="icon" /> Overage</>
                      ) : (
                        <><FiAlertCircle className="icon" /> Shortage</>
                      )}
                    </div>
                    <div className="balance-amount">
                      ${Math.abs(balance).toFixed(2)}
                    </div>
                  </div>

                  {shift.notes && <div className="shift-notes">{shift.notes}</div>}
                </div>
              )
            })}
          </div>
        </div>
      ) : !todaysRecord ? (
        <div className="reconciliation-card">
          <h3>Today's Reconciliation</h3>
          
          <div className="metrics-grid">
            <div className="metric">
              <div className="metric-label">Total Sales</div>
              <div className="metric-value">${totalSales.toFixed(2)}</div>
              <div className="metric-count">{todaysSales.length} transactions</div>
            </div>
            <div className="metric">
              <div className="metric-label">Total Expenses</div>
              <div className="metric-value">${totalExpenses.toFixed(2)}</div>
              <div className="metric-count">{todaysExpenses.length} entries</div>
            </div>
            <div className="metric highlight">
              <div className="metric-label">Expected Cash</div>
              <div className="metric-value">${expectedCash.toFixed(2)}</div>
            </div>
          </div>

          {!showForm ? (
            <button className="btn btn-primary" onClick={() => setShowForm(true)}>
              Count Cash & Close Day
            </button>
          ) : (
            <div className="cash-count-form">
              <h4>Cash Count</h4>
              <div className="form-group">
                <label>Actual Cash Counted (USD) *</label>
                <input
                  type="number"
                  step="0.01"
                  value={actualCash}
                  onChange={(e) => setActualCash(e.target.value)}
                  placeholder="0.00"
                  className="cash-input"
                />
              </div>

              {actualCash && (
                <div className={`reconciliation-result ${status.toLowerCase()}`}>
                  <div className="result-line">
                    <span>Expected</span>
                    <span>${expectedCash.toFixed(2)}</span>
                  </div>
                  <div className="result-line">
                    <span>Actual</span>
                    <span>${parseFloat(actualCash).toFixed(2)}</span>
                  </div>
                  <div className="result-line total">
                    <span>{status}</span>
                    <span className={status === 'Overage' ? 'positive' : status === 'Shortage' ? 'negative' : ''}>
                      ${Math.abs(difference).toFixed(2)}
                    </span>
                  </div>
                </div>
              )}

              <div className="form-group">
                <label>Notes</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Add any notes about shortages, overages, or special events..."
                  rows="3"
                />
              </div>

              <div className="form-actions">
                <button className="btn btn-primary" onClick={handleCloseDay}>
                  Close Day
                </button>
                <button className="btn btn-secondary" onClick={() => {
                  setShowForm(false)
                  setActualCash('')
                  setNotes('')
                }}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          {todaysSales.length > 0 && (
            <div className="transactions-section">
              <h4>Today's Sales ({todaysSales.length})</h4>
              <div className="transactions-table">
                <table>
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Amount</th>
                      <th>Cashier</th>
                    </tr>
                  </thead>
                  <tbody>
                    {todaysSales.map(s => (
                      <tr key={s.id}>
                        <td>{new Date(s.date_created).toLocaleTimeString('en-ZW', { hour: '2-digit', minute: '2-digit' })}</td>
                        <td className="amount">${s.total?.toFixed(2)}</td>
                        <td>{s.cashier || 'System'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {todaysExpenses.length > 0 && (
            <div className="transactions-section">
              <h4>Today's Expenses ({todaysExpenses.length})</h4>
              <div className="transactions-table">
                <table>
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Description</th>
                      <th>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {todaysExpenses.map(e => (
                      <tr key={e.id}>
                        <td>{new Date(e.date).toLocaleTimeString('en-ZW', { hour: '2-digit', minute: '2-digit' })}</td>
                        <td>{e.description}</td>
                        <td className="amount">${e.amount?.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="record-card">
          <h3 style={{color: '#2e7d32'}}>✓ Day Closed</h3>
          <div className="record-details">
            <div className="detail-row">
              <span>Total Sales</span>
              <span>${todaysRecord.total_sales?.toFixed(2)}</span>
            </div>
            <div className="detail-row">
              <span>Total Expenses</span>
              <span>${todaysRecord.total_expenses?.toFixed(2)}</span>
            </div>
            <div className="detail-row">
              <span>Expected Cash</span>
              <span>${todaysRecord.expected_cash?.toFixed(2)}</span>
            </div>
            <div className="detail-row">
              <span>Actual Cash</span>
              <span>${todaysRecord.actual_cash?.toFixed(2)}</span>
            </div>
            <div className={`detail-row ${todaysRecord.status?.toLowerCase()}`}>
              <span>{todaysRecord.status}</span>
              <span>${Math.abs(todaysRecord.difference).toFixed(2)}</span>
            </div>
          </div>
          {todaysRecord.notes && <p className="notes">{todaysRecord.notes}</p>}
        </div>
      )}

      {records.length > 0 && (
        <div className="history-section">
          <h3>History</h3>
          <div className="history-table">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Sales</th>
                  <th>Expenses</th>
                  <th>Expected</th>
                  <th>Actual</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {records.slice().reverse().map(r => (
                  <tr key={r.id}>
                    <td>{new Date(r.date).toLocaleDateString('en-ZW')}</td>
                    <td>${r.total_sales?.toFixed(2)}</td>
                    <td>${r.total_expenses?.toFixed(2)}</td>
                    <td>${r.expected_cash?.toFixed(2)}</td>
                    <td>${r.actual_cash?.toFixed(2)}</td>
                    <td><span className={`status-badge ${r.status?.toLowerCase()}`}>{r.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

export default EndOfDay
