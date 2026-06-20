import { useState, useEffect } from 'react'
import { FiDownload, FiLock, FiPrinter, FiCheck, FiBarChart2 } from 'react-icons/fi'
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts'
import { getSales, getExpenses, getProducts, getStockReceivings, getSaleItems, getShop, getReceiptBySaleId } from '../database/db'
import { hasPermission } from '../utils/permissions'
import * as XLSX from 'xlsx'
import { useAuthStore } from '../store/useAuthStore'
import './Reports.css'

function Reports() {
  const { user } = useAuthStore()
  const [reportType, setReportType] = useState('daily-sales')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0])
  const [startDate, setStartDate] = useState(new Date(new Date().setDate(new Date().getDate() - 30)).toISOString().split('T')[0])
  const [endDate, setEndDate] = useState(new Date().toISOString().split('T')[0])
  const [chartData, setChartData] = useState([])
  const [paymentBreakdown, setPaymentBreakdown] = useState([])
  const [tableData, setTableData] = useState([])
  const [summary, setSummary] = useState({})
  const [filterCashier, setFilterCashier] = useState('')
  const [cashiers, setCashiers] = useState([])
  const [shopInfo, setShopInfo] = useState(null)
  const [printerSettings, setPrinterSettings] = useState(null)
  const [reprintingId, setReprintingId] = useState(null)

  useEffect(() => {
    loadReportData()
    loadShopInfo()
  }, [reportType, selectedDate, startDate, endDate, filterCashier])

  const loadShopInfo = async () => {
    try {
      const shop = await getShop()
      setShopInfo(shop)
      setPrinterSettings({
        printer_port: shop?.printer_port,
        printer_name: shop?.printer_name,
        auto_print: shop?.auto_print ?? 1,
        print_duplicate: shop?.print_duplicate ?? 0
      })
    } catch (err) {
      console.error('Failed to load shop info:', err)
    }
  }

  const handleReprintReceipt = async (saleId) => {
    if (!printerSettings?.printer_port) {
      setError('Printer not configured. Please set up a printer in Settings.')
      setTimeout(() => setError(''), 4000)
      return
    }

    setReprintingId(saleId)
    try {
      // Get the sale and items
      const receipt = await getReceiptBySaleId(saleId)
      if (!receipt) {
        setError('Receipt not found')
        setTimeout(() => setError(''), 3000)
        setReprintingId(null)
        return
      }

      // Send to printer
      const printResult = await window.stocka.printer.printReceipt(
        printerSettings.printer_port,
        receipt,
        shopInfo,
        true // Mark as reprint
      )

      if (printResult.success) {
        setSuccess('Receipt reprinted successfully')
        setTimeout(() => setSuccess(''), 3000)
      } else {
        setError(`Reprint failed: ${printResult.error || 'Unknown error'}`)
        setTimeout(() => setError(''), 4000)
      }
    } catch (err) {
      console.error('Reprint error:', err)
      setError('Failed to reprint receipt')
      setTimeout(() => setError(''), 4000)
    } finally {
      setReprintingId(null)
    }
  }

  const loadReportData = async () => {
    try {
      setLoading(true)
      const [sales, expenses, products, receivings, saleItems] = await Promise.all([
        getSales(),
        getExpenses(),
        getProducts(),
        getStockReceivings(),
        getSaleItems()
      ])

      // Get unique cashiers
      const uniqueCashiers = [...new Set(sales.map(s => s.cashier || 'System'))].filter(c => c !== 'System')
      setCashiers(uniqueCashiers)

      if (reportType === 'daily-sales') {
        generateDailySalesReport(sales, expenses, saleItems)
      } else if (reportType === 'date-range-sales') {
        generateDateRangeSalesReport(sales, expenses, saleItems)
      } else if (reportType === 'cashier-performance') {
        generateCashierPerformanceReport(sales)
      } else if (reportType === 'best-selling') {
        generateBestSellingReport(sales, saleItems)
      } else if (reportType === 'profit-loss') {
        generateProfitLossReport(sales, expenses, saleItems)
      } else if (reportType === 'stock') {
        generateStockReport(products, receivings)
      }
    } catch (err) {
      setError('Failed to load report data')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const generateDailySalesReport = (sales, expenses, saleItems) => {
    const selectedTime = new Date(selectedDate).getTime()
    const dayStart = selectedTime
    const dayEnd = selectedTime + 24 * 60 * 60 * 1000

    const daySales = sales.filter(s => {
      const saleTime = new Date(s.created_at).getTime()
      return s.status === 'completed' && saleTime >= dayStart && saleTime < dayEnd
    })

    const dayExpenses = expenses.filter(e => {
      const expenseTime = new Date(e.date).getTime()
      return expenseTime >= dayStart && expenseTime < dayEnd
    })

    const dayItems = saleItems.filter(si => {
      const sale = sales.find(s => s.id === si.sale_id)
      return sale && sale.status === 'completed' &&
        new Date(sale.created_at).getTime() >= dayStart &&
        new Date(sale.created_at).getTime() < dayEnd
    })

    const totalRevenue = daySales.reduce((sum, s) => sum + (s.total || 0), 0)
    const totalExpenses = dayExpenses.reduce((sum, e) => sum + (e.amount || 0), 0)
    const totalCOGS = dayItems.reduce((sum, si) => sum + ((si.quantity || 0) * (si.cost_price || 0)), 0)
    const totalProfit = totalRevenue - totalCOGS - totalExpenses

    // Payment breakdown
    const breakdown = { 'Cash': 0, 'Transfer': 0, 'Split': 0 }
    daySales.forEach(s => {
      const method = s.payment_method || 'Cash'
      if (method === 'Cash' || method === 'USD Cash' || method === 'ZWG Cash' || method === 'USD') {
        breakdown['Cash'] += s.total || 0
      } else if (method === 'Transfer' || method === 'Swipe' || method === 'EcoCash') {
        breakdown['Transfer'] += s.total || 0
      } else if (method === 'Split') {
        breakdown['Split'] += s.total || 0
      }
    })
    const paymentData = Object.entries(breakdown).map(([name, value]) => ({ name, value: parseFloat(value.toFixed(2)) }))

    setSummary({
      totalRevenue: parseFloat(totalRevenue.toFixed(2)),
      totalCOGS: parseFloat(totalCOGS.toFixed(2)),
      grossProfit: parseFloat((totalRevenue - totalCOGS).toFixed(2)),
      totalExpenses: parseFloat(totalExpenses.toFixed(2)),
      netProfit: parseFloat(totalProfit.toFixed(2)),
      transactions: daySales.length
    })
    setPaymentBreakdown(paymentData)
    setChartData(daySales.map(s => ({
      time: new Date(s.created_at).toLocaleTimeString('en-ZW', { hour: '2-digit', minute: '2-digit' }),
      amount: s.total || 0
    })))
    setTableData(daySales.map(s => ({
      ...s,
      time: new Date(s.created_at).toLocaleTimeString('en-ZW', { hour: '2-digit', minute: '2-digit' })
    })))
  }

  const generateDateRangeSalesReport = (sales, expenses, saleItems) => {
    const start = new Date(startDate).getTime()
    const end = new Date(endDate).getTime() + 24 * 60 * 60 * 1000

    const dayData = {}
    const rangedSales = sales.filter(s => {
      const saleTime = new Date(s.created_at).getTime()
      return s.status === 'completed' && saleTime >= start && saleTime < end
    })

    rangedSales.forEach(s => {
      const date = new Date(s.created_at).toLocaleDateString('en-ZW')
      if (!dayData[date]) {
        dayData[date] = { date, revenue: 0, count: 0, cash: 0, transfer: 0, split: 0 }
      }
      dayData[date].revenue += s.total || 0
      dayData[date].count += 1
      const method = s.payment_method || 'Cash'
      if (method === 'Cash' || method === 'USD Cash' || method === 'ZWG Cash' || method === 'USD') dayData[date].cash += s.total || 0
      else if (method === 'Transfer' || method === 'Swipe' || method === 'EcoCash') dayData[date].transfer += s.total || 0
      else if (method === 'Split') dayData[date].split += s.total || 0
    })

    const data = Object.values(dayData)
    const totalRevenue = data.reduce((sum, d) => sum + d.revenue, 0)

    setSummary({
      totalRevenue: parseFloat(totalRevenue.toFixed(2)),
      totalTransactions: rangedSales.length,
      avgDailyRevenue: parseFloat((totalRevenue / data.length || 0).toFixed(2)),
      days: data.length
    })

    const paymentData = [
      { name: 'Cash', value: parseFloat(rangedSales.filter(s => !s.payment_method || s.payment_method === 'Cash' || s.payment_method === 'USD Cash' || s.payment_method === 'ZWG Cash' || s.payment_method === 'USD').reduce((sum, s) => sum + (s.total || 0), 0).toFixed(2)) },
      { name: 'Transfer', value: parseFloat(rangedSales.filter(s => s.payment_method === 'Transfer' || s.payment_method === 'Swipe' || s.payment_method === 'EcoCash').reduce((sum, s) => sum + (s.total || 0), 0).toFixed(2)) },
      { name: 'Split', value: parseFloat(rangedSales.filter(s => s.payment_method === 'Split').reduce((sum, s) => sum + (s.total || 0), 0).toFixed(2)) }
    ]

    setPaymentBreakdown(paymentData)
    setChartData(data)
    setTableData(data)
  }

  const generateCashierPerformanceReport = (sales) => {
    const cashierData = {}

    const filteredSales = sales.filter(s =>
      s.status === 'completed' &&
      (!filterCashier || (s.cashier || 'System') === filterCashier)
    )

    filteredSales.forEach(s => {
      const cashier = s.cashier || 'System'
      if (!cashierData[cashier]) {
        cashierData[cashier] = { cashier, total: 0, count: 0, cash: 0, transfer: 0, split: 0 }
      }
      cashierData[cashier].total += s.total || 0
      cashierData[cashier].count += 1
      const method = s.payment_method || 'Cash'
      if (method === 'Cash' || method === 'USD Cash' || method === 'ZWG Cash' || method === 'USD') cashierData[cashier].cash += s.total || 0
      else if (method === 'Transfer' || method === 'Swipe' || method === 'EcoCash') cashierData[cashier].transfer += s.total || 0
      else if (method === 'Split') cashierData[cashier].split += s.total || 0
    })

    const data = Object.values(cashierData).map(c => ({
      ...c,
      avgTransaction: c.count > 0 ? (c.total / c.count) : 0
    }))

    setSummary({
      totalCashiers: Object.keys(cashierData).length,
      totalRevenue: parseFloat(data.reduce((sum, d) => sum + d.total, 0).toFixed(2)),
      totalTransactions: data.reduce((sum, d) => sum + d.count, 0),
      avgPerCashier: parseFloat((data.reduce((sum, d) => sum + d.total, 0) / data.length || 0).toFixed(2))
    })

    setChartData(data)
    setTableData(data)
    setPaymentBreakdown([])
  }

  const generateBestSellingReport = (sales, saleItems) => {
    const productSales = {}

    saleItems.forEach(si => {
      const sale = sales.find(s => s.id === si.sale_id && s.status === 'completed')
      if (sale) {
        if (!productSales[si.product_id]) {
          productSales[si.product_id] = { productName: si.product_name, units: 0, revenue: 0, cogs: 0 }
        }
        productSales[si.product_id].units += si.quantity || 0
        productSales[si.product_id].revenue += (si.quantity || 0) * (si.selling_price || 0)
        productSales[si.product_id].cogs += (si.quantity || 0) * (si.cost_price || 0)
      }
    })

    const data = Object.values(productSales)
      .map(p => ({ ...p, profit: p.revenue - p.cogs }))
      .sort((a, b) => b.units - a.units)
      .slice(0, 20)

    setSummary({
      totalProductsSold: Object.keys(productSales).length,
      topProductUnits: data[0]?.units || 0,
      topProductName: data[0]?.productName || 'N/A',
      totalUnitsSold: data.reduce((sum, p) => sum + p.units, 0)
    })

    setChartData(data.slice(0, 10))
    setTableData(data)
    setPaymentBreakdown([])
  }

  const generateProfitLossReport = (sales, expenses, saleItems) => {
    const start = new Date(startDate).getTime()
    const end = new Date(endDate).getTime() + 24 * 60 * 60 * 1000

    const monthData = {}
    
    const rangedSales = sales.filter(s => {
      const saleTime = new Date(s.created_at).getTime()
      return s.status === 'completed' && saleTime >= start && saleTime < end
    })

    const rangedExpenses = expenses.filter(e => {
      const expenseTime = new Date(e.date).getTime()
      return expenseTime >= start && expenseTime < end
    })

    rangedSales.forEach(s => {
      const date = new Date(s.created_at)
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
      const monthLabel = date.toLocaleDateString('en-ZW', { month: 'short', year: 'numeric' })
      
      if (!monthData[monthKey]) {
        monthData[monthKey] = { month: monthLabel, revenue: 0, cogs: 0, expenses: 0 }
      }
      monthData[monthKey].revenue += s.total || 0
    })

    rangedExpenses.forEach(e => {
      const date = new Date(e.date)
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
      const monthLabel = date.toLocaleDateString('en-ZW', { month: 'short', year: 'numeric' })
      
      if (!monthData[monthKey]) {
        monthData[monthKey] = { month: monthLabel, revenue: 0, cogs: 0, expenses: 0 }
      }
      monthData[monthKey].expenses += e.amount || 0
    })

    const rangedSaleItems = saleItems.filter(si => {
      const sale = sales.find(s => s.id === si.sale_id && s.status === 'completed')
      return sale && new Date(sale.created_at).getTime() >= start && new Date(sale.created_at).getTime() < end
    })

    rangedSaleItems.forEach(si => {
      const sale = sales.find(s => s.id === si.sale_id)
      if (sale) {
        const date = new Date(sale.created_at)
        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
        if (monthData[monthKey]) {
          monthData[monthKey].cogs += (si.quantity || 0) * (si.cost_price || 0)
        }
      }
    })

    const data = Object.values(monthData).map(m => ({
      ...m,
      grossProfit: m.revenue - m.cogs,
      netProfit: m.revenue - m.cogs - m.expenses
    }))

    const totals = {
      totalRevenue: data.reduce((sum, d) => sum + d.revenue, 0),
      totalCOGS: data.reduce((sum, d) => sum + d.cogs, 0),
      totalExpenses: data.reduce((sum, d) => sum + d.expenses, 0)
    }
    totals.grossProfit = totals.totalRevenue - totals.totalCOGS
    totals.netProfit = totals.grossProfit - totals.totalExpenses
    totals.profitMargin = totals.totalRevenue > 0 ? ((totals.netProfit / totals.totalRevenue) * 100).toFixed(1) : 0

    setSummary({
      totalRevenue: parseFloat(totals.totalRevenue.toFixed(2)),
      totalCOGS: parseFloat(totals.totalCOGS.toFixed(2)),
      grossProfit: parseFloat(totals.grossProfit.toFixed(2)),
      totalExpenses: parseFloat(totals.totalExpenses.toFixed(2)),
      netProfit: parseFloat(totals.netProfit.toFixed(2)),
      profitMargin: `${totals.profitMargin}%`
    })

    setChartData(data)
    setTableData(data)
    setPaymentBreakdown([])
  }

  const generateStockReport = (products, receivings) => {
    const costTotal = products.reduce((sum, p) => {
      const latestPrice = receivings
        .filter(r => r.product_id === p.id)
        .sort((a, b) => new Date(b.date_received) - new Date(a.date_received))[0]
      return sum + ((p.current_quantity || 0) * (latestPrice?.cost_per_unit || 0))
    }, 0)

    const sellingTotal = products.reduce((sum, p) => {
      const latestPrice = receivings
        .filter(r => r.product_id === p.id)
        .sort((a, b) => new Date(b.date_received) - new Date(a.date_received))[0]
      return sum + ((p.current_quantity || 0) * (latestPrice?.selling_price_per_unit || 0))
    }, 0)

    const lowStockItems = products.filter(p => p.current_quantity <= p.reorder_level && p.current_quantity > 0)
    const outOfStockItems = products.filter(p => p.current_quantity === 0 || p.current_quantity < 0)

    setSummary({
      totalItems: products.length,
      totalUnits: products.reduce((sum, p) => sum + (p.current_quantity || 0), 0),
      inventoryCostValue: parseFloat(costTotal.toFixed(2)),
      inventorySellingValue: parseFloat(sellingTotal.toFixed(2)),
      inventoryProfit: parseFloat((sellingTotal - costTotal).toFixed(2)),
      lowStockCount: lowStockItems.length,
      outOfStockCount: outOfStockItems.length
    })

    setTableData(products)
    setChartData([])
    setPaymentBreakdown([])
  }

  const handleExport = () => {
    const filename = `${reportType}-report-${new Date().toISOString().split('T')[0]}.xlsx`
    const ws = XLSX.utils.json_to_sheet(tableData.map((row, idx) => {
      const baseObj = {}
      
      if (reportType === 'daily-sales') {
        return {
          'Time': row.time || '',
          'Amount': `$${parseFloat(row.total || 0).toFixed(2)}`,
          'Payment Method': row.payment_method || 'Cash',
          'Cashier': row.cashier || 'System'
        }
      } else if (reportType === 'date-range-sales') {
        return {
          'Date': row.date,
          'Revenue': `$${parseFloat(row.revenue).toFixed(2)}`,
          'Transactions': row.count,
          'Cash': `$${parseFloat(row.cash).toFixed(2)}`,
          'Transfer': `$${parseFloat(row.transfer).toFixed(2)}`,
          'Split': `$${parseFloat(row.split).toFixed(2)}`
        }
      } else if (reportType === 'cashier-performance') {
        return {
          'Cashier': row.cashier,
          'Total Sales': `$${parseFloat(row.total).toFixed(2)}`,
          'Transactions': row.count,
          'Avg Transaction': `$${parseFloat(row.avgTransaction).toFixed(2)}`,
          'Cash': `$${parseFloat(row.cash).toFixed(2)}`,
          'Transfer': `$${parseFloat(row.transfer).toFixed(2)}`,
          'Split': `$${parseFloat(row.split).toFixed(2)}`
        }
      } else if (reportType === 'best-selling') {
        return {
          'Product': row.productName,
          'Units Sold': row.units,
          'Revenue': `$${parseFloat(row.revenue).toFixed(2)}`,
          'COGS': `$${parseFloat(row.cogs).toFixed(2)}`,
          'Profit': `$${parseFloat(row.profit).toFixed(2)}`
        }
      } else if (reportType === 'profit-loss') {
        return {
          'Month': row.month,
          'Revenue': `$${parseFloat(row.revenue).toFixed(2)}`,
          'COGS': `$${parseFloat(row.cogs).toFixed(2)}`,
          'Expenses': `$${parseFloat(row.expenses).toFixed(2)}`,
          'Gross Profit': `$${parseFloat(row.grossProfit).toFixed(2)}`,
          'Net Profit': `$${parseFloat(row.netProfit).toFixed(2)}`
        }
      } else if (reportType === 'stock') {
        return {
          'Product': row.name,
          'Current Qty': row.current_quantity,
          'Reorder Level': row.reorder_level,
          'Category': row.category || '',
          'Status': row.current_quantity === 0 ? 'Out of Stock' : row.current_quantity <= row.reorder_level ? 'Low Stock' : 'In Stock'
        }
      }
      return baseObj
    }))
    
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Report')
    XLSX.writeFile(wb, filename)
  }

  const COLORS = ['#2e7d32', '#1a5c2a', '#4caf50', '#66bb6a', '#81c784', '#a5d6a7']

  // Check permissions
  const canAccessReports = hasPermission(user?.role || 'Cashier', 'canAccessReports')
  
  if (!canAccessReports) {
    return (
      <div className="reports-page">
          <div className="access-denied">
          <div className="denied-icon"><FiLock size={40} /></div>
          <h2>Access Denied</h2>
          <p>Your role (Cashier) does not have permission to access Reports.</p>
          <p className="denied-details">Reports are available to Managers and Administrators only.</p>
        </div>
      </div>
    )
  }

  if (loading) return <div className="reports-page"><div className="loading">Loading...</div></div>

  return (
    <div className="reports-page">
      {error && <div className="error-banner">{error}</div>}
      {success && <div className="success-banner">{success}</div>}

      <div className="report-controls">
        <div className="control-group">
          <label>Report Type</label>
          <select value={reportType} onChange={(e) => setReportType(e.target.value)}>
            <option value="daily-sales">Daily Sales Report</option>
            <option value="date-range-sales">Date Range Sales Report</option>
            <option value="cashier-performance">Cashier Performance Report</option>
            <option value="best-selling">Best Selling Products Report</option>
            {(user?.role === 'Admin' || user?.role === 'Manager') && (
              <option value="profit-loss">Profit & Loss Report</option>
            )}
            <option value="stock">Stock Report</option>
          </select>
        </div>

        {reportType === 'daily-sales' && (
          <div className="control-group">
            <label>Select Date</label>
            <input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} />
          </div>
        )}

        {(reportType === 'date-range-sales' || reportType === 'profit-loss') && (
          <>
            <div className="control-group">
              <label>From</label>
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div className="control-group">
              <label>To</label>
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
          </>
        )}

        {reportType === 'cashier-performance' && cashiers.length > 0 && (
          <div className="control-group">
            <label>Filter by Cashier</label>
            <select value={filterCashier} onChange={(e) => setFilterCashier(e.target.value)}>
              <option value="">All Cashiers</option>
              {cashiers.map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
        )}

        <button className="btn btn-secondary" onClick={handleExport}>
          <FiDownload size={14} /> Export
        </button>
      </div>

      <div className="summary-cards">
        {Object.entries(summary).map(([key, value]) => {
          let displayValue = value
          if (typeof value === 'number') {
            if (key.includes('Revenue') || key.includes('COGS') || key.includes('Expenses') || key.includes('Profit') || key.includes('Value') || key.includes('total')) {
              displayValue = `$${value.toFixed(2)}`
            } else if (key.includes('Margin')) {
              displayValue = value
            } else {
              displayValue = value.toFixed(0)
            }
          }
          
          return (
            <div key={key} className="summary-card">
              <div className="card-label">{key.replace(/([A-Z])/g, ' $1').replace('_', ' ').trim()}</div>
              <div className="card-value">{displayValue}</div>
            </div>
          )
        })}
      </div>

      {paymentBreakdown.length > 0 && (
        <div className="chart-container">
          <h3>Payment Method Breakdown</h3>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={paymentBreakdown}
                cx="50%"
                cy="50%"
                labelLine={false}
                label={(entry) => `${entry.name}: $${entry.value.toFixed(2)}`}
                outerRadius={100}
                fill="#8884d8"
                dataKey="value"
              >
                {paymentBreakdown.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip formatter={(value) => `$${value.toFixed(2)}`} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      )}

      {chartData.length > 0 && (
        <div className="chart-container">
          <h3>{reportType === 'best-selling' ? 'Top 10 Best Selling Products' : reportType === 'daily-sales' ? 'Hourly Sales' : reportType === 'profit-loss' ? 'Monthly Profit Trend' : 'Sales Trend'}</h3>
          <ResponsiveContainer width="100%" height={300}>
            {reportType === 'profit-loss' ? (
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" />
                <YAxis />
                <Tooltip formatter={(value) => `$${value.toFixed(2)}`} />
                <Legend />
                <Line type="monotone" dataKey="revenue" stroke="#2e7d32" name="Revenue" />
                <Line type="monotone" dataKey="netProfit" stroke="#28a745" name="Net Profit" />
              </LineChart>
            ) : reportType === 'best-selling' ? (
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="productName" angle={-45} textAnchor="end" height={60} />
                <YAxis />
                <Tooltip />
                <Legend />
                <Bar dataKey="units" fill="#2e7d32" name="Units Sold" />
              </BarChart>
            ) : (
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey={reportType === 'daily-sales' ? 'time' : 'date'} />
                <YAxis />
                <Tooltip formatter={(value) => `$${value.toFixed(2)}`} />
                <Legend />
                <Bar dataKey={reportType === 'daily-sales' ? 'amount' : reportType === 'cashier-performance' ? 'total' : 'revenue'} fill="#2e7d32" name="Total" />
              </BarChart>
            )}
          </ResponsiveContainer>
        </div>
      )}

      <div className="table-container">
        <h3>Details</h3>
        {tableData.length > 0 ? (
          <table className="report-table">
            <thead>
              <tr>
                {reportType === 'daily-sales' && (
                  <>
                    <th>Time</th>
                    <th>Amount</th>
                    <th>Payment Method</th>
                    <th>Cashier</th>
                    <th>Actions</th>
                  </>
                )}
                {reportType === 'date-range-sales' && (
                  <>
                    <th>Date</th>
                    <th>Revenue</th>
                    <th>Transactions</th>
                    <th>Cash</th>
                    <th>Transfer</th>
                    <th>Split</th>
                  </>
                )}
                {reportType === 'cashier-performance' && (
                  <>
                    <th>Cashier</th>
                    <th>Total Sales</th>
                    <th>Transactions</th>
                    <th>Avg Transaction</th>
                    <th>Cash</th>
                    <th>Transfer</th>
                    <th>Split</th>
                  </>
                )}
                {reportType === 'best-selling' && (
                  <>
                    <th>Product</th>
                    <th>Units Sold</th>
                    <th>Revenue</th>
                    <th>COGS</th>
                    <th>Profit</th>
                  </>
                )}
                {reportType === 'profit-loss' && (
                  <>
                    <th>Month</th>
                    <th>Revenue</th>
                    <th>COGS</th>
                    <th>Expenses</th>
                    <th>Gross Profit</th>
                    <th>Net Profit</th>
                  </>
                )}
                {reportType === 'stock' && (
                  <>
                    <th>Product</th>
                    <th>Current Qty</th>
                    <th>Reorder Level</th>
                    <th>Category</th>
                    <th>Status</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {tableData.map((row, idx) => (
                <tr key={idx}>
                  {reportType === 'daily-sales' && (
                    <>
                      <td>{row.time || ''}</td>
                      <td>${parseFloat(row.total || 0).toFixed(2)}</td>
                      <td>{row.payment_method || 'Cash'}</td>
                      <td>{row.cashier || 'System'}</td>
                      <td>
                        {row.id && printerSettings?.printer_port && (
                          <button
                            className="btn btn-small btn-secondary"
                            onClick={() => handleReprintReceipt(row.id)}
                            disabled={reprintingId === row.id}
                          >
                            {reprintingId === row.id ? <><FiPrinter size={12} /> Printing...</> : <><FiPrinter size={12} /> Reprint</>}
                          </button>
                        )}
                      </td>
                    </>
                  )}
                  {reportType === 'date-range-sales' && (
                    <>
                      <td>{row.date}</td>
                      <td>${parseFloat(row.revenue).toFixed(2)}</td>
                      <td>{row.count}</td>
                      <td>${parseFloat(row.cash).toFixed(2)}</td>
                      <td>${parseFloat(row.transfer).toFixed(2)}</td>
                      <td>${parseFloat(row.split).toFixed(2)}</td>
                    </>
                  )}
                  {reportType === 'cashier-performance' && (
                    <>
                      <td>{row.cashier}</td>
                      <td>${parseFloat(row.total).toFixed(2)}</td>
                      <td>{row.count}</td>
                      <td>${parseFloat(row.avgTransaction).toFixed(2)}</td>
                      <td>${parseFloat(row.cash).toFixed(2)}</td>
                      <td>${parseFloat(row.transfer).toFixed(2)}</td>
                      <td>${parseFloat(row.split).toFixed(2)}</td>
                    </>
                  )}
                  {reportType === 'best-selling' && (
                    <>
                      <td>{row.productName}</td>
                      <td>{row.units}</td>
                      <td>${parseFloat(row.revenue).toFixed(2)}</td>
                      <td>${parseFloat(row.cogs).toFixed(2)}</td>
                      <td className="profit">${parseFloat(row.profit).toFixed(2)}</td>
                    </>
                  )}
                  {reportType === 'profit-loss' && (
                    <>
                      <td>{row.month}</td>
                      <td>${parseFloat(row.revenue).toFixed(2)}</td>
                      <td>${parseFloat(row.cogs).toFixed(2)}</td>
                      <td>${parseFloat(row.expenses).toFixed(2)}</td>
                      <td>${parseFloat(row.grossProfit).toFixed(2)}</td>
                      <td className="profit">${parseFloat(row.netProfit).toFixed(2)}</td>
                    </>
                  )}
                  {reportType === 'stock' && (
                    <>
                      <td>{row.name}</td>
                      <td>{row.current_quantity}</td>
                      <td>{row.reorder_level}</td>
                      <td>{row.category || '-'}</td>
                      <td>
                        <span className={`stock-badge ${row.current_quantity === 0 ? 'out-of-stock' : row.current_quantity <= row.reorder_level ? 'low-stock' : 'in-stock'}`}>
                          {row.current_quantity === 0 ? 'Out of Stock' : row.current_quantity <= row.reorder_level ? 'Low Stock' : <><FiCheck size={11} /> In Stock</>}
                        </span>
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="no-data">No data available for selected period</div>
        )}
      </div>
    </div>
  )
}

export default Reports
