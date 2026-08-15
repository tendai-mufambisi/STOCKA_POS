import { useState, useEffect, useMemo, useRef } from 'react'
import { getStockLosses, getStockLossSummary, recordStockLoss, reverseStockLoss, getProducts } from '../database/db'
import { useAuthStore } from '../store/useAuthStore'
import { useLanSync } from '../hooks/useLanSync'
import { STOCK_LOSS_REASONS, stockLossReasonLabel } from '../utils/stockLossReasons'
import './StockLosses.css'
import {
  FiPlus, FiX, FiCheck, FiRotateCcw, FiSearch, FiPackage,
  FiAlertTriangle, FiChevronLeft, FiChevronRight, FiInfo
} from 'react-icons/fi'

// Local YYYY-MM-DD. Deliberately not toISOString(), which converts to UTC and
// reports "yesterday" for anything logged after 10pm Zimbabwe time.
const ymd = (d) => {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
const monthBounds = (year, month) => ({
  start: ymd(new Date(year, month, 1)),
  end: ymd(new Date(year, month + 1, 0)),
})
const money = (n) => `$${(n || 0).toFixed(2)}`

function StockLosses() {
  const { user } = useAuthStore()
  // Reversing restores stock, so it sits at the same privilege bar as discarding
  // an expired batch or correcting a receiving. Recording is open to anyone who
  // can reach the page — which is the admin's choice, made in Role Privileges.
  const canReverse = user?.role === 'Admin' || user?.role === 'Manager'

  const [losses, setLosses] = useState([])
  const [summary, setSummary] = useState(null)
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const today = new Date()
  const [cursor, setCursor] = useState({ year: today.getFullYear(), month: today.getMonth() })
  const [reasonFilter, setReasonFilter] = useState('ALL')
  const [search, setSearch] = useState('')

  const [showRecord, setShowRecord] = useState(false)
  const [reverseTarget, setReverseTarget] = useState(null)
  const successTimer = useRef(null)

  const range = useMemo(() => monthBounds(cursor.year, cursor.month), [cursor])

  useEffect(() => { loadData() }, [range.start, range.end])
  useLanSync(() => loadData(true))

  const loadData = async (silent = false) => {
    try {
      if (!silent) setLoading(true)
      const [rows, sum, prods] = await Promise.all([
        getStockLosses({ start: range.start, end: range.end }),
        getStockLossSummary({ start: range.start, end: range.end }),
        getProducts(),
      ])
      setLosses(rows || [])
      setSummary(sum || null)
      setProducts(prods || [])
      setError('')
    } catch (err) {
      setError(err?.message || 'Failed to load breakage records')
    } finally {
      if (!silent) setLoading(false)
    }
  }

  const flash = (msg) => {
    setSuccess(msg)
    clearTimeout(successTimer.current)
    successTimer.current = setTimeout(() => setSuccess(''), 6000)
  }
  useEffect(() => () => clearTimeout(successTimer.current), [])

  const shiftMonth = (delta) => {
    const d = new Date(cursor.year, cursor.month + delta, 1)
    // Never page into a month that cannot contain records yet.
    if (d > new Date(today.getFullYear(), today.getMonth(), 1)) return
    setCursor({ year: d.getFullYear(), month: d.getMonth() })
  }
  const isCurrentMonth = cursor.year === today.getFullYear() && cursor.month === today.getMonth()
  const monthLabel = new Date(cursor.year, cursor.month, 1)
    .toLocaleDateString('en-ZW', { month: 'long', year: 'numeric' })

  const todayStr = ymd(today)
  const todayUnits = losses
    .filter(r => !r.reversed && r.created_at?.slice(0, 10) === todayStr)
    .reduce((n, r) => n + r.quantity, 0)

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return losses.filter(r => {
      if (reasonFilter !== 'ALL' && r.reason_code !== reasonFilter) return false
      if (q && !r.product_name?.toLowerCase().includes(q) && !r.note?.toLowerCase().includes(q)) return false
      return true
    })
  }, [losses, reasonFilter, search])

  // Only offer filters for reasons that actually occur this month.
  const reasonsPresent = useMemo(() => {
    const seen = new Map()
    for (const r of losses) seen.set(r.reason_code, (seen.get(r.reason_code) || 0) + 1)
    return [...seen.entries()].sort((a, b) => b[1] - a[1])
  }, [losses])

  const topReason = summary?.by_reason?.[0]
  const topProduct = summary?.by_product?.[0]

  if (loading) return <div className="sl-page"><div className="loading">Loading…</div></div>

  return (
    <div className="sl-page">
      <div className="sl-header">
        <div>
          <h1>Breakages &amp; Losses</h1>
          <p>Stock that left the shelves without being sold — broken, damaged, spoiled, lost or stolen.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowRecord(true)}>
          <FiPlus size={14} /> Record Loss
        </button>
      </div>

      {error && <div className="error-banner">{error}</div>}
      {success && <div className="success-banner">{success}</div>}

      {/* ── Month ── */}
      <div className="sl-monthbar">
        <button className="sl-month-nav" onClick={() => shiftMonth(-1)} title="Previous month">
          <FiChevronLeft size={16} />
        </button>
        <span className="sl-month-label">{monthLabel}</span>
        <button
          className="sl-month-nav"
          onClick={() => shiftMonth(1)}
          disabled={isCurrentMonth}
          title={isCurrentMonth ? 'This is the current month' : 'Next month'}
        >
          <FiChevronRight size={16} />
        </button>
      </div>

      {/* ── Summary ── */}
      <div className="sl-cards">
        <div className="sl-card">
          <span className="sl-card-label">This month</span>
          <span className="sl-card-value">{summary?.units ?? 0}<em>units</em></span>
          <span className="sl-card-sub">
            {summary?.incidents ?? 0} record{(summary?.incidents ?? 0) !== 1 ? 's' : ''} ·
            {' '}{summary?.products_affected ?? 0} product{(summary?.products_affected ?? 0) !== 1 ? 's' : ''}
          </span>
        </div>

        <div className="sl-card">
          <span className="sl-card-label">Today</span>
          <span className="sl-card-value">{todayUnits}<em>units</em></span>
          <span className="sl-card-sub">
            {isCurrentMonth ? 'Recorded so far today' : 'Today falls outside the month shown'}
          </span>
        </div>

        <div className="sl-card">
          <span className="sl-card-label">Value lost</span>
          <span className="sl-card-value">{money(summary?.value)}</span>
          {/* The headline is units, not money: most products here have no cost on
              record, and a total that treats unknown as zero understates the loss
              while looking authoritative. Say how much of it is actually backed. */}
          <span className={`sl-card-sub${summary?.unvalued_units ? ' warn' : ''}`}>
            {summary?.unvalued_units
              ? `${summary.valued_units} of ${summary.units} units have a cost on record`
              : summary?.units ? 'All lost units have a cost on record' : 'Nothing recorded yet'}
          </span>
        </div>

        <div className="sl-card">
          <span className="sl-card-label">Most affected</span>
          <span className="sl-card-value sl-card-value-text">
            {topProduct ? topProduct.product_name : '—'}
          </span>
          <span className="sl-card-sub">
            {topProduct
              ? `${topProduct.units} units · mostly ${stockLossReasonLabel(topReason?.reason_code)}`
              : 'No losses recorded this month'}
          </span>
        </div>
      </div>

      {/* ── Filters ── */}
      <div className="sl-toolbar">
        <div className="sl-search">
          <FiSearch size={14} />
          <input
            placeholder="Search product or note…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {search && <button onClick={() => setSearch('')}><FiX size={12} /></button>}
        </div>
        <div className="sl-chips">
          <button
            className={`sl-chip${reasonFilter === 'ALL' ? ' active' : ''}`}
            onClick={() => setReasonFilter('ALL')}
          >All ({losses.length})</button>
          {reasonsPresent.map(([code, n]) => (
            <button
              key={code}
              className={`sl-chip${reasonFilter === code ? ' active' : ''}`}
              onClick={() => setReasonFilter(code)}
            >{stockLossReasonLabel(code)} ({n})</button>
          ))}
        </div>
      </div>

      {/* ── Table ── */}
      {visible.length === 0 ? (
        <div className="empty-state">
          <FiPackage className="icon" />
          <h3>{losses.length === 0 ? 'No losses recorded this month' : 'Nothing matches that filter'}</h3>
          <p>
            {losses.length === 0
              ? 'When something breaks, spoils or goes missing, record it here so the stock figures stay honest.'
              : 'Try a different reason or clear the search.'}
          </p>
        </div>
      ) : (
        <div className="sl-table-wrap">
          <table className="sl-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Product</th>
                <th className="num">Qty</th>
                <th>Reason</th>
                <th className="num">Cost</th>
                <th>Recorded by</th>
                <th>Note</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {visible.map(r => (
                <tr key={`${r.source}-${r.id}`} className={r.reversed ? 'sl-row-reversed' : ''}>
                  <td className="sl-date">
                    {new Date(r.created_at.replace(' ', 'T') + 'Z').toLocaleDateString('en-ZW', { day: '2-digit', month: 'short' })}
                  </td>
                  <td className="sl-product">{r.product_name}</td>
                  <td className="num sl-qty">−{r.quantity}</td>
                  <td>
                    <span className={`sl-reason sl-reason-${r.reason_code.toLowerCase()}`}>
                      {stockLossReasonLabel(r.reason_code)}
                    </span>
                    {r.source === 'expiry' && (
                      <span className="sl-src" title="Recorded in Expiry Tracking">Expiry</span>
                    )}
                  </td>
                  <td className="num">
                    {r.cost_known
                      ? money(r.total_cost)
                      : <span className="sl-nocost" title="No cost price on record for this product">—</span>}
                  </td>
                  <td className="sl-by">{r.recorded_by}</td>
                  <td className="sl-note">{r.note || <span className="sl-muted">—</span>}</td>
                  <td className="sl-actions">
                    {r.reversed ? (
                      <span className="sl-badge-reversed" title={`Reversed by ${r.reversed_by}: ${r.reversal_reason}`}>
                        Reversed
                      </span>
                    ) : canReverse && r.source === 'loss' ? (
                      <button className="sl-reverse-btn" onClick={() => setReverseTarget(r)}>
                        <FiRotateCcw size={12} /> Reverse
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="sl-footnote">
        <FiInfo size={13} />
        <span>
          Expired stock is written off in <strong>Expiry Tracking</strong>, which also clears the batch from
          the expiry list. Those write-offs appear here so this page shows everything the shop lost,
          but they are recorded there.
        </span>
      </div>

      {showRecord && (
        <RecordLossModal
          products={products}
          user={user}
          onClose={() => setShowRecord(false)}
          onSaved={(result) => {
            setShowRecord(false)
            flash(
              `${Math.abs(result.quantity)} unit${Math.abs(result.quantity) !== 1 ? 's' : ''} of "${result.product_name}" ` +
              `written off as ${stockLossReasonLabel(result.reason_code).toLowerCase()}.`
            )
            loadData(true)
          }}
        />
      )}

      {reverseTarget && (
        <ReverseLossModal
          loss={reverseTarget}
          user={user}
          onClose={() => setReverseTarget(null)}
          onDone={(result) => {
            setReverseTarget(null)
            flash(`${result.units_returned} unit${result.units_returned !== 1 ? 's' : ''} of "${result.product_name}" returned to stock — now ${result.new_stock_qty}.`)
            loadData(true)
          }}
        />
      )}
    </div>
  )
}

// ── Record ────────────────────────────────────────────────────────────────────
// Keyboard-first: the tills have no touchscreen, so the flow is type-to-search,
// arrow to pick, Enter to move on, Enter to save.
function RecordLossModal({ products, user, onClose, onSaved }) {
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState(null)
  const [highlight, setHighlight] = useState(0)
  const [qty, setQty] = useState('')
  const [reason, setReason] = useState('BROKEN')
  const [note, setNote] = useState('')
  const [date, setDate] = useState(ymd(new Date()))
  const [err, setErr] = useState('')
  const [saving, setSaving] = useState(false)
  const qtyRef = useRef(null)

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q || picked) return []
    return products
      .filter(p => p.name?.toLowerCase().includes(q) || String(p.barcode || '').includes(q))
      .slice(0, 6)
  }, [query, products, picked])

  const choose = (p) => {
    setPicked(p)
    setQuery(p.name)
    setErr('')
    setTimeout(() => qtyRef.current?.focus(), 0)
  }

  const onSearchKey = (e) => {
    if (!matches.length) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight(h => Math.min(h + 1, matches.length - 1)) }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setHighlight(h => Math.max(h - 1, 0)) }
    if (e.key === 'Enter')     { e.preventDefault(); choose(matches[highlight]) }
  }

  const onHand = picked?.current_quantity ?? 0
  const qtyNum = parseInt(qty)
  const qtyValid = Number.isFinite(qtyNum) && qtyNum > 0 && qtyNum <= onHand

  const submit = async () => {
    if (!picked) { setErr('Choose a product first'); return }
    if (!Number.isFinite(qtyNum) || qtyNum <= 0) { setErr('Enter how many units were lost'); return }
    if (qtyNum > onHand) { setErr(`Only ${onHand} units of "${picked.name}" are in stock`); return }
    if (reason === 'OTHER' && !note.trim()) { setErr('Describe what happened when the reason is "Other"'); return }
    setSaving(true)
    setErr('')
    try {
      const saved = await recordStockLoss({
        product_id: picked.id,
        quantity: qtyNum,
        reason_code: reason,
        note: note.trim(),
        loss_date: date,
        recorded_by: user?.username || 'System',
      })
      onSaved(saved)
    } catch (e) {
      setErr(e?.message || 'Could not record the loss')
      setSaving(false)
    }
  }

  return (
    <div className="form-overlay" onClick={onClose}>
      <div className="product-form sl-modal" onClick={e => e.stopPropagation()}>
        <div className="form-header">
          <h2>Record Loss</h2>
          <button className="close-btn" onClick={onClose}><FiX size={14} /></button>
        </div>

        {err && <div className="error-banner">{err}</div>}

        <div className="form-row">
          <div className="form-group sl-picker">
            <label>Product *</label>
            <input
              autoFocus
              value={query}
              placeholder="Type a product name or scan a barcode…"
              onChange={e => { setQuery(e.target.value); setPicked(null); setHighlight(0); setErr('') }}
              onKeyDown={onSearchKey}
            />
            {matches.length > 0 && (
              <ul className="sl-suggest">
                {matches.map((p, i) => (
                  <li
                    key={p.id}
                    className={i === highlight ? 'active' : ''}
                    onMouseEnter={() => setHighlight(i)}
                    onMouseDown={(e) => { e.preventDefault(); choose(p) }}
                  >
                    <span>{p.name}</span>
                    <span className="sl-suggest-qty">{p.current_quantity ?? 0} in stock</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {picked && (
          <div className="sl-picked">
            <div className="sl-picked-row">
              <span>In stock now</span>
              <strong>{onHand} units</strong>
            </div>
            <div className="sl-picked-row">
              <span>After this loss</span>
              <strong className={qtyValid ? 'ok' : ''}>
                {qtyValid ? `${onHand - qtyNum} units` : '—'}
              </strong>
            </div>
          </div>
        )}

        <div className="form-row sl-two">
          <div className="form-group">
            <label>Quantity lost *</label>
            <input
              ref={qtyRef}
              type="number" min="1" step="1" max={onHand || undefined}
              value={qty}
              onChange={e => { setQty(e.target.value); setErr('') }}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submit() } }}
            />
            {picked && qty !== '' && qtyNum > onHand && (
              <p className="field-hint warn">Only {onHand} in stock — you cannot write off more than that.</p>
            )}
          </div>
          <div className="form-group">
            <label>Date *</label>
            <input
              type="date"
              value={date}
              max={ymd(new Date())}
              onChange={e => { setDate(e.target.value); setErr('') }}
            />
            <p className="field-hint">Days already closed off by End of Day cannot be changed.</p>
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label>Reason *</label>
            <select value={reason} onChange={e => { setReason(e.target.value); setErr('') }}>
              {STOCK_LOSS_REASONS.map(r => (
                <option key={r.code} value={r.code}>{r.label}</option>
              ))}
            </select>
            <p className="field-hint">
              {STOCK_LOSS_REASONS.find(r => r.code === reason)?.hint}
              {' · '}Expired stock is written off in Expiry Tracking.
            </p>
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label>What happened{reason === 'OTHER' ? ' *' : ''}</label>
            <textarea
              rows={2}
              value={note}
              placeholder="e.g. Two bottles fell while restocking the fridge"
              onChange={e => { setNote(e.target.value); setErr('') }}
            />
          </div>
        </div>

        <div className="sl-recorded-by">
          Recording as <strong>{user?.username || 'System'}</strong>
        </div>

        <div className="form-actions">
          <button className="btn btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn btn-primary" onClick={submit} disabled={saving}>
            {saving ? 'Saving…' : <><FiCheck size={14} /> Record Loss</>}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Reverse ───────────────────────────────────────────────────────────────────
function ReverseLossModal({ loss, user, onClose, onDone }) {
  const [reason, setReason] = useState('')
  const [err, setErr] = useState('')
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    if (!reason.trim()) { setErr('Say why this record is being reversed'); return }
    setSaving(true)
    setErr('')
    try {
      onDone(await reverseStockLoss(loss.id, reason.trim(), user?.username || 'System'))
    } catch (e) {
      setErr(e?.message || 'Could not reverse the loss')
      setSaving(false)
    }
  }

  return (
    <div className="form-overlay" onClick={onClose}>
      <div className="product-form sl-modal sl-modal-narrow" onClick={e => e.stopPropagation()}>
        <div className="form-header">
          <h2>Reverse Loss</h2>
          <button className="close-btn" onClick={onClose}><FiX size={14} /></button>
        </div>

        <div className="sl-picked">
          <div className="sl-picked-row"><span>Product</span><strong>{loss.product_name}</strong></div>
          <div className="sl-picked-row"><span>Written off</span><strong>{loss.quantity} units · {stockLossReasonLabel(loss.reason_code)}</strong></div>
          <div className="sl-picked-row"><span>Recorded by</span><strong>{loss.recorded_by}</strong></div>
        </div>

        <div className="sl-warn">
          <FiAlertTriangle size={14} />
          <span>
            {loss.quantity} units go back into stock. The original record stays on the list marked
            as reversed — it is not deleted, so the history stays intact.
          </span>
        </div>

        {err && <div className="error-banner">{err}</div>}

        <div className="form-row">
          <div className="form-group">
            <label>Why is this being reversed? *</label>
            <input
              autoFocus
              value={reason}
              placeholder="e.g. Entered against the wrong product"
              onChange={e => { setReason(e.target.value); setErr('') }}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submit() } }}
            />
          </div>
        </div>

        <div className="form-actions">
          <button className="btn btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn btn-primary" onClick={submit} disabled={saving}>
            {saving ? 'Saving…' : <><FiRotateCcw size={14} /> Reverse Loss</>}
          </button>
        </div>
      </div>
    </div>
  )
}

export default StockLosses
