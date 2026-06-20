import { useState, useEffect, useRef } from 'react'
import { FiWifi, FiWifiOff, FiServer, FiRefreshCw, FiClock, FiChevronDown, FiX } from 'react-icons/fi'

// Maps a raw channel name like "domain:sales:add" to a short human label
function channelLabel(channel) {
  const map = {
    'domain:sales:add':           'Sale',
    'domain:sales:void':          'Void sale',
    'domain:sales:hold':          'Hold sale',
    'domain:sales:complete':      'Complete sale',
    'domain:expenses:add':        'New expense',
    'domain:expenses:update':     'Update expense',
    'domain:expenses:delete':     'Delete expense',
    'domain:products:add':        'Add product',
    'domain:products:update':     'Update product',
    'domain:products:delete':     'Delete product',
    'domain:products:updateQty':  'Stock qty update',
    'domain:shifts:start':        'Start shift',
    'domain:shifts:close':        'Close shift',
    'domain:shifts:closeAll':     'Close all shifts',
    'domain:eod:add':             'End of Day',
    'domain:stock:addReceiving':  'Stock receiving',
    'domain:stock:recordDirect':  'Direct purchase',
    'domain:users:add':           'Add user',
    'domain:users:update':        'Update user',
    'domain:audit:log':           'Audit log',
  }
  return map[channel] || channel.replace(/^domain:/, '').replace(/:/g, ' › ')
}

function timeAgo(ts) {
  if (!ts) return ''
  const secs = Math.floor((Date.now() - ts) / 1000)
  if (secs < 60) return `${secs}s ago`
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m ago`
  return `${Math.floor(mins / 60)}h ago`
}

export default function LanStatusBar() {
  const [status, setStatus] = useState(null)
  const [open, setOpen] = useState(false)
  const panelRef = useRef(null)

  useEffect(() => {
    const lan = window.stocka?.lan
    if (!lan) return

    lan.getStatus().then(setStatus).catch(() => {})

    const offStatus = lan.onStatusChange?.((s) => setStatus(s))
    const poll = setInterval(() => {
      lan.getStatus().then(setStatus).catch(() => {})
    }, 5000)

    return () => {
      try { offStatus?.() } catch (_) {}
      clearInterval(poll)
    }
  }, [])

  // Close panel when clicking outside
  useEffect(() => {
    if (!open) return
    const handler = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  if (!status || status.mode === 'standalone') return null

  const isServer = status.mode === 'server'
  const isClient = status.mode === 'client'
  const online   = status.clientOnline
  const queued   = status.queueSize || 0
  const items    = status.queueItems || []

  let dotColor, labelText
  if (isServer) {
    dotColor = '#4caf50'
    labelText = `Server · ${status.clientCount || 0} device${status.clientCount !== 1 ? 's' : ''}`
  } else if (isClient && online) {
    dotColor = '#4caf50'
    labelText = queued > 0 ? `${queued} pending` : 'Synced'
  } else if (isClient) {
    dotColor = '#ff9800'
    labelText = queued > 0 ? `Offline · ${queued} queued` : 'Offline'
  } else {
    return null
  }

  const lastSyncStr = status.lastSync
    ? new Date(status.lastSync).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : null

  return (
    <div style={{ position: 'relative' }} ref={panelRef}>
      {/* ── Status pill (clickable) ── */}
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex', alignItems: 'center', gap: '7px',
          padding: '6px 10px', marginBottom: '6px',
          background: open ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.08)',
          borderRadius: '8px', border: 'none',
          fontSize: '12px', color: 'rgba(255,255,255,0.85)',
          cursor: 'pointer', userSelect: 'none', width: '100%',
          transition: 'background 0.15s',
        }}
      >
        <span style={{
          width: '8px', height: '8px', borderRadius: '50%',
          background: dotColor, flexShrink: 0, boxShadow: `0 0 6px ${dotColor}`,
        }} />
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'left' }}>
          {labelText}
        </span>
        <FiChevronDown
          size={12}
          style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s', flexShrink: 0 }}
        />
      </button>

      {/* ── Detail panel ── */}
      {open && (
        <div style={{
          position: 'absolute', bottom: '100%', left: 0, right: 0,
          background: '#1e293b', border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: '10px', padding: '12px', marginBottom: '4px',
          zIndex: 1000, boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
          minWidth: 220,
        }}>
          {/* Header row */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.9)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {isServer ? 'Network — Main' : 'Network — Satellite'}
            </span>
            <button onClick={() => setOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.5)', padding: 2 }}>
              <FiX size={12} />
            </button>
          </div>

          {/* Connection status */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            {isServer
              ? <FiServer size={13} style={{ color: '#4caf50' }} />
              : online
                ? <FiWifi size={13} style={{ color: '#4caf50' }} />
                : <FiWifiOff size={13} style={{ color: '#ff9800' }} />
            }
            <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.8)' }}>
              {isServer
                ? `Listening · ${status.clientCount || 0} satellite${status.clientCount !== 1 ? 's' : ''} connected`
                : online
                  ? `Connected to ${status.serverIp || 'Main'}`
                  : `Offline · reconnecting…`
              }
            </span>
          </div>

          {/* Last sync */}
          {isClient && lastSyncStr && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <FiRefreshCw size={12} style={{ color: 'rgba(255,255,255,0.4)' }} />
              <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)' }}>Last sync: {lastSyncStr}</span>
            </div>
          )}

          {/* Pending queue */}
          {isClient && queued === 0 && (
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', paddingTop: 4 }}>
              No pending operations
            </div>
          )}

          {isClient && items.length > 0 && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#fbbf24', marginBottom: 6 }}>
                {queued} operation{queued !== 1 ? 's' : ''} pending sync
              </div>
              <div style={{ maxHeight: 160, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
                {items.map((item) => (
                  <div key={item.id} style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    background: 'rgba(255,255,255,0.06)', borderRadius: 6,
                    padding: '5px 8px', fontSize: 11,
                  }}>
                    <span style={{ color: 'rgba(255,255,255,0.85)', fontWeight: 500 }}>
                      {channelLabel(item.channel)}
                    </span>
                    <span style={{ color: 'rgba(255,255,255,0.4)', display: 'flex', alignItems: 'center', gap: 4 }}>
                      <FiClock size={10} />
                      {timeAgo(item.timestamp)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Server: connected satellites */}
          {isServer && status.clients?.length > 0 && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.6)', marginBottom: 6 }}>
                Connected satellites
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {status.clients.map((c, i) => (
                  <div key={i} style={{
                    background: 'rgba(255,255,255,0.06)', borderRadius: 6,
                    padding: '5px 8px', fontSize: 11,
                    color: 'rgba(255,255,255,0.75)',
                    display: 'flex', alignItems: 'center', gap: 6,
                  }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#4caf50', flexShrink: 0 }} />
                    {c.ip}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
