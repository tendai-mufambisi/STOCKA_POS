import { useState, useEffect, useRef } from 'react'
import { getProducts, logAuditAction } from '../database/db'
import { reconcileProduct, reconcileProducts } from '../database/domains/stock'
import { useAuthStore } from '../store/useAuthStore'
import './InventoryReconciliation.css'
import {
  FiCheck, FiAlertCircle, FiRefreshCw, FiDownload,
  FiSearch, FiFilter, FiCheckCircle, FiPackage, FiX
} from 'react-icons/fi'

export default function InventoryReconciliation() {
  const { user } = useAuthStore()
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  // counts[productId] = { counted_qty: string, notes: string }
  const [counts, setCounts] = useState({})
  // set of productIds that have been reconciled (DB updated) this session
  const [reconciled, setReconciled] = useState(new Set())
  const [applying, setApplying] = useState(new Set())   // in-flight per-row
  const [finalizing, setFinalizing] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all') // all | pending | reconciled | discrepancy
  const successTimer = useRef(null)

  useEffect(() => { loadProducts() }, [])

  const loadProducts = async () => {
    try {
      setLoading(true)
      const data = await getProducts()
      setProducts(data || [])
      const init = {}
      ;(data || []).forEach(p => { init[p.id] = { counted_qty: '', notes: '' } })
      setCounts(init)
      setReconciled(new Set())
    } catch {
      setError('Failed to load products')
    } finally {
      setLoading(false)
    }
  }

  const flash = (msg) => {
    setSuccess(msg)
    clearTimeout(successTimer.current)
    successTimer.current = setTimeout(() => setSuccess(''), 3500)
  }

  // ── per-row helpers ──────────────────────────────────────────
  const setCountedQty = (id, val) => {
    setError('')
    setCounts(prev => ({ ...prev, [id]: { ...prev[id], counted_qty: val } }))
  }
  const setNotes = (id, val) => {
    setCounts(prev => ({ ...prev, [id]: { ...prev[id], notes: val } }))
  }

  const parsedQty = (id) => {
    const v = counts[id]?.counted_qty
    if (v === '' || v == null) return null
    const n = parseFloat(v)
    return isNaN(n) || n < 0 ? null : n
  }

  const variance = (product) => {
    const qty = parsedQty(product.id)
    if (qty === null) return null
    return qty - (product.current_quantity || 0)
  }

  // ── Apply one product ────────────────────────────────────────
  const handleApply = async (product) => {
    const qty = parsedQty(product.id)
    if (qty === null) { setError(`Enter a valid counted quantity for "${product.name}"`); return }
    setError('')
    setApplying(prev => new Set(prev).add(product.id))
    try {
      await reconcileProduct(product.id, qty, counts[product.id]?.notes || '', user.username)
      // Update local system qty so variance refreshes immediately
      setProducts(prev => prev.map(p => p.id === product.id ? { ...p, current_quantity: qty } : p))
      setReconciled(prev => new Set(prev).add(product.id))
      flash(`✓ "${product.name}" reconciled — new qty: ${qty}`)
      await logAuditAction(user.username, 'INVENTORY_RECONCILIATION', 'PRODUCT', String(product.id),
        `Reconciled "${product.name}": ${product.current_quantity} → ${qty}`)
    } catch (err) {
      setError(`Failed to reconcile "${product.name}": ${err.message}`)
    } finally {
      setApplying(prev => { const s = new Set(prev); s.delete(product.id); return s })
    }
  }

  // ── Finalize all counted (not yet reconciled) ────────────────
  const handleFinalizeAll = async () => {
    const toReconcile = products.filter(p => {
      const qty = parsedQty(p.id)
      return qty !== null && !reconciled.has(p.id)
    })
    if (toReconcile.length === 0) {
      setError('No products with new counted quantities to finalize. Enter counts first.')
      return
    }
    setError('')
    setFinalizing(true)
    try {
      const adjustments = toReconcile.map(p => ({
        product_id: p.id,
        counted_qty: parsedQty(p.id),
        notes: counts[p.id]?.notes || ''
      }))
      const results = await reconcileProducts(adjustments, user.username)
      // Update local quantities
      setProducts(prev => prev.map(p => {
        const r = results.find(r => r.product_id === p.id)
        return r ? { ...p, current_quantity: r.new_qty } : p
      }))
      setReconciled(prev => {
        const s = new Set(prev)
        results.forEach(r => s.add(r.product_id))
        return s
      })
      const summary = results.map(r =>
        `${r.product_name}: ${r.previous_qty} → ${r.new_qty} (${r.adjustment >= 0 ? '+' : ''}${r.adjustment})`
      ).join(' | ')
      await logAuditAction(user.username, 'INVENTORY_RECONCILIATION', 'INVENTORY', 'batch',
        `Finalized ${results.length} items: ${summary}`)
      flash(`✓ ${results.length} product${results.length !== 1 ? 's' : ''} reconciled successfully`)
    } catch (err) {
      setError('Finalize failed: ' + err.message)
    } finally {
      setFinalizing(false)
    }
  }

  // ── Export CSV ───────────────────────────────────────────────
  const handleExport = () => {
    const rows = [
      ['Product', 'Category', 'System Qty', 'Counted Qty', 'Variance', 'Status', 'Notes'],
      ...products.map(p => {
        const qty = parsedQty(p.id)
        const v   = qty !== null ? qty - (p.current_quantity || 0) : ''
        const status = reconciled.has(p.id) ? 'Reconciled' : qty !== null ? 'Counted' : 'Not counted'
        return [p.name, p.category || '', p.current_quantity || 0, qty ?? '', v, status, counts[p.id]?.notes || '']
      })
    ]
    const csv = rows.map(r => r.map(c => `"${c}"`).join(',')).join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    const a = document.createElement('a'); a.href = url
    a.download = `reconciliation-${new Date().toISOString().split('T')[0]}.csv`
    a.click(); URL.revokeObjectURL(url)
  }

  // ── Filtering ────────────────────────────────────────────────
  const filtered = products.filter(p => {
    if (search && !p.name.toLowerCase().includes(search.toLowerCase()) &&
        !(p.category || '').toLowerCase().includes(search.toLowerCase())) return false
    if (filter === 'reconciled') return reconciled.has(p.id)
    if (filter === 'pending') {
      const qty = parsedQty(p.id)
      return qty !== null && !reconciled.has(p.id)
    }
    if (filter === 'discrepancy') {
      const v = variance(p)
      return v !== null && v !== 0 && !reconciled.has(p.id)
    }
    return true
  })

  // ── Summary stats ────────────────────────────────────────────
  const counted = products.filter(p => parsedQty(p.id) !== null).length
  const pendingCount = products.filter(p => parsedQty(p.id) !== null && !reconciled.has(p.id)).length
  const discrepancyCount = products.filter(p => { const v = variance(p); return v !== null && v !== 0 && !reconciled.has(p.id) }).length

  if (loading) return <div className="ir-loading"><FiRefreshCw className="ir-spin" size={28} /><span>Loading products…</span></div>

  return (
    <div className="ir-page">
      {/* ── Header ── */}
      <div className="ir-header">
        <div className="ir-header-left">
          <h1>Inventory Reconciliation</h1>
          <p>Count physical stock and adjust system quantities to match reality</p>
        </div>
        <div className="ir-header-actions">
          <button className="ir-btn ir-btn-ghost" onClick={loadProducts} title="Reload products">
            <FiRefreshCw size={15} /> Reload
          </button>
          <button className="ir-btn ir-btn-ghost" onClick={handleExport}>
            <FiDownload size={15} /> Export CSV
          </button>
        </div>
      </div>

      {/* ── Alerts ── */}
      {error   && <div className="ir-alert ir-alert-error"><FiAlertCircle size={15}/> {error} <button onClick={() => setError('')}><FiX size={13}/></button></div>}
      {success && <div className="ir-alert ir-alert-success"><FiCheck size={15}/> {success}</div>}

      {/* ── Summary strip ── */}
      <div className="ir-summary">
        <div className="ir-stat">
          <span className="ir-stat-val">{products.length}</span>
          <span className="ir-stat-lbl">Total Products</span>
        </div>
        <div className="ir-stat">
          <span className="ir-stat-val">{counted}</span>
          <span className="ir-stat-lbl">Counted</span>
        </div>
        <div className={`ir-stat ${discrepancyCount > 0 ? 'ir-stat-warn' : ''}`}>
          <span className="ir-stat-val">{discrepancyCount}</span>
          <span className="ir-stat-lbl">Discrepancies</span>
        </div>
        <div className={`ir-stat ${reconciled.size > 0 ? 'ir-stat-ok' : ''}`}>
          <span className="ir-stat-val">{reconciled.size}</span>
          <span className="ir-stat-lbl">Reconciled</span>
        </div>
      </div>

      {/* ── Toolbar ── */}
      <div className="ir-toolbar">
        <div className="ir-search-wrap">
          <FiSearch size={15} className="ir-search-icon" />
          <input
            className="ir-search"
            placeholder="Search by product or category…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {search && <button className="ir-search-clear" onClick={() => setSearch('')}><FiX size={13}/></button>}
        </div>
        <div className="ir-filters">
          <FiFilter size={14} />
          {['all','pending','reconciled','discrepancy'].map(f => (
            <button key={f} className={`ir-chip ${filter === f ? 'active' : ''}`} onClick={() => setFilter(f)}>
              {f === 'all' ? `All (${products.length})` :
               f === 'pending' ? `To Apply (${pendingCount})` :
               f === 'reconciled' ? `Done (${reconciled.size})` :
               `Discrepancy (${discrepancyCount})`}
            </button>
          ))}
        </div>
      </div>

      {/* ── Table ── */}
      <div className="ir-table-wrap">
        {filtered.length === 0 ? (
          <div className="ir-empty">
            <FiPackage size={42} />
            <p>No products match your filter</p>
          </div>
        ) : (
          <table className="ir-table">
            <thead>
              <tr>
                <th>Product</th>
                <th>Category</th>
                <th className="ir-num">System Qty</th>
                <th className="ir-num">Counted Qty</th>
                <th className="ir-num">Variance</th>
                <th>Notes</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(product => {
                const qty = parsedQty(product.id)
                const v   = qty !== null ? qty - (product.current_quantity || 0) : null
                const isReconciled = reconciled.has(product.id)
                const isApplying   = applying.has(product.id)
                const rowClass = isReconciled ? 'ir-row-done' : v !== null && v !== 0 ? 'ir-row-disc' : v === 0 ? 'ir-row-match' : ''

                return (
                  <tr key={product.id} className={rowClass}>
                    <td className="ir-product-name">{product.name}</td>
                    <td className="ir-category">{product.category || <span className="ir-muted">—</span>}</td>
                    <td className="ir-num ir-system-qty">{product.current_quantity ?? 0}</td>
                    <td className="ir-num">
                      <input
                        type="number"
                        min="0"
                        step="1"
                        className={`ir-qty-input ${isReconciled ? 'ir-qty-done' : ''}`}
                        value={counts[product.id]?.counted_qty ?? ''}
                        onChange={e => setCountedQty(product.id, e.target.value)}
                        placeholder="Enter"
                        disabled={isReconciled}
                      />
                    </td>
                    <td className={`ir-num ir-variance ${v === null ? '' : v === 0 ? 'zero' : v > 0 ? 'pos' : 'neg'}`}>
                      {v === null ? <span className="ir-muted">—</span> :
                       v === 0 ? <span className="ir-match-tick"><FiCheck size={13}/></span> :
                       `${v > 0 ? '+' : ''}${v}`}
                    </td>
                    <td>
                      <input
                        type="text"
                        className="ir-notes-input"
                        value={counts[product.id]?.notes ?? ''}
                        onChange={e => setNotes(product.id, e.target.value)}
                        placeholder="Optional notes…"
                        disabled={isReconciled}
                      />
                    </td>
                    <td>
                      {isReconciled
                        ? <span className="ir-badge ir-badge-done"><FiCheckCircle size={12}/> Reconciled</span>
                        : qty !== null
                          ? <span className="ir-badge ir-badge-pending">Counted</span>
                          : <span className="ir-badge ir-badge-none">Not counted</span>}
                    </td>
                    <td>
                      {!isReconciled && (
                        <button
                          className="ir-apply-btn"
                          disabled={qty === null || isApplying}
                          onClick={() => handleApply(product)}
                          title="Apply this count to the database"
                        >
                          {isApplying ? <FiRefreshCw size={13} className="ir-spin"/> : <FiCheck size={13}/>}
                          Apply
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Finalize bar ── */}
      {pendingCount > 0 && (
        <div className="ir-finalize-bar">
          <span>
            <strong>{pendingCount} product{pendingCount !== 1 ? 's' : ''}</strong> counted but not yet applied to the database.
          </span>
          <button
            className="ir-btn ir-btn-primary"
            disabled={finalizing}
            onClick={handleFinalizeAll}
          >
            {finalizing
              ? <><FiRefreshCw size={14} className="ir-spin"/> Applying…</>
              : <><FiCheckCircle size={14}/> Finalize All ({pendingCount})</>}
          </button>
        </div>
      )}
    </div>
  )
}
