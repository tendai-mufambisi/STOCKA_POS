import { useState, useEffect } from 'react'
import { getProducts, getStockValue } from '../database/db'
import './CurrentInventory.css'
import { FiSearch, FiArrowUp, FiArrowDown, FiPlus, FiDownload, FiDollarSign } from 'react-icons/fi'

function CurrentInventory({ onNavigateToAddStock } = {}) {
  const [products, setProducts] = useState([])
  const [filteredProducts, setFilteredProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [stockValue, setStockValue] = useState(0)

  // Column-level search and sort states
  const [searchFilters, setSearchFilters] = useState({
    product: '',
    sellingPrice: '',
    quantity: ''
  })

  const [sortConfig, setSortConfig] = useState({
    column: null,
    direction: 'asc' // 'asc' or 'desc'
  })

  const [showAddStock, setShowAddStock] = useState(false)

  useEffect(() => {
    loadInventory()
  }, [])

  // Re-filter and sort when products, search filters, or sort config changes
  useEffect(() => {
    filterAndSortProducts()
  }, [products, searchFilters, sortConfig])

  const loadInventory = async () => {
    try {
      setLoading(true)
      const [productsData, stockValueData] = await Promise.all([
        getProducts(),
        getStockValue()
      ])
      setProducts(productsData || [])
      setStockValue(stockValueData)
    } catch (err) {
      setError('Failed to load inventory')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const filterAndSortProducts = () => {
    let filtered = products.filter(product => {
      // Filter by product name
      const productMatch = (product.name || '')
        .toLowerCase()
        .includes(searchFilters.product.toLowerCase())

      // Filter by selling price
      const sellingPrice = product.selling_price || 0
      let priceMatch = true
      if (searchFilters.sellingPrice) {
        priceMatch = sellingPrice.toString().includes(searchFilters.sellingPrice)
      }

      // Filter by quantity
      const quantity = product.current_quantity || 0
      let quantityMatch = true
      if (searchFilters.quantity) {
        quantityMatch = quantity.toString().includes(searchFilters.quantity)
      }

      return productMatch && priceMatch && quantityMatch
    })

    // Sort the filtered results
    if (sortConfig.column) {
      filtered.sort((a, b) => {
        let aValue, bValue

        switch (sortConfig.column) {
          case 'product':
            aValue = (a.name || '').toLowerCase()
            bValue = (b.name || '').toLowerCase()
            break
          case 'sellingPrice':
            aValue = a.selling_price || 0
            bValue = b.selling_price || 0
            break
          case 'quantity':
            aValue = a.current_quantity || 0
            bValue = b.current_quantity || 0
            break
          default:
            return 0
        }

        if (aValue < bValue) {
          return sortConfig.direction === 'asc' ? -1 : 1
        }
        if (aValue > bValue) {
          return sortConfig.direction === 'asc' ? 1 : -1
        }
        return 0
      })
    }

    setFilteredProducts(filtered)
  }

  const handleSort = (column) => {
    if (sortConfig.column === column) {
      // Toggle direction if clicking same column
      setSortConfig({
        column,
        direction: sortConfig.direction === 'asc' ? 'desc' : 'asc'
      })
    } else {
      // Set new column with ascending direction
      setSortConfig({
        column,
        direction: 'asc'
      })
    }
  }

  const handleSearchChange = (column, value) => {
    setSearchFilters(prev => ({
      ...prev,
      [column]: value
    }))
  }

  const getSortIcon = (column) => {
    if (sortConfig.column !== column) return null
    return sortConfig.direction === 'asc' ? (
      <FiArrowUp size={16} className="sort-icon-inline" />
    ) : (
      <FiArrowDown size={16} className="sort-icon-inline" />
    )
  }

  const exportToCSV = () => {
    const headers = ['Product Name', 'Selling Price', 'Current Quantity', 'Category', 'Unit']
    const rows = filteredProducts.map(p => [
      p.name,
      p.selling_price || 0,
      p.current_quantity || 0,
      p.category || '-',
      p.unit || 'each'
    ])

    const csv = [headers, ...rows].map(row => row.map(cell => `"${cell}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `inventory_${new Date().toISOString().split('T')[0]}.csv`
    a.click()
  }

  if (loading) {
    return (
      <div className="current-inventory">
        <div className="loading-center">
          <p>Loading inventory...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="current-inventory">
      <div className="inventory-header">
        <div>
          <h1>Current Inventory</h1>
          <p className="inventory-subtitle">
            Real-time stock levels for all products — {filteredProducts.length} of {products.length} products
          </p>
        </div>
        <div className="inventory-actions">
          <button className="btn btn-secondary" onClick={exportToCSV}>
            <FiDownload size={18} /> Export CSV
          </button>
          <button className="btn btn-primary" onClick={() => setShowAddStock(true)}>
            <FiPlus size={18} /> Add Stock
          </button>
        </div>
      </div>

      {/* Total Stock Value Metric */}
      <div className="metrics-section">
        <div className="metric-card">
          <div className="metric-icon"><FiDollarSign size={20} /></div>
          <div className="metric-details">
            <div className="metric-label">Total Stock Value</div>
            <div className="metric-value">${stockValue.toFixed(2)}</div>
            <div className="metric-sub">Inventory valuation</div>
          </div>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="inventory-table-container">
        <table className="inventory-table">
          <thead>
            <tr>
              <th>
                <div className="column-header" onClick={() => handleSort('product')}>
                  <span>Product</span>
                  {getSortIcon('product')}
                </div>
                <input
                  type="text"
                  className="column-search"
                  placeholder="Search product..."
                  value={searchFilters.product}
                  onChange={(e) => handleSearchChange('product', e.target.value)}
                />
              </th>
              <th>
                <div className="column-header" onClick={() => handleSort('sellingPrice')}>
                  <span>Selling Price</span>
                  {getSortIcon('sellingPrice')}
                </div>
                <input
                  type="text"
                  className="column-search"
                  placeholder="Search price..."
                  value={searchFilters.sellingPrice}
                  onChange={(e) => handleSearchChange('sellingPrice', e.target.value)}
                />
              </th>
              <th>
                <div className="column-header" onClick={() => handleSort('quantity')}>
                  <span>Quantity</span>
                  {getSortIcon('quantity')}
                </div>
                <input
                  type="text"
                  className="column-search"
                  placeholder="Search qty..."
                  value={searchFilters.quantity}
                  onChange={(e) => handleSearchChange('quantity', e.target.value)}
                />
              </th>
              <th>Category</th>
              <th>Reorder Level</th>
              <th>Unit</th>
            </tr>
          </thead>
          <tbody>
            {filteredProducts.length === 0 ? (
              <tr>
                <td colSpan="6" className="empty-td">
                  No products found matching your filters
                </td>
              </tr>
            ) : (
              filteredProducts.map((product) => {
                const isLowStock = (product.current_quantity || 0) <= (product.reorder_level || 0)
                return (
                  <tr key={product.id} className={isLowStock ? 'low-stock' : ''}>
                    <td className="product-name">
                      <span className="product-indicator">{product.name}</span>
                    </td>
                    <td className="selling-price">
                      ${(product.selling_price || 0).toFixed(2)}
                    </td>
                    <td className="quantity">
                      <span className={`qty-badge ${isLowStock ? 'low' : 'normal'}`}>
                        {product.current_quantity || 0}
                      </span>
                    </td>
                    <td>{product.category || '-'}</td>
                    <td>{product.reorder_level || 0}</td>
                    <td>{product.unit || 'each'}</td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {showAddStock && (
        <div className="modal-overlay" onClick={() => setShowAddStock(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h2>Add Stock</h2>
            <p className="modal-description">
              This feature will redirect you to the stock receiving form in Stock Control.
            </p>
            <div className="modal-actions">
              <button
                className="btn btn-secondary"
                onClick={() => setShowAddStock(false)}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={() => {
                  setShowAddStock(false)
                  if (onNavigateToAddStock) {
                    onNavigateToAddStock('stock')
                  }
                }}
              >
                Go to Stock Control
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}

export default CurrentInventory
