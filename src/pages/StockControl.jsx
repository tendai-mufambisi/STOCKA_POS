import { useState, useEffect } from 'react'
import { getProducts, getSuppliers, addStockReceiving, recordDirectPurchase, getAllPurchaseHistory } from '../database/db'
import './StockControl.css'

function StockControl() {
  const [receivings, setReceivings] = useState([])
  const [products, setProducts] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [error, setError] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const user = JSON.parse(localStorage.getItem('stocka_user') || '{}')

  // Separate tracking for purchase type
  const [purchaseType, setPurchaseType] = useState('supplier') // 'supplier' or 'direct'

  const [formData, setFormData] = useState({
    supplier_id: '',
    product_id: '',
    date_received: new Date().toISOString().split('T')[0],
    cartons: '',
    units_per_carton: '',
    cost_per_carton: '',
    // For direct purchases
    quantity: '',
    cost_per_unit: '',
    notes: ''
  })

  const [calculations, setCalculations] = useState({
    total_units: 0,
    cost_per_unit: 0,
    total_value: 0
  })

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    try {
      setLoading(true)
      const [productsData, suppliersData, purchaseHistoryData] = await Promise.all([
        getProducts(),
        getSuppliers(),
        getAllPurchaseHistory()
      ])
      setProducts(productsData)
      setSuppliers(suppliersData)
      setReceivings(purchaseHistoryData)
    } catch (err) {
      setError('Failed to load data')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const handleChange = (e) => {
    const { name, value } = e.target
    
    // Special handling for purchase_type dropdown
    if (name === 'purchase_type') {
      setPurchaseType(value)
      // Reset supplier_id when switching to direct purchase
      if (value === 'direct') {
        setFormData(prev => ({...prev, supplier_id: '', quantity: '', cost_per_unit: '', notes: ''}))
      } else {
        setFormData(prev => ({...prev, supplier_id: '', quantity: '', cost_per_unit: '', notes: ''}))
      }
      return
    }

    const newFormData = {
      ...formData,
      [name]: value
    }
    setFormData(newFormData)
    
    // Only calculate for supplier purchases
    if (purchaseType === 'supplier') {
      calculateValues(newFormData)
    }
  }

  const calculateValues = (data) => {
    const cartons = parseFloat(data.cartons) || 0
    const unitsPerCarton = parseFloat(data.units_per_carton) || 0
    const costPerCarton = parseFloat(data.cost_per_carton) || 0

    const totalUnits = cartons * unitsPerCarton
    const costPerUnit = unitsPerCarton > 0 ? costPerCarton / unitsPerCarton : 0
    const totalValue = totalUnits * costPerUnit

    setCalculations({
      total_units: totalUnits,
      cost_per_unit: costPerUnit,
      total_value: totalValue
    })
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setSuccessMessage('')

    if (purchaseType === 'supplier') {
      // Supplier purchase validation and submission
      if (!formData.supplier_id) {
        setError('Please select a supplier')
        return
      }
      if (!formData.product_id) {
        setError('Please select a product')
        return
      }
      if (!formData.cartons || parseFloat(formData.cartons) <= 0) {
        setError('Please enter a valid number of cartons')
        return
      }
      if (!formData.units_per_carton || parseFloat(formData.units_per_carton) <= 0) {
        setError('Please enter units per carton')
        return
      }
      if (!formData.cost_per_carton || parseFloat(formData.cost_per_carton) < 0) {
        setError('Please enter cost per carton')
        return
      }

      try {
        const receiving = {
          supplier_id: parseInt(formData.supplier_id),
          product_id: parseInt(formData.product_id),
          date_received: formData.date_received,
          cartons: parseInt(formData.cartons),
          units_per_carton: parseInt(formData.units_per_carton),
          total_units: calculations.total_units,
          cost_per_carton: parseFloat(formData.cost_per_carton),
          cost_per_unit: calculations.cost_per_unit,
          total_value: calculations.total_value,
          recorded_by: user.username
        }

        await addStockReceiving(receiving)
        setSuccessMessage('Stock receiving recorded successfully!')
        setTimeout(() => setSuccessMessage(''), 3000)
        await loadData()
        resetForm()
      } catch (err) {
        setError('Failed to record stock receiving')
        console.error(err)
      }
    } else {
      // Direct purchase validation and submission
      if (!formData.product_id) {
        setError('Please select a product')
        return
      }
      if (!formData.quantity || parseFloat(formData.quantity) <= 0) {
        setError('Please enter a valid quantity')
        return
      }

      try {
        const selectedProduct = products.find(p => p.id === parseInt(formData.product_id))
        
        await recordDirectPurchase({
          product_id: parseInt(formData.product_id),
          quantity: parseInt(formData.quantity),
          cost_per_unit: parseFloat(formData.cost_per_unit) || 0,
          notes: formData.notes,
          recorded_by: user?.username || 'System'
        })

        setSuccessMessage(`Added ${formData.quantity} units of ${selectedProduct?.name}!`)
        setTimeout(() => setSuccessMessage(''), 3000)
        await loadData()
        resetForm()
      } catch (err) {
        setError('Failed to record direct purchase: ' + err.message)
        console.error(err)
      }
    }
  }

  const resetForm = () => {
    setFormData({
      supplier_id: '',
      product_id: '',
      date_received: new Date().toISOString().split('T')[0],
      cartons: '',
      units_per_carton: '',
      cost_per_carton: '',
      quantity: '',
      cost_per_unit: '',
      notes: ''
    })
    setCalculations({
      total_units: 0,
      cost_per_unit: 0,
      total_value: 0
    })
    setPurchaseType('supplier')
    setShowForm(false)
    setError('')
  }

  const getSupplierName = (id) => suppliers.find(s => s.id === id)?.name || ''
  const getProductName = (id) => products.find(p => p.id === id)?.name || ''

  if (loading) {
    return <div className="stock-control-page"><div className="loading">Loading...</div></div>
  }

  return (
    <div className="stock-control-page">
      <div className="page-header">
        <h1>Stock Receiving</h1>
        <p>Record incoming stock from suppliers</p>
      </div>

      {/* Metrics Cards */}
      <div className="metrics-section" style={{ display: 'none' }}>
        <div className="metric-card">
          <div className="metric-icon">💰</div>
          <div className="metric-details">
            <div className="metric-label">Total Stock Value</div>
            <div className="metric-value">$0.00</div>
            <div className="metric-sub">Inventory valuation</div>
          </div>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}
      {successMessage && <div className="success-banner">{successMessage}</div>}

      <div className="toolbar">
        <button className="btn btn-primary" onClick={() => setShowForm(!showForm)}>
          {showForm ? '✕ Cancel' : '✚ Record Stock'}
        </button>
      </div>

      {showForm && (
        <div className="form-card">
          <h3>Record Stock Purchase</h3>
          <form onSubmit={handleSubmit}>
            {/* Purchase Type Selection */}
            <div className="form-row">
              <div className="form-group">
                <label>Purchase Type *</label>
                <select
                  name="purchase_type"
                  value={purchaseType}
                  onChange={handleChange}
                  required
                >
                  <option value="supplier">Supplier Purchase</option>
                  <option value="direct">Direct Purchase</option>
                </select>
              </div>
            </div>

            {/* SUPPLIER PURCHASE FORM */}
            {purchaseType === 'supplier' && (
              <>
                <div className="form-row">
                  <div className="form-group">
                    <label>Supplier *</label>
                    <select
                      name="supplier_id"
                      value={formData.supplier_id}
                      onChange={handleChange}
                      required
                    >
                      <option value="">Select supplier</option>
                      {suppliers.map(s => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Product *</label>
                    <select
                      name="product_id"
                      value={formData.product_id}
                      onChange={handleChange}
                      required
                    >
                      <option value="">Select product</option>
                      {products.map(p => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label>Date Received *</label>
                    <input
                      type="date"
                      name="date_received"
                      value={formData.date_received}
                      onChange={handleChange}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label>Number of Cartons *</label>
                    <input
                      type="number"
                      name="cartons"
                      value={formData.cartons}
                      onChange={handleChange}
                      placeholder="0"
                      min="0"
                      required
                    />
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label>Units per Carton *</label>
                    <input
                      type="number"
                      name="units_per_carton"
                      value={formData.units_per_carton}
                      onChange={handleChange}
                      placeholder="0"
                      min="0"
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label>Cost per Carton (USD) *</label>
                    <input
                      type="number"
                      name="cost_per_carton"
                      value={formData.cost_per_carton}
                      onChange={handleChange}
                      placeholder="0.00"
                      step="0.01"
                      min="0"
                      required
                    />
                  </div>
                </div>

                {/* Calculations Display */}
                <div className="calculations-panel">
                  <div className="calc-row">
                    <div className="calc-item">
                      <span className="calc-label">Total Units:</span>
                      <span className="calc-value">{(calculations.total_units || 0).toFixed(0)}</span>
                    </div>
                    <div className="calc-item">
                      <span className="calc-label">Cost per Unit:</span>
                      <span className="calc-value">${(calculations.cost_per_unit || 0).toFixed(2)}</span>
                    </div>
                    <div className="calc-item">
                      <span className="calc-label">Total Stock Value:</span>
                      <span className="calc-value">${(calculations.total_value || 0).toFixed(2)}</span>
                    </div>
                  </div>
                  <p style={{ fontSize: '12px', color: '#666', marginTop: '12px' }}>
                    💡 Selling price is managed in the Products tab
                  </p>
                </div>
              </>
            )}

            {/* DIRECT PURCHASE FORM */}
            {purchaseType === 'direct' && (
              <>
                <div className="form-row">
                  <div className="form-group">
                    <label>Product *</label>
                    <select
                      name="product_id"
                      value={formData.product_id}
                      onChange={handleChange}
                      required
                    >
                      <option value="">Select product</option>
                      {products.map(p => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label>Date Received *</label>
                    <input
                      type="date"
                      name="date_received"
                      value={formData.date_received}
                      onChange={handleChange}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label>Quantity to Add *</label>
                    <input
                      type="number"
                      name="quantity"
                      value={formData.quantity}
                      onChange={handleChange}
                      placeholder="0"
                      min="1"
                      step="1"
                      required
                    />
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label>Cost Per Unit (USD)</label>
                    <input
                      type="number"
                      name="cost_per_unit"
                      value={formData.cost_per_unit}
                      onChange={handleChange}
                      placeholder="0.00"
                      step="0.01"
                      min="0"
                    />
                  </div>
                  <div className="form-group">
                    <label>Notes</label>
                    <textarea
                      name="notes"
                      value={formData.notes}
                      onChange={handleChange}
                      placeholder="e.g., Personal purchase, Donation, Transfer..."
                      rows="2"
                      style={{ fontFamily: 'inherit', resize: 'vertical' }}
                    />
                  </div>
                </div>

                {/* Direct Purchase Summary */}
                {formData.quantity && (
                  <div className="calculations-panel">
                    <div className="calc-row">
                      <div className="calc-item">
                        <span className="calc-label">Total Cost:</span>
                        <span className="calc-value">
                          ${(parseInt(formData.quantity || 0) * parseFloat(formData.cost_per_unit || 0)).toFixed(2)}
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}

            <button type="submit" className="btn btn-primary">
              {purchaseType === 'supplier' ? 'Record Stock Receiving' : 'Confirm Direct Purchase'}
            </button>
          </form>
        </div>
      )}

      <div className="receivings-list">
        <h3>Purchase History (Supplier & Direct)</h3>
        {receivings.length === 0 ? (
          <div className="empty-state">
            <p>No purchases recorded yet</p>
          </div>
        ) : (
          <div className="receivings-table">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Source</th>
                  <th>Product</th>
                  <th>Type</th>
                  <th>Quantity</th>
                  <th>Cost per Unit</th>
                  <th>Total Value</th>
                </tr>
              </thead>
              <tbody>
                {receivings.map(r => (
                  <tr key={r.id}>
                    <td>{new Date(r.date_received).toLocaleDateString('en-ZW')}</td>
                    <td>{r.supplier_name}</td>
                    <td>{r.product_name}</td>
                    <td>
                      <span style={{
                        padding: '4px 8px',
                        borderRadius: '4px',
                        fontSize: '12px',
                        fontWeight: '500',
                        backgroundColor: r.purchase_type === 'supplier' ? '#e3f2fd' : '#f3e5f5',
                        color: r.purchase_type === 'supplier' ? '#1976d2' : '#7b1fa2'
                      }}>
                        {r.purchase_type === 'supplier' ? 'Supplier' : 'Direct'}
                      </span>
                    </td>
                    <td>
                      {r.purchase_type === 'supplier' 
                        ? `${r.cartons} cartons (${r.total_units} units)`
                        : `${r.total_units} units`
                      }
                    </td>
                    <td>${(r.cost_per_unit || 0).toFixed(2)}</td>
                    <td>${(r.total_value || 0).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

export default StockControl
