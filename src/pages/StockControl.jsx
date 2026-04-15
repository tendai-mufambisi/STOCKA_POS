import { useState, useEffect } from 'react'
import { getProducts, getSuppliers, addStockReceiving, getStockReceivings } from '../database/db'
import './StockControl.css'

function StockControl() {
  const [receivings, setReceivings] = useState([])
  const [products, setProducts] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [error, setError] = useState('')
  const user = JSON.parse(localStorage.getItem('stocka_user') || '{}')

  const [formData, setFormData] = useState({
    supplier_id: '',
    product_id: '',
    date_received: new Date().toISOString().split('T')[0],
    cartons: '',
    units_per_carton: '',
    cost_per_carton: '',
    selling_price_per_unit: ''
  })

  const [calculations, setCalculations] = useState({
    total_units: 0,
    cost_per_unit: 0,
    total_value: 0,
    profit_per_unit: 0,
    profit_margin: 0
  })

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    try {
      setLoading(true)
      const [productsData, suppliersData, receivingsData] = await Promise.all([
        getProducts(),
        getSuppliers(),
        getStockReceivings()
      ])
      setProducts(productsData)
      setSuppliers(suppliersData)
      setReceivings(receivingsData)
    } catch (err) {
      setError('Failed to load data')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const handleChange = (e) => {
    const { name, value } = e.target
    const newFormData = {
      ...formData,
      [name]: value
    }
    setFormData(newFormData)
    calculateValues(newFormData)
  }

  const calculateValues = (data) => {
    const cartons = parseFloat(data.cartons) || 0
    const unitsPerCarton = parseFloat(data.units_per_carton) || 0
    const costPerCarton = parseFloat(data.cost_per_carton) || 0
    const sellingPrice = parseFloat(data.selling_price_per_unit) || 0

    const totalUnits = cartons * unitsPerCarton
    const costPerUnit = unitsPerCarton > 0 ? costPerCarton / unitsPerCarton : 0
    const totalValue = totalUnits * costPerUnit
    const profitPerUnit = sellingPrice - costPerUnit
    const profitMargin = sellingPrice > 0 ? (profitPerUnit / sellingPrice) * 100 : 0

    setCalculations({
      total_units: totalUnits,
      cost_per_unit: costPerUnit,
      total_value: totalValue,
      profit_per_unit: profitPerUnit,
      profit_margin: profitMargin
    })
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')

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
    if (!formData.selling_price_per_unit || parseFloat(formData.selling_price_per_unit) <= 0) {
      setError('Please enter selling price per unit')
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
        selling_price_per_unit: parseFloat(formData.selling_price_per_unit),
        total_value: calculations.total_value,
        recorded_by: user.username
      }

      await addStockReceiving(receiving)
      await loadData()
      
      setFormData({
        supplier_id: '',
        product_id: '',
        date_received: new Date().toISOString().split('T')[0],
        cartons: '',
        units_per_carton: '',
        cost_per_carton: '',
        selling_price_per_unit: ''
      })
      setCalculations({
        total_units: 0,
        cost_per_unit: 0,
        total_value: 0,
        profit_per_unit: 0,
        profit_margin: 0
      })
      setShowForm(false)
    } catch (err) {
      setError('Failed to record stock receiving')
      console.error(err)
    }
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

      {error && <div className="error-banner">{error}</div>}

      <div className="toolbar">
        <button className="btn btn-primary" onClick={() => setShowForm(!showForm)}>
          {showForm ? '✕ Cancel' : '✚ Record Stock'}
        </button>
      </div>

      {showForm && (
        <div className="form-card">
          <h3>Record Stock Receiving</h3>
          <form onSubmit={handleSubmit}>
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

            <div className="form-group">
              <label>Selling Price per Unit (USD) *</label>
              <input
                type="number"
                name="selling_price_per_unit"
                value={formData.selling_price_per_unit}
                onChange={handleChange}
                placeholder="0.00"
                step="0.01"
                min="0"
                required
              />
            </div>

            {/* Calculations Display */}
            <div className="calculations-panel">
              <div className="calc-row">
                <div className="calc-item">
                  <span className="calc-label">Total Units:</span>
                  <span className="calc-value">{calculations.total_units.toFixed(0)}</span>
                </div>
                <div className="calc-item">
                  <span className="calc-label">Cost per Unit:</span>
                  <span className="calc-value">${calculations.cost_per_unit.toFixed(2)}</span>
                </div>
                <div className="calc-item">
                  <span className="calc-label">Total Stock Value:</span>
                  <span className="calc-value">${calculations.total_value.toFixed(2)}</span>
                </div>
              </div>
              <div className="calc-row">
                <div className="calc-item">
                  <span className="calc-label">Profit per Unit:</span>
                  <span className="calc-value">${calculations.profit_per_unit.toFixed(2)}</span>
                </div>
                <div className="calc-item">
                  <span className="calc-label">Profit Margin:</span>
                  <span className="calc-value">{calculations.profit_margin.toFixed(2)}%</span>
                </div>
              </div>
            </div>

            <button type="submit" className="btn btn-primary">
              Record Stock Receiving
            </button>
          </form>
        </div>
      )}

      <div className="receivings-list">
        <h3>Stock Receiving History</h3>
        {receivings.length === 0 ? (
          <div className="empty-state">
            <p>No stock receivings recorded yet</p>
          </div>
        ) : (
          <div className="receivings-table">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Supplier</th>
                  <th>Product</th>
                  <th>Cartons</th>
                  <th>Total Units</th>
                  <th>Cost per Unit</th>
                  <th>Selling Price</th>
                  <th>Total Value</th>
                </tr>
              </thead>
              <tbody>
                {receivings.map(r => (
                  <tr key={r.id}>
                    <td>{new Date(r.date_received).toLocaleDateString('en-ZW')}</td>
                    <td>{r.supplier_name}</td>
                    <td>{r.product_name}</td>
                    <td>{r.cartons}</td>
                    <td>{r.total_units}</td>
                    <td>${r.cost_per_unit.toFixed(2)}</td>
                    <td>${r.selling_price_per_unit.toFixed(2)}</td>
                    <td>${r.total_value.toFixed(2)}</td>
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
