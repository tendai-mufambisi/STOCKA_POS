import { useState, useEffect } from 'react'
import { getProducts, recordDirectPurchase } from '../database/db'
import './DirectPurchases.css'
import { FiPlus, FiCheck } from 'react-icons/fi'

function DirectPurchases({ user }) {
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedProduct, setSelectedProduct] = useState(null)
  const [formData, setFormData] = useState({
    quantity: '',
    cost_per_unit: '',
    notes: ''
  })

  useEffect(() => {
    loadProducts()
  }, [])

  const loadProducts = async () => {
    try {
      setLoading(true)
      const allProducts = await getProducts()
      setProducts(allProducts)
    } catch (err) {
      setError('Failed to load products')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const filteredProducts = products.filter(p =>
    p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    p.category?.toLowerCase().includes(searchTerm.toLowerCase())
  )

  const resetForm = () => {
    setSelectedProduct(null)
    setFormData({ quantity: '', cost_per_unit: '', notes: '' })
    setShowForm(false)
  }

  const handleStartAdd = (product) => {
    setSelectedProduct(product)
    setShowForm(true)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    
    if (!formData.quantity || !selectedProduct) {
      setError('Quantity is required')
      return
    }

    try {
      await recordDirectPurchase({
        product_id: selectedProduct.id,
        quantity: parseInt(formData.quantity),
        cost_per_unit: parseFloat(formData.cost_per_unit) || 0,
        notes: formData.notes,
        recorded_by: user?.username || 'System'
      })

      setSuccessMessage(`Added ${formData.quantity} units of ${selectedProduct.name}!`)
      await loadProducts()
      resetForm()
      
      // Clear success message after 3 seconds
      setTimeout(() => setSuccessMessage(''), 3000)
    } catch (err) {
      setError('Failed to record purchase: ' + err.message)
    }
  }

  if (loading) return <div className="dp-page"><div className="loading">Loading...</div></div>

  return (
    <div className="dp-page">
      <div className="page-header">
        <h1>Direct Purchases</h1>
        <p>Add stock directly without a supplier invoice - for personal purchases, donations, or transfers</p>
      </div>

      {error && <div className="error-banner">{error}</div>}
      {successMessage && <div className="success-banner">{successMessage}</div>}

      {/* Search and Overview */}
      <div className="controls">
        <div className="search-box">
          <input
            type="text"
            placeholder="Search products..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="search-input"
          />
        </div>
        <p className="product-count">Showing {filteredProducts.length} products</p>
      </div>

      {/* Products Grid */}
      {filteredProducts.length > 0 ? (
        <div className="products-grid">
          {filteredProducts.map(product => (
            <div key={product.id} className="product-card">
              <div className="card-header">
                <h3>{product.name}</h3>
                <span className="current-stock">
                  {product.current_quantity || 0} in stock
                </span>
              </div>

              <div className="card-info">
                {product.category && (
                  <div className="info-item">
                    <span className="label">Category</span>
                    <span className="value">{product.category}</span>
                  </div>
                )}
                <div className="info-item">
                  <span className="label">Reorder Level</span>
                  <span className="value">{product.reorder_level}</span>
                </div>
              </div>

              {product.description && (
                <div className="description">{product.description}</div>
              )}

              <button
                className="add-btn"
                onClick={() => handleStartAdd(product)}
              >
                <FiPlus /> Add Stock
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <p>No products found matching "{searchTerm}"</p>
        </div>
      )}

      {/* Add Stock Form Modal */}
      {showForm && selectedProduct && (
        <div className="modal-overlay" onClick={resetForm}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Add Stock - {selectedProduct.name}</h2>
              <button className="close-btn" onClick={resetForm}>✕</button>
            </div>

            <form onSubmit={handleSubmit} className="modal-body">
              <div className="form-group">
                <label>Current Stock</label>
                <div className="current-value">{selectedProduct.current_quantity || 0} units</div>
              </div>

              <div className="form-group">
                <label>Quantity to Add *</label>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={formData.quantity}
                  onChange={(e) => setFormData({...formData, quantity: e.target.value})}
                  placeholder="0"
                  required
                  className="form-input"
                />
              </div>

              <div className="form-group">
                <label>Cost Per Unit</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={formData.cost_per_unit}
                  onChange={(e) => setFormData({...formData, cost_per_unit: e.target.value})}
                  placeholder="0.00"
                  className="form-input"
                />
              </div>

              <div className="form-group">
                <label>Notes</label>
                <textarea
                  value={formData.notes}
                  onChange={(e) => setFormData({...formData, notes: e.target.value})}
                  placeholder="e.g., Personal purchase, Donation, Transfer..."
                  rows="3"
                  className="form-input"
                />
              </div>

              {formData.quantity && (
                <div className="summary">
                  <div className="summary-row">
                    <span>New Stock Level</span>
                    <span className="value">
                      {(selectedProduct.current_quantity || 0) + parseInt(formData.quantity || 0)} units
                    </span>
                  </div>
                  {formData.cost_per_unit && (
                    <div className="summary-row">
                      <span>Total Cost</span>
                      <span className="value">
                        ${(parseInt(formData.quantity || 0) * parseFloat(formData.cost_per_unit || 0)).toFixed(2)}
                      </span>
                    </div>
                  )}
                </div>
              )}

              <div className="form-actions">
                <button type="submit" className="btn btn-primary">
                  <FiCheck /> Confirm Add
                </button>
                <button type="button" className="btn btn-secondary" onClick={resetForm}>
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

export default DirectPurchases
