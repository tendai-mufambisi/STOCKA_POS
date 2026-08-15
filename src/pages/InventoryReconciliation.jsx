import { useState, useEffect, useRef, useMemo } from 'react'
import { logAuditAction } from '../database/db'
import {
  getReconciliationSnapshot,
  reconcileProductExplained,
  reconcileProductsExplained,
} from '../database/domains/stock'
import { useAuthStore } from '../store/useAuthStore'
import { STOCK_LOSS_REASONS, stockLossReasonLabel } from '../utils/stockLossReasons'
import './InventoryReconciliation.css'
import {
  FiCheck, FiAlertCircle, FiRefreshCw, FiDownload, FiSearch, FiFilter,
  FiCheckCircle, FiPackage, FiX, FiChevronDown, FiChevronRight, FiInfo
} from 'react-icons/fi'

const ymd = (d) => {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
const monthStart = (d) => ymd(new Date(d.getFullYear(), d.getMonth(), 1))

export default function InventoryReconciliation() {
  const { user } = useAuthStore()
  const [snapshot, setSnapshot] = useState({ products: [], period: null })
  const [loading, setLoading] = useState(true)
  // entries[productId] = { counted, type: 'loss'|'adjustment', reason_code, note }
  const [entries, setEntries] = useState({})
  const [settled, setSettled] = useState(new Map())   // productId -> outcome
  const [applying, setApplying] = useState(new Set())
  const [finalizing, setFinalizing] = useState(false)
  const [expanded, setExpanded] = useState(new Set())
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const successTimer = useRef(null)

  const [from, setFrom] = useState(monthStart(new Date()))
  const [to, setTo] = useState(ymd(new Date()))

  useEffect(() => { load() }, [from, to])
  useEffect(() => () => clearTimeout(successTimer.current), [])

  const load = async () => {
    try {
      setLoading(true)
      const snap = await getReconciliationSnapshot({ start: from, end: to })
      if (snap?.__error) throw new Error(snap.__error)
      setSnapshot(snap || { products: [], period: null })
      const init = {}
      ;(snap?.products || []).forEach(p => {
        init[p.id] = { counted: '', type: 'adjustment', reason_code: 'BROKEN', note: '' }
      })
      setEntries(init)
      setSettled(new Map())
      setError('')
    } catch (err) {
      setError(err?.message || 'Failed to load stock figures')
    } finally {
      setLoading(false)
    }
  }

  const flash = (msg) => {
    setSuccess(msg)
    clearTimeout(successTimer.current)
    successTimer.current = setTimeout(() => setSuccess(''), 4500)
  }

  const patch = (id, changes) => {
    setError('')
    setEntries(prev => ({ ...prev, [id]: { ...prev[id], ...changes } }))
  }

  const countedOf = (id) => {
    const v = entries[id]?.counted
    if (v === '' || v == null) return null
    const n = parseInt(v)
    return Number.isFinite(n) && n >= 0 ? n : null
  }
  const varianceOf = (p) => {
    const c = countedOf(p.id)
    return c === null ? null : c - (p.expected || 0)
  }

  const toggleRow = (id) => setExpanded(prev => {
    const s = new Set(prev)
    s.has(id) ? s.delete(id) : s.add(id)
    return s
  })

  const explanationFor = (p) => {
    const e = entries[p.id]
    const v = varianceOf(p)
    // A surplus can only ever be an adjustment — stock cannot be un-broken.
    if (v === null || v >= 0) return { type: 'adjustment', note: e?.note || '' }
    return e?.type === 'loss'
      ? { type: 'loss', reason_code: e.reason_code, note: e.note || '' }
      : { type: 'adjustment', note: e?.note || '' }
  }

  const apply = async (p) => {
    const counted = countedOf(p.id)
    if (counted === null) { setError(`Enter a counted quantity for "${p.name}"`); return }
    setApplying(prev => new Set(prev).add(p.id))
    try {
      const res = await reconcileProductExplained(p.id, counted, explanationFor(p), user.username)
      if (res?.__error) throw new Error(res.__error)
      absorb(res)
      flash(describe(res))
      await logAuditAction(user.username, 'INVENTORY_RECONCILIATION', 'PRODUCT', String(p.id),
        `Counted "${p.name}": ${p.expected} → ${counted} (${res.outcome})`)
    } catch (err) {
      setError(`Could not apply "${p.name}": ${err.message}`)
    } finally {
      setApplying(prev => { const s = new Set(prev); s.delete(p.id); return s })
    }
  }

  const absorb = (res) => {
    setSnapshot(prev => ({
      ...prev,
      products: prev.products.map(x => x.id === res.product_id ? { ...x, expected: res.new_qty } : x),
    }))
    setSettled(prev => new Map(prev).set(res.product_id, res))
  }

  const describe = (r) => {
    if (r.outcome === 'matched') return `"${r.product_name}" matches the system count.`
    if (r.outcome === 'explained') {
      return `"${r.product_name}": ${Math.abs(r.variance)} short, recorded as ${stockLossReasonLabel(r.reason_code).toLowerCase()}.`
    }
    return `"${r.product_name}": ${r.variance > 0 ? '+' : ''}${r.variance} adjusted as unexplained.`
  }

  const pending = useMemo(
    () => snapshot.products.filter(p => countedOf(p.id) !== null && !settled.has(p.id)),
    [snapshot.products, entries, settled]
  )

  const finalizeAll = async () => {
    if (pending.length === 0) { setError('Enter some counted quantities first.'); return }
    setFinalizing(true)
    setError('')
    try {
      const payload = pending.map(p => ({
        product_id: p.id,
        counted_qty: countedOf(p.id),
        explanation: explanationFor(p),
      }))
      const out = await reconcileProductsExplained(payload, user.username)
      if (out?.__error) throw new Error(out.__error)
      ;(out.results || []).forEach(absorb)
      const n = (out.results || []).length
      const explained = (out.results || []).filter(r => r.outcome === 'explained').length
      const unexplained = (out.results || []).filter(r => r.outcome === 'unexplained').length
      await logAuditAction(user.username, 'INVENTORY_RECONCILIATION', 'INVENTORY', 'batch',
        `Finalized ${n} items: ${explained} explained, ${unexplained} unexplained`)
      if (out.errors?.length) {
        setError(`${out.errors.length} item${out.errors.length !== 1 ? 's' : ''} could not be applied: ` +
          out.errors.map(e => e.message).join('; '))
      }
      flash(`${n} product${n !== 1 ? 's' : ''} reconciled — ${explained} explained, ${unexplained} unexplained.`)
    } catch (err) {
      setError('Finalize failed: ' + err.message)
    } finally {
      setFinalizing(false)
    }
  }

  const exportCsv = () => {
    const rows = [
      ['Product', 'Category', 'Opening', 'Received', 'Sold', 'Breakages', 'Expired', 'Adjustments', 'Expected', 'Counted', 'Variance', 'Outcome', 'Note'],
      ...snapshot.products.map(p => {
        const m = p.movements
        const c = countedOf(p.id)
        const s = settled.get(p.id)
        return [
          p.name, p.category || '', m.opening, m.received, m.sold, m.lost, m.expired, m.adjusted,
          p.expected, c ?? '', c === null ? '' : c - (p.expected || 0),
          s ? s.outcome : c === null ? 'not counted' : 'pending',
          entries[p.id]?.note || '',
        ]
      }),
    ]
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `reconciliation-${ymd(new Date())}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const filtered = snapshot.products.filter(p => {
    if (search) {
      const q = search.toLowerCase()
      if (!p.name.toLowerCase().includes(q) && !(p.category || '').toLowerCase().includes(q)) return false
    }
    const v = varianceOf(p)
    if (filter === 'counted') return v !== null
    if (filter === 'done') return settled.has(p.id)
    if (filter === 'variance') return v !== null && v !== 0 && !settled.has(p.id)
    if (filter === 'short') return v !== null && v < 0 && !settled.has(p.id)
    return true
  })

  const countedCount = snapshot.products.filter(p => countedOf(p.id) !== null).length
  const varianceCount = snapshot.products.filter(p => { const v = varianceOf(p); return v !== null && v !== 0 && !settled.has(p.id) }).length
  const shortCount = snapshot.products.filter(p => { const v = varianceOf(p); return v !== null && v < 0 && !settled.has(p.id) }).length

  if (loading) return <div className="ir-loading"><FiRefreshCw className="ir-spin" size={28} /><span>Loading stock figures…</span></div>

  return (
    <div className="ir-page">
      <div className="ir-header">
        <div className="ir-header-left">
          <h1>Inventory Reconciliation</h1>
          <p>Count what is on the shelves, then say what happened to anything missing.</p>
        </div>
        <div className="ir-header-actions">
          <button className="ir-btn ir-btn-ghost" onClick={load}><FiRefreshCw size={15} /> Reload</button>
          <button className="ir-btn ir-btn-ghost" onClick={exportCsv}><FiDownload size={15} /> Export CSV</button>
        </div>
      </div>

      {error && <div className="ir-alert ir-alert-error"><FiAlertCircle size={15} /> {error} <button onClick={() => setError('')}><FiX size={13} /></button></div>}
      {success && <div className="ir-alert ir-alert-success"><FiCheck size={15} /> {success}</div>}

      {/* Period governs the movement breakdown, not the expected figure — the
          expected quantity is always what the system holds right now. */}
      <div className="ir-period">
        <span className="ir-period-label">Show movements from</span>
        <input type="date" value={from} max={to} onChange={e => setFrom(e.target.value)} />
        <span className="ir-period-label">to</span>
        <input type="date" value={to} max={ymd(new Date())} onChange={e => setTo(e.target.value)} />
        <span className="ir-period-hint">
          <FiInfo size={12} /> Changes what the breakdown covers. Expected stock is always today's figure.
        </span>
      </div>

      <div className="ir-summary">
        <div className="ir-stat">
          <span className="ir-stat-val">{snapshot.products.length}</span>
          <span className="ir-stat-lbl">Products</span>
        </div>
        <div className="ir-stat">
          <span className="ir-stat-val">{countedCount}</span>
          <span className="ir-stat-lbl">Counted</span>
        </div>
        <div className={`ir-stat ${varianceCount > 0 ? 'ir-stat-warn' : ''}`}>
          <span className="ir-stat-val">{varianceCount}</span>
          <span className="ir-stat-lbl">With variance</span>
        </div>
        <div className={`ir-stat ${shortCount > 0 ? 'ir-stat-warn' : ''}`}>
          <span className="ir-stat-val">{shortCount}</span>
          <span className="ir-stat-lbl">Short — need a reason</span>
        </div>
        <div className={`ir-stat ${settled.size > 0 ? 'ir-stat-ok' : ''}`}>
          <span className="ir-stat-val">{settled.size}</span>
          <span className="ir-stat-lbl">Applied</span>
        </div>
      </div>

      <div className="ir-toolbar">
        <div className="ir-search-wrap">
          <FiSearch size={15} className="ir-search-icon" />
          <input className="ir-search" placeholder="Search by product or category…" value={search} onChange={e => setSearch(e.target.value)} />
          {search && <button className="ir-search-clear" onClick={() => setSearch('')}><FiX size={13} /></button>}
        </div>
        <div className="ir-filters">
          <FiFilter size={14} />
          {[
            ['all', `All (${snapshot.products.length})`],
            ['counted', `Counted (${countedCount})`],
            ['variance', `Variance (${varianceCount})`],
            ['short', `Short (${shortCount})`],
            ['done', `Applied (${settled.size})`],
          ].map(([f, label]) => (
            <button key={f} className={`ir-chip ${filter === f ? 'active' : ''}`} onClick={() => setFilter(f)}>{label}</button>
          ))}
        </div>
      </div>

      <div className="ir-table-wrap">
        {filtered.length === 0 ? (
          <div className="ir-empty"><FiPackage size={42} /><p>No products match your filter</p></div>
        ) : (
          <table className="ir-table">
            <thead>
              <tr>
                <th className="ir-expand-col"></th>
                <th>Product</th>
                <th className="ir-num">Expected</th>
                <th className="ir-num">Counted</th>
                <th className="ir-num">Variance</th>
                <th>What happened?</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(p => {
                const counted = countedOf(p.id)
                const v = varianceOf(p)
                const done = settled.get(p.id)
                const busy = applying.has(p.id)
                const open = expanded.has(p.id)
                const e = entries[p.id] || {}
                const isShort = v !== null && v < 0
                const rowClass = done ? 'ir-row-done' : v === null ? '' : v === 0 ? 'ir-row-match' : 'ir-row-disc'

                return [
                  <tr key={p.id} className={rowClass}>
                    <td className="ir-expand-col">
                      <button className="ir-expand" onClick={() => toggleRow(p.id)} aria-expanded={open} title="Show how this figure was reached">
                        {open ? <FiChevronDown size={14} /> : <FiChevronRight size={14} />}
                      </button>
                    </td>
                    <td className="ir-product-name">
                      {p.name}
                      {p.category && <span className="ir-category-inline">{p.category}</span>}
                    </td>
                    <td className="ir-num ir-system-qty">{p.expected ?? 0}</td>
                    <td className="ir-num">
                      <input
                        type="number" min="0" step="1"
                        className={`ir-qty-input ${done ? 'ir-qty-done' : ''}`}
                        value={e.counted ?? ''}
                        onChange={ev => patch(p.id, { counted: ev.target.value })}
                        placeholder="Count"
                        disabled={!!done}
                      />
                    </td>
                    <td className={`ir-num ir-variance ${v === null ? '' : v === 0 ? 'zero' : v > 0 ? 'pos' : 'neg'}`}>
                      {v === null ? <span className="ir-muted">—</span>
                        : v === 0 ? <span className="ir-match-tick"><FiCheck size={13} /></span>
                        : `${v > 0 ? '+' : ''}${v}`}
                    </td>
                    <td className="ir-explain">
                      {done ? (
                        <span className="ir-muted">{done.outcome === 'explained' ? stockLossReasonLabel(done.reason_code) : done.outcome === 'matched' ? '—' : 'Unexplained'}</span>
                      ) : v === null || v === 0 ? (
                        <span className="ir-muted">—</span>
                      ) : isShort ? (
                        <div className="ir-explain-controls">
                          <select
                            className="ir-explain-select"
                            value={e.type === 'loss' ? e.reason_code : 'UNEXPLAINED'}
                            onChange={ev => {
                              const val = ev.target.value
                              patch(p.id, val === 'UNEXPLAINED'
                                ? { type: 'adjustment' }
                                : { type: 'loss', reason_code: val })
                            }}
                          >
                            <option value="UNEXPLAINED">Unexplained — shrinkage</option>
                            <optgroup label="Known loss">
                              {STOCK_LOSS_REASONS.map(r => <option key={r.code} value={r.code}>{r.label}</option>)}
                            </optgroup>
                          </select>
                          <input
                            className="ir-note-input"
                            placeholder="Note (optional)"
                            value={e.note ?? ''}
                            onChange={ev => patch(p.id, { note: ev.target.value })}
                          />
                        </div>
                      ) : (
                        <div className="ir-explain-controls">
                          <span className="ir-surplus-tag" title="Extra stock cannot be a loss — it is recorded as an unexplained adjustment">
                            Surplus — adjustment
                          </span>
                          <input
                            className="ir-note-input"
                            placeholder="Note (optional)"
                            value={e.note ?? ''}
                            onChange={ev => patch(p.id, { note: ev.target.value })}
                          />
                        </div>
                      )}
                    </td>
                    <td>
                      {done
                        ? <span className={`ir-badge ir-badge-${done.outcome}`}>
                            {done.outcome === 'explained' ? <><FiCheckCircle size={12} /> Explained</>
                              : done.outcome === 'matched' ? <><FiCheck size={12} /> Matched</>
                              : 'Unexplained'}
                          </span>
                        : counted !== null
                          ? <span className="ir-badge ir-badge-pending">Counted</span>
                          : <span className="ir-badge ir-badge-none">Not counted</span>}
                    </td>
                    <td>
                      {/* Only once there is a count to apply. A live-looking
                          button on all 240 rows is noise the eye has to filter
                          on every single row of a count. */}
                      {!done && counted !== null && (
                        <button className="ir-apply-btn" disabled={busy} onClick={() => apply(p)}>
                          {busy ? <FiRefreshCw size={13} className="ir-spin" /> : <FiCheck size={13} />} Apply
                        </button>
                      )}
                    </td>
                  </tr>,
                  open && (
                    <tr key={`${p.id}-detail`} className="ir-detail-row">
                      <td></td>
                      <td colSpan={7}>
                        <Breakdown m={p.movements} expected={p.expected} counted={counted} period={snapshot.period} />
                      </td>
                    </tr>
                  ),
                ]
              })}
            </tbody>
          </table>
        )}
      </div>

      {pending.length > 0 && (
        <div className="ir-finalize-bar">
          <span><strong>{pending.length} product{pending.length !== 1 ? 's' : ''}</strong> counted but not yet applied.</span>
          <button className="ir-btn ir-btn-primary" disabled={finalizing} onClick={finalizeAll}>
            {finalizing ? <><FiRefreshCw size={14} className="ir-spin" /> Applying…</> : <><FiCheckCircle size={14} /> Apply All ({pending.length})</>}
          </button>
        </div>
      )}
    </div>
  )
}

// How the expected figure was reached. This is the difference between a
// reconciliation and an overwrite: the operator can see that 5 of the missing 8
// are already accounted for, and only has to explain the other 3.
function Breakdown({ m, expected, counted, period }) {
  const lines = [
    { label: 'Opening stock', value: m.opening, kind: 'base' },
    { label: 'Received', value: m.received, kind: 'in' },
    { label: 'Sold', value: -m.sold, kind: 'out' },
    m.voided ? { label: 'Voided sales returned', value: m.voided, kind: 'in' } : null,
    m.lost ? { label: 'Breakages & losses', value: -m.lost, kind: 'out' } : null,
    m.expired ? { label: 'Expired write-offs', value: -m.expired, kind: 'out' } : null,
    m.corrections ? { label: 'Receiving corrections', value: m.corrections, kind: m.corrections >= 0 ? 'in' : 'out' } : null,
    m.adjusted ? { label: 'Previous adjustments', value: m.adjusted, kind: m.adjusted >= 0 ? 'in' : 'out' } : null,
  ].filter(Boolean)

  const variance = counted === null ? null : counted - expected

  return (
    <div className="ir-breakdown">
      <div className="ir-breakdown-head">
        Movements {period ? `${period.start} → ${period.end}` : ''}
      </div>
      <table className="ir-breakdown-table">
        <tbody>
          {lines.map((l, i) => (
            <tr key={i}>
              <td>{l.label}</td>
              <td className={`ir-bd-num ir-bd-${l.kind}`}>
                {l.kind === 'base' ? l.value : `${l.value > 0 ? '+' : ''}${l.value}`}
              </td>
            </tr>
          ))}
          <tr className="ir-bd-expected">
            <td>Expected on shelf</td>
            <td className="ir-bd-num">{expected}</td>
          </tr>
          {counted !== null && (
            <>
              <tr>
                <td>Counted</td>
                <td className="ir-bd-num">{counted}</td>
              </tr>
              <tr className={`ir-bd-variance ${variance === 0 ? 'zero' : variance > 0 ? 'pos' : 'neg'}`}>
                <td>{variance === 0 ? 'Matches' : variance > 0 ? 'Surplus to explain' : 'Missing, unaccounted for'}</td>
                <td className="ir-bd-num">{variance > 0 ? '+' : ''}{variance}</td>
              </tr>
            </>
          )}
        </tbody>
      </table>
      {m.lost > 0 && (
        <p className="ir-breakdown-note">
          <FiInfo size={12} /> {m.lost} unit{m.lost !== 1 ? 's' : ''} already recorded as breakages or losses in this
          period — those are accounted for and are not part of the variance.
        </p>
      )}
    </div>
  )
}
