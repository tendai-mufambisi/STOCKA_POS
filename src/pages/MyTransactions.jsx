import { useState, useEffect, useCallback } from 'react'
import { getSales, getReceiptBySaleId, getShop } from '../database/db'
import { useAuthStore } from '../store/useAuthStore'
import { useReceiptPrinter } from '../hooks/useReceiptPrinter'
import ReceiptModal from '../components/ReceiptModal'
import { FiSearch, FiEye, FiRefreshCw } from 'react-icons/fi'
import './MyTransactions.css'

function MyTransactions() {
  const { user } = useAuthStore()
  const isManager = user?.role === 'Admin' || user?.role === 'Manager'

  const todayStr = new Date().toISOString().split('T')[0]

  const [allSales, setAllSales]       = useState([])
  const [loading, setLoading]         = useState(true)
  const [dateFilter, setDateFilter]   = useState(todayStr)
  const [cashierFilter, setCashierFilter] = useState('')
  const [search, setSearch]           = useState('')
  const [selectedSale, setSelectedSale] = useState(null)
  const [receiptLoading, setReceiptLoading] = useState(false)
  const [shopInfo, setShopInfo]       = useState(null)
  const [printerName, setPrinterName] = useState('')

  const { printReceipt, isPrinting } = useReceiptPrinter()

  const loadData = useCallback(async () => {
    try {
      setLoading(true)
      const [sales, shop] = await Promise.all([getSales(), getShop()])
      setAllSales(sales || [])
      setShopInfo(shop)
      setPrinterName(shop?.printer_name || '')
    } catch {
      setAllSales([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadData() }, [loadData])

  // ── Filtering ──────────────────────────────────────────────────────────────
  const filtered = allSales.filter(s => {
    if (s.status !== 'completed') return false

    // Cashiers only see their own sales
    if (!isManager && s.cashier !== user?.username) return false

    // Date filter
    if (dateFilter) {
      const saleDate = s.created_at?.slice(0, 10) ||
        new Date(s.created_at).toISOString().slice(0, 10)
      if (saleDate !== dateFilter) return false
    }

    // Cashier filter (manager only)
    if (isManager && cashierFilter && s.cashier !== cashierFilter) return false

    // Search by receipt number or cashier name
    if (search) {
      const q = search.toLowerCase()
      const matchReceipt = (s.receipt_number || '').toLowerCase().includes(q)
      const matchCashier = (s.cashier || '').toLowerCase().includes(q)
      if (!matchReceipt && !matchCashier) return false
    }

    return true
  })

  const totalValue = filtered.reduce((sum, s) => sum + (s.total || 0), 0)

  // Unique cashier list for the manager filter dropdown
  const cashierNames = [...new Set(allSales.map(s => s.cashier).filter(Boolean))].sort()

  // ── View receipt ───────────────────────────────────────────────────────────
  const handleView = async (sale) => {
    setReceiptLoading(true)
    try {
      const full = await getReceiptBySaleId(sale.id)
      setSelectedSale(full || sale)
    } catch {
      setSelectedSale(sale)
    } finally {
      setReceiptLoading(false)
    }
  }

  const handleReprint = async () => {
    if (!selectedSale || !shopInfo) return
    const opts = { printerName, portPath: shopInfo.printer_port || '', isDuplicate: true }
    await printReceipt(selectedSale, shopInfo, opts)
  }

  // ── Formatters ─────────────────────────────────────────────────────────────
  const fmtTime = (d) => {
    if (!d) return '—'
    return new Date(d).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })
  }
  const fmtDate = (d) => {
    if (!d) return '—'
    return new Date(d).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' })
  }
  const fmtMoney = (n) => `$${(n || 0).toFixed(2)}`

  const paymentBadge = (method) => {
    const m = (method || '').toLowerCase()
    if (m.includes('card'))   return 'card'
    if (m.includes('mobile') || m.includes('ecocash') || m.includes('innbucks')) return 'mobile'
    return 'cash'
  }

  return (
    <div className="txn-page">
      {/* Header */}
      <div className="txn-header">
        <div>
          <h2 className="txn-title">{isManager ? 'Transactions' : 'My Receipts'}</h2>
          <p className="txn-subtitle">
            {isManager
              ? 'View and reprint any sale receipt'
              : 'Your completed sales for the selected day'}
          </p>
        </div>
        <button className="txn-refresh" onClick={loadData} title="Refresh">
          <FiRefreshCw size={15} />
        </button>
      </div>

      {/* Summary chips */}
      <div className="txn-chips">
        <div className="txn-chip">
          <span className="txn-chip-label">Transactions</span>
          <span className="txn-chip-value">{filtered.length}</span>
        </div>
        <div className="txn-chip green">
          <span className="txn-chip-label">Total</span>
          <span className="txn-chip-value">{fmtMoney(totalValue)}</span>
        </div>
      </div>

      {/* Filters */}
      <div className="txn-filters">
        <div className="txn-filter-group">
          <label>Date</label>
          <input
            type="date"
            value={dateFilter}
            onChange={e => setDateFilter(e.target.value)}
            className="txn-input"
          />
        </div>

        {isManager && (
          <div className="txn-filter-group">
            <label>Cashier</label>
            <select
              value={cashierFilter}
              onChange={e => setCashierFilter(e.target.value)}
              className="txn-input"
            >
              <option value="">All cashiers</option>
              {cashierNames.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        )}

        <div className="txn-filter-group txn-search-group">
          <label>Search</label>
          <div className="txn-search-wrap">
            <FiSearch size={14} className="txn-search-icon" />
            <input
              type="text"
              placeholder="Receipt # or cashier…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="txn-input txn-search-input"
            />
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="txn-table-wrap">
        {loading ? (
          <div className="txn-empty">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="txn-empty">No transactions found for this filter.</div>
        ) : (
          <table className="txn-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Receipt #</th>
                {isManager && <th>Cashier</th>}
                <th>Items</th>
                <th>Payment</th>
                <th className="txn-right">Total</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(sale => (
                <tr key={sale.id} className="txn-row" onClick={() => handleView(sale)}>
                  <td className="txn-time">
                    <div>{fmtTime(sale.created_at)}</div>
                    {dateFilter === '' && (
                      <div className="txn-date-sub">{fmtDate(sale.created_at)}</div>
                    )}
                  </td>
                  <td className="txn-receipt">
                    {sale.receipt_number
                      ? <span className="txn-rcpt-badge">#{sale.receipt_number}</span>
                      : <span className="txn-no-rcpt">—</span>}
                  </td>
                  {isManager && <td className="txn-cashier">{sale.cashier || '—'}</td>}
                  <td className="txn-items-count">{sale.items_count ?? '—'}</td>
                  <td>
                    <span className={`txn-pay-badge txn-pay-${paymentBadge(sale.payment_method)}`}>
                      {sale.payment_method || 'Cash'}
                    </span>
                  </td>
                  <td className="txn-right txn-total">{fmtMoney(sale.total)}</td>
                  <td className="txn-action-cell">
                    <button
                      className="txn-view-btn"
                      onClick={e => { e.stopPropagation(); handleView(sale) }}
                      disabled={receiptLoading}
                      title="View receipt"
                    >
                      <FiEye size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Receipt modal */}
      {selectedSale && (
        <ReceiptModal
          sale={selectedSale}
          onClose={() => setSelectedSale(null)}
          onReprint={printerName ? handleReprint : undefined}
        />
      )}

      {isPrinting && (
        <div className="txn-printing-toast">Printing…</div>
      )}
    </div>
  )
}

export default MyTransactions
