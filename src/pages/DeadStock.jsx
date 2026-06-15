import { useState, useEffect } from 'react'
import { getDeadStockProducts } from '../database/db'
import './DeadStock.css'
import { FiTrendingDown, FiCalendar, FiCheck, FiPackage } from 'react-icons/fi'

function DeadStock() {
  const [deadStockProducts, setDeadStockProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedDays, setSelectedDays] = useState(30)
  const [filterCategory, setFilterCategory] = useState('all')
  const [categories, setCategories] = useState([])

  useEffect(() => {
    loadData()
  }, [selectedDays])

  const loadData = async () => {
    try {
      setLoading(true)
      const deadStock = await getDeadStockProducts(selectedDays)
      setDeadStockProducts(deadStock)
      
      // Extract unique categories
      const cats = [...new Set(deadStock.map(p => p.category).filter(Boolean))]
      setCategories(cats)
    } catch (err) {
      setError('Failed to load dead stock data')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const filteredProducts = filterCategory === 'all'
    ? deadStockProducts
    : deadStockProducts.filter(p => p.category === filterCategory)

  const getLastSoldDaysAgo = (lastSoldDate) => {
    if (!lastSoldDate) return 'Never'
    const lastDate = new Date(lastSoldDate)
    const daysAgo = Math.floor((Date.now() - lastDate.getTime()) / (1000 * 60 * 60 * 24))
    if (daysAgo === 0) return 'Today'
    if (daysAgo === 1) return 'Yesterday'
    return `${daysAgo} days ago`
  }

  const getTotalInventoryValue = () => {
    return filteredProducts.reduce((sum, p) => {
      return sum + (p.current_quantity || 0) * (p.latest_cost_per_unit || 0)
    }, 0)
  }

  if (loading) return <div className="dead-stock-page"><div className="loading">Loading...</div></div>

  return (
    <div className="dead-stock-page">
      {error && <div className="error-banner">{error}</div>}

      {/* Overview */}
      <div className="overview-section">
        <div className="overview-card high-stock-value">
          <FiTrendingDown className="icon" />
          <div className="content">
            <div className="label">Dead Stock Items</div>
            <div className="value">{filteredProducts.length}</div>
            <div className="subtext">{(getTotalInventoryValue()).toFixed(2)} value locked up</div>
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="controls">
        <div className="control-group">
          <label>Days without sales:</label>
          <select value={selectedDays} onChange={(e) => setSelectedDays(parseInt(e.target.value))}>
            <option value={14}>14+ days</option>
            <option value={21}>21+ days</option>
            <option value={30}>30+ days</option>
            <option value={60}>60+ days</option>
            <option value={90}>90+ days</option>
          </select>
        </div>

        {categories.length > 0 && (
          <div className="control-group">
            <label>Filter by category:</label>
            <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)}>
              <option value="all">All categories ({deadStockProducts.length})</option>
              {categories.map(cat => (
                <option key={cat} value={cat}>
                  {cat} ({deadStockProducts.filter(p => p.category === cat).length})
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Products Grid */}
      {filteredProducts.length > 0 ? (
        <div className="dead-stock-grid">
          {filteredProducts.map(product => (
            <div key={product.id} className="stock-card">
              <div className="card-header">
                <h3>{product.name}</h3>
                <span className="category-badge">{product.category || 'Uncategorized'}</span>
              </div>

              <div className="card-content">
                <div className="info-row">
                  <span>Current Stock</span>
                  <span className="value">{product.current_quantity || 0}</span>
                </div>
                <div className="info-row">
                  <span>Last Sold</span>
                  <span className="value">
                    <FiCalendar className="icon" />
                    {getLastSoldDaysAgo(product.last_sold_date)}
                  </span>
                </div>
                <div className="info-row">
                  <span>Status</span>
                  <span className={`status-badge ${product.current_quantity > 0 ? 'stocked' : 'empty'}`}>
                    {product.current_quantity > 0 ? <><FiPackage size={11} /> In Stock</> : <><FiCheck size={11} /> Cleared</>}
                  </span>
                </div>
              </div>

              {product.current_quantity > 0 && (
                <div className="card-action">
                  <button className="action-btn promote">Run Promotion</button>
                  <button className="action-btn discount">Apply Discount</button>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <FiTrendingDown className="icon" />
          <h3>No dead stock found!</h3>
          <p>All products have been sold recently. Great inventory management!</p>
        </div>
      )}

      {/* Recommendations */}
      {filteredProducts.length > 0 && (
        <div className="recommendations">
          <h3>Recommendations</h3>
          <ul>
            <li>Consider running a clearance sale on slow-moving items to free up cash and shelf space</li>
            <li>Review pricing - these items might benefit from a discount strategy</li>
            <li>Donate excess stock if it's nearing expiry or obsolete</li>
            <li>Reduce future orders of these products to prevent overstocking</li>
            <li>Analyze why these products aren't selling - market demand may have changed</li>
          </ul>
        </div>
      )}
    </div>
  )
}

export default DeadStock
