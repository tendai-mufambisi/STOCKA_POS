import { useState, useEffect } from 'react'
import { getProducts, logAuditAction } from '../database/db'
import { validateNonNegativeNumber } from '../utils/validation'
import { useAuthStore } from '../store/useAuthStore'
import './InventoryReconciliation.css'
import { FiCheck, FiX, FiRefreshCw, FiAlertCircle, FiDownload } from 'react-icons/fi'

function InventoryReconciliation() {
  const { user } = useAuthStore()
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [reconciliationData, setReconciliationData] = useState({})
  const [discrepancies, setDiscrepancies] = useState([])
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [reconciliationMode, setReconciliationMode] = useState('count') // 'count' or 'review'
  const [searchTerm, setSearchTerm] = useState('')
  const [filterBy, setFilterBy] = useState('all') // 'all', 'discrepancies', 'matched'

  useEffect(() => {
    loadProducts()
  }, [])

  const loadProducts = async () => {
    try {
      setLoading(true)
      const data = await getProducts()
      setProducts(data)
      
      // Initialize reconciliation data with system quantities
      const initData = {}
      data.forEach(product => {
        initData[product.id] = {
          system_qty: product.current_quantity || 0,
          counted_qty: null,
          discrepancy: 0,
          notes: ''
        }
      })
      setReconciliationData(initData)
    } catch (err) {
      setError('Failed to load products')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const handleCountChange = (productId, count) => {
    // Validate quantity
    const validation = validateNonNegativeNumber(count, 'Quantity')
    if (!validation.valid) {
      setError(validation.error)
      return
    }

    setError('')
    const countNum = parseInt(count) || 0
    const systemQty = reconciliationData[productId].system_qty
    const discrepancy = countNum - systemQty

    setReconciliationData(prev => ({
      ...prev,
      [productId]: {
        ...prev[productId],
        counted_qty: countNum,
        discrepancy: discrepancy
      }
    }))
  }

  const handleNotesChange = (productId, notes) => {
    setReconciliationData(prev => ({
      ...prev,
      [productId]: {
        ...prev[productId],
        notes: notes
      }
    }))
  }

  const getFilteredProducts = () => {
    let filtered = products

    // Apply search filter
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase()
      filtered = filtered.filter(p =>
        p.name.toLowerCase().includes(term) ||
        p.category?.toLowerCase().includes(term)
      )
    }

    // Apply status filter
    if (filterBy === 'discrepancies') {
      filtered = filtered.filter(p => {
        const data = reconciliationData[p.id]
        return data?.counted_qty !== null && data?.discrepancy !== 0
      })
    } else if (filterBy === 'matched') {
      filtered = filtered.filter(p => {
        const data = reconciliationData[p.id]
        return data?.counted_qty !== null && data?.discrepancy === 0
      })
    }

    return filtered
  }

  const calculateSummary = () => {
    const productsWithCounts = products.filter(p => reconciliationData[p.id]?.counted_qty !== null)
    const matchedCount = productsWithCounts.filter(p => reconciliationData[p.id]?.discrepancy === 0).length
    const discrepancyCount = productsWithCounts.filter(p => reconciliationData[p.id]?.discrepancy !== 0).length
    const totalSystemQty = products.reduce((sum, p) => sum + (reconciliationData[p.id]?.system_qty || 0), 0)
    const totalCountedQty = productsWithCounts.reduce((sum, p) => sum + (reconciliationData[p.id]?.counted_qty || 0), 0)
    const totalDiscrepancy = totalCountedQty - totalSystemQty

    return {
      productsProcessed: productsWithCounts.length,
      productsTotal: products.length,
      matchedCount,
      discrepancyCount,
      totalSystemQty,
      totalCountedQty,
      totalDiscrepancy
    }
  }

  const handleSubmitReconciliation = async () => {
    const hasNoDiscrepancies = products.every(p => {
      const data = reconciliationData[p.id]
      return !data?.counted_qty || data?.discrepancy === 0
    })

    if (!hasNoDiscrepancies && reconciliationMode === 'count') {
      // Move to review mode if there are discrepancies
      setReconciliationMode('review')
      setSuccess('Review discrepancies before finalizing')
      setTimeout(() => setSuccess(''), 3000)
      return
    }

    // Prepare discrepancy records for audit
    const discrepancies_ = []
    for (const product of products) {
      const data = reconciliationData[product.id]
      if (data?.counted_qty !== null && data?.discrepancy !== 0) {
        discrepancies_.push({
          product_id: product.id,
          product_name: product.name,
          system_qty: data.system_qty,
          counted_qty: data.counted_qty,
          discrepancy: data.discrepancy,
          notes: data.notes || ''
        })
      }
    }

    try {
      // Log audit record for reconciliation
      if (discrepancies_.length > 0) {
        const summary = discrepancies_.map(d =>
          `${d.product_name}: ${d.system_qty} → ${d.counted_qty} (${d.discrepancy > 0 ? '+' : ''}${d.discrepancy})`
        ).join(' | ')

        await logAuditAction(
          user.username,
          'INVENTORY_RECONCILIATION',
          'INVENTORY',
          'reconciliation',
          `Reconciliation completed with ${discrepancies_.length} discrepancies: ${summary}`
        )
      } else {
        await logAuditAction(
          user.username,
          'INVENTORY_RECONCILIATION',
          'INVENTORY',
          'reconciliation',
          `Reconciliation completed - all items matched (${products.length} products verified)`
        )
      }

      setSuccess('✓ Reconciliation submitted and logged')
      setDiscrepancies(discrepancies_)
      setReconciliationMode('review')
      setTimeout(() => setSuccess(''), 3000)
    } catch (err) {
      setError('Failed to submit reconciliation: ' + err.message)
      console.error(err)
    }
  }

  const handleReset = () => {
    if (window.confirm('Reset all counts and start over?')) {
      setReconciliationData({})
      const initData = {}
      products.forEach(product => {
        initData[product.id] = {
          system_qty: product.current_quantity || 0,
          counted_qty: null,
          discrepancy: 0,
          notes: ''
        }
      })
      setReconciliationData(initData)
      setReconciliationMode('count')
      setSuccess('✓ Reconciliation reset')
      setTimeout(() => setSuccess(''), 2000)
    }
  }

  const handleExportReport = () => {
    const summary = calculateSummary()
    const csv = [
      ['Inventory Reconciliation Report'],
      [`Date: ${new Date().toISOString()}`],
      [`User: ${user.username}`],
      [''],
      ['Summary'],
      [`Products Processed: ${summary.productsProcessed}/${summary.productsTotal}`],
      [`Matched: ${summary.matchedCount}`],
      [`Discrepancies: ${summary.discrepancyCount}`],
      [`Total System Qty: ${summary.totalSystemQty}`],
      [`Total Counted Qty: ${summary.totalCountedQty}`],
      [`Total Variance: ${summary.totalDiscrepancy}`],
      [''],
      ['Details'],
      ['Product Name', 'Category', 'System Qty', 'Counted Qty', 'Variance', 'Notes']
    ]

    products.forEach(product => {
      const data = reconciliationData[product.id]
      if (data?.counted_qty !== null) {
        csv.push([
          product.name,
          product.category || '',
          data.system_qty,
          data.counted_qty,
          data.discrepancy,
          data.notes
        ])
      }
    })

    const csvContent = csv.map(row => row.map(cell => `"${cell}"`).join(',')).join('\n')
    const blob = new Blob([csvContent], { type: 'text/csv' })
    const url = window.URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `inventory-reconciliation-${new Date().toISOString().split('T')[0]}.csv`
    link.click()
    window.URL.revokeObjectURL(url)
  }

  const summary = calculateSummary()
  const filteredProducts = getFilteredProducts()

  if (loading) {
    return <div className="loading">Loading products...</div>
  }

  return (
    <div className="inventory-reconciliation">
      {error && <div className="alert alert-error"><FiAlertCircle /> {error}</div>}
      {success && <div className="alert alert-success"><FiCheck /> {success}</div>}

      {/* Summary Stats */}
      <div className="summary-stats">
        <div className="stat-box">
          <div className="stat-label">Processed</div>
          <div className="stat-value">{summary.productsProcessed}/{summary.productsTotal}</div>
        </div>
        <div className="stat-box success">
          <div className="stat-label"><FiCheck size={11} /> Matched</div>
          <div className="stat-value">{summary.matchedCount}</div>
        </div>
        <div className="stat-box warning">
          <div className="stat-label"><FiAlertCircle size={11} /> Discrepancies</div>
          <div className="stat-value">{summary.discrepancyCount}</div>
        </div>
        <div className="stat-box">
          <div className="stat-label">System Qty</div>
          <div className="stat-value">{summary.totalSystemQty}</div>
        </div>
        <div className="stat-box">
          <div className="stat-label">Counted Qty</div>
          <div className="stat-value">{summary.totalCountedQty}</div>
        </div>
        <div className={`stat-box ${summary.totalDiscrepancy === 0 ? '' : summary.totalDiscrepancy > 0 ? 'warning' : 'error'}`}>
          <div className="stat-label">Variance</div>
          <div className="stat-value">{summary.totalDiscrepancy > 0 ? '+' : ''}{summary.totalDiscrepancy}</div>
        </div>
      </div>

      {/* Mode Indicator */}
      <div className="mode-indicator">
        <span className={`mode-badge ${reconciliationMode === 'count' ? 'active' : ''}`}>
          1. Count Items
        </span>
        <span className="separator">→</span>
        <span className={`mode-badge ${reconciliationMode === 'review' ? 'active' : ''}`}>
          2. Review
        </span>
      </div>

      {/* Controls */}
      <div className="controls">
        <div className="search-filter">
          <input
            type="text"
            placeholder="Search products..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="search-input"
          />
          <select value={filterBy} onChange={(e) => setFilterBy(e.target.value)} className="filter-select">
            <option value="all">All Items ({products.length})</option>
            <option value="discrepancies">Discrepancies ({summary.discrepancyCount})</option>
            <option value="matched">Matched ({summary.matchedCount})</option>
          </select>
        </div>

        <div className="action-buttons">
          <button onClick={handleReset} className="btn btn-secondary" title="Reset all counts">
            <FiRefreshCw /> Reset
          </button>
          <button onClick={handleExportReport} className="btn btn-secondary" title="Export to CSV">
            <FiDownload /> Export
          </button>
          <button
            onClick={handleSubmitReconciliation}
            className={`btn ${reconciliationMode === 'count' ? 'btn-primary' : 'btn-success'}`}
          >
            {reconciliationMode === 'count' ? 'Review Discrepancies' : 'Finalize Reconciliation'}
          </button>
        </div>
      </div>

      {/* Product List */}
      <div className="products-grid">
        {filteredProducts.length === 0 ? (
          <div className="empty-state">
            <FiAlertCircle />
            <p>No products found matching your filters</p>
          </div>
        ) : (
          filteredProducts.map(product => {
            const data = reconciliationData[product.id] || {}
            const isMatched = data.counted_qty !== null && data.discrepancy === 0
            const hasDiscrepancy = data.counted_qty !== null && data.discrepancy !== 0
            const isUncounted = data.counted_qty === null

            return (
              <div
                key={product.id}
                className={`product-card ${isMatched ? 'matched' : hasDiscrepancy ? 'discrepancy' : isUncounted ? 'uncounted' : ''}`}
              >
                <div className="product-header">
                  <div className="product-info">
                    <h3>{product.name}</h3>
                    <p className="product-category">{product.category || 'No category'}</p>
                  </div>
                  <div className="product-status">
                    {isMatched && <span className="badge badge-success"><FiCheck /> Matched</span>}
                    {hasDiscrepancy && <span className="badge badge-warning"><FiAlertCircle /> Variance</span>}
                    {isUncounted && <span className="badge badge-neutral">Not counted</span>}
                  </div>
                </div>

                <div className="product-quantities">
                  <div className="qty-item">
                    <label>System Qty</label>
                    <div className="qty-display">{data.system_qty}</div>
                  </div>
                  <div className="qty-item">
                    <label>Counted Qty</label>
                    <input
                      type="number"
                      min="0"
                      value={data.counted_qty === null ? '' : data.counted_qty}
                      onChange={(e) => handleCountChange(product.id, e.target.value)}
                      placeholder="Enter count"
                      className="qty-input"
                    />
                  </div>
                  {data.counted_qty !== null && (
                    <div className={`qty-item variance ${data.discrepancy === 0 ? 'matched' : data.discrepancy > 0 ? 'positive' : 'negative'}`}>
                      <label>Variance</label>
                      <div className="qty-display">
                        {data.discrepancy > 0 ? '+' : ''}{data.discrepancy}
                      </div>
                    </div>
                  )}
                </div>

                <div className="product-notes">
                  <textarea
                    placeholder="Notes (e.g., 'Damaged items found', 'System error suspected')"
                    value={data.notes}
                    onChange={(e) => handleNotesChange(product.id, e.target.value)}
                    className="notes-textarea"
                    rows="2"
                  />
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

export default InventoryReconciliation
