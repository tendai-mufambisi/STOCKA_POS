import { useState, useEffect } from 'react'
import { getAllShifts } from '../database/db'
import './CashierPerformance.css'
import { FiBarChart2, FiTrendingUp, FiDownload } from 'react-icons/fi'

function CashierPerformance() {
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [loading, setLoading] = useState(false)
  const [cashierStats, setCashierStats] = useState([])

  const generateReport = async () => {
    if (!dateFrom || !dateTo) {
      alert('Please select both start and end dates')
      return
    }

    setLoading(true)
    try {
      let from = new Date(dateFrom).toISOString()
      let to = new Date(new Date(dateTo).getTime() + 86400000).toISOString()
      
      const shifts = await getAllShifts(null, from, to)
      
      // Group by cashier and calculate stats
      const stats = {}
      shifts.forEach(shift => {
        const key = shift.cashier_username
        if (!stats[key]) {
          stats[key] = {
            name: shift.cashier_display_name || shift.cashier_username,
            username: shift.cashier_username,
            shifts: 0,
            totalSales: 0,
            totalSalesCount: 0,
            totalVariance: 0,
            balancedShifts: 0,
            shortShifts: 0,
            overShifts: 0,
            totalShortAmount: 0,
            totalOverAmount: 0
          }
        }
        
        stats[key].shifts += 1
        stats[key].totalSales += shift.total_sales_value || 0
        stats[key].totalSalesCount += shift.total_sales_count || 0
        stats[key].totalVariance += shift.overall_variance || 0
        
        if (shift.reconciliation_status === 'balanced') {
          stats[key].balancedShifts += 1
        } else if (shift.reconciliation_status === 'short') {
          stats[key].shortShifts += 1
          stats[key].totalShortAmount += Math.abs(shift.overall_variance || 0)
        } else if (shift.reconciliation_status === 'over') {
          stats[key].overShifts += 1
          stats[key].totalOverAmount += shift.overall_variance || 0
        }
      })
      
      const result = Object.values(stats).sort((a, b) => b.totalSales - a.totalSales)
      setCashierStats(result)
    } catch (err) {
      console.error('Failed to generate report:', err)
      alert('Failed to generate report')
    } finally {
      setLoading(false)
    }
  }

  const handleExportExcel = () => {
    if (cashierStats.length === 0) {
      alert('No data to export')
      return
    }

    try {
      // Simple CSV export
      let csv = 'Cashier,Shifts,Total Sales,Avg Sales,Transactions,Balanced,Short,Over,Total Variance\n'
      
      cashierStats.forEach(stat => {
        const avgSales = stat.shifts > 0 ? stat.totalSales / stat.shifts : 0
        csv += `"${stat.name}",${stat.shifts},$${stat.totalSales.toFixed(2)},$${avgSales.toFixed(2)},${stat.totalSalesCount},${stat.balancedShifts},${stat.shortShifts},${stat.overShifts},$${Math.abs(stat.totalVariance).toFixed(2)}\n`
      })

      const blob = new Blob([csv], { type: 'text/csv' })
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.setAttribute('hidden', '')
      a.setAttribute('href', url)
      a.setAttribute('download', `cashier-performance-${new Date().toISOString().split('T')[0]}.csv`)
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
    } catch (err) {
      console.error('Export failed:', err)
    }
  }

  return (
    <div className="cashier-performance">
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <FiBarChart2 size={32} />
          <div>
            <h1>Cashier Performance Report</h1>
            <p>Analyze cashier productivity and accuracy over time</p>
          </div>
        </div>
      </div>

      {/* Filter Section */}
      <div className="filters-panel">
        <div className="filter-row">
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
          <div className="filter-group" style={{ display: 'flex', alignItems: 'flex-end', gap: '8px' }}>
            <button
              onClick={generateReport}
              disabled={loading}
              className="primary-btn"
            >
              {loading ? 'Loading...' : 'Generate Report'}
            </button>
          </div>
        </div>
      </div>

      {/* Results */}
      {cashierStats.length > 0 && (
        <>
          <div className="report-actions">
            <button
              onClick={handleExportExcel}
              className="export-btn"
            >
              <FiDownload size={16} />
              Export to CSV
            </button>
          </div>

          <div className="table-container">
            <table className="performance-table">
              <thead>
                <tr>
                  <th>Cashier</th>
                  <th>Shifts</th>
                  <th>Total Sales</th>
                  <th>Avg Sales/Shift</th>
                  <th>Transactions</th>
                  <th>Balanced</th>
                  <th>Short</th>
                  <th>Over</th>
                  <th>Accuracy Rate</th>
                </tr>
              </thead>
              <tbody>
                {cashierStats.map((stat, i) => {
                  const accuracyRate = stat.shifts > 0 ? ((stat.balancedShifts / stat.shifts) * 100) : 0
                  const avgSales = stat.shifts > 0 ? stat.totalSales / stat.shifts : 0
                  
                  return (
                    <tr key={i}>
                      <td className="name-cell">{stat.name}</td>
                      <td className="number-cell">{stat.shifts}</td>
                      <td className="number-cell">${stat.totalSales.toFixed(2)}</td>
                      <td className="number-cell">${avgSales.toFixed(2)}</td>
                      <td className="number-cell">{stat.totalSalesCount}</td>
                      <td className="status-cell balanced">{stat.balancedShifts}</td>
                      <td className="status-cell short">{stat.shortShifts}</td>
                      <td className="status-cell over">{stat.overShifts}</td>
                      <td className="percentage-cell">
                        <div className="accuracy-bar">
                          <div 
                            className={`accuracy-fill ${accuracyRate >= 95 ? 'excellent' : accuracyRate >= 80 ? 'good' : 'needs-improvement'}`}
                            style={{ width: `${accuracyRate}%` }}
                          />
                        </div>
                        {accuracyRate.toFixed(1)}%
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Summary Stats */}
          <div className="summary-stats">
            <div className="summary-card">
              <h3>Total Cashiers</h3>
              <div className="stat-value">{cashierStats.length}</div>
            </div>
            <div className="summary-card">
              <h3>Total Shifts</h3>
              <div className="stat-value">{cashierStats.reduce((sum, c) => sum + c.shifts, 0)}</div>
            </div>
            <div className="summary-card">
              <h3>Total Sales</h3>
              <div className="stat-value">${cashierStats.reduce((sum, c) => sum + c.totalSales, 0).toFixed(2)}</div>
            </div>
            <div className="summary-card">
              <h3>Balanced Shifts</h3>
              <div className="stat-value">{cashierStats.reduce((sum, c) => sum + c.balancedShifts, 0)}</div>
            </div>
          </div>
        </>
      )}

      {cashierStats.length === 0 && !loading && (dateFrom || dateTo) && (
        <div className="empty-state">
          <FiTrendingUp size={48} />
          <h2>No Data Available</h2>
          <p>No shifts found for the selected date range</p>
        </div>
      )}
    </div>
  )
}

export default CashierPerformance
