import { useState, useEffect, useRef } from 'react'
import { getProducts, getSuppliers, addProduct, addSupplier, addStockReceiving, recordDirectPurchase, getAllPurchaseHistory, importStockReceivings, getLatestProductPrice, updateProduct, correctStockReceiving } from '../database/db'
import { useAuthStore } from '../store/useAuthStore'
// stock_receivings.date_received is a LOCAL calendar day — same reasoning as
// expenses.date. See analytics/kernel/time.js receivingDayExpr.
import { localDateStr } from '../utils/salesDay'
import { useLanSync } from '../hooks/useLanSync'
import { FiSearch, FiArrowUp, FiArrowDown, FiPlus, FiX, FiTruck, FiShoppingBag, FiCheck, FiUpload, FiEdit3, FiClock, FiWifiOff } from 'react-icons/fi'
import { utils, writeFile, read } from 'xlsx'
import Modal from '../components/Modal'
import Field from '../components/Field'
import Stepper from '../components/Stepper'
import { toast } from '../store/useToastStore'
import './StockControl.css'

// Inline searchable dropdown component used for product and supplier selection
function SearchableSelect({ options, value, onChange, placeholder, disabled, onQuickAdd, addLabel = 'Add new' }) {
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

  // Inside a dialog the list can open below the visible area — the supplier picker
  // sits near the bottom of Record Stock. Scroll it into view when it opens.
  useEffect(() => {
    if (!open) return
    const id = requestAnimationFrame(() => {
      ref.current?.querySelector('.ss-dropdown')?.scrollIntoView({ block: 'nearest' })
    })
    return () => cancelAnimationFrame(id)
  }, [open])

  const handleSelect = (opt) => {
    onChange(opt.value)
    setQuery('')
    setOpen(false)
  }

  // Adding something new is always one click away at the foot of the list —
  // it used to appear only after typing a name that matched nothing.
  const quickAdd = () => {
    onQuickAdd(query.trim())
    setQuery('')
    setOpen(false)
  }

  // The search box sits inside the Record Stock form, so Enter must not submit
  // it. Enter picks the first match, or offers to add the name if none matches.
  const handleSearchKey = (e) => {
    if (e.key !== 'Enter') return
    e.preventDefault()
    e.stopPropagation()
    if (filtered.length > 0) handleSelect(filtered[0])
    else if (onQuickAdd && query.trim()) quickAdd()
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
              onKeyDown={handleSearchKey}
            />
          </div>
          <div className="ss-options">
            {filtered.length === 0 ? (
              <div className="ss-empty">
                <span>{query.trim() ? `Nothing called "${query.trim()}" yet` : 'Nothing here yet'}</span>
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
          {onQuickAdd && (
            <button
              type="button"
              className="ss-add-row"
              onMouseDown={e => { e.preventDefault(); quickAdd() }}
            >
              <FiPlus size={14} />
              <span>{query.trim() ? <>Add &ldquo;<strong>{query.trim()}</strong>&rdquo;</> : addLabel}</span>
            </button>
          )}
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
  // In-flight guard for the receiving form. A LAN write can take up to ~8 s before it
  // gives up and falls back to the offline queue; without this the button looks dead,
  // the operator clicks again, and every click lands as a separate receiving on replay.
  const [submitting, setSubmitting] = useState(false)
  // Result of the last receiving, shown as a confirmation modal — mirrors the
  // sale-complete flash on the POS so a save is never ambiguous.
  const [saveResult, setSaveResult] = useState(null)
  const { user } = useAuthStore()

  // Record Stock is a two-step dialog: what came in, then how much and at what
  // cost. It started as four steps, which meant pressing Next three times for every
  // delivery line — too much for something done many times a day.
  const RS_STEPS = ['What came in', 'Quantity & cost']
  const [step, setStep] = useState(0)
  const [stepErrors, setStepErrors] = useState({})
  const [stepAttempt, setStepAttempt] = useState(0)

  const [purchaseType, setPurchaseType] = useState('supplier')
  const [productPriceInfo, setProductPriceInfo] = useState(null)

  const emptyForm = {
    product_id: '',
    supplier_id: '',
    date_received: localDateStr(),
    expiry_date: '',
    cartons: '',
    units_per_carton: '',
    cost_per_carton: '',
    quantity: '',
    cost_per_unit: '',
    notes: '',
    new_selling_price: ''
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
        const same = products.find(p => p.name.trim().toLowerCase() === quickProductForm.name.trim().toLowerCase())
        if (same) {
          // Already on the list — pick it rather than make a second copy.
          handleFieldChange('product_id', same.id)
          toast.info(`${same.name} is already in your products — selected it`)
          setQuickAddMode(null)
          return
        }
        await addProduct({ ...quickProductForm, name: quickProductForm.name.trim(), selling_price: parseFloat(quickProductForm.selling_price) || 0 })
        const fresh = await getProducts()
        setProducts(fresh)
        const created = fresh.find(p => p.name.toLowerCase() === quickProductForm.name.trim().toLowerCase())
        if (created) handleFieldChange('product_id', created.id)
        toast.success(`${quickProductForm.name.trim()} added to your products`)
      } else {
        if (!quickSupplierForm.name.trim()) { setQuickAddError('Supplier name is required'); setQuickAddSaving(false); return }
        const same = suppliers.find(x => x.name.trim().toLowerCase() === quickSupplierForm.name.trim().toLowerCase())
        if (same) {
          handleFieldChange('supplier_id', same.id)
          toast.info(`${same.name} is already one of your suppliers — selected it`)
          setQuickAddMode(null)
          return
        }
        await addSupplier({ ...quickSupplierForm, name: quickSupplierForm.name.trim() })
        const fresh = await getSuppliers()
        setSuppliers(fresh)
        const created = fresh.find(s => s.name.toLowerCase() === quickSupplierForm.name.trim().toLowerCase())
        if (created) handleFieldChange('supplier_id', created.id)
        toast.success(`${quickSupplierForm.name.trim()} added to your suppliers`, { detail: 'Selected for this delivery.' })
      }
      setQuickAddMode(null)
    } catch (err) {
      setQuickAddError(err.message || 'Failed to save')
    } finally {
      setQuickAddSaving(false)
    }
  }

  // ── Correction state ──
  // Only Admin/Manager may correct; a correction never edits the original row —
  // it appends a signed-delta receiving that references it.
  const canCorrect = user?.role === 'Admin' || user?.role === 'Manager'
  const [correctionTarget, setCorrectionTarget] = useState(null)   // original receiving row being corrected
  const [correctionForm, setCorrectionForm] = useState({ quantity: '', cost_per_unit: '', reason: '' })
  const [correctionError, setCorrectionError] = useState('')
  const [correctionSaving, setCorrectionSaving] = useState(false)

  // Current truth for a receiving = original + all its corrections
  const effectiveReceiving = (row) => {
    const corrections = receivings.filter(r => r.corrects_receiving_id === row.id)
    const units = (row.total_units || 0) + corrections.reduce((s, c) => s + (c.total_units || 0), 0)
    const value = (row.total_value || 0) + corrections.reduce((s, c) => s + (c.total_value || 0), 0)
    return { units, value, cpu: units > 0 ? value / units : (row.cost_per_unit || 0) }
  }

  const openCorrection = (row) => {
    const eff = effectiveReceiving(row)
    setCorrectionTarget(row)
    setCorrectionForm({ quantity: String(eff.units), cost_per_unit: eff.cpu ? eff.cpu.toFixed(2) : '0', reason: '' })
    setCorrectionError('')
  }

  const closeCorrection = () => {
    if (correctionSaving) return
    setCorrectionTarget(null)
    setCorrectionError('')
  }

  // Clears the error as soon as the user starts fixing the form
  const updateCorrectionField = (field, value) => {
    setCorrectionForm(f => ({ ...f, [field]: value }))
    if (correctionError) setCorrectionError('')
  }

  const handleCorrectionSubmit = async () => {
    if (!correctionTarget) return
    setCorrectionError('')
    const qty = parseInt(correctionForm.quantity)
    const cpu = parseFloat(correctionForm.cost_per_unit)
    if (correctionForm.quantity === '' || !Number.isFinite(qty) || qty < 0) { setCorrectionError('Please fill in the correct quantity (0 or more)'); return }
    if (correctionForm.cost_per_unit === '' || !Number.isFinite(cpu) || cpu < 0) { setCorrectionError('Please fill in the correct cost per unit (0 or more)'); return }
    if (!correctionForm.reason.trim()) { setCorrectionError('Please give a reason for the correction'); return }
    const eff = effectiveReceiving(correctionTarget)
    if (qty === eff.units && Math.abs(qty * cpu - eff.value) < 0.005) {
      setCorrectionError('These values match the current record — change the quantity or cost to save a correction.')
      return
    }
    setCorrectionSaving(true)
    try {
      const result = await correctStockReceiving(
        correctionTarget.id,
        { total_units: qty, cost_per_unit: cpu, reason: correctionForm.reason.trim() },
        user?.username || 'System'
      )
      setCorrectionTarget(null)
      const sign = result.qty_delta >= 0 ? '+' : ''
      setSuccessMessage(`Correction saved for "${result.product_name}": ${sign}${result.qty_delta} units (record #${result.original_id}). Stock is now ${result.new_stock_qty}.`)
      setTimeout(() => setSuccessMessage(''), 6000)
      await loadData()
    } catch (err) {
      setCorrectionError(err.message || 'Failed to save correction')
    } finally {
      setCorrectionSaving(false)
    }
  }

  // History search/filter state (matches CurrentInventory pattern)
  const [historySearch, setHistorySearch] = useState('')
  const [historyTypeFilter, setHistoryTypeFilter] = useState('all')
  const [historySupplierFilter, setHistorySupplierFilter] = useState('all')
  const [sortConfig, setSortConfig] = useState({ column: 'date', direction: 'desc' })

  // Stock received on this till while offline — queued writes Main hasn't got yet.
  // Only ever non-empty on a satellite with pending stock writes.
  const [pendingReceivings, setPendingReceivings] = useState([])

  useEffect(() => { loadData() }, [])
  useLanSync(() => loadData(true))

  // Mirror the Transactions page: surface queued stock receivings so nothing done
  // offline is invisible until it syncs. Refreshed on every LAN status change.
  useEffect(() => {
    const lan = window.stocka?.lan
    if (!lan) return
    const refreshQueue = (status) => {
      const items = (status?.queueItems || []).filter(
        i => (i.channel === 'domain:stock:addReceiving' || i.channel === 'domain:stock:recordDirect') && i.summary
      )
      setPendingReceivings(items)
    }
    lan.getStatus().then(refreshQueue).catch(() => {})
    const off = lan.onStatusChange?.(refreshQueue)
    return () => { try { off?.() } catch (_) {} }
  }, [])

  useEffect(() => { applyHistoryFilters() }, [receivings, historySearch, historyTypeFilter, historySupplierFilter, sortConfig])

  const dismissSaveResult = () => setSaveResult(null)

  // A clean save clears itself so capturing a delivery of 20 lines doesn't need 20
  // dismissals. A queued save stays until acknowledged — that is the one the operator
  // must actually read. Enter/Escape/Space close either, since the tills are keyboard-driven.
  useEffect(() => {
    if (!saveResult) return
    const onKey = (e) => {
      if (e.key === 'Enter' || e.key === 'Escape' || e.key === ' ') {
        e.preventDefault()
        dismissSaveResult()
      }
    }
    window.addEventListener('keydown', onKey)
    const t = saveResult.queued ? null : setTimeout(dismissSaveResult, 2600)
    return () => { window.removeEventListener('keydown', onKey); if (t) clearTimeout(t) }
  }, [saveResult])

  const loadData = async (silent = false) => {
    try {
      if (!silent) setLoading(true)
      const [p, s, h] = await Promise.all([getProducts(), getSuppliers(), getAllPurchaseHistory()])
      setProducts(p)
      setSuppliers(s)
      setReceivings(h)
    } catch (err) {
      setError('Failed to load data')
      console.error(err)
    } finally {
      if (!silent) setLoading(false)
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

  // Cost per unit defaults to the previous restock cost; the field only
  // appears when there is no previous cost or the user chooses to edit it.
  const [editingCost, setEditingCost] = useState(false)
  const prevCpu = productPriceInfo?.cost_per_unit || 0
  const hasPrevCost = prevCpu > 0
  const usingPrevCost = hasPrevCost && !editingCost

  // Computed values for both form types
  const directQty = parseInt(formData.quantity) || 0
  const directCpu = usingPrevCost ? prevCpu : (parseFloat(formData.cost_per_unit) || 0)
  const directTotalValue = directQty * directCpu

  // Profit calculations — use new selling price if being updated, otherwise current
  const effectiveSP = parseFloat(formData.new_selling_price) > 0
    ? parseFloat(formData.new_selling_price)
    : (productPriceInfo?.selling_price_per_unit || 0)
  const showProfit = effectiveSP > 0 && directCpu > 0
  const profitPerUnit = effectiveSP - directCpu
  const totalProfit = profitPerUnit * directQty
  const profitMarginPct = effectiveSP > 0 ? (profitPerUnit / effectiveSP) * 100 : 0

  // Cost per unit: last time's cost is used unless the person chooses to change it,
  // because on a busy delivery most lines cost exactly what they did last time.
  const costPerUnitField = usingPrevCost ? (
    <div className="rs-prevcost">
      <div className="rs-prevcost-words">
        <span className="rs-prevcost-label">Cost per unit</span>
        <span className="rs-prevcost-value">${prevCpu.toFixed(2)}</span>
        <span className="rs-prevcost-sub">Same as the last delivery</span>
      </div>
      <button
        type="button"
        className="smodal-btn"
        onClick={() => { setFormData(prev => ({ ...prev, cost_per_unit: prevCpu.toFixed(2) })); setEditingCost(true) }}
      >
        <FiEdit3 size={13} /> Change
      </button>
    </div>
  ) : (
    <Field
      label="Cost per unit" prefix="$" type="number" step="any" min="0" inputMode="decimal"
      value={formData.cost_per_unit}
      onChange={e => handleFieldChange('cost_per_unit', e.target.value)}
      error={stepErrors.cost_per_unit} shakeKey={stepAttempt}
      autoFocus={editingCost}
      hint={hasPrevCost ? (
        <>Last delivery was ${prevCpu.toFixed(2)}.{' '}
          <button type="button" className="rs-linkbtn"
            onClick={() => { setEditingCost(false); setFormData(prev => ({ ...prev, cost_per_unit: '' })) }}>
            Use that instead
          </button>
        </>
      ) : 'What you paid for one unit. Leave blank if you do not know.'}
    />
  )

  const handleFieldChange = (name, value) => {
    setFormData(prev => ({ ...prev, [name]: value }))
    setStepErrors(se => (se[name] ? { ...se, [name]: null } : se))
    if (name === 'product_id') {
      setEditingCost(false)
      setFormData(prev => ({ ...prev, product_id: value, cost_per_unit: '' }))
      if (value) {
        getLatestProductPrice(parseInt(value)).then(info => setProductPriceInfo(info)).catch(() => setProductPriceInfo(null))
      } else {
        setProductPriceInfo(null)
      }
    }
  }

  const openRecord = () => {
    setFormData(emptyForm)
    setPurchaseType('supplier')
    setProductPriceInfo(null)
    setEditingCost(false)
    setStepErrors({})
    setStep(0)
    setError('')
    setShowForm(true)
  }

  const closeRecord = () => {
    if (submitting) return
    setShowForm(false)
    handleCloseQuickAdd()
  }

  // Switching between supplier and bought-directly keeps everything already filled
  // in; only the supplier (meaningless for a direct purchase) is cleared.
  const chooseType = (type) => {
    if (type === purchaseType) return
    setPurchaseType(type)
    setFormData(f => ({ ...f, supplier_id: '', notes: type === 'direct' ? f.notes : '' }))
    setStepErrors(se => ({ ...se, supplier_id: null }))
  }

  // What is wrong with a given step, keyed by field, so each box can say so itself.
  const stepProblems = (n) => {
    const e = {}
    if (n === 0) {
      if (!formData.product_id) e.product_id = 'Choose the product that came in'
      if (purchaseType === 'supplier' && !formData.supplier_id) e.supplier_id = 'Choose who supplied it'
      if (!formData.date_received) e.date_received = 'When did it arrive?'
    }
    if (n === 1) {
      if (!formData.quantity || directQty <= 0) e.quantity = 'How many units came in?'
      if (!usingPrevCost && formData.cost_per_unit !== '') {
        const c = parseFloat(formData.cost_per_unit)
        if (!Number.isFinite(c) || c < 0) e.cost_per_unit = 'Enter a cost of 0 or more'
      }
      if (formData.new_selling_price !== '') {
        const sp = parseFloat(formData.new_selling_price)
        if (!Number.isFinite(sp) || sp <= 0) e.new_selling_price = 'Enter a price above 0, or leave it blank'
      }
      if (formData.expiry_date && formData.date_received && formData.expiry_date < formData.date_received) {
        e.expiry_date = 'It cannot expire before the day it arrived'
      }
    }
    return e
  }

  const failStep = (e) => {
    setStepErrors(e)
    setStepAttempt(a => a + 1)
    requestAnimationFrame(() => {
      const bad = document.querySelector('#record-stock-form [aria-invalid="true"]')
      if (bad) bad.focus()
    })
  }

  const goNext = () => {
    const e = stepProblems(step)
    if (Object.keys(e).length) { failStep(e); return }
    setStepErrors({})
    setStep(n => Math.min(n + 1, RS_STEPS.length - 1))
  }

  const goBack = () => {
    setStepErrors({})
    setStep(n => Math.max(n - 1, 0))
  }

  // Enter moves forward through the steps and saves on the last one — the tills are
  // keyboard-first.
  const onRecordSubmit = (e) => {
    e.preventDefault()
    if (step < RS_STEPS.length - 1) goNext()
    else handleSubmit(e)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (submitting) return
    setError('')
    setSuccessMessage('')

    // A last check across every step; if something slipped through, go back to it.
    for (const n of [0, 1]) {
      const e = stepProblems(n)
      if (Object.keys(e).length) { setStep(n); failStep(e); return }
    }

    const productName = products.find(p => p.id === parseInt(formData.product_id))?.name || 'Stock'
    setSubmitting(true)
    try {
      let res
      if (purchaseType === 'supplier') {
        res = await addStockReceiving({
          supplier_id: parseInt(formData.supplier_id),
          product_id: parseInt(formData.product_id),
          date_received: formData.date_received,
          cartons: 0,
          units_per_carton: 0,
          total_units: directQty,
          cost_per_carton: 0,
          cost_per_unit: directCpu,
          total_value: directTotalValue,
          recorded_by: user?.username || 'System',
          expiry_date: formData.expiry_date || null
        })
      } else {
        res = await recordDirectPurchase({
          product_id: parseInt(formData.product_id),
          quantity: directQty,
          cost_per_unit: directCpu,
          date_received: formData.date_received,
          notes: formData.notes,
          recorded_by: user?.username || 'System',
          expiry_date: formData.expiry_date || null
        })
      }

      // On a satellite that can't reach Main the write is QUEUED, not applied — the
      // local database is untouched, so the history table below will not show it yet.
      // Never claim "inventory updated" in that case; an operator who reads that and
      // then sees an unchanged table simply captures the receiving a second time.
      const queued = res?.__queued === true

      let priceNote = ''
      const newSP = parseFloat(formData.new_selling_price)
      if (newSP > 0) {
        const prod = products.find(p => p.id === parseInt(formData.product_id))
        if (prod) {
          await updateProduct(prod.id, { ...prod, selling_price: newSP })
          priceNote = `Selling price set to $${newSP.toFixed(2)}`
        }
      }

      let pendingCount = 0
      if (queued) {
        try { pendingCount = (await window.stocka?.lan?.getStatus())?.queueBusinessSize ?? 0 } catch (_) {}
      }

      // A clean save is a toast. A QUEUED save keeps the full card, because it is
      // the one somebody has to actually read: "I saw nothing happen" is what makes
      // people capture the same delivery twice.
      if (queued) {
        setSaveResult({
          queued,
          pendingCount,
          productName,
          units: directQty,
          costPerUnit: directCpu,
          totalValue: directTotalValue,
          kind: purchaseType,
          priceNote,
        })
      } else {
        toast.success(`${productName}: +${directQty} received`, {
          detail: `${directQty} units at $${directCpu.toFixed(2)} = $${directTotalValue.toFixed(2)}${priceNote ? ' · ' + priceNote : ''}`,
        })
      }

      setFormData(emptyForm)
      setPurchaseType('supplier')
      setProductPriceInfo(null)
      setEditingCost(false)
      setShowForm(false)
      setStep(0)
      await loadData()
    } catch (err) {
      toast.error(`Could not record that stock: ${err.message || err}`)
      console.error(err)
    } finally {
      setSubmitting(false)
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
    if (['expirydate', 'expiry', 'expirationdate', 'expdate', 'bestbefore', 'bestbeforedate', 'bbd'].includes(s)) return 'expiry_date'
    if (['notes', 'note', 'description', 'remarks'].includes(s))       return 'notes'
    return null
  }

  // Excel cells may hold dates as serial numbers, Date objects, or text —
  // normalize all of them to YYYY-MM-DD (or '' when blank/unreadable)
  const toISODate = (v) => {
    if (v === '' || v == null) return ''
    if (typeof v === 'number') {
      const d = new Date(Math.round((v - 25569) * 86400 * 1000))
      return isNaN(d) ? '' : localDateStr(d)
    }
    const d = new Date(String(v).trim())
    return isNaN(d) ? '' : localDateStr(d)
  }

  const downloadImportTemplate = () => {
    const templateData = [
      { 'Product Name': 'Bread', 'Purchase Type': 'supplier', 'Supplier Name': 'Fresh Bakers Ltd', Quantity: 48, 'Cost Per Unit': 0.80, 'Expiry Date': '2026-08-01', Notes: '' },
      { 'Product Name': 'Cooking Oil 2L', 'Purchase Type': 'supplier', 'Supplier Name': 'Fresh Bakers Ltd', Quantity: 24, 'Cost Per Unit': 3.20, 'Expiry Date': '', Notes: '' },
      { 'Product Name': 'Salt 1kg', 'Purchase Type': 'direct', 'Supplier Name': '', Quantity: 10, 'Cost Per Unit': 0.50, 'Expiry Date': '', Notes: 'Cash purchase at market' },
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
            date_received: String(row.date_received ?? '').trim() || localDateStr(),
            quantity:      qty,
            cost_per_unit: parseFloat(row.cost_per_unit) || 0,
            expiry_date:   toISODate(row.expiry_date),
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
      if (result.inserted === 0 && result.errors && result.errors.length > 0) {
        setImportError(`Import failed — ${result.errors[0]}${result.errors.length > 1 ? ` (and ${result.errors.length - 1} more)` : ''}`)
        return
      }
      setShowImportModal(false)
      setImportPreview({ valid: [], skipped: 0 })
      const parts = [`${result.inserted} receiving${result.inserted !== 1 ? 's' : ''} imported`]
      if (result.created_products)  parts.push(`${result.created_products} new product${result.created_products !== 1 ? 's' : ''} created`)
      if (result.created_suppliers) parts.push(`${result.created_suppliers} new supplier${result.created_suppliers !== 1 ? 's' : ''} created`)
      if (result.errors && result.errors.length > 0) parts.push(`${result.errors.length} row${result.errors.length !== 1 ? 's' : ''} skipped`)
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
        <button className="btn btn-primary" onClick={openRecord}>
          <FiPlus size={16} /> Record Stock
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

      {/* ── Record Stock ──
             Two steps over the history table: what came in, then how much and at
             what cost. Saving happens from step two — no separate confirm step. */}
      <Modal
        open={showForm}
        size="large"
        title="Record Stock"
        subtitle="Stock that has arrived in the shop. Stock levels update the moment you save."
        onClose={closeRecord}
        closeOnBackdrop={false}
        footer={
          <>
            {step === 0 ? (
              <button type="button" className="smodal-btn-away" onClick={closeRecord}>Cancel</button>
            ) : (
              <button type="button" className="smodal-btn-away" onClick={goBack} disabled={submitting}>Back</button>
            )}
            <button type="submit" form="record-stock-form" className="smodal-btn-primary" disabled={submitting}>
              {step === 0
                ? 'Next'
                : submitting ? 'Saving...' : purchaseType === 'supplier' ? 'Record Stock' : 'Record Purchase'}
            </button>
          </>
        }
      >
        <Stepper steps={RS_STEPS} current={step} onStepClick={(i) => { setStepErrors({}); setStep(i) }} />

        <form id="record-stock-form" onSubmit={onRecordSubmit} noValidate>

          {/* ── 1. What came in ── */}
          {step === 0 && (
            <div className="rs-step fl-stack">
              <div className="rs-toggle" role="radiogroup" aria-label="Where did it come from?">
                <button
                  type="button" role="radio" aria-checked={purchaseType === 'supplier'}
                  className={`rs-toggle-opt${purchaseType === 'supplier' ? ' is-on' : ''}`}
                  onClick={() => chooseType('supplier')}
                >
                  <FiTruck size={16} />
                  <span><strong>From a supplier</strong><small>A delivery or an order</small></span>
                </button>
                <button
                  type="button" role="radio" aria-checked={purchaseType === 'direct'}
                  className={`rs-toggle-opt${purchaseType === 'direct' ? ' is-on' : ''}`}
                  onClick={() => chooseType('direct')}
                >
                  <FiShoppingBag size={16} />
                  <span><strong>Bought it myself</strong><small>Market, shop, donation, another branch</small></span>
                </button>
              </div>

              <div className={`rs-pick${stepErrors.product_id ? ' rs-pick-invalid' : ''}`}>
                <span className="rs-pick-label">
                  Product <span className="fl-req">*</span>
                  <button type="button" className="rs-pick-add" onClick={() => handleOpenQuickAdd('product', '')}>
                    <FiPlus size={12} /> New product
                  </button>
                </span>
                <SearchableSelect
                  addLabel="New product" 
                  options={productOptions}
                  value={formData.product_id}
                  onChange={val => { handleFieldChange('product_id', val); handleCloseQuickAdd() }}
                  placeholder="Search your products..."
                  onQuickAdd={name => handleOpenQuickAdd('product', name)}
                />
                {stepErrors.product_id
                  ? <p className="fl-msg fl-msg-err" role="alert">{stepErrors.product_id}</p>
                  : <p className="fl-msg">Not in the list? Add it here — no need to leave this form.</p>}
              </div>

              <div className="fl-row">
                {purchaseType === 'supplier' ? (
                  <div className={`rs-pick${stepErrors.supplier_id ? ' rs-pick-invalid' : ''}`}>
                    <span className="rs-pick-label">
                      Supplier <span className="fl-req">*</span>
                      <button type="button" className="rs-pick-add" onClick={() => handleOpenQuickAdd('supplier', '')}>
                        <FiPlus size={12} /> New supplier
                      </button>
                    </span>
                    <SearchableSelect
                      addLabel="New supplier" 
                      options={supplierOptions}
                      value={formData.supplier_id}
                      onChange={val => { handleFieldChange('supplier_id', val); handleCloseQuickAdd() }}
                      placeholder="Search your suppliers..."
                      onQuickAdd={name => handleOpenQuickAdd('supplier', name)}
                    />
                    {stepErrors.supplier_id && <p className="fl-msg fl-msg-err" role="alert">{stepErrors.supplier_id}</p>}
                  </div>
                ) : <div />}
                <Field
                  label="Arrived on" required type="date"
                  value={formData.date_received}
                  onChange={e => handleFieldChange('date_received', e.target.value)}
                  error={stepErrors.date_received} shakeKey={stepAttempt}
                />
              </div>

              {productPriceInfo && formData.product_id && (
                <div className="rs-context">
                  <div>
                    <span className="rs-context-label">Sells for</span>
                    <span className="rs-context-value">
                      {productPriceInfo.selling_price_per_unit > 0 ? `$${productPriceInfo.selling_price_per_unit.toFixed(2)}` : 'Not set'}
                    </span>
                  </div>
                  <div>
                    <span className="rs-context-label">Last cost</span>
                    <span className="rs-context-value">
                      {productPriceInfo.cost_per_unit > 0 ? `$${productPriceInfo.cost_per_unit.toFixed(2)}` : 'No earlier delivery'}
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── 2. How many, at what cost — and save ── */}
          {step === 1 && (
            <div className="rs-step fl-stack">
              {/* What step one chose, so it is still in view while you fill this in. */}
              <div className="rs-recap">
                <strong>{products.find(p => String(p.id) === String(formData.product_id))?.name || '—'}</strong>
                <span>
                  {purchaseType === 'supplier'
                    ? `from ${suppliers.find(x => String(x.id) === String(formData.supplier_id))?.name || '—'}`
                    : 'bought directly'}
                  {' · arrived '}{formData.date_received}
                </span>
                <button type="button" className="rs-linkbtn" onClick={goBack}>Change</button>
              </div>

              <div className="fl-row">
                <Field
                  label="Units received" required type="number" min="1" step="1" inputMode="numeric"
                  value={formData.quantity}
                  onChange={e => handleFieldChange('quantity', e.target.value)}
                  error={stepErrors.quantity} shakeKey={stepAttempt}
                  autoFocus
                  hint="Count single items, not boxes."
                />
                {costPerUnitField}
              </div>

              <div className="fl-row">
                <Field
                  label="New selling price" prefix="$" type="number" step="any" min="0" inputMode="decimal"
                  value={formData.new_selling_price}
                  onChange={e => handleFieldChange('new_selling_price', e.target.value)}
                  error={stepErrors.new_selling_price} shakeKey={stepAttempt}
                  hint={productPriceInfo?.selling_price_per_unit > 0
                    ? `Leave blank to keep $${productPriceInfo.selling_price_per_unit.toFixed(2)}.`
                    : 'No selling price yet — set one here if you know it.'}
                />
                <Field
                  label="Expires on" type="date"
                  value={formData.expiry_date}
                  min={formData.date_received}
                  onChange={e => handleFieldChange('expiry_date', e.target.value)}
                  error={stepErrors.expiry_date} shakeKey={stepAttempt}
                  hint="Optional. Leave blank if it does not go off."
                />
              </div>

              {directQty > 0 && (
                <div className="rs-calc">
                  <div className="rs-calc-cell">
                    <span className="rs-calc-label">Total cost</span>
                    <span className="rs-calc-value">${directTotalValue.toFixed(2)}</span>
                  </div>
                  {showProfit && (
                    <>
                      <div className="rs-calc-cell">
                        <span className="rs-calc-label">Profit each</span>
                        <span className={`rs-calc-value ${profitPerUnit >= 0 ? 'is-good' : 'is-bad'}`}>${profitPerUnit.toFixed(2)}</span>
                      </div>
                      <div className="rs-calc-cell">
                        <span className="rs-calc-label">Profit on this lot</span>
                        <span className={`rs-calc-value ${totalProfit >= 0 ? 'is-good' : 'is-bad'}`}>${totalProfit.toFixed(2)}</span>
                      </div>
                      <div className="rs-calc-cell">
                        <span className="rs-calc-label">Margin</span>
                        <span className={`rs-calc-value ${profitMarginPct >= 0 ? 'is-good' : 'is-bad'}`}>{profitMarginPct.toFixed(0)}%</span>
                      </div>
                    </>
                  )}
                </div>
              )}

              {purchaseType === 'direct' && (
                <Field
                  as="textarea" label="Note" rows={2}
                  value={formData.notes}
                  onChange={e => handleFieldChange('notes', e.target.value)}
                  placeholder="e.g. Bought at Mbare market, donation, moved from the other branch"
                />
              )}
            </div>
          )}
        </form>
      </Modal>

      {/* ── Quick add: a product or supplier that is not in the list yet ──
             A dialog on top of Record Stock rather than a form wedged inside it. */}
      <Modal
        open={!!quickAddMode}
        size="medium"
        level={1100}
        title={quickAddMode === 'supplier' ? 'New supplier' : 'New product'}
        subtitle="Saved straight away and picked for this delivery."
        onClose={handleCloseQuickAdd}
        footer={
          <>
            <button type="button" className="smodal-btn-away" onClick={handleCloseQuickAdd} disabled={quickAddSaving}>Cancel</button>
            <button type="submit" form="quick-add-form" className="smodal-btn-primary" disabled={quickAddSaving}>
              {quickAddSaving ? 'Saving...' : quickAddMode === 'supplier' ? 'Save Supplier' : 'Save Product'}
            </button>
          </>
        }
      >
        <form
          id="quick-add-form"
          className="fl-stack"
          onSubmit={e => { e.preventDefault(); handleQuickAddSave() }}
          noValidate
        >
          {quickAddMode === 'product' ? (
            <>
              <Field
                label="Product name" required autoFocus
                value={quickProductForm.name}
                onChange={e => setQuickProductForm(p => ({ ...p, name: e.target.value }))}
                error={quickAddError || undefined}
              />
              <div className="fl-row">
                <Field as="select" label="Category"
                  value={quickProductForm.category}
                  onChange={e => setQuickProductForm(p => ({ ...p, category: e.target.value }))}>
                  <option value="">No category</option>
                  {['Food', 'Non-Food', 'Drinks', 'Other'].map(c => <option key={c} value={c}>{c}</option>)}
                </Field>
                <Field as="select" label="Sold by the"
                  value={quickProductForm.unit}
                  onChange={e => setQuickProductForm(p => ({ ...p, unit: e.target.value }))}>
                  <option value="each">Each (single item)</option>
                  <option value="pack">Pack</option>
                </Field>
              </div>
              <div className="fl-row">
                <Field label="Selling price" prefix="$" type="number" step="any" min="0" inputMode="decimal"
                  value={quickProductForm.selling_price}
                  onChange={e => setQuickProductForm(p => ({ ...p, selling_price: e.target.value }))}
                />
                <Field label="Reorder level" type="number" min="0"
                  value={quickProductForm.reorder_level}
                  onChange={e => setQuickProductForm(p => ({ ...p, reorder_level: parseInt(e.target.value) || 0 }))}
                />
              </div>
            </>
          ) : (
            <>
              <Field
                label="Supplier name" required autoFocus
                value={quickSupplierForm.name}
                onChange={e => setQuickSupplierForm(p => ({ ...p, name: e.target.value }))}
                error={quickAddError || undefined}
              />
              <div className="fl-row">
                <Field label="Contact person"
                  value={quickSupplierForm.contact_person}
                  onChange={e => setQuickSupplierForm(p => ({ ...p, contact_person: e.target.value }))}
                  placeholder="e.g. John Moyo"
                />
                <Field label="Phone" type="tel"
                  value={quickSupplierForm.phone}
                  onChange={e => setQuickSupplierForm(p => ({ ...p, phone: e.target.value }))}
                  placeholder="e.g. 0771 234 567"
                />
              </div>
            </>
          )}
        </form>
      </Modal>

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
                          <th>Expiry</th>
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
                            <td>{row.expiry_date || '—'}</td>
                          </tr>
                        ))}
                        {importPreview.valid.length > 8 && (
                          <tr className="import-more-row">
                            <td colSpan="7">… and {importPreview.valid.length - 8} more rows</td>
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

      {/* ── Correction Modal ── */}
      {correctionTarget && (() => {
        const eff = effectiveReceiving(correctionTarget)
        const qty = parseInt(correctionForm.quantity)
        const cpu = parseFloat(correctionForm.cost_per_unit)
        const inputsValid = Number.isFinite(qty) && qty >= 0 && Number.isFinite(cpu) && cpu >= 0
        const qtyDelta = inputsValid ? qty - eff.units : 0
        const valueDelta = inputsValid ? (qty * cpu) - eff.value : 0
        const noChange = inputsValid && qtyDelta === 0 && Math.abs(valueDelta) < 0.005
        return (
          <div className="form-overlay" onClick={closeCorrection}>
            <div className="product-form correction-modal" onClick={e => e.stopPropagation()}>
              <div className="form-header">
                <h2>Correct Stock Record #{correctionTarget.id}</h2>
                <button className="close-btn" onClick={closeCorrection}><FiX size={14} /></button>
              </div>

              <div className="correction-original">
                <div className="co-row"><span className="co-label">Product</span><span>{correctionTarget.product_name}</span></div>
                <div className="co-row"><span className="co-label">Source</span><span>{correctionTarget.supplier_name || '—'}</span></div>
                <div className="co-row"><span className="co-label">Date received</span><span>{new Date(correctionTarget.date_received).toLocaleDateString('en-ZW')}</span></div>
                <div className="co-row">
                  <span className="co-label">Currently recorded{correctionTarget.correction_count > 0 ? ' (after earlier corrections)' : ''}</span>
                  <span>{eff.units} units @ ${eff.cpu.toFixed(2)} = ${eff.value.toFixed(2)}</span>
                </div>
              </div>

              {correctionError && <div className="error-banner">{correctionError}</div>}

              <div className="form-row">
                <div className="form-group">
                  <label>Correct Quantity *</label>
                  <input
                    type="number" min="0" step="1" autoFocus
                    value={correctionForm.quantity}
                    onChange={e => updateCorrectionField('quantity', e.target.value)}
                  />
                  <p className="field-hint">What the quantity should have been</p>
                </div>
                <div className="form-group">
                  <label>Correct Cost per Unit (USD) *</label>
                  <input
                    type="number" min="0" step="any"
                    value={correctionForm.cost_per_unit}
                    onChange={e => updateCorrectionField('cost_per_unit', e.target.value)}
                  />
                  <p className="field-hint">What you actually paid per unit</p>
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Reason for Correction *</label>
                  <textarea
                    rows="2"
                    value={correctionForm.reason}
                    onChange={e => updateCorrectionField('reason', e.target.value)}
                    placeholder="e.g. Counted 45 cartons on delivery, 50 was entered by mistake"
                  />
                </div>
              </div>

              {inputsValid && !noChange && (
                <div className="correction-preview">
                  <span>This will record a correction of&nbsp;</span>
                  <strong className={qtyDelta >= 0 ? 'delta-pos' : 'delta-neg'}>
                    {qtyDelta >= 0 ? '+' : ''}{qtyDelta} units
                  </strong>
                  <span>&nbsp;/&nbsp;</span>
                  <strong className={valueDelta >= 0 ? 'delta-pos' : 'delta-neg'}>
                    {valueDelta >= 0 ? '+' : '−'}${Math.abs(valueDelta).toFixed(2)}
                  </strong>
                  <span>&nbsp;against record #{correctionTarget.id}. The original entry is kept in history.</span>
                </div>
              )}
              {noChange && (
                <div className="correction-preview muted">These values match the current record — nothing to correct.</div>
              )}

              <div className="form-actions">
                <button className="btn btn-secondary" onClick={closeCorrection} disabled={correctionSaving}>Cancel</button>
                <button
                  className="btn btn-primary"
                  onClick={handleCorrectionSubmit}
                  disabled={correctionSaving}
                >
                  {correctionSaving ? 'Saving…' : <><FiCheck size={14} /> Save Correction</>}
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* Pending sync — stock received on this till that Main hasn't got yet.
          Shown above the history so nothing received offline is ever hidden. */}
      {pendingReceivings.length > 0 && (
        <div className="receivings-list" style={{ marginBottom: 16, border: '1px solid #fde68a', borderRadius: 8, overflow: 'hidden' }}>
          <div style={{ background: '#fffbeb', padding: '8px 14px', fontSize: 12, fontWeight: 700, color: '#92400e', display: 'flex', alignItems: 'center', gap: 6 }}>
            <FiClock size={13} /> {pendingReceivings.length} stock receiving{pendingReceivings.length !== 1 ? 's' : ''} on this till — waiting to sync to Main
          </div>
          <div className="receivings-table">
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Product</th>
                  <th>Type</th>
                  <th className="th-right">Units</th>
                  <th className="th-right">Cost/Unit</th>
                  <th>By</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {pendingReceivings.map(item => {
                  const prod = products.find(p => p.id === item.summary.productId)
                  return (
                    <tr key={item.id}>
                      <td className="th-nowrap">{new Date(item.timestamp).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })}</td>
                      <td>{prod?.name || `#${item.summary.productId ?? '—'}`}</td>
                      <td>{item.summary.kind === 'direct' ? 'Direct' : 'Supplier'}</td>
                      <td className="th-right">{item.summary.units || '—'}</td>
                      <td className="th-right">${(item.summary.costPerUnit || 0).toFixed(2)}</td>
                      <td>{item.summary.recordedBy || '—'}</td>
                      <td><span style={{ fontSize: 11, fontWeight: 700, color: '#d97706' }}>Pending</span></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
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
                  {canCorrect && <th></th>}
                </tr>
              </thead>
              <tbody>
                {filteredReceivings.map(r => {
                  const isCorrection = r.corrects_receiving_id != null
                  return (
                  <tr key={r.id} className={isCorrection ? 'correction-row' : ''}>
                    <td>{new Date(r.date_received).toLocaleDateString('en-ZW')}</td>
                    <td>
                      {r.product_name}
                      {isCorrection && (
                        <div className="correction-detail">Corrects record #{r.corrects_receiving_id}{r.correction_reason ? ` — ${r.correction_reason}` : ''}</div>
                      )}
                      {!isCorrection && r.expiry_date && (
                        <div className="expiry-detail">Expires {new Date(r.expiry_date).toLocaleDateString('en-ZW')}</div>
                      )}
                    </td>
                    <td>{r.supplier_name || '—'}</td>
                    <td>
                      {isCorrection ? (
                        <span className="type-badge correction">Correction</span>
                      ) : (
                        <>
                          <span className={`type-badge ${r.purchase_type === 'supplier' ? 'supplier' : 'direct'}`}>
                            {r.purchase_type === 'supplier' ? 'Supplier' : 'Direct'}
                          </span>
                          {r.correction_count > 0 && (
                            <span className="type-badge corrected" title="This record has been corrected — see its correction entries">Corrected</span>
                          )}
                        </>
                      )}
                    </td>
                    <td className={isCorrection ? (r.total_units >= 0 ? 'delta-pos' : 'delta-neg') : ''}>
                      {isCorrection && r.total_units >= 0 ? '+' : ''}{r.total_units} units
                    </td>
                    <td>${(r.cost_per_unit || 0).toFixed(2)}</td>
                    <td className={isCorrection ? (r.total_value >= 0 ? 'delta-pos' : 'delta-neg') : ''}>
                      {isCorrection ? (r.total_value >= 0 ? '+' : '−') : ''}${Math.abs(r.total_value || 0).toFixed(2)}
                    </td>
                    {canCorrect && (
                      <td>
                        {!isCorrection && (
                          <button
                            className="btn-correct"
                            title="Correct this record — the original is kept and a +/- correction is added"
                            onClick={() => openCorrection(r)}
                          >
                            <FiEdit3 size={13} /> Correct
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Receiving confirmation ──────────────────────────────────────────────
          Mirrors the sale-complete flash on the POS. Two states, deliberately very
          different-looking: saved to the books, or held on this till until Main is
          back. The queued one does not auto-close — the operator must acknowledge
          it, because "I saw nothing happen" is what makes people re-capture stock. */}
      {saveResult && (
        <div className="stk-confirm-overlay" onClick={dismissSaveResult}>
          <div
            className={`stk-confirm-card ${saveResult.queued ? 'is-queued' : 'is-saved'}`}
            onClick={e => e.stopPropagation()}
          >
            <div className="stk-confirm-icon">
              {saveResult.queued ? <FiWifiOff size={30} strokeWidth={2.5} /> : <FiCheck size={34} strokeWidth={3} />}
            </div>

            <div className="stk-confirm-title">
              {saveResult.queued ? 'Saved on this computer' : 'Stock Received'}
            </div>

            <div className="stk-confirm-product">{saveResult.productName}</div>

            <div className="stk-confirm-figures">
              <div className="stk-confirm-figure">
                <div className="stk-confirm-figure-label">Units</div>
                <div className="stk-confirm-figure-value">+{saveResult.units}</div>
              </div>
              <div className="stk-confirm-figure">
                <div className="stk-confirm-figure-label">Cost / unit</div>
                <div className="stk-confirm-figure-value">${saveResult.costPerUnit.toFixed(2)}</div>
              </div>
              <div className="stk-confirm-figure">
                <div className="stk-confirm-figure-label">Total</div>
                <div className="stk-confirm-figure-value">${saveResult.totalValue.toFixed(2)}</div>
              </div>
            </div>

            {saveResult.priceNote && (
              <div className="stk-confirm-note">{saveResult.priceNote}</div>
            )}

            <div className="stk-confirm-banner">
              {saveResult.queued ? (
                <>
                  <FiClock size={14} />
                  <span>
                    Waiting to sync to the Main computer
                    {saveResult.pendingCount > 1 && ` · ${saveResult.pendingCount} records pending`}
                  </span>
                </>
              ) : (
                <>
                  <FiCheck size={14} />
                  <span>Inventory updated</span>
                </>
              )}
            </div>

            {saveResult.queued && (
              <div className="stk-confirm-explain">
                It is safe — nothing is lost. It will appear in the history below once
                this computer reconnects. <strong>Do not capture it again.</strong>
              </div>
            )}

            <button className="stk-confirm-btn" onClick={dismissSaveResult} autoFocus>
              {saveResult.queued ? 'Got it' : 'Done'}
            </button>

            {!saveResult.queued && (
              <div className="stk-confirm-hint">Closing automatically…</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default StockControl
