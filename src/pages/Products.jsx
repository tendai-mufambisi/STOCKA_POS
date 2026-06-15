import { useState, useEffect, useRef } from 'react'
import { FiPackage, FiEdit2, FiTrash2, FiDownload, FiUpload, FiPlus, FiX, FiGrid, FiList, FiImage } from 'react-icons/fi'
import { getProducts, addProduct, updateProduct, deleteProduct, getSuppliers, getLatestProductPrice, getLowStockItems, getShop } from '../database/db'
import { validateRequired, validateCurrency, validateNonNegativeNumber } from '../utils/validation'
import { utils, writeFile, read } from 'xlsx'
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
  const [viewMode, setViewMode] = useState('list')
  const [formData, setFormData] = useState({
    name: '',
    category: '',
    supplier_id: '',
    unit: 'each',
    selling_price: '',
    reorder_level: 5,
    description: '',
    image_data: null
  })
  const [error, setError] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const [itemsPerPage, setItemsPerPage] = useState(25)
  const [defaultReorderLevel, setDefaultReorderLevel] = useState(5)
  const [showImportModal, setShowImportModal] = useState(false)
  const [importPreview, setImportPreview] = useState({ valid: [], skipped: 0 })
  const [importError, setImportError] = useState('')
  const [importing, setImporting] = useState(false)

  const units = ['each', 'pack']
  const categories = ['Food', 'Non-Food', 'Drinks', 'Other']
  const importFileRef = useRef(null)

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    try {
      setLoading(true)
      const [productsData, suppliersData, shop] = await Promise.all([
        getProducts(),
        getSuppliers(),
        getShop()
      ])
      setProducts(productsData)
      setSuppliers(suppliersData)
      const level = shop?.default_reorder_level ?? 5
      setDefaultReorderLevel(level)
      setFormData(prev => ({ ...prev, reorder_level: level }))
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
      [name]: (name === 'reorder_level') ? parseFloat(value) || 0 : value
    }))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')

    // Validate required fields
    const nameValidation = validateRequired(formData.name, 'Product name')
    if (!nameValidation.valid) {
      setError(nameValidation.error)
      return
    }

    // Validate price if provided
    if (formData.selling_price) {
      const priceValidation = validateCurrency(formData.selling_price, 'Selling price')
      if (!priceValidation.valid) {
        setError(priceValidation.error)
        return
      }
    }

    // Validate reorder level
    const reorderValidation = validateNonNegativeNumber(formData.reorder_level, 'Reorder level')
    if (!reorderValidation.valid) {
      setError(reorderValidation.error)
      return
    }

    try {
      if (editingId) {
        await updateProduct(editingId, {
          ...formData,
          selling_price: parseFloat(formData.selling_price) || 0
        })
        console.log('Product updated successfully')
        console.log('Updated product details:', formData)
      } else {
        await addProduct({
          ...formData,
          selling_price: parseFloat(formData.selling_price) || 0
        })
        
      }
      await loadData()
      setFormData({
        name: '',
        category: '',
        supplier_id: '',
        unit: 'each',
        selling_price: '',
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
      selling_price: product.selling_price || '',
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

  // Pagination calculations
  const totalPages = Math.ceil(filteredProducts.length / itemsPerPage)
  // Reset to page 1 if current page exceeds total pages
  const pageToUse = currentPage > totalPages ? 1 : currentPage
  if (pageToUse !== currentPage) {
    setCurrentPage(1)
  }
  const startIndex = (pageToUse - 1) * itemsPerPage
  const endIndex = startIndex + itemsPerPage
  const paginatedProducts = filteredProducts.slice(startIndex, endIndex)

  const handlePageChange = (newPage) => {
    if (newPage >= 1 && newPage <= totalPages) {
      setCurrentPage(newPage)
    }
  }

  const handleItemsPerPageChange = (e) => {
    setItemsPerPage(parseInt(e.target.value))
    setCurrentPage(1)
  }

  const handleExport = () => {
    const exportData = filteredProducts.map(p => ({
      'Product Name': p.name,
      'Category': p.category || '',
      'Unit': p.unit,
      'Current Quantity': p.current_quantity || 0,
      'Reorder Level': p.reorder_level,
      'Status': getStockStatus(p.current_quantity, p.reorder_level)
    }))

    const ws = utils.json_to_sheet(exportData)
    const wb = utils.book_new()
    utils.book_append_sheet(wb, ws, 'Products')
    writeFile(wb, `products_${new Date().toISOString().split('T')[0]}.xlsx`)
  }

  const normalizeHeader = (h) => {
    const s = String(h).toLowerCase().replace(/[\s_]+/g, '')
    if (['name', 'productname', 'product'].includes(s)) return 'name'
    if (['category', 'type'].includes(s)) return 'category'
    if (s === 'unit') return 'unit'
    if (['sellingprice', 'price', 'unitprice'].includes(s)) return 'selling_price'
    if (['reorderlevel', 'reorder', 'minstock', 'minimumstock'].includes(s)) return 'reorder_level'
    if (['currentquantity', 'quantity', 'qty', 'stock', 'currentstock'].includes(s)) return 'current_quantity'
    if (['description', 'desc'].includes(s)) return 'description'
    if (['supplier', 'suppliername'].includes(s)) return 'supplier'
    return null
  }

  const downloadTemplate = () => {
    const templateData = [
      { 'Product Name': 'Bread', Category: 'Food', Unit: 'each', 'Selling Price': 1.50, 'Reorder Level': 10, 'Current Quantity': 50, Description: 'White bread', Supplier: '' },
      { 'Product Name': 'Cooking Oil 2L', Category: 'Food', Unit: 'each', 'Selling Price': 4.00, 'Reorder Level': 5, 'Current Quantity': 20, Description: '', Supplier: '' },
    ]
    const ws = utils.json_to_sheet(templateData)
    const wb = utils.book_new()
    utils.book_append_sheet(wb, ws, 'Products')
    writeFile(wb, 'products_import_template.xlsx')
  }

  const handleImportFile = (e) => {
    const file = e.target.files[0]
    if (!file) return
    e.target.value = ''
    const reader = new FileReader()
    reader.onload = (evt) => {
      try {
        const wb = read(evt.target.result, { type: 'array' })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const rawRows = utils.sheet_to_json(ws, { defval: '' })
        if (rawRows.length === 0) {
          setImportError('The spreadsheet appears to be empty.')
          setShowImportModal(true)
          return
        }
        const normalized = rawRows.map(row => {
          const out = {}
          for (const [key, val] of Object.entries(row)) {
            const mapped = normalizeHeader(key)
            if (mapped) out[mapped] = val
          }
          return out
        })
        if (!normalized.some(r => r.name !== undefined)) {
          setImportError('Could not find a "Name" or "Product Name" column. Please check your spreadsheet headers match the template.')
          setShowImportModal(true)
          return
        }
        const valid = []
        let skipped = 0
        for (const row of normalized) {
          const name = String(row.name ?? '').trim()
          if (!name) { skipped++; continue }
          const rawUnit = String(row.unit ?? '').toLowerCase().trim()
          valid.push({
            name,
            category: String(row.category ?? '').trim(),
            unit: ['each', 'pack'].includes(rawUnit) ? rawUnit : 'each',
            selling_price: parseFloat(row.selling_price) || 0,
            reorder_level: parseInt(row.reorder_level) || 5,
            current_quantity: parseInt(row.current_quantity) || 0,
            description: String(row.description ?? '').trim(),
            supplier: String(row.supplier ?? '').trim(),
          })
        }
        setImportPreview({ valid, skipped })
        setImportError('')
        setShowImportModal(true)
      } catch {
        setImportError('Failed to read the file. Please make sure it is a valid Excel (.xlsx) file.')
        setShowImportModal(true)
      }
    }
    reader.readAsArrayBuffer(file)
  }

  const handleConfirmImport = async () => {
    if (importPreview.valid.length === 0) return
    setImporting(true)
    try {
      await window.stocka.products.importBatch(importPreview.valid)
      setShowImportModal(false)
      setImportPreview({ valid: [], skipped: 0 })
      await loadData()
    } catch (err) {
      setImportError('Import failed: ' + err.message)
    } finally {
      setImporting(false)
    }
  }

  if (loading) {
    return <div className="products-page"><div className="loading">Loading products...</div></div>
  }

  return (
    <div className="products-page">
      {/* Metrics Cards */}
      <div className="metrics-section">
        <div className="metric-card">
          <div className="metric-icon"><FiPackage size={20} /></div>
          <div className="metric-details">
            <div className="metric-label">Total Products</div>
            <div className="metric-value">{products.length}</div>
            <div className="metric-sub">In inventory</div>
          </div>
        </div>
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
            {showForm ? <><FiX size={14} /> Cancel</> : <><FiPlus size={14} /> Add Product</>}
          </button>
          <button className="btn btn-secondary" onClick={handleExport}>
            <FiDownload size={14} /> Export
          </button>
          <button className="btn btn-secondary" onClick={() => importFileRef.current.click()}>
            <FiUpload size={14} /> Import
          </button>
          <input
            ref={importFileRef}
            type="file"
            accept=".xlsx"
            className="input-hidden"
            onChange={handleImportFile}
          />
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
          <div className="view-toggle">
            <button
              className={`view-toggle-btn ${viewMode === 'list' ? 'active' : ''}`}
              onClick={() => setViewMode('list')}
              title="List View"
            >
              <FiList size={13} /> List
            </button>
            <button
              className={`view-toggle-btn ${viewMode === 'grid' ? 'active' : ''}`}
              onClick={() => setViewMode('grid')}
              title="Grid View"
            >
              <FiGrid size={13} /> Grid
            </button>
          </div>
        </div>
      </div>

      {showImportModal && (
        <div className="form-overlay" onClick={() => !importing && setShowImportModal(false)}>
          <div className="product-form import-modal" onClick={e => e.stopPropagation()}>
            <div className="form-header">
              <h2>Import Products from Sheet</h2>
              <button className="close-btn" onClick={() => !importing && setShowImportModal(false)}><FiX size={14} /></button>
            </div>

            {importError ? (
              <>
                <div className="error-banner">{importError}</div>
                <p className="import-template-hint">
                  Download the <button className="link-btn" onClick={downloadTemplate}>template file</button> to see the required column format.
                </p>
              </>
            ) : (
              <>
                <div className="import-summary">
                  <p className="import-count-valid">✓ <strong>{importPreview.valid.length}</strong> products ready to import</p>
                  {importPreview.skipped > 0 && (
                    <p className="import-count-skipped">✗ {importPreview.skipped} row{importPreview.skipped !== 1 ? 's' : ''} skipped — missing product name</p>
                  )}
                </div>

                {importPreview.valid.length > 0 && (
                  <div className="import-preview-table">
                    <table>
                      <thead>
                        <tr>
                          <th>Name</th>
                          <th>Category</th>
                          <th>Unit</th>
                          <th>Price</th>
                          <th>Qty</th>
                        </tr>
                      </thead>
                      <tbody>
                        {importPreview.valid.slice(0, 6).map((row, i) => (
                          <tr key={i}>
                            <td>{row.name}</td>
                            <td>{row.category || '—'}</td>
                            <td>{row.unit}</td>
                            <td>${row.selling_price.toFixed(2)}</td>
                            <td>{row.current_quantity}</td>
                          </tr>
                        ))}
                        {importPreview.valid.length > 6 && (
                          <tr className="import-more-row">
                            <td colSpan="5">... and {importPreview.valid.length - 6} more products</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}

            <div className="form-actions import-modal-actions">
              <button className="link-btn" onClick={downloadTemplate} disabled={importing}>
                ⇩ Download Template
              </button>
              <div className="modal-btn-row">
                <button className="btn btn-secondary" onClick={() => setShowImportModal(false)} disabled={importing}>
                  Cancel
                </button>
                {!importError && importPreview.valid.length > 0 && (
                  <button className="btn btn-primary" onClick={handleConfirmImport} disabled={importing}>
                    {importing ? 'Importing...' : `Import ${importPreview.valid.length} Products`}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {showForm && (
        <div className="form-card">
          <h3>{editingId ? <><FiEdit2 size={14} /> Edit Product</> : <><FiPlus size={14} /> Add New Product</>}</h3>
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
                <label>Unit of Measure</label>
                <select name="unit" value={formData.unit} onChange={handleChange}>
                  {units.map(u => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>Selling Price (USD) *</label>
                <input
                  type="number"
                  name="selling_price"
                  value={formData.selling_price}
                  onChange={handleChange}
                  placeholder="0.00"
                  step="any"
                  min="0"
                  required
                />
              </div>
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
                  <FiImage size={14} /> {formData.image_data ? 'Change Image' : 'Select Image'}
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
          <div className={viewMode === 'grid' ? 'products-grid' : 'products-list-view'}>
            {paginatedProducts.map(product => {
              const status = getStockStatus(product.current_quantity, product.reorder_level)
              
              if (viewMode === 'list') {
                return (
                  <div key={product.id} className="product-list-item">
                    <div className="list-item-top">
                      {product.image_data && (
                        <div className="list-item-image">
                          <img src={product.image_data} alt={product.name} />
                        </div>
                      )}
                      <div className="list-item-header">
                        <h4>{product.name}</h4>
                        <div className="list-item-quick-info">
                          <span className={`status-badge ${getStatusColor(status)}`}>{status}</span>
                          {product.category && <span className="category-tag">{product.category}</span>}
                          <span className="qty-info">{product.current_quantity || 0} {product.unit}</span>
                          {product.selling_price > 0 && (
                            <span className="price-info">${parseFloat(product.selling_price).toFixed(2)}</span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="list-item-actions">
                      <button className="btn-icon" onClick={() => handleEdit(product)} title="Edit">
                        <FiEdit2 size={14} />
                      </button>
                      <button className="btn-icon delete" onClick={() => handleDelete(product.id)} title="Delete">
                        <FiTrash2 size={14} />
                      </button>
                    </div>
                  </div>
                )
              }
              
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
                      <span className="label">Selling Price:</span>
                      <span className="value">${parseFloat(product.selling_price || 0).toFixed(2)}</span>
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

        {/* Pagination Controls */}
        {filteredProducts.length > 0 && (
          <div className="pagination-section">
            <div className="pagination-info">
              <span>Showing {startIndex + 1} to {Math.min(endIndex, filteredProducts.length)} of {filteredProducts.length} products</span>
              <select value={itemsPerPage} onChange={handleItemsPerPageChange} className="items-per-page-select">
                <option value="10">10 per page</option>
                <option value="25">25 per page</option>
                <option value="50">50 per page</option>
                <option value="100">100 per page</option>
              </select>
            </div>
            <div className="pagination-controls">
              <button
                className="pagination-btn"
                onClick={() => handlePageChange(1)}
                disabled={pageToUse === 1}
                title="First page"
              >
                ⟨⟨
              </button>
              <button
                className="pagination-btn"
                onClick={() => handlePageChange(pageToUse - 1)}
                disabled={pageToUse === 1}
                title="Previous page"
              >
                ⟨
              </button>

              <div className="page-numbers">
                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                  let pageNum
                  if (totalPages <= 5) {
                    pageNum = i + 1
                  } else {
                    const start = Math.max(1, pageToUse - 2)
                    pageNum = start + i
                  }
                  return pageNum <= totalPages ? (
                    <button
                      key={pageNum}
                      className={`page-number ${pageNum === pageToUse ? 'active' : ''}`}
                      onClick={() => handlePageChange(pageNum)}
                    >
                      {pageNum}
                    </button>
                  ) : null
                })}
              </div>

              <button
                className="pagination-btn"
                onClick={() => handlePageChange(pageToUse + 1)}
                disabled={pageToUse === totalPages}
                title="Next page"
              >
                ⟩
              </button>
              <button
                className="pagination-btn"
                onClick={() => handlePageChange(totalPages)}
                disabled={pageToUse === totalPages}
                title="Last page"
              >
                ⟩⟩
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default Products