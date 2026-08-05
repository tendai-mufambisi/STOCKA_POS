import { useState, useEffect, useCallback, useRef } from 'react'
import { LuTriangleAlert, LuCircleCheck, LuSearch, LuHistory } from 'react-icons/lu'
import {
  getProductsMissingCost, getCostCoverageSummary, setProductCosts, backfillSaleItemCosts,
} from '../database/db'
import { useAuthStore } from '../store/useAuthStore'
import './CostEntry.css'

// Cost entry.
//
// Stocka freezes cost_price onto each sale line at the moment of sale, taken
// from the product's latest receiving. A product that was never received
// freezes 0 — so it reports a 100% margin and looks like the best performer in
// the shop. On the live database that is 224 of 229 stocked products.
//
// No analytics engine can fix that; it is missing data. This screen is how the
// data gets in.
//
// Two design decisions matter more than the layout:
//
//   Ranked by impact, not alphabetically. Told "224 products need costs" an
//   owner gives up. Told "these six are 80% of your uncosted revenue", they fix
//   six. The list leads with the products whose absence has actually distorted
//   the reports.
//
//   Keyboard-first. These tills have no touchscreen. Enter moves down the
//   column, so a whole category can be typed without touching the mouse.

const money = (n) => (n == null ? '—' : `$${Number(n).toFixed(2)}`)
const pct = (n) => (n == null ? '—' : `${Math.round(n * 100)}%`)

export default function CostEntry() {
  const { user } = useAuthStore()
  const [rows, setRows] = useState([])
  const [summary, setSummary] = useState(null)
  const [drafts, setDrafts] = useState({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')
  const [message, setMessage] = useState(null)
  const [backfillPreview, setBackfillPreview] = useState(null)
  const inputRefs = useRef({})

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [missing, cover] = await Promise.all([
        getProductsMissingCost(),
        getCostCoverageSummary(),
      ])
      setRows(missing || [])
      setSummary(cover || null)
    } catch (err) {
      setMessage({ type: 'error', text: `Could not load cost data: ${err.message}` })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const visible = rows.filter(
    (r) => !search || r.name.toLowerCase().includes(search.toLowerCase())
  )

  const pending = Object.entries(drafts).filter(([, v]) => v !== '' && Number(v) > 0)

  // Enter advances down the column rather than submitting, so a run of products
  // can be typed straight through.
  const onKeyDown = (e, index) => {
    if (e.key !== 'Enter') return
    e.preventDefault()
    const next = visible[index + 1]
    if (next) inputRefs.current[next.id]?.focus()
    else handleSave()
  }

  const handleSave = async () => {
    if (pending.length === 0) return
    setSaving(true)
    setMessage(null)
    try {
      const entries = pending.map(([id, cost]) => ({ productId: Number(id), cost: Number(cost) }))
      const res = await setProductCosts(entries, user?.username || 'System')
      setDrafts({})
      await load()
      setMessage({
        type: res.failed ? 'warn' : 'ok',
        text: res.failed
          ? `Saved ${res.saved}, but ${res.failed} failed: ${res.failures[0]?.error}`
          : `Saved ${res.saved} cost${res.saved === 1 ? '' : 's'}.`,
      })
    } catch (err) {
      setMessage({ type: 'error', text: `Could not save: ${err.message}` })
    } finally {
      setSaving(false)
    }
  }

  // Always previewed before it runs. This is the one action in the app that
  // changes an already-reported figure, so it never happens by accident.
  const previewBackfill = async () => {
    try {
      setBackfillPreview(await backfillSaleItemCosts({ dryRun: true }))
    } catch (err) {
      setMessage({ type: 'error', text: `Could not preview: ${err.message}` })
    }
  }

  const runBackfill = async () => {
    setSaving(true)
    try {
      const res = await backfillSaleItemCosts({ recordedBy: user?.username || 'System' })
      setBackfillPreview(null)
      await load()
      setMessage({
        type: 'ok',
        text: `Corrected ${res.linesUpdated} sold line${res.linesUpdated === 1 ? '' : 's'}. ` +
          `Cost of goods increased by ${money(res.cogsAdded)}, so past profit will now read lower — and more accurately.`,
      })
    } catch (err) {
      setMessage({ type: 'error', text: `Backfill failed: ${err.message}` })
    } finally {
      setSaving(false)
    }
  }

  const coverage = summary?.revenueCoverage

  return (
    <div className="cost-entry">
      <div className="page-header">
        <h1>Cost Prices</h1>
        <p>Products with no cost recorded, ranked by how much their absence distorts your reports</p>
      </div>

      {summary && (
        <div className="ce-summary">
          <div className={`ce-stat ${coverage != null && coverage < 0.9 ? 'warn' : 'ok'}`}>
            <span className="ce-stat-value">{pct(coverage)}</span>
            <span className="ce-stat-label">of revenue has a known cost</span>
            <span className="ce-stat-sub">
              {coverage != null && coverage < 0.9
                ? 'Margin and profit figures are unreliable below 90%'
                : 'Margin figures can be trusted'}
            </span>
          </div>
          <div className="ce-stat">
            <span className="ce-stat-value">
              {summary.productsStockedCosted}<span className="ce-of">/{summary.productsStocked}</span>
            </span>
            <span className="ce-stat-label">stocked products costed</span>
            <span className="ce-stat-sub">{summary.productsMissingCost} still to do</span>
          </div>
          <div className="ce-stat">
            <span className="ce-stat-value">{money(summary.revenueUncosted)}</span>
            <span className="ce-stat-label">revenue reported at 100% margin</span>
            <span className="ce-stat-sub">last {summary.revenueWindowDays} days · not real profit</span>
          </div>
        </div>
      )}

      {message && (
        <div className={`ce-message ce-${message.type}`}>
          {message.type === 'ok' ? <LuCircleCheck /> : <LuTriangleAlert />}
          <span>{message.text}</span>
        </div>
      )}

      {/* Correcting history is offered only once there is something to correct
          it with, and always behind a preview. */}
      {summary?.backfillableLines > 0 && (
        <div className="ce-backfill">
          <LuHistory className="ce-backfill-icon" />
          <div className="ce-backfill-body">
            <strong>{summary.backfillableLines} past sale{summary.backfillableLines === 1 ? '' : 's'} can be corrected</strong>
            <p>
              These were sold before their product had a cost, so they were recorded at a 100% margin.
              Now that the cost is known they can be filled in. Only lines with no cost at all are touched,
              each one is stamped as corrected, and reports will say so rather than presenting the new
              figures as original.
            </p>
            {backfillPreview ? (
              <div className="ce-backfill-preview">
                <p>
                  This will correct <strong>{backfillPreview.linesUpdated}</strong> lines across{' '}
                  <strong>{backfillPreview.productsAffected}</strong> products, adding{' '}
                  <strong>{money(backfillPreview.cogsAdded)}</strong> to cost of goods.
                  Reported profit for those periods will fall by that amount.
                </p>
                <div className="ce-backfill-actions">
                  <button className="btn-primary" onClick={runBackfill} disabled={saving}>
                    Correct {backfillPreview.linesUpdated} lines
                  </button>
                  <button className="btn-ghost" onClick={() => setBackfillPreview(null)}>Cancel</button>
                </div>
              </div>
            ) : (
              <button className="btn-secondary" onClick={previewBackfill}>Preview correction</button>
            )}
          </div>
        </div>
      )}

      <div className="ce-toolbar">
        <div className="ce-search">
          <LuSearch />
          <input
            type="text"
            placeholder="Search products…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <button className="btn-primary" onClick={handleSave} disabled={saving || pending.length === 0}>
          {saving ? 'Saving…' : `Save ${pending.length || ''} cost${pending.length === 1 ? '' : 's'}`}
        </button>
      </div>

      {loading ? (
        <p className="ce-empty">Loading…</p>
      ) : visible.length === 0 ? (
        <div className="ce-done">
          <LuCircleCheck />
          <h2>{rows.length === 0 ? 'Every product has a cost' : 'No products match that search'}</h2>
          {rows.length === 0 && <p>Margin and profit figures can be trusted.</p>}
        </div>
      ) : (
        <div className="ce-table-wrap">
          <table className="ce-table">
            <thead>
              <tr>
                <th>Product</th>
                <th>Category</th>
                <th className="num">In stock</th>
                <th className="num">Sells for</th>
                <th className="num">Sold (90d)</th>
                <th className="num">Revenue at 100%</th>
                <th className="num">Cost per {'unit'}</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r, i) => (
                <tr key={r.id} className={drafts[r.id] ? 'ce-dirty' : ''}>
                  <td className="ce-name">{r.name}</td>
                  <td className="ce-muted">{r.category || '—'}</td>
                  <td className="num">{r.qty}</td>
                  <td className="num">{money(r.selling_price)}</td>
                  <td className="num">{r.units_sold || 0}</td>
                  {/* The whole reason this row is near the top. */}
                  <td className={`num ${r.revenueAtRisk > 0 ? 'ce-risk' : 'ce-muted'}`}>
                    {r.revenueAtRisk > 0 ? money(r.revenueAtRisk) : '—'}
                  </td>
                  <td className="num">
                    <input
                      ref={(el) => { inputRefs.current[r.id] = el }}
                      className="ce-input"
                      type="number"
                      min="0"
                      step="0.01"
                      inputMode="decimal"
                      placeholder="0.00"
                      value={drafts[r.id] ?? ''}
                      onChange={(e) => setDrafts({ ...drafts, [r.id]: e.target.value })}
                      onKeyDown={(e) => onKeyDown(e, i)}
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
}
