import { useState, useEffect, useCallback } from 'react'
import './LanSettings.css'

const MODES = {
  standalone: { label: 'Standalone', desc: 'Single computer, no network sharing (default).' },
  server:     { label: 'Main Computer', desc: 'This machine is the authoritative database server. Other computers connect to it.' },
  client:     { label: 'Satellite Computer', desc: 'This cashier machine connects to the Main computer over WiFi.' },
}

export default function LanSettings() {
  const [config, setConfig]       = useState(null)
  const [status, setStatus]       = useState(null)
  const [mode, setMode]           = useState('standalone')
  const [serverIp, setServerIp]   = useState('')
  const [serverPort, setServerPort] = useState(7821)
  const [discovering, setDiscover] = useState(false)
  const [discovered, setDiscovered] = useState([])
  const [saving, setSaving]       = useState(false)
  const [msg, setMsg]             = useState(null) // { type: 'ok'|'err', text }
  const [failureLog, setFailureLog] = useState([])

  const lan = window.stocka?.lan

  const loadStatus = useCallback(async () => {
    if (!lan) return
    try {
      const [cfg, st] = await Promise.all([lan.getConfig(), lan.getStatus()])
      setConfig(cfg)
      setStatus(st)
      setMode(cfg.mode || 'standalone')
      setServerIp(cfg.serverIp || '')
      setServerPort(cfg.serverPort || 7821)
    } catch (_) {}
  }, [lan])

  useEffect(() => {
    loadStatus()
    const off = lan?.onStatusChange?.((s) => setStatus(s))
    const off2 = lan?.onSyncFailures?.((f) => setFailureLog(prev => [...f, ...prev].slice(0, 20)))
    return () => { try { off?.(); off2?.() } catch (_) {} }
  }, [loadStatus, lan])

  const handleSave = async () => {
    if (!lan) return
    if (mode === 'client' && !serverIp.trim()) {
      setMsg({ type: 'err', text: 'Enter the Main computer\'s IP address.' })
      return
    }
    setSaving(true)
    setMsg(null)
    try {
      const res = await lan.saveConfig({ mode, serverIp: serverIp.trim() || null, serverPort: parseInt(serverPort) || 7821 })
      if (res?.ok) {
        setStatus(res.status)
        setMsg({ type: 'ok', text: mode === 'server' ? 'Server started — other computers can now connect.'
          : mode === 'client' ? 'Connected to Main computer.'
          : 'Switched to standalone mode.' })
      }
    } catch (e) {
      setMsg({ type: 'err', text: e.message || 'Failed to save settings.' })
    } finally {
      setSaving(false)
    }
  }

  const handleDiscover = async () => {
    if (!lan) return
    setDiscover(true)
    setDiscovered([])
    try {
      const res = await lan.discover()
      setDiscovered(res?.servers || [])
      if (!res?.servers?.length) setMsg({ type: 'err', text: 'No Main computers found on the network. Make sure the Main computer is running in Server mode.' })
    } catch (e) {
      setMsg({ type: 'err', text: 'Discovery failed: ' + e.message })
    } finally {
      setDiscover(false)
    }
  }

  const handleSyncNow = async () => {
    if (!lan) return
    try {
      await lan.syncNow()
      setMsg({ type: 'ok', text: 'Sync complete.' })
    } catch (e) {
      setMsg({ type: 'err', text: 'Sync failed: ' + e.message })
    }
  }

  const localIp = status?.ip

  return (
    <div className="lan-settings">
      <h3 className="lan-title">Network / LAN Sync</h3>
      <p className="lan-subtitle">
        Share your inventory and sales across multiple computers in the same shop over WiFi.
      </p>

      {msg && <div className={`lan-msg ${msg.type}`}>{msg.text}</div>}

      {/* Mode selector */}
      <div className="lan-section">
        <label className="lan-section-label">Computer Role</label>
        <div className="lan-modes">
          {Object.entries(MODES).map(([key, { label, desc }]) => (
            <label key={key} className={`lan-mode-item${mode === key ? ' active' : ''}`}>
              <input
                type="radio"
                name="lan-mode"
                value={key}
                checked={mode === key}
                onChange={() => setMode(key)}
                className="lan-mode-radio"
              />
              <div>
                <div className="lan-mode-title">{label}</div>
                <div className="lan-mode-desc">{desc}</div>
              </div>
            </label>
          ))}
        </div>
      </div>

      {/* SERVER mode details */}
      {mode === 'server' && (
        <div className="lan-server-card">
          <div className="lan-card-title">Server Info</div>
          {status?.isRunning ? (
            <>
              <div className="lan-server-row">
                <span className="lan-server-label">IP Address: </span>
                <strong className="lan-server-value">{localIp || '—'}</strong>
                <span className="lan-server-hint">(share this with cashier computers)</span>
              </div>
              <div className="lan-server-row">
                <span className="lan-server-label">Port: </span>
                <strong className="lan-server-value">{status?.port || 7821}</strong>
              </div>
              <div className="lan-server-row">
                <span className="lan-server-label">Connected satellites: </span>
                <strong>{status?.clientCount || 0}</strong>
              </div>
              {status?.clientCount > 0 && (
                <div className="lan-clients-list">
                  {(status.clients || []).map((c, i) => (
                    <div key={i} className="lan-client-item">
                      • {c.ip} — last seen {new Date(c.lastSeen).toLocaleTimeString()}
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="lan-server-offline">Server not running — click Save to start it.</div>
          )}

          <div className="lan-port-field">
            <label className="lan-port-label">Port (default 7821)</label>
            <input
              type="number"
              value={serverPort}
              onChange={e => setServerPort(e.target.value)}
              min={1024}
              max={65535}
              className="lan-port-input"
            />
          </div>

          {config?.hasSecret && (
            <div className="lan-secret-box">
              <div className="lan-secret-title">Pairing secret</div>
              <div className="lan-secret-desc">
                A shared secret is automatically generated and stored in<br />
                <code>%AppData%\Stocka\lan_config.json</code><br />
                Copy this file to each satellite machine to pair them.
              </div>
            </div>
          )}
        </div>
      )}

      {/* CLIENT mode details */}
      {mode === 'client' && (
        <div className="lan-client-card">
          <div className="lan-card-title">Main Computer Connection</div>

          {status?.mode === 'client' && (
            <div className="lan-status-row">
              <span className={`lan-status-dot ${status.clientOnline ? 'online' : 'offline'}`} />
              <span>
                {status.clientOnline
                  ? `Connected · last synced ${status.lastSync ? new Date(status.lastSync).toLocaleTimeString() : 'never'}`
                  : `Offline · ${status.queueSize || 0} writes queued`}
              </span>
              {status.clientOnline && (
                <button className="lan-sync-now-btn" onClick={handleSyncNow}>Sync Now</button>
              )}
            </div>
          )}

          <div className="lan-ip-field">
            <label className="lan-ip-label">Main Computer IP Address</label>
            <div className="lan-ip-row">
              <input
                type="text"
                value={serverIp}
                onChange={e => setServerIp(e.target.value)}
                placeholder="192.168.1.100"
                className="lan-ip-input"
              />
              <button className="lan-discover-btn" onClick={handleDiscover} disabled={discovering}>
                {discovering ? 'Scanning...' : 'Auto-Detect'}
              </button>
            </div>
          </div>

          {discovered.length > 0 && (
            <div className="lan-discovered">
              <div className="lan-discovered-title">Found on network:</div>
              {discovered.map((s, i) => (
                <div key={i} className="lan-discovered-item">
                  <button
                    onClick={() => setServerIp(s.ip)}
                    className={`lan-discovered-btn${serverIp === s.ip ? ' active' : ''}`}
                  >
                    {s.ip}
                  </button>
                  <span className="lan-discovered-name">{s.shopName || 'Stocka'} · port {s.port}</span>
                </div>
              ))}
            </div>
          )}

          <div className="lan-client-port">
            <label className="lan-client-port-label">Port</label>
            <input
              type="number"
              value={serverPort}
              onChange={e => setServerPort(e.target.value)}
              min={1024}
              max={65535}
              className="lan-port-input"
            />
          </div>

          <div className="lan-pair-warning">
            Copy <code>%AppData%\Stocka\lan_config.json</code> from the Main computer to this machine before connecting — it contains the shared pairing secret.
          </div>
        </div>
      )}

      <button className="lan-save-btn" onClick={handleSave} disabled={saving}>
        {saving ? 'Applying...' : 'Save & Apply'}
      </button>

      {failureLog.length > 0 && (
        <div className="lan-failures">
          <div className="lan-failures-title">Sync failures ({failureLog.length})</div>
          <div className="lan-failures-list">
            {failureLog.map((f, i) => (
              <div key={i} className="lan-failure-item">
                <span className="lan-failure-channel">{f.channel}</span>
                {' — '}{f.error}
                <span className="lan-failure-time">{new Date(f.queuedAt).toLocaleTimeString()}</span>
              </div>
            ))}
          </div>
          <button className="lan-clear-btn" onClick={() => setFailureLog([])}>Clear log</button>
        </div>
      )}
    </div>
  )
}
