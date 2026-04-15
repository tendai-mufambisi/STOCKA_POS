import { useState, useEffect } from 'react'
import { getRestockNeeded, getProductSalesVelocity, getProductById } from '../database/db'
import './RestockNeeded.css'
import { FiTrendingUp, FiAlertCircle, FiCheckCircle } from 'react-icons/fi'

function RestockNeeded({ user }) {
  const [restockProducts, setRestockProducts] = useState([])
  const [velocityData, setVelocityData] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [sortBy, setSortBy] = useState('shortfall') // shortfall | velocity | name
  const [selectedProduct, setSelectedProduct] = useState(null)

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    try {
      setLoading(true)
      const [restock, velocity] = await Promise.all([
        getRestockNeeded(),
        getProductSalesVelocity(30)
      ])
      
      // Create velocity lookup
      const velMap = {}
      velocity.forEach(v => {
        velMap[v.id] = v
      })
      setVelocityData(velMap)
      
      // Sort and set
      const sorted = sortRestockProducts(restock, sortBy, velMap)
      setRestockProducts(sorted)
    } catch (err) {
      setError('Failed to load restock data')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const sortRestockProducts = (products, sortType, velMap) => {
    const copy = [...products]
    
    switch (sortType) {
      case 'shortfall':
        return copy.sort((a, b) => (b.shortfall || 0) - (a.shortfall || 0))
      case 'velocity':
        return copy.sort((a, b) => {
          const aVel = velMap[a.id]?.velocity_per_day || 0
          const bVel = velMap[b.id]?.velocity_per_day || 0
          return bVel - aVel
        })
      case 'name':
        return copy.sort((a, b) => a.name.localeCompare(b.name))
      default:
        return copy
    }
  }

  const handleSortChange = (newSort) => {
    setSortBy(newSort)
    const sorted = sortRestockProducts(restockProducts, newSort, velocityData)
    setRestockProducts(sorted)
  }

  const getUrgencyColor = (shortfall, velocity) => {
    const velPerDay = velocity?.velocity_per_day || 0
    const daysUntilStockout = velocity?.current_quantity / (velPerDay || 1)
    
    if (daysUntilStockout < 3) return 'critical'
    if (daysUntilStockout < 7) return 'high'
    return 'medium'
  }

  const getUrgencyLabel = (shortfall, velocity) => {
    const velPerDay = velocity?.velocity_per_day || 0
    const daysUntilStockout = velocity?.current_quantity / (velPerDay || 1)
    
    if (daysUntilStockout < 3) return '⚠️ Critical'
    if (daysUntilStockout < 7) return '⚡ High'
    return '📊 Medium'
  }

  if (loading) return <div className="restock-page"><div className="loading">Loading...</div></div>

  const totalShortfall = restockProducts.reduce((sum, p) => sum + (p.shortfall || 0), 0)
  const criticalCount = restockProducts.filter(p => {
    const vel = velocityData[p.id]
    const daysUntilStockout = (p.current_quantity || 0) / (vel?.velocity_per_day || 1)
    return daysUntilStockout < 3
  }).length

  return (
    <div className="restock-page">
      <div className="page-header">
        <h1>Restock Recommendations</h1>
        <p>Products below reorder level - manage inventory efficiently</p>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {/* Overview Cards */}
      <div className="overview-cards">
        <div className="overview-card">
          <div className="card-icon critical">
            <FiAlertCircle />
          </div>
          <div className="card-content">
            <div className="card-label">Critical Items</div>
            <div className="card-value">{criticalCount}</div>
          </div>
        </div>

        <div className="overview-card">
          <div className="card-icon">
            <FiTrendingUp />
          </div>
          <div className="card-content">
            <div className="card-label">Total Shortfall</div>
            <div className="card-value">{totalShortfall.toFixed(0)} units</div>
          </div>
        </div>

        <div className="overview-card">
          <div className="card-icon">
            <FiCheckCircle />
          </div>
          <div className="card-content">
            <div className="card-label">Products to Restock</div>
            <div className="card-value">{restockProducts.length}</div>
          </div>
        </div>
      </div>

      {/* Sort Controls */}
      <div className="controls">
        <div className="sort-controls">
          <span>Sort by:</span>
          <button
            className={`sort-btn ${sortBy === 'shortfall' ? 'active' : ''}`}
            onClick={() => handleSortChange('shortfall')}
          >
            Shortfall
          </button>
          <button
            className={`sort-btn ${sortBy === 'velocity' ? 'active' : ''}`}
            onClick={() => handleSortChange('velocity')}
          >
            Sales Velocity
          </button>
          <button
            className={`sort-btn ${sortBy === 'name' ? 'active' : ''}`}
            onClick={() => handleSortChange('name')}
          >
            Name
          </button>
        </div>
      </div>

      {/* Products Table */}
      <div className="restock-table">
        <table>
          <thead>
            <tr>
              <th>Product</th>
              <th>Current Stock</th>
              <th>Reorder Level</th>
              <th>Shortfall</th>
              <th>30-Day Velocity</th>
              <th>Days to Stockout</th>
              <th>Urgency</th>
              <th>Supplier</th>
            </tr>
          </thead>
          <tbody>
            {restockProducts.map(product => {
              const velocity = velocityData[product.id]
              const daysUntilStockout = velocity ? (product.current_quantity || 0) / (velocity.velocity_per_day || 1) : 'N/A'
              const urgency = getUrgencyColor(product.shortfall, velocity)
              
              return (
                <tr key={product.id} className={`urgency-${urgency}`}>
                  <td className="product-name">
                    <button
                      className="detail-link"
                      onClick={() => setSelectedProduct(product)}
                    >
                      {product.name}
                    </button>
                  </td>
                  <td className="number">{product.current_quantity || 0}</td>
                  <td className="number">{product.reorder_level}</td>
                  <td className="number shortfall">{-(product.shortfall || 0)}</td>
                  <td className="number">
                    {velocity ? (
                      <>
                        <div>{velocity.total_quantity_sold || 0} units</div>
                        <div className="sub-text">{velocity.velocity_per_day || 0}/day</div>
                      </>
                    ) : (
                      'No data'
                    )}
                  </td>
                  <td className="number">
                    {typeof daysUntilStockout === 'number'
                      ? daysUntilStockout.toFixed(1) + ' days'
                      : daysUntilStockout}
                  </td>
                  <td className={`urgency ${urgency}`}>
                    {getUrgencyLabel(product.shortfall, velocity)}
                  </td>
                  <td className="supplier">
                    {product.supplier_name || 'Unassigned'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {restockProducts.length === 0 && (
        <div className="empty-state">
          <FiCheckCircle className="icon" />
          <h3>All products are well-stocked!</h3>
          <p>No items currently below reorder level</p>
        </div>
      )}

      {/* Product Detail Modal */}
      {selectedProduct && (
        <div className="modal-overlay" onClick={() => setSelectedProduct(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{selectedProduct.name}</h2>
              <button className="close-btn" onClick={() => setSelectedProduct(null)}>✕</button>
            </div>

            <div className="modal-body">
              <div className="detail-grid">
                <div className="detail-item">
                  <span>Current Stock</span>
                  <span className="value">{selectedProduct.current_quantity || 0}</span>
                </div>
                <div className="detail-item">
                  <span>Reorder Level</span>
                  <span className="value">{selectedProduct.reorder_level}</span>
                </div>
                <div className="detail-item">
                  <span>Shortfall</span>
                  <span className="value shortfall">-{selectedProduct.shortfall || 0}</span>
                </div>
                <div className="detail-item">
                  <span>Supplier</span>
                  <span className="value">{selectedProduct.supplier_name || 'Unassigned'}</span>
                </div>

                {velocityData[selectedProduct.id] && (
                  <>
                    <div className="detail-item">
                      <span>30-Day Sales</span>
                      <span className="value">{velocityData[selectedProduct.id].total_quantity_sold || 0} units</span>
                    </div>
                    <div className="detail-item">
                      <span>Daily Velocity</span>
                      <span className="value">{velocityData[selectedProduct.id].velocity_per_day || 0}/day</span>
                    </div>
                  </>
                )}
              </div>

              <div className="recommendation">
                <h4>📦 Recommendation</h4>
                {velocityData[selectedProduct.id] && (
                  <p>Based on 30-day sales velocity of {velocityData[selectedProduct.id].velocity_per_day}/day,
                     we recommend ordering at least <strong>{(selectedProduct.shortfall * 1.5).toFixed(0)} units</strong> to
                     restore stock to reorder level with a safety buffer.</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default RestockNeeded
