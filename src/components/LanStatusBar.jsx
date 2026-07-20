import { useState, useEffect, useRef } from 'react'
import { FiWifi, FiWifiOff, FiServer, FiRefreshCw, FiChevronDown, FiX, FiAlertTriangle } from 'react-icons/fi'


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

  const isServer    = status.mode === 'server'
  const isClient    = status.mode === 'client'
  const online      = status.clientOnline
  const connecting  = status.clientConnecting ?? false
  // Business writes only. Falls back to the raw size for older main-process builds.
  const queued      = status.queueBusinessSize ?? status.queueSize ?? 0

  let dotColor, labelText
  if (isServer) {
    dotColor = '#4caf50'
    labelText = `Server · ${status.clientCount || 0} device${status.clientCount !== 1 ? 's' : ''}`
  } else if (isClient && connecting) {
    dotColor = 'rgba(255,255,255,0.35)'
    labelText = 'Connecting…'
  } else if (isClient && online) {
    dotColor = '#4caf50'
    labelText = queued > 0 ? 'Syncing…' : 'Synced'
  } else if (isClient) {
    dotColor = '#ff9800'
    labelText = 'Offline'
  } else {
    return null
  }

  // "Last sync" is shown from THIS machine's clock (lastSyncAt). The old field
  // (status.lastSync) is Main's clock and reads hours wrong whenever Main's
  // timezone is misconfigured — which is exactly when the user needs the truth.
  const lastSyncStr = status.lastSyncAt
    ? new Date(status.lastSyncAt).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : null

  // Satellite alert banner — anything that risks losing or mistiming sales must be
  // impossible to miss. One banner at a time, worst problem first.
  const skewHours   = (status.clockSkewMs || 0) / 3600000
  const clockSkewed = isClient && online && (status.clockSkewMs || 0) > 90_000
  const syncStale   = isClient && online && !!status.lastSyncError &&
    (!status.lastSyncAt || Date.now() - status.lastSyncAt > 120_000)

  let banner = null
  if (isClient && !connecting && !online) {
    banner = {
      bg: '#dc2626', icon: <FiWifiOff size={15} />,
      text: queued > 0
        ? `OFFLINE — ${queued} record${queued !== 1 ? 's' : ''} saved on this till, waiting to sync to Main`
        : 'OFFLINE — no connection to Main. Sales will be saved here and synced when Main is back.',
    }
  } else if (syncStale) {
    banner = {
      bg: '#dc2626', icon: <FiAlertTriangle size={15} />,
      text: `Connected to Main but data is NOT syncing (${status.lastSyncError}). Try Settings → Network → Force Full Resync.`,
    }
  } else if (clockSkewed) {
    banner = {
      bg: '#d97706', icon: <FiAlertTriangle size={15} />,
      text: `This till's clock and Main's clock differ by ${skewHours >= 1 ? `~${skewHours.toFixed(1)} hours` : `${Math.round((status.clockSkewMs || 0) / 60000)} min`} — fix the Windows date/time/timezone on BOTH computers. Sale times and daily totals are wrong until fixed.`,
    }
  } else if (isClient && !connecting && queued > 0) {
    banner = {
      bg: '#d97706', icon: <FiRefreshCw size={15} />,
      text: `Syncing ${queued} pending record${queued !== 1 ? 's' : ''} to Main…`,
    }
  }

  const alertBanner = banner ? (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9999,
      background: banner.bg,
      color: '#fff', padding: '8px 16px',
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
      fontSize: 13, fontWeight: 700, letterSpacing: '0.02em',
      boxShadow: '0 2px 12px rgba(0,0,0,0.35)',
    }}>
      {banner.icon}
      {banner.text}
    </div>
  ) : null

  return (
    <div style={{ position: 'relative' }} ref={panelRef}>
      {alertBanner}
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
              : connecting
                ? <FiRefreshCw size={13} style={{ color: 'rgba(255,255,255,0.45)' }} />
                : online
                  ? <FiWifi size={13} style={{ color: '#4caf50' }} />
                  : <FiWifiOff size={13} style={{ color: '#ff9800' }} />
            }
            <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.8)' }}>
              {isServer
                ? `Listening · ${status.clientCount || 0} satellite${status.clientCount !== 1 ? 's' : ''} connected`
                : connecting
                  ? `Connecting to ${status.serverIp || 'Main'}…`
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

          {/* Pending queue count */}
          {isClient && queued > 0 && (
            <div style={{
              fontSize: 11, fontWeight: 700, color: '#fbbf24', paddingTop: 4,
              display: 'flex', alignItems: 'center', gap: 6,
            }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#fbbf24', flexShrink: 0 }} />
              {queued} write{queued !== 1 ? 's' : ''} pending sync to Main
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
