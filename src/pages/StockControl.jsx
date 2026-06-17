import { useState, useEffect, useRef } from 'react'
import { getProducts, getSuppliers, addProduct, addSupplier, addStockReceiving, recordDirectPurchase, getAllPurchaseHistory, importStockReceivings } from '../database/db'
import { useAuthStore } from '../store/useAuthStore'
import { FiSearch, FiArrowUp, FiArrowDown, FiPlus, FiX, FiTruck, FiShoppingBag, FiCheck, FiUpload } from 'react-icons/fi'
import { utils, writeFile, read } from 'xlsx'
import './StockControl.css'

// Inline searchable dropdown component used for product and supplier selection
function SearchableSelect({ options, value, onChange, placeholder, disabled, onQuickAdd }) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  const selected = options.find(o => String(o.value) === String(value))

  const filtered = options.filter(o =>
    o.label.toLowerCase().includes(query.toLowerCase())
  )

  useEffect(() => {
    const handleClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const handleSelect = (opt) => {
    onChange(opt.value)
    setQuery('')
    setOpen(false)
  }

  const handleClear = (e) => {
    e.stopPropagation()
    onChange('')
    setQuery('')
  }

  return (
    <div ref={ref} className="ss-container">
      <div className={`ss-trigger${disabled ? ' disabled' : ''}`} onClick={() => { if (!disabled) setOpen(o => !o) }}>
        <FiSearch size={14} className="ss-trigger-icon" />
        <span className={`ss-trigger-text${selected ? ' selected' : ''}`}>
          {selected ? selected.label : placeholder}
        </span>
        {selected && !disabled && (
          <FiX size={14} className="ss-clear-icon" onClick={handleClear} />
        )}
      </div>

      {open && (
        <div className="ss-dropdown">
          <div className="ss-search-wrap">
            <input
              autoFocus
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Type to search..."
              className="ss-search-input"
              onClick={e => e.stopPropagation()}
            />
          </div>
          <div className="ss-options">
            {filtered.length === 0 ? (
              <div className="ss-empty">
                <span>No results found</span>
                {onQuickAdd && query.trim() && (
                  <button
                    type="button"
                    className="ss-quick-add-btn"
                    onMouseDown={e => { e.preventDefault(); onQuickAdd(query.trim()); setOpen(false) }}
                  >
                    <FiPlus size={12} /> Add "{query.trim()}"
                  </button>
                )}
              </div>
            ) : (
              filtered.map(opt => (
                <div
                  key={opt.value}
                  onClick={() => handleSelect(opt)}
                  className={`ss-option${String(opt.value) === String(value) ? ' selected' : ''}`}
                >
                  {opt.label}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function StockControl() {
  const [receivings, setReceivings] = useState([])
  const [filteredReceivings, setFilteredReceivings] = useState([])
  const [products, setProducts] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [error, setError] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const { user } = useAuthStore()

  const [purchaseType, setPurchaseType] = useState('supplier')

  const emptyForm = {
    product_id: '',
    supplier_id: '',
    date_received: new Date().toISOString().split('T')[0],
    cartons: '',
    units_per_carton: '',
    cost_per_carton: '',
    quantity: '',
    cost_per_unit: '',
    notes: ''
  }
  const [formData, setFormData] = useState(emptyForm)

  // Quick-add inline form state
  const [quickAddMode, setQuickAddMode] = useState(null) // 'product' | 'supplier' | null
  const [quickAddSaving, setQuickAddSaving] = useState(false)
  const [quickAddError, setQuickAddError] = useState('')
  const [quickProductForm, setQuickProductForm] = useState({ name: '', category: '', unit: 'each', selling_price: '', reorder_level: 5 })
  const [quickSupplierForm, setQuickSupplierForm] = useState({ name: '', contact_person: '', phone: '' })

  const handleOpenQuickAdd = (type, prefillName) => {
    setQuickAddMode(type)
    setQuickAddError('')
    if (type === 'product') setQuickProductForm({ name: prefillName, category: '', unit: 'each', selling_price: '', reorder_level: 5 })
    if (type === 'supplier') setQuickSupplierForm({ name: prefillName, contact_person: '', phone: '' })
  }

  const handleCloseQuickAdd = () => {
    setQuickAddMode(null)
    setQuickAddError('')
  }

  const handleQuickAddSave = async () => {
    setQuickAddError('')
    setQuickAddSaving(true)
    try {
      if (quickAddMode === 'product') {
        if (!quickProductForm.name.trim()) { setQuickAddError('Product name is required'); setQuickAddSaving(false); return }
        await addProduct({ ...quickProductForm, name: quickProductForm.name.trim(), selling_price: parseFloat(quickProductForm.selling_price) || 0 })
        const fresh = await getProducts()
        setProducts(fresh)
        const created = fresh.find(p => p.name.toLowerCase() === quickProductForm.name.trim().toLowerCase())
        if (created) handleFieldChange('product_id', created.id)
      } else {
        if (!quickSupplierForm.name.trim()) { setQuickAddError('Supplier name is required'); setQuickAddSaving(false); return }
        await addSupplier({ ...quickSupplierForm, name: quickSupplierForm.name.trim() })
        const fresh = await getSuppliers()
        setSuppliers(fresh)
        const created = fresh.find(s => s.name.toLowerCase() === quickSupplierForm.name.trim().toLowerCase())
        if (created) handleFieldChange('supplier_id', created.id)
      }
      setQuickAddMode(null)
    } catch (err) {
      setQuickAddError(err.message || 'Failed to save')
    } finally {
      setQuickAddSaving(false)
    }
  }

  // History search/filter state (matches CurrentInventory pattern)
  const [historySearch, setHistorySearch] = useState('')
  const [historyTypeFilter, setHistoryTypeFilter] = useState('all')
  const [historySupplierFilter, setHistorySupplierFilter] = useState('all')
  const [sortConfig, setSortConfig] = useState({ column: 'date', direction: 'desc' })

  useEffect(() => { loadData() }, [])

  useEffect(() => { applyHistoryFilters() }, [receivings, historySearch, historyTypeFilter, historySupplierFilter, sortConfig])

  const loadData = async () => {
    try {
      setLoading(true)
      const [p, s, h] = await Promise.all([getProducts(), getSuppliers(), getAllPurchaseHistory()])
      setProducts(p)
      setSuppliers(s)
      setReceivings(h)
    } catch (err) {
      setError('Failed to load data')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const applyHistoryFilters = () => {
    let data = [...receivings]

    if (historySearch.trim()) {
      const q = historySearch.toLowerCase()
      data = data.filter(r =>
        (r.product_name || '').toLowerCase().includes(q) ||
        (r.supplier_name || '').toLowerCase().includes(q)
      )
    }

    if (historyTypeFilter !== 'all') {
      data = data.filter(r => r.purchase_type === historyTypeFilter)
    }

    if (historySupplierFilter !== 'all') {
      data = data.filter(r => String(r.supplier_name) === historySupplierFilter)
    }

    data.sort((a, b) => {
      let av, bv
      switch (sortConfig.column) {
        case 'date':     av = a.date_received; bv = b.date_received; break
        case 'product':  av = (a.product_name || '').toLowerCase(); bv = (b.product_name || '').toLowerCase(); break
        case 'source':   av = (a.supplier_name || '').toLowerCase(); bv = (b.supplier_name || '').toLowerCase(); break
        case 'units':    av = a.total_units || 0; bv = b.total_units || 0; break
        case 'value':    av = a.total_value || 0; bv = b.total_value || 0; break
        default:         av = a.date_received; bv = b.date_received
      }
      if (av < bv) return sortConfig.direction === 'asc' ? -1 : 1
      if (av > bv) return sortConfig.direction === 'asc' ? 1 : -1
      return 0
    })

    setFilteredReceivings(data)
  }

  const handleSort = (column) => {
    setSortConfig(prev => ({
      column,
      direction: prev.column === column && prev.direction === 'asc' ? 'desc' : 'asc'
    }))
  }

  const SortIcon = ({ column }) => {
    if (sortConfig.column !== column) return null
    return sortConfig.direction === 'asc'
      ? <FiArrowUp size={13} className="sort-icon" />
      : <FiArrowDown size={13} className="sort-icon" />
  }

  // Computed values for both form types
  const directQty = parseInt(formData.quantity) || 0
  const directCpu = parseFloat(formData.cost_per_unit) || 0
  const directTotalValue = directQty * directCpu

  const handleFieldChange = (name, value) => {
    setFormData(prev => ({ ...prev, [name]: value }))
  }

  const handleTypeChange = (type) => {
    setPurchaseType(type)
    setFormData(emptyForm)
    setError('')
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setSuccessMessage('')

    if (!formData.product_id) { setError('Please select a product'); return }

    try {
      if (purchaseType === 'supplier') {
        if (!formData.supplier_id) { setError('Please select a supplier'); return }
        if (!formData.quantity || directQty <= 0) { setError('Enter a valid quantity'); return }

        await addStockReceiving({
          supplier_id: parseInt(formData.supplier_id),
          product_id: parseInt(formData.product_id),
          date_received: formData.date_received,
          cartons: 0,
          units_per_carton: 0,
          total_units: directQty,
          cost_per_carton: 0,
          cost_per_unit: directCpu,
          total_value: directTotalValue,
          recorded_by: user?.username || 'System'
        })

        setSuccessMessage('Stock received and inventory updated!')
      } else {
        if (!formData.quantity || directQty <= 0) { setError('Enter a valid quantity'); return }

        await recordDirectPurchase({
          product_id: parseInt(formData.product_id),
          quantity: directQty,
          cost_per_unit: directCpu,
          date_received: formData.date_received,
          notes: formData.notes,
          recorded_by: user?.username || 'System'
        })

        const productName = products.find(p => p.id === parseInt(formData.product_id))?.name || ''
        setSuccessMessage(`${directQty} units of "${productName}" added to stock!`)
      }

      setTimeout(() => setSuccessMessage(''), 4000)
      setFormData(emptyForm)
      setPurchaseType('supplier')
      setShowForm(false)
      await loadData()
    } catch (err) {
      setError(`Failed to record: ${err.message || err}`)
      console.error(err)
    }
  }

  // ── Import state ──
  const [showImportModal, setShowImportModal]   = useState(false)
  const [importPreview, setImportPreview]       = useState({ valid: [], skipped: 0 })
  const [importError, setImportError]           = useState('')
  const [importing, setImporting]               = useState(false)
  const importFileRef                           = useRef(null)

  const normalizeImportHeader = (h) => {
    const s = String(h).toLowerCase().replace(/[\s_\-/]+/g, '')
    if (['productname', 'product', 'item', 'itemname'].includes(s))   return 'product_name'
    if (['purchasetype', 'type', 'source'].includes(s))                return 'purchase_type'
    if (['suppliername', 'supplier', 'vendor'].includes(s))            return 'supplier_name'
    if (['datereceived', 'date', 'receiveddate'].includes(s))          return 'date_received'
    if (['quantity', 'qty', 'units', 'totalunits'].includes(s))        return 'quantity'
    if (['costperunit', 'costunit', 'unitcost', 'cpu', 'cost'].includes(s)) return 'cost_per_unit'
    if (['notes', 'note', 'description', 'remarks'].includes(s))       return 'notes'
    return null
  }

  const downloadImportTemplate = () => {
    const templateData = [
      { 'Product Name': 'Bread', 'Purchase Type': 'supplier', 'Supplier Name': 'Fresh Bakers Ltd', 'Date Received': '2026-06-17', Quantity: 48, 'Cost Per Unit': 0.80, Notes: '' },
      { 'Product Name': 'Cooking Oil 2L', 'Purchase Type': 'supplier', 'Supplier Name': 'Fresh Bakers Ltd', 'Date Received': '2026-06-17', Quantity: 24, 'Cost Per Unit': 3.20, Notes: '' },
      { 'Product Name': 'Salt 1kg', 'Purchase Type': 'direct', 'Supplier Name': '', 'Date Received': '2026-06-17', Quantity: 10, 'Cost Per Unit': 0.50, Notes: 'Cash purchase at market' },
    ]
    const ws = utils.json_to_sheet(templateData)
    const wb = utils.book_new()
    utils.book_append_sheet(wb, ws, 'Stock Receivings')
    writeFile(wb, 'stock_receiving_import_template.xlsx')
  }

  const handleImportFile = (e) => {
    const file = e.target.files[0]
    if (!file) return
    e.target.value = ''
    const reader = new FileReader()
    reader.onload = (evt) => {
      try {
        const wb  = read(evt.target.result, { type: 'array' })
        const ws  = wb.Sheets[wb.SheetNames[0]]
        const raw = utils.sheet_to_json(ws, { defval: '' })
        if (raw.length === 0) {
          setImportError('The spreadsheet appears to be empty.')
          setShowImportModal(true)
          return
        }
        const normalized = raw.map(row => {
          const out = {}
          for (const [key, val] of Object.entries(row)) {
            const mapped = normalizeImportHeader(key)
            if (mapped) out[mapped] = val
          }
          return out
        })
        if (!normalized.some(r => r.product_name !== undefined)) {
          setImportError('Could not find a "Product Name" column. Please use the template.')
          setShowImportModal(true)
          return
        }
        const valid = []
        let skipped = 0
        for (const row of normalized) {
          const name = String(row.product_name ?? '').trim()
          if (!name) { skipped++; continue }
          const qty  = parseInt(row.quantity) || 0
          if (qty <= 0) { skipped++; continue }
          const type = String(row.purchase_type ?? 'supplier').toLowerCase().trim() === 'direct' ? 'direct' : 'supplier'
          valid.push({
            product_name:  name,
            purchase_type: type,
            supplier_name: String(row.supplier_name ?? '').trim(),
            date_received: String(row.date_received ?? '').trim() || new Date().toISOString().split('T')[0],
            quantity:      qty,
            cost_per_unit: parseFloat(row.cost_per_unit) || 0,
            notes:         String(row.notes ?? '').trim(),
          })
        }
        setImportPreview({ valid, skipped })
        setImportError('')
        setShowImportModal(true)
      } catch {
        setImportError('Failed to read the file. Make sure it is a valid Excel (.xlsx) file.')
        setShowImportModal(true)
      }
    }
    reader.readAsArrayBuffer(file)
  }

  const handleConfirmImport = async () => {
    if (importPreview.valid.length === 0) return
    setImporting(true)
    try {
      const result = await importStockReceivings(importPreview.valid, user?.username || 'Import')
      setShowImportModal(false)
      setImportPreview({ valid: [], skipped: 0 })
      const parts = [`${result.inserted} receiving${result.inserted !== 1 ? 's' : ''} imported`]
      if (result.created_products)  parts.push(`${result.created_products} new product${result.created_products !== 1 ? 's' : ''} created`)
      if (result.created_suppliers) parts.push(`${result.created_suppliers} new supplier${result.created_suppliers !== 1 ? 's' : ''} created`)
      setSuccessMessage(parts.join(' · '))
      setTimeout(() => setSuccessMessage(''), 5000)
      await loadData()
    } catch (err) {
      setImportError('Import failed: ' + err.message)
    } finally {
      setImporting(false)
    }
  }

  const productOptions = products.map(p => ({ value: p.id, label: `${p.name}${p.current_quantity != null ? ` (${p.current_quantity} in stock)` : ''}` }))
  const supplierOptions = suppliers.map(s => ({ value: s.id, label: s.name }))
  const uniqueSuppliers = [...new Set(receivings.map(r => r.supplier_name).filter(Boolean))]

  if (loading) return <div className="stock-control-page"><div className="loading">Loading...</div></div>

  return (
    <div className="stock-control-page">
      {error && <div className="error-banner">{error}</div>}
      {successMessage && <div className="success-banner">{successMessage}</div>}

      <div className="toolbar">
        <button className="btn btn-primary" onClick={() => { setShowForm(s => !s); setError(''); setFormData(emptyForm) }}>
          {showForm ? <><FiX size={16} />Cancel</> : <><FiPlus size={16} />Record Stock</>}
        </button>
        <button className="btn btn-secondary" onClick={() => importFileRef.current.click()}>
          <FiUpload size={15} /> Import Sheet
        </button>
        <input
          ref={importFileRef}
          type="file"
          accept=".xlsx"
          style={{ display: 'none' }}
          onChange={handleImportFile}
        />
      </div>

      {showForm && (
        <div className="form-card">
          <h3>Record Stock</h3>
          <form onSubmit={handleSubmit}>

            {/* ── Step 1: Purchase Type ── */}
            <div className="form-row">
              <div className="form-group">
                <label>Purchase Type *</label>
                <div className="form-actions">
                  {['supplier', 'direct'].map(type => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => handleTypeChange(type)}
                      className={`purchase-type-btn ${purchaseType === type ? 'active' : ''}`}
                    >
                      {type === 'supplier' ? <><FiTruck size={15} /> From Supplier</> : <><FiShoppingBag size={15} /> Direct Purchase</>}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* ── Step 2: Product (both types) ── */}
            <div className="form-row">
              <div className="form-group">
                <label>Product *</label>
                <SearchableSelect
                  options={productOptions}
                  value={formData.product_id}
                  onChange={val => { handleFieldChange('product_id', val); handleCloseQuickAdd() }}
                  placeholder="Search and select a product..."
                  onQuickAdd={name => handleOpenQuickAdd('product', name)}
                />
              </div>
            </div>

            {quickAddMode === 'product' && (
              <div className="quick-add-form">
                <div className="quick-add-header">
                  <FiPlus size={13} /> New Product
                  <button type="button" className="btn-icon" onClick={handleCloseQuickAdd}><FiX size={13} /></button>
                </div>
                {quickAddError && <div className="error-banner">{quickAddError}</div>}
                <div className="form-row">
                  <div className="form-group">
                    <label>Name *</label>
                    <input type="text" value={quickProductForm.name} onChange={e => setQuickProductForm(p => ({ ...p, name: e.target.value }))} placeholder="Product name" autoFocus />
                  </div>
                  <div className="form-group">
                    <label>Category</label>
                    <select value={quickProductForm.category} onChange={e => setQuickProductForm(p => ({ ...p, category: e.target.value }))}>
                      <option value="">Select category</option>
                      {['Food', 'Non-Food', 'Drinks', 'Other'].map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label>Unit</label>
                    <select value={quickProductForm.unit} onChange={e => setQuickProductForm(p => ({ ...p, unit: e.target.value }))}>
                      <option value="each">each</option>
                      <option value="pack">pack</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Selling Price (USD)</label>
                    <input type="number" value={quickProductForm.selling_price} onChange={e => setQuickProductForm(p => ({ ...p, selling_price: e.target.value }))} placeholder="0.00" step="any" min="0" />
                  </div>
                  <div className="form-group">
                    <label>Reorder Level</label>
                    <input type="number" value={quickProductForm.reorder_level} onChange={e => setQuickProductForm(p => ({ ...p, reorder_level: parseInt(e.target.value) || 0 }))} min="0" />
                  </div>
                </div>
                <div className="quick-add-actions">
                  <button type="button" className="btn btn-secondary" onClick={handleCloseQuickAdd} disabled={quickAddSaving}>Cancel</button>
                  <button type="button" className="btn btn-primary" onClick={handleQuickAddSave} disabled={quickAddSaving}>
                    {quickAddSaving ? 'Saving…' : 'Save & Select Product'}
                  </button>
                </div>
              </div>
            )}

            {/* ── Step 3: Supplier (supplier type only) ── */}
            {purchaseType === 'supplier' && (
              <div className="form-row">
                <div className="form-group">
                  <label>Supplier *</label>
                  <SearchableSelect
                    options={supplierOptions}
                    value={formData.supplier_id}
                    onChange={val => { handleFieldChange('supplier_id', val); handleCloseQuickAdd() }}
                    placeholder="Search and select a supplier..."
                    onQuickAdd={name => handleOpenQuickAdd('supplier', name)}
                  />
                </div>
              </div>
            )}

            {purchaseType === 'supplier' && quickAddMode === 'supplier' && (
              <div className="quick-add-form">
                <div className="quick-add-header">
                  <FiPlus size={13} /> New Supplier
                  <button type="button" className="btn-icon" onClick={handleCloseQuickAdd}><FiX size={13} /></button>
                </div>
                {quickAddError && <div className="error-banner">{quickAddError}</div>}
                <div className="form-row">
                  <div className="form-group">
                    <label>Name *</label>
                    <input type="text" value={quickSupplierForm.name} onChange={e => setQuickSupplierForm(p => ({ ...p, name: e.target.value }))} placeholder="Supplier name" autoFocus />
                  </div>
                  <div className="form-group">
                    <label>Contact Person</label>
                    <input type="text" value={quickSupplierForm.contact_person} onChange={e => setQuickSupplierForm(p => ({ ...p, contact_person: e.target.value }))} placeholder="e.g. John Moyo" />
                  </div>
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label>Phone</label>
                    <input type="text" value={quickSupplierForm.phone} onChange={e => setQuickSupplierForm(p => ({ ...p, phone: e.target.value }))} placeholder="e.g. 0771234567" />
                  </div>
                </div>
                <div className="quick-add-actions">
                  <button type="button" className="btn btn-secondary" onClick={handleCloseQuickAdd} disabled={quickAddSaving}>Cancel</button>
                  <button type="button" className="btn btn-primary" onClick={handleQuickAddSave} disabled={quickAddSaving}>
                    {quickAddSaving ? 'Saving…' : 'Save & Select Supplier'}
                  </button>
                </div>
              </div>
            )}

            {/* ── Step 4: Date Received (both types) ── */}
            <div className="form-row">
              <div className="form-group">
                <label>Date Received *</label>
                <input
                  type="date"
                  value={formData.date_received}
                  onChange={e => handleFieldChange('date_received', e.target.value)}
                  required
                />
              </div>
            </div>

            {/* ── Supplier Purchase: quantity fields ── */}
            {purchaseType === 'supplier' && (
              <>
                <div className="form-row">
                  <div className="form-group">
                    <label>Quantity to Add *</label>
                    <input
                      type="number"
                      value={formData.quantity}
                      onChange={e => handleFieldChange('quantity', e.target.value)}
                      placeholder="e.g. 24"
                      min="1"
                      step="1"
                    />
                    <p className="field-hint">Total individual units being added to stock</p>
                  </div>
                  <div className="form-group">
                    <label>Cost per Unit (USD)</label>
                    <input
                      type="number"
                      value={formData.cost_per_unit}
                      onChange={e => handleFieldChange('cost_per_unit', e.target.value)}
                      placeholder="0.00"
                      step="any"
                      min="0"
                    />
                    <p className="field-hint">What you paid per individual unit</p>
                  </div>
                </div>

                {directQty > 0 && (
                  <div className="calculations-panel">
                    <div className="calc-row">
                      <div className="calc-item">
                        <span className="calc-label">Total Units to Add:</span>
                        <span className="calc-value">{directQty}</span>
                      </div>
                      <div className="calc-item">
                        <span className="calc-label">Total Cost:</span>
                        <span className="calc-value">${directTotalValue.toFixed(2)}</span>
                      </div>
                    </div>
                    <p className="calc-note">Selling price is managed separately in the Products section</p>
                  </div>
                )}
              </>
            )}

            {/* ── Direct Purchase: quantity fields ── */}
            {purchaseType === 'direct' && (
              <>
                <div className="form-row">
                  <div className="form-group">
                    <label>Quantity to Add *</label>
                    <input
                      type="number"
                      value={formData.quantity}
                      onChange={e => handleFieldChange('quantity', e.target.value)}
                      placeholder="e.g. 24"
                      min="1"
                      step="1"
                    />
                    <p className="field-hint">Total individual units being added to stock</p>
                  </div>
                  <div className="form-group">
                    <label>Cost per Unit (USD)</label>
                    <input
                      type="number"
                      value={formData.cost_per_unit}
                      onChange={e => handleFieldChange('cost_per_unit', e.target.value)}
                      placeholder="0.00"
                      step="any"
                      min="0"
                    />
                    <p className="field-hint">What you paid per individual unit</p>
                  </div>
                </div>

                {directQty > 0 && (
                  <div className="calculations-panel">
                    <div className="calc-row">
                      <div className="calc-item">
                        <span className="calc-label">Total Units to Add:</span>
                        <span className="calc-value">{directQty}</span>
                      </div>
                      <div className="calc-item">
                        <span className="calc-label">Total Cost:</span>
                        <span className="calc-value">${directTotalValue.toFixed(2)}</span>
                      </div>
                    </div>
                    <p className="calc-note">Selling price is managed separately in the Products section</p>
                  </div>
                )}

                <div className="form-row">
                  <div className="form-group">
                    <label>Notes</label>
                    <textarea
                      value={formData.notes}
                      onChange={e => handleFieldChange('notes', e.target.value)}
                      placeholder="e.g. Personal purchase, donation, inter-branch transfer..."
                      rows="2"
                      />
                  </div>
                </div>
              </>
            )}

            <div className="form-actions">
              <button type="submit" className="btn btn-primary">
                {purchaseType === 'supplier' ? <><FiCheck size={14} /> Record Stock Receiving</> : <><FiCheck size={14} /> Confirm Direct Purchase</>}
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => { setShowForm(false); setFormData(emptyForm); setError('') }}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ── Import Modal ── */}
      {showImportModal && (
        <div className="form-overlay" onClick={() => !importing && setShowImportModal(false)}>
          <div className="product-form import-modal" onClick={e => e.stopPropagation()}>
            <div className="form-header">
              <h2>Import Stock Receivings</h2>
              <button className="close-btn" onClick={() => !importing && setShowImportModal(false)}><FiX size={14} /></button>
            </div>

            {importError ? (
              <>
                <div className="error-banner">{importError}</div>
                <p className="import-template-hint">
                  Download the <button className="link-btn" onClick={downloadImportTemplate}>template file</button> to see the required column format.
                </p>
              </>
            ) : (
              <>
                <div className="import-summary">
                  <p className="import-count-valid">✓ <strong>{importPreview.valid.length}</strong> row{importPreview.valid.length !== 1 ? 's' : ''} ready to import</p>
                  {importPreview.skipped > 0 && (
                    <p className="import-count-skipped">✗ {importPreview.skipped} row{importPreview.skipped !== 1 ? 's' : ''} skipped — missing product name or zero quantity</p>
                  )}
                </div>

                {importPreview.valid.length > 0 && (
                  <div className="import-preview-table">
                    <table>
                      <thead>
                        <tr>
                          <th>Product</th>
                          <th>Type</th>
                          <th>Supplier</th>
                          <th>Date</th>
                          <th>Qty</th>
                          <th>Cost/Unit</th>
                        </tr>
                      </thead>
                      <tbody>
                        {importPreview.valid.slice(0, 8).map((row, i) => (
                          <tr key={i}>
                            <td>{row.product_name}</td>
                            <td><span className={`type-badge ${row.purchase_type}`}>{row.purchase_type === 'supplier' ? 'Supplier' : 'Direct'}</span></td>
                            <td>{row.supplier_name || '—'}</td>
                            <td>{row.date_received}</td>
                            <td>{row.quantity}</td>
                            <td>${row.cost_per_unit.toFixed(2)}</td>
                          </tr>
                        ))}
                        {importPreview.valid.length > 8 && (
                          <tr className="import-more-row">
                            <td colSpan="6">… and {importPreview.valid.length - 8} more rows</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
                <p className="import-template-hint">New products and suppliers in the sheet will be created automatically.</p>
              </>
            )}

            <div className="form-actions import-modal-actions">
              <button className="link-btn" onClick={downloadImportTemplate} disabled={importing}>
                ⇩ Download Template
              </button>
              <div className="modal-btn-row">
                <button className="btn btn-secondary" onClick={() => setShowImportModal(false)} disabled={importing}>Cancel</button>
                {!importError && importPreview.valid.length > 0 && (
                  <button className="btn btn-primary" onClick={handleConfirmImport} disabled={importing}>
                    {importing ? 'Importing…' : `Import ${importPreview.valid.length} Row${importPreview.valid.length !== 1 ? 's' : ''}`}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Purchase History Table ── */}
      <div className="receivings-list">
        <div className="receivings-list-header">
          <h3>Purchase History ({filteredReceivings.length} of {receivings.length})</h3>
        </div>

        {/* Search & Filter Bar */}
        <div className="history-search-bar">
          <div className="history-search-input-wrap">
            <FiSearch size={14} />
            <input
              type="text"
              value={historySearch}
              onChange={e => setHistorySearch(e.target.value)}
              placeholder="Search by product or supplier..."
            />
            {historySearch && (
              <FiX size={13} className="icon-btn" onClick={() => setHistorySearch('')} />
            )}
          </div>

          <select
            value={historyTypeFilter}
            onChange={e => setHistoryTypeFilter(e.target.value)}
            className="history-filter-select"
          >
            <option value="all">All Types</option>
            <option value="supplier">Supplier</option>
            <option value="direct">Direct</option>
          </select>

          {uniqueSuppliers.length > 0 && (
            <select
              value={historySupplierFilter}
              onChange={e => setHistorySupplierFilter(e.target.value)}
              className="history-filter-select"
            >
              <option value="all">All Suppliers</option>
              {uniqueSuppliers.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          )}

          {(historySearch || historyTypeFilter !== 'all' || historySupplierFilter !== 'all') && (
            <button
              onClick={() => { setHistorySearch(''); setHistoryTypeFilter('all'); setHistorySupplierFilter('all') }}
              className="history-clear-btn"
            >
              Clear Filters
            </button>
          )}
        </div>

        {filteredReceivings.length === 0 ? (
          <div className="empty-state">
            <p>{receivings.length === 0 ? 'No purchases recorded yet.' : 'No records match your filters.'}</p>
          </div>
        ) : (
          <div className="receivings-table">
            <table>
              <thead>
                <tr>
                  <th onClick={() => handleSort('date')} className="th-sort th-nowrap">
                    Date <SortIcon column="date" />
                  </th>
                  <th onClick={() => handleSort('product')} className="th-sort">
                    Product <SortIcon column="product" />
                  </th>
                  <th onClick={() => handleSort('source')} className="th-sort">
                    Source <SortIcon column="source" />
                  </th>
                  <th>Type</th>
                  <th onClick={() => handleSort('units')} className="th-sort th-nowrap">
                    Quantity <SortIcon column="units" />
                  </th>
                  <th className="th-nowrap">Cost/Unit</th>
                  <th onClick={() => handleSort('value')} className="th-sort th-nowrap">
                    Total Value <SortIcon column="value" />
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredReceivings.map(r => (
                  <tr key={r.id}>
                    <td>{new Date(r.date_received).toLocaleDateString('en-ZW')}</td>
                    <td>{r.product_name}</td>
                    <td>{r.supplier_name || '—'}</td>
                    <td>
                      <span className={`type-badge ${r.purchase_type === 'supplier' ? 'supplier' : 'direct'}`}>
                        {r.purchase_type === 'supplier' ? 'Supplier' : 'Direct'}
                      </span>
                    </td>
                    <td>{r.total_units} units</td>
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
