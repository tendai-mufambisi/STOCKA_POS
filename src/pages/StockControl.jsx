import { useState, useEffect, useRef } from 'react'
import { getProducts, getSuppliers, addStockReceiving, recordDirectPurchase, getAllPurchaseHistory } from '../database/db'
import { useAuthStore } from '../store/useAuthStore'
import { FiSearch, FiArrowUp, FiArrowDown, FiPlus, FiX, FiTruck, FiShoppingBag, FiCheck } from 'react-icons/fi'
import './StockControl.css'

// Inline searchable dropdown component used for product and supplier selection
function SearchableSelect({ options, value, onChange, placeholder, disabled }) {
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
              <div className="ss-empty">No results found</div>
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
                  onChange={val => handleFieldChange('product_id', val)}
                  placeholder="Search and select a product..."
                />
              </div>
            </div>

            {/* ── Step 3: Supplier (supplier type only) ── */}
            {purchaseType === 'supplier' && (
              <div className="form-row">
                <div className="form-group">
                  <label>Supplier *</label>
                  <SearchableSelect
                    options={supplierOptions}
                    value={formData.supplier_id}
                    onChange={val => handleFieldChange('supplier_id', val)}
                    placeholder="Search and select a supplier..."
                  />
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
