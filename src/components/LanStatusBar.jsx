import { useState, useEffect } from 'react'

export default function LanStatusBar() {
  const [status, setStatus] = useState(null)

  useEffect(() => {
    const lan = window.stocka?.lan
    if (!lan) return

    lan.getStatus().then(setStatus).catch(() => {})

    const off = lan.onStatusChange?.((s) => setStatus(s))
    return () => { try { off?.() } catch (_) {} }
  }, [])

  if (!status || status.mode === 'standalone') return null

  const isServer = status.mode === 'server'
  const isClient = status.mode === 'client'
  const online   = status.clientOnline
  const queued   = status.queueSize || 0

  let dot, label
  if (isServer) {
    dot = '#4caf50'
    label = `Server · ${status.clientCount || 0} client${status.clientCount !== 1 ? 's' : ''}`
  } else if (isClient && online) {
    dot = '#4caf50'
    label = queued > 0 ? `Syncing (${queued} pending)` : 'Synced'
  } else if (isClient) {
    dot = '#ff9800'
    label = queued > 0 ? `Offline · ${queued} queued` : 'Offline'
  } else {
    return null
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '7px',
      padding: '6px 10px', marginBottom: '6px',
      background: 'rgba(255,255,255,0.08)', borderRadius: '8px',
      fontSize: '12px', color: 'rgba(255,255,255,0.85)', cursor: 'default',
      userSelect: 'none',
    }}>
      <span style={{
        width: '8px', height: '8px', borderRadius: '50%',
        background: dot, flexShrink: 0,
        boxShadow: `0 0 6px ${dot}`,
      }} />
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {label}
      </span>
    </div>
  )
}
