import { useState, useEffect } from 'react'
import { getProducts, addProduct, updateProduct, deleteProduct, getSuppliers, getLatestProductPrice, getLowStockItems } from '../database/db'
import { utils, writeFile } from 'xlsx'
import './Products.css'

function Products() {
  const [products, setProducts] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState('name-asc')
  const [filterSupplier, setFilterSupplier] = useState('')
  const [filterCategory, setFilterCategory] = useState('')
  const [formData, setFormData] = useState({
    name: '',
    category: '',
    supplier_id: '',
    unit: 'each',
    reorder_level: 5,
    description: '',
    image_data: null
  })
  const [prices, setPrices] = useState({})
  const [error, setError] = useState('')

  const units = ['each', 'kg', 'litre', 'box', 'carton', 'pack', 'dozen', 'pair', 'roll']
  const categories = ['Electronics', 'Clothing', 'Food & Beverage', 'Home & Garden', 'Sports', 'Books', 'Toys', 'Other']

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    try {
      setLoading(true)
      const [productsData, suppliersData] = await Promise.all([
        getProducts(),
        getSuppliers()
      ])
      setProducts(productsData)
      setSuppliers(suppliersData)

      // Load prices for each product
      const pricesMap = {}
      for (const product of productsData) {
        const price = await getLatestProductPrice(product.id)
        if (price) {
          pricesMap[product.id] = price
        }
      }
      setPrices(pricesMap)
    } catch (err) {
      setError('Failed to load products')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const handleChange = (e) => {
    const { name, value } = e.target
    setFormData(prev => ({
      ...prev,
      [name]: name === 'reorder_level' ? parseInt(value) || 0 : value
    }))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')

    if (!formData.name.trim()) {
      setError('Product name is required')
      return
    }

    try {
      if (editingId) {
        await updateProduct(editingId, formData)
      } else {
        await addProduct(formData)
      }
      await loadData()
      setFormData({
        name: '',
        category: '',
        supplier_id: '',
        unit: 'each',
        reorder_level: 5,
        description: '',
        image_data: null
      })
      setEditingId(null)
      setShowForm(false)
    } catch (err) {
      setError('Failed to save product')
      console.error(err)
    }
  }

  const handleEdit = (product) => {
    setFormData({
      name: product.name,
      category: product.category || '',
      supplier_id: product.supplier_id || '',
      unit: product.unit,
      reorder_level: product.reorder_level,
      description: product.description || '',
      image_data: product.image_data || null
    })
    setEditingId(product.id)
    setShowForm(true)
  }

  const handleDelete = async (id) => {
    if (window.confirm('Are you sure you want to delete this product?')) {
      try {
        await deleteProduct(id)
        await loadData()
      } catch (err) {
        setError('Failed to delete product')
        console.error(err)
      }
    }
  }

  const getSupplierName = (id) => {
    return suppliers.find(s => s.id === id)?.name || 'N/A'
  }

  const getStockStatus = (quantity, reorderLevel) => {
    if (quantity === 0) return 'Out of Stock'
    if (quantity <= reorderLevel) return 'Low Stock'
    return 'In Stock'
  }

  const getStatusColor = (status) => {
    if (status === 'Out of Stock') return 'status-danger'
    if (status === 'Low Stock') return 'status-warning'
    return 'status-success'
  }

  let filteredProducts = products.filter(p => {
    const matchesSearch = p.name.toLowerCase().includes(search.toLowerCase())
    const matchesSupplier = !filterSupplier || p.supplier_id === parseInt(filterSupplier)
    const matchesCategory = !filterCategory || p.category === filterCategory
    return matchesSearch && matchesSupplier && matchesCategory
  })

  // Apply sorting
  filteredProducts.sort((a, b) => {
    switch (sortBy) {
      case 'name-asc':
        return a.name.localeCompare(b.name)
      case 'name-desc':
        return b.name.localeCompare(a.name)
      case 'qty-asc':
        return (a.current_quantity || 0) - (b.current_quantity || 0)
      case 'qty-desc':
        return (b.current_quantity || 0) - (a.current_quantity || 0)
      default:
        return 0
    }
  })

  const handleExport = () => {
    const exportData = filteredProducts.map(p => ({
      'Product Name': p.name,
      'Category': p.category || '',
      'Supplier': getSupplierName(p.supplier_id),
      'Unit': p.unit,
      'Current Quantity': p.current_quantity || 0,
      'Reorder Level': p.reorder_level,
      'Status': getStockStatus(p.current_quantity, p.reorder_level),
      'Selling Price': prices[p.id]?.selling_price_per_unit ? `$${prices[p.id].selling_price_per_unit.toFixed(2)}` : 'N/A',
      'Cost Per Unit': prices[p.id]?.cost_per_unit ? `$${prices[p.id].cost_per_unit.toFixed(2)}` : 'N/A',
      'Profit Margin %': prices[p.id] ? ((((prices[p.id].selling_price_per_unit - prices[p.id].cost_per_unit) / prices[p.id].selling_price_per_unit) * 100).toFixed(2)) : 'N/A'
    }))

    const ws = utils.json_to_sheet(exportData)
    const wb = utils.book_new()
    utils.book_append_sheet(wb, ws, 'Products')
    writeFile(wb, `products_${new Date().toISOString().split('T')[0]}.xlsx`)
  }

  if (loading) {
    return <div className="products-page"><div className="loading">Loading products...</div></div>
  }

  return (
    <div className="products-page">
      <div className="page-header">
        <h1>Products</h1>
        <p>Manage your product catalog</p>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="products-toolbar">
        <div className="toolbar-actions">
          <button className="btn btn-primary" onClick={() => {
            setShowForm(!showForm)
            if (showForm) {
              setEditingId(null)
              setFormData({
                name: '',
                category: '',
                supplier_id: '',
                unit: 'each',
                reorder_level: 5,
                description: '',
                image_data: null
              })
            }
          }}>
            {showForm ? '✕ Cancel' : '✚ Add Product'}
          </button>
          <button className="btn btn-secondary" onClick={handleExport}>
            ⇩ Export to Excel
          </button>
        </div>

        <div className="toolbar-filters">
          <input
            type="text"
            placeholder="Search products..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="search-input"
          />
          <select value={filterSupplier} onChange={(e) => setFilterSupplier(e.target.value)} className="filter-select">
            <option value="">All Suppliers</option>
            {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)} className="filter-select">
            <option value="">All Categories</option>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} className="filter-select">
            <option value="name-asc">A-Z</option>
            <option value="name-desc">Z-A</option>
            <option value="qty-asc">Quantity ↑</option>
            <option value="qty-desc">Quantity ↓</option>
          </select>
        </div>
      </div>

      {showForm && (
        <div className="form-card">
          <h3>{editingId ? '✎ Edit Product' : '✚ Add New Product'}</h3>
          <form onSubmit={handleSubmit}>
            <div className="form-row">
              <div className="form-group">
                <label>Product Name *</label>
                <input
                  type="text"
                  name="name"
                  value={formData.name}
                  onChange={handleChange}
                  placeholder="Enter product name"
                />
              </div>
              <div className="form-group">
                <label>Category</label>
                <select name="category" value={formData.category} onChange={handleChange}>
                  <option value="">Select category</option>
                  {categories.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>Supplier</label>
                <select name="supplier_id" value={formData.supplier_id} onChange={handleChange}>
                  <option value="">Select supplier</option>
                  {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Unit of Measure</label>
                <select name="unit" value={formData.unit} onChange={handleChange}>
                  {units.map(u => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>Reorder Level</label>
                <input
                  type="number"
                  name="reorder_level"
                  value={formData.reorder_level}
                  onChange={handleChange}
                  min="0"
                />
              </div>
            </div>

            <div className="form-group">
              <label>Product Image (Optional)</label>
              <div className="form-image-input">
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => {
                    const file = e.target.files[0]
                    if (file) {
                      const reader = new FileReader()
                      reader.onload = (event) => {
                        setFormData({ ...formData, image_data: event.target.result })
                      }
                      reader.readAsDataURL(file)
                    }
                  }}
                  id="image-input"
                  className="image-file-input"
                />
                <label htmlFor="image-input" className="image-input-label">
                  {formData.image_data ? '📸 Change Image' : '📸 Select Image'}
                </label>
                {formData.image_data && (
                  <div className="image-preview">
                    <img src={formData.image_data} alt="Preview" />
                  </div>
                )}
              </div>
            </div>

            <div className="form-group">
              <label>Description</label>
              <textarea
                name="description"
                value={formData.description}
                onChange={handleChange}
                placeholder="Product description"
                rows="3"
              />
            </div>

            <button type="submit" className="btn btn-primary">
              {editingId ? 'Update Product' : 'Add Product'}
            </button>
          </form>
        </div>
      )}

      <div className="products-list">
        {filteredProducts.length === 0 ? (
          <div className="empty-state">
            <p>No products found</p>
            <small>Add your first product to get started</small>
          </div>
        ) : (
          <div className="products-grid">
            {filteredProducts.map(product => {
              const price = prices[product.id]
              const status = getStockStatus(product.current_quantity, product.reorder_level)
              const profitMargin = price ? (((price.selling_price_per_unit - price.cost_per_unit) / price.selling_price_per_unit * 100).toFixed(2)) : 'N/A'
              
              return (
                <div key={product.id} className="product-card">
                  {product.image_data && (
                    <div className="product-image">
                      <img src={product.image_data} alt={product.name} />
                    </div>
                  )}
                  <div className="product-header">
                    <h4>{product.name}</h4>
                    <span className={`status-badge ${getStatusColor(status)}`}>{status}</span>
                  </div>

                  <div className="product-details">
                    <div className="detail-row">
                      <span className="label">Quantity:</span>
                      <span className="value">{product.current_quantity || 0} {product.unit}</span>
                    </div>
                    <div className="detail-row">
                      <span className="label">Reorder Level:</span>
                      <span className="value">{product.reorder_level}</span>
                    </div>
                    {product.category && (
                      <div className="detail-row">
                        <span className="label">Category:</span>
                        <span className="value">{product.category}</span>
                      </div>
                    )}
                    {getSupplierName(product.supplier_id) !== 'N/A' && (
                      <div className="detail-row">
                        <span className="label">Supplier:</span>
                        <span className="value">{getSupplierName(product.supplier_id)}</span>
                      </div>
                    )}
                    {price && (
                      <>
                        <div className="detail-row price-row">
                          <span className="label">Selling Price:</span>
                          <span className="value price">${price.selling_price_per_unit.toFixed(2)}</span>
                        </div>
                        <div className="detail-row price-row">
                          <span className="label">Cost Per Unit:</span>
                          <span className="value price">${price.cost_per_unit.toFixed(2)}</span>
                        </div>
                        <div className="detail-row">
                          <span className="label">Profit Margin:</span>
                          <span className="value profit">{profitMargin}%</span>
                        </div>
                      </>
                    )}
                  </div>

                  <div className="product-actions">
                    <button className="btn-icon" onClick={() => handleEdit(product)} title="Edit">
                      ✎
                    </button>
                    <button className="btn-icon delete" onClick={() => handleDelete(product.id)} title="Delete">
                      ✘
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

export default Products