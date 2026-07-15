import React, { useState, useEffect, useCallback } from 'react'
import { getAuditLog } from '../database/db'
import { parseDbDate, localDateStr } from '../utils/salesDay'
import { FiSearch, FiRefreshCw } from 'react-icons/fi'
import './ActivityLogs.css'

const ACTION_META = {
  LOGIN:          { label: 'Login',          cls: 'badge-green' },
  LOGIN_FAILED:   { label: 'Login Failed',   cls: 'badge-red' },
  LOGOUT:         { label: 'Logout',         cls: 'badge-blue' },
  SHIFT_OPENED:   { label: 'Shift Opened',   cls: 'badge-teal' },
  SHIFT_CLOSED:   { label: 'Shift Closed',   cls: 'badge-amber' },
  PRODUCT_CREATED:{ label: 'Product Added',  cls: 'badge-green' },
  PRODUCT_UPDATED:{ label: 'Product Updated',cls: 'badge-blue' },
  PRODUCT_DELETED:{ label: 'Product Deleted',cls: 'badge-red' },
  SALE_COMPLETED: { label: 'Sale',           cls: 'badge-green' },
  SALE_VOIDED:    { label: 'Sale Voided',    cls: 'badge-red' },
}

function fmt(iso) {
  if (!iso) return '—'
  return parseDbDate(iso).toLocaleString('en-ZW', { dateStyle: 'short', timeStyle: 'short' })
}

export default function ActivityLogs() {
  const today = localDateStr()
  const sevenAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

  const [logs, setLogs]             = useState([])
  const [loading, setLoading]       = useState(true)
  const [startDate, setStartDate]   = useState(sevenAgo)
  const [endDate, setEndDate]       = useState(today)
  const [search, setSearch]         = useState('')
  const [actionFilter, setFilter]   = useState('all')

  const load = useCallback(async () => {
    setLoading(true)
    try { setLogs(await getAuditLog(startDate, endDate) || []) }
    catch { setLogs([]) }
    finally { setLoading(false) }
  }, [startDate, endDate])

  useEffect(() => { load() }, [load])

  const q = search.toLowerCase()
  const filtered = logs.filter(l => {
    if (actionFilter !== 'all' && l.action_type !== actionFilter) return false
    if (q) return (
      l.username?.toLowerCase().includes(q) ||
      l.description?.toLowerCase().includes(q) ||
      l.entity_type?.toLowerCase().includes(q)
    )
    return true
  })

  const actionTypes = [...new Set(logs.map(l => l.action_type))].sort()

  return (
    <div className="alog-page">
      <div className="alog-toolbar">
        <div className="alog-date-range">
          <input type="date" value={startDate} max={endDate}
            onChange={e => setStartDate(e.target.value)} className="alog-date-input" />
          <span className="alog-date-sep">→</span>
          <input type="date" value={endDate} min={startDate} max={today}
            onChange={e => setEndDate(e.target.value)} className="alog-date-input" />
        </div>

        <select value={actionFilter} onChange={e => setFilter(e.target.value)} className="alog-type-select">
          <option value="all">All Actions</option>
          {actionTypes.map(t => (
            <option key={t} value={t}>{ACTION_META[t]?.label || t}</option>
          ))}
        </select>

        <div className="alog-search-wrap">
          <FiSearch size={13} className="alog-search-icon" />
          <input type="text" placeholder="Search user, description…"
            value={search} onChange={e => setSearch(e.target.value)}
            className="alog-search-input" />
        </div>

        <button className="alog-refresh-btn" onClick={load} title="Refresh">
          <FiRefreshCw size={14} className={loading ? 'alog-spin' : ''} />
        </button>
      </div>

      <div className="alog-meta-row">
        <span className="alog-count">
          {filtered.length} {filtered.length === 1 ? 'entry' : 'entries'}
          {filtered.length !== logs.length && <> · {logs.length} total</>}
        </span>
      </div>

      {loading ? (
        <div className="alog-placeholder">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="alog-placeholder">No log entries match your filters.</div>
      ) : (
        <div className="alog-table-wrap">
          <table className="alog-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>User</th>
                <th>Action</th>
                <th>Machine</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(l => {
                const meta = ACTION_META[l.action_type] || { label: l.action_type, cls: 'badge-gray' }
                return (
                  <tr key={l.id}>
                    <td className="alog-time">{fmt(l.created_at)}</td>
                    <td className="alog-user">{l.username || '—'}</td>
                    <td><span className={`alog-badge ${meta.cls}`}>{meta.label}</span></td>
                    <td className="alog-machine">{l.machine_name || '—'}</td>
                    <td className="alog-desc">{l.description || '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
