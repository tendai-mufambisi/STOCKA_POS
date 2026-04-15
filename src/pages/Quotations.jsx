import { useState, useEffect } from 'react'
import { getCustomers, getProducts, addQuotation, getQuotations, updateQuotationStatus, addSale } from '../database/db'
import './Quotations.css'

function Quotations() {
  const [quotations, setQuotations] = useState([])
  const [customers, setCustomers] = useState([])
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')
  const [cart, setCart] = useState([])
  const [formData, setFormData] = useState({
    customer_id: '',
    notes: ''
  })

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    try {
      const [quoteData, custData, prodData] = await Promise.all([
        getQuotations(),
        getCustomers(),
        getProducts()
      ])
      setQuotations(quoteData)
      setCustomers(custData)
      setProducts(prodData)
    } catch (err) {
      setError('Failed to load quotations')
    } finally {
      setLoading(false)
    }
  }

  const handleAddProduct = (product) => {
    const existing = cart.find(i => i.product_id === product.id)
    if (existing) {
      setCart(cart.map(i => i.product_id === product.id ? 
        { ...i, quantity: i.quantity + 1, subtotal: (i.quantity + 1) * i.price } : i))
    } else {
      setCart([...cart, {
        product_id: product.id,
        product_name: product.name,
        quantity: 1,
        price: product.selling_price_per_unit || 0,
        subtotal: product.selling_price_per_unit || 0
      }])
    }
  }

  const updateQuantity = (idx, qty) => {
    const newCart = [...cart]
    if (qty <= 0) {
      newCart.splice(idx, 1)
    } else {
      newCart[idx].quantity = qty
      newCart[idx].subtotal = qty * newCart[idx].price
    }
    setCart(newCart)
  }

  const cartTotal = cart.reduce((sum, item) => sum + item.subtotal, 0)

  const handleCreateQuote = async () => {
    if (!formData.customer_id) {
      setError('Select a customer')
      return
    }
    if (cart.length === 0) {
      setError('Add products to quotation')
      return
    }

    try {
      await addQuotation({
        customer_id: parseInt(formData.customer_id),
        total_amount: cartTotal,
        status: 'Pending',
        notes: formData.notes
      }, cart)
      await loadData()
      setCart([])
      setFormData({ customer_id: '', notes: '' })
      setShowForm(false)
    } catch (err) {
      setError('Failed to create quotation')
    }
  }

  const handleConvertToSale = async (quotation) => {
    try {
      const items = quotation.items || cart
      await addSale({
        customer_id: quotation.customer_id,
        total: quotation.total_amount,
        cash_tendered: quotation.total_amount,
        change_given: 0,
        notes: `From quotation #${quotation.id}`
      }, items)
      await updateQuotationStatus(quotation.id, 'Converted to Sale')
      await loadData()
    } catch (err) {
      setError('Failed to convert quotation')
    }
  }

  const filteredQuotations = quotations.filter(q => {
    const customer = customers.find(c => c.id === q.customer_id)
    return customer?.name.toLowerCase().includes(search.toLowerCase())
  })

  if (loading) return <div className="quotations-page"><div className="loading">Loading...</div></div>

  return (
    <div className="quotations-page">
      <div className="page-header">
        <h1>Quotations</h1>
        <p>Create and manage quotations</p>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="toolbar">
        <button className="btn btn-primary" onClick={() => setShowForm(!showForm)}>
          {showForm ? '✕ Cancel' : '✚ New Quotation'}
        </button>
        <input type="text" placeholder="Search by customer..." value={search} 
          onChange={(e) => setSearch(e.target.value)} className="search-input" />
      </div>

      {showForm && (
        <div className="form-card">
          <h3>Create Quotation</h3>
          <div className="form-row">
            <div className="form-group">
              <label>Customer *</label>
              <select value={formData.customer_id} onChange={(e) => 
                setFormData({...formData, customer_id: e.target.value})} required>
                <option value="">Select customer...</option>
                {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Notes</label>
              <input type="text" value={formData.notes} onChange={(e) => 
                setFormData({...formData, notes: e.target.value})} />
            </div>
          </div>

          <div className="products-list">
            <h4>Add Products</h4>
            <div className="product-search">
              {products.slice(0, 8).map(p => (
                <button key={p.id} type="button" className="product-btn" 
                  onClick={() => handleAddProduct(p)}>
                  {p.name}
                </button>
              ))}
            </div>
          </div>

          {cart.length > 0 && (
            <div className="cart-section">
              <h4>Quotation Items</h4>
              <table className="cart-table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Qty</th>
                    <th>Price</th>
                    <th>Subtotal</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {cart.map((item, idx) => (
                    <tr key={idx}>
                      <td>{item.product_name}</td>
                      <td><input type="number" min="1" value={item.quantity} 
                        onChange={(e) => updateQuantity(idx, parseInt(e.target.value))} 
                        style={{width: '50px'}} /></td>
                      <td>${item.price.toFixed(2)}</td>
                      <td>${item.subtotal.toFixed(2)}</td>
                      <td><button type="button" onClick={() => updateQuantity(idx, 0)}>Remove</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="cart-total">Total: ${cartTotal.toFixed(2)}</div>
            </div>
          )}

          <div className="form-actions">
            <button type="button" className="btn btn-primary" onClick={handleCreateQuote}>
              Create Quotation
            </button>
          </div>
        </div>
      )}

      <div className="quotations-list">
        {filteredQuotations.length === 0 ? (
          <div className="empty-state">No quotations found</div>
        ) : (
          filteredQuotations.map(q => {
            const customer = customers.find(c => c.id === q.customer_id)
            return (
              <div key={q.id} className="quote-card">
                <div className="quote-header">
                  <div>
                    <h4>#{q.id} - {customer?.name}</h4>
                    <p>{new Date(q.date_created).toLocaleDateString('en-ZW')}</p>
                  </div>
                  <div className="quote-meta">
                    <span className={`status-badge ${q.status.toLowerCase()}`}>{q.status}</span>
                    <span className="amount">${q.total_amount?.toFixed(2)}</span>
                  </div>
                </div>
                {q.notes && <p className="notes">{q.notes}</p>}
                {q.status === 'Pending' && (
                  <button className="btn btn-primary" onClick={() => handleConvertToSale(q)}>
                    Convert to Sale
                  </button>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

export default Quotations
