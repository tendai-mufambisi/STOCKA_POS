import { useState, useEffect, useRef } from 'react'
import { FiPackage, FiEdit2, FiTrash2, FiDownload, FiUpload, FiPlus, FiX, FiGrid, FiList, FiImage } from 'react-icons/fi'
import { getProducts, addProduct, updateProduct, deleteProduct, getSuppliers, getLatestProductPrice, getLowStockItems, getShop, updateProductQuantity, addProductsBatch } from '../database/db'
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
  const [importPreview, setImportPreview] = useState({ fresh: [], duplicates: [], skipped: 0 })
  const [duplicateResolutions, setDuplicateResolutions] = useState({})
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
    setShowForm(false)
    setError('')
  }

  const handleCancelEdit = () => {
    setEditingId(null)
    setFormData({ name: '', category: '', supplier_id: '', unit: 'each', selling_price: '', reorder_level: defaultReorderLevel, description: '', image_data: null })
    setError('')
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
        const parsed = []
        let skipped = 0
        for (const row of normalized) {
          const name = String(row.name ?? '').trim()
          if (!name) { skipped++; continue }
          const rawUnit = String(row.unit ?? '').toLowerCase().trim()
          parsed.push({
            name,
            category:         String(row.category ?? '').trim(),
            unit:             ['each', 'pack'].includes(rawUnit) ? rawUnit : 'each',
            selling_price:    parseFloat(row.selling_price) || 0,
            reorder_level:    parseInt(row.reorder_level) || 5,
            current_quantity: parseInt(row.current_quantity) || 0,
            description:      String(row.description ?? '').trim(),
            supplier:         String(row.supplier ?? '').trim(),
          })
        }
        // Split into fresh (new) and duplicates (name already exists)
        const fresh = [], duplicates = []
        for (const row of parsed) {
          const existing = products.find(p => p.name.toLowerCase() === row.name.toLowerCase())
          if (existing) duplicates.push({ incoming: row, existing })
          else fresh.push(row)
        }
        // Default all duplicates to 'skip'
        const resolutions = {}
        duplicates.forEach((_, i) => { resolutions[i] = { action: 'skip', useImported: {} } })
        setImportPreview({ fresh, duplicates, skipped })
        setDuplicateResolutions(resolutions)
        setImportError('')
        setShowImportModal(true)
      } catch {
        setImportError('Failed to read the file. Please make sure it is a valid Excel (.xlsx) file.')
        setShowImportModal(true)
      }
    }
    reader.readAsArrayBuffer(file)
  }

  const getDiffFields = (dup) => {
    const ex = dup.existing
    const inc = dup.incoming
    const exSupplier = suppliers.find(s => s.id === ex.supplier_id)?.name || ''
    return [
      { field: 'selling_price',    label: 'Selling Price',  current: `$${(ex.selling_price || 0).toFixed(2)}`,    imported: `$${(inc.selling_price || 0).toFixed(2)}`,    diff: ex.selling_price !== inc.selling_price },
      { field: 'category',         label: 'Category',       current: ex.category || '—',                          imported: inc.category || '—',                          diff: (ex.category || '') !== (inc.category || '') },
      { field: 'unit',             label: 'Unit',           current: ex.unit || 'each',                           imported: inc.unit || 'each',                           diff: (ex.unit || 'each') !== (inc.unit || 'each') },
      { field: 'reorder_level',    label: 'Reorder Level',  current: String(ex.reorder_level ?? 5),               imported: String(inc.reorder_level ?? 5),               diff: (ex.reorder_level ?? 5) !== (inc.reorder_level ?? 5) },
      { field: 'current_quantity', label: 'Quantity',       current: String(ex.current_quantity ?? 0),            imported: String(inc.current_quantity ?? 0),            diff: (ex.current_quantity ?? 0) !== (inc.current_quantity ?? 0) },
      { field: 'description',      label: 'Description',    current: ex.description || '—',                       imported: inc.description || '—',                       diff: (ex.description || '') !== (inc.description || '') },
      { field: 'supplier',         label: 'Supplier',       current: exSupplier || '—',                           imported: inc.supplier || '—',                          diff: exSupplier.toLowerCase() !== (inc.supplier || '').toLowerCase() },
    ].filter(f => f.diff)
  }

  const setResAction = (i, action) => {
    setDuplicateResolutions(prev => {
      const useImported = {}
      if (action === 'update') {
        getDiffFields(importPreview.duplicates[i]).forEach(f => { useImported[f.field] = true })
      }
      return { ...prev, [i]: { action, useImported } }
    })
  }

  const setResField = (i, field, checked) => {
    setDuplicateResolutions(prev => ({
      ...prev,
      [i]: { ...prev[i], useImported: { ...prev[i].useImported, [field]: checked } }
    }))
  }

  const handleConfirmImport = async () => {
    const toUpdateDups = importPreview.duplicates.filter((_, i) => duplicateResolutions[i]?.action === 'update')
    if (importPreview.fresh.length === 0 && toUpdateDups.length === 0) { setShowImportModal(false); return }
    setImporting(true)
    try {
      if (importPreview.fresh.length > 0) {
        await addProductsBatch(importPreview.fresh)
      }
      for (let i = 0; i < importPreview.duplicates.length; i++) {
        const res = duplicateResolutions[i]
        if (res?.action !== 'update') continue
        const dup = importPreview.duplicates[i]
        const ui  = res.useImported || {}
        const ex  = dup.existing
        const inc = dup.incoming
        const resolvedSupplierId = ui.supplier === true
          ? (suppliers.find(s => s.name.toLowerCase() === (inc.supplier || '').toLowerCase())?.id ?? ex.supplier_id)
          : ex.supplier_id
        await updateProduct(ex.id, {
          name:          ex.name,
          category:      ui.category      === true ? (inc.category || '')   : (ex.category || ''),
          unit:          ui.unit          === true ? (inc.unit || 'each')   : (ex.unit || 'each'),
          selling_price: ui.selling_price === true ? inc.selling_price      : ex.selling_price,
          reorder_level: ui.reorder_level === true ? inc.reorder_level      : ex.reorder_level,
          description:   ui.description   === true ? (inc.description || '') : (ex.description || ''),
          supplier_id:   resolvedSupplierId,
          image_data:    ex.image_data || null,
        })
        if (ui.current_quantity === true) {
          await updateProductQuantity(ex.id, inc.current_quantity)
        }
      }
      setShowImportModal(false)
      setImportPreview({ fresh: [], duplicates: [], skipped: 0 })
      setDuplicateResolutions({})
      await loadData()
    } catch (err) {
      setImportError('Import failed: ' + err.message)
    } finally {
      setImporting(false)
    }
  }

  const renderInlineEditForm = (product) => (
    <div key={product.id} className="product-inline-edit">
      <div className="inline-edit-header">
        <span><FiEdit2 size={13} /> Editing: <strong>{product.name}</strong></span>
        <button type="button" className="btn-icon" onClick={handleCancelEdit} title="Cancel edit"><FiX size={14} /></button>
      </div>
      {error && <div className="error-banner">{error}</div>}
      <form onSubmit={handleSubmit}>
        <div className="form-row">
          <div className="form-group">
            <label>Product Name *</label>
            <input type="text" name="name" value={formData.name} onChange={handleChange} placeholder="Enter product name" />
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
          <div className="form-group">
            <label>Selling Price (USD) *</label>
            <input type="number" name="selling_price" value={formData.selling_price} onChange={handleChange} placeholder="0.00" step="any" min="0" required />
          </div>
          <div className="form-group">
            <label>Reorder Level</label>
            <input type="number" name="reorder_level" value={formData.reorder_level} onChange={handleChange} min="0" />
          </div>
        </div>
        <div className="form-group">
          <label>Description</label>
          <textarea name="description" value={formData.description} onChange={handleChange} placeholder="Product description" rows="2" />
        </div>
        <div className="inline-edit-actions">
          <button type="button" className="btn btn-secondary" onClick={handleCancelEdit}>Cancel</button>
          <button type="submit" className="btn btn-primary">Save Changes</button>
        </div>
      </form>
    </div>
  )

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

      {showImportModal && (() => {
        const toUpdateCount = importPreview.duplicates.filter((_, i) => duplicateResolutions[i]?.action === 'update').length
        const totalActions  = importPreview.fresh.length + toUpdateCount
        return (
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
                <div className="import-scroll-body">
                  <div className="import-summary">
                    {importPreview.fresh.length > 0 && (
                      <p className="import-count-valid">✓ <strong>{importPreview.fresh.length}</strong> new product{importPreview.fresh.length !== 1 ? 's' : ''} to add</p>
                    )}
                    {importPreview.duplicates.length > 0 && (
                      <p className="import-count-dup">⚠ <strong>{importPreview.duplicates.length}</strong> product{importPreview.duplicates.length !== 1 ? 's' : ''} already exist — review below</p>
                    )}
                    {importPreview.skipped > 0 && (
                      <p className="import-count-skipped">✗ {importPreview.skipped} row{importPreview.skipped !== 1 ? 's' : ''} skipped — missing product name</p>
                    )}
                    {importPreview.fresh.length === 0 && importPreview.duplicates.length === 0 && (
                      <p className="import-count-skipped">No valid rows found in the spreadsheet.</p>
                    )}
                  </div>

                  {importPreview.fresh.length > 0 && (
                    <div className="import-preview-table">
                      <table>
                        <thead>
                          <tr>
                            <th>Name</th><th>Category</th><th>Unit</th><th>Price</th><th>Qty</th>
                          </tr>
                        </thead>
                        <tbody>
                          {importPreview.fresh.slice(0, 6).map((row, i) => (
                            <tr key={i}>
                              <td>{row.name}</td>
                              <td>{row.category || '—'}</td>
                              <td>{row.unit}</td>
                              <td>${row.selling_price.toFixed(2)}</td>
                              <td>{row.current_quantity}</td>
                            </tr>
                          ))}
                          {importPreview.fresh.length > 6 && (
                            <tr className="import-more-row">
                              <td colSpan="5">… and {importPreview.fresh.length - 6} more new products</td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {importPreview.duplicates.length > 0 && (
                    <div className="dup-section">
                      <p className="dup-section-title">Existing Products — choose what to do with each:</p>
                      {importPreview.duplicates.map((dup, i) => {
                        const res        = duplicateResolutions[i] || { action: 'skip', useImported: {} }
                        const diffFields = getDiffFields(dup)
                        return (
                          <div key={i} className={`dup-item ${res.action === 'update' ? 'updating' : ''}`}>
                            <div className="dup-header">
                              <span className="dup-name">{dup.existing.name}</span>
                              <div className="dup-action-group">
                                <button type="button" className={`dup-action-btn ${res.action === 'skip' ? 'active-skip' : ''}`} onClick={() => setResAction(i, 'skip')}>Skip</button>
                                <button type="button" className={`dup-action-btn ${res.action === 'update' ? 'active-update' : ''}`} onClick={() => setResAction(i, 'update')}>Update</button>
                              </div>
                            </div>

                            {res.action === 'update' && diffFields.length === 0 && (
                              <p className="dup-no-diff">All fields already match — no changes will be made.</p>
                            )}

                            {res.action === 'update' && diffFields.length > 0 && (
                              <div className="dup-fields">
                                <table>
                                  <thead>
                                    <tr>
                                      <th>Field</th>
                                      <th>Current</th>
                                      <th>Imported</th>
                                      <th>Use imported</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {diffFields.map(f => (
                                      <tr key={f.field}>
                                        <td className="dup-field-label">{f.label}</td>
                                        <td className="dup-val-current">{f.current}</td>
                                        <td className="dup-val-imported">{f.imported}</td>
                                        <td>
                                          <input
                                            type="checkbox"
                                            checked={res.useImported[f.field] === true}
                                            onChange={e => setResField(i, f.field, e.target.checked)}
                                          />
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}

              <div className="form-actions import-modal-actions">
                <button className="link-btn" onClick={downloadTemplate} disabled={importing}>
                  ⇩ Download Template
                </button>
                <div className="modal-btn-row">
                  <button className="btn btn-secondary" onClick={() => setShowImportModal(false)} disabled={importing}>Cancel</button>
                  {!importError && (importPreview.fresh.length > 0 || importPreview.duplicates.length > 0) && (
                    <button className="btn btn-primary" onClick={handleConfirmImport} disabled={importing || totalActions === 0}>
                      {importing ? 'Importing…' : totalActions === 0 ? 'Nothing to import' : `Import ${totalActions} Product${totalActions !== 1 ? 's' : ''}`}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )
      })()}

      {showForm && !editingId && (
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
                if (editingId === product.id) return renderInlineEditForm(product)
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

              if (editingId === product.id) return renderInlineEditForm(product)
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