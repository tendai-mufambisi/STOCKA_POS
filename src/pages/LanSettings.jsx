import { useState, useEffect, useCallback } from 'react'
import './LanSettings.css'

const MODES = {
  standalone: { label: 'Standalone', desc: 'Single computer, no network sharing (default).' },
  server:     { label: 'Main Computer', desc: 'This machine is the authoritative database server. Other computers connect to it.' },
  client:     { label: 'Satellite Computer', desc: 'This cashier machine connects to the Main computer over WiFi.' },
}

function formatCountdown(expiresAt) {
  if (!expiresAt) return ''
  const ms = expiresAt - Date.now()
  if (ms <= 0) return 'expired'
  const mins = Math.floor(ms / 60000)
  const secs = Math.floor((ms % 60000) / 1000)
  return `${mins}:${String(secs).padStart(2, '0')}`
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
  const [clockSkew, setClockSkew]   = useState(null) // { skewMs, serverTime } | null
  const [clearingQueue, setClearingQueue] = useState(false)

  // This till's identity (local-only; scopes its receipt numbers)
  const [tillIdentity, setTillIdentity] = useState(null) // { code, label }
  const [tillLabelInput, setTillLabelInput] = useState('')
  const [savingLabel, setSavingLabel] = useState(false)

  // Pairing (Main computer side)
  const [pairingInfo, setPairingInfo] = useState(null) // { code, expiresAt }
  const [pairingTick, setPairingTick] = useState(0)     // forces countdown re-render

  // Pairing (Satellite side)
  const [pairCode, setPairCode]   = useState('')
  const [pairing, setPairing]     = useState(false)
  const [resyncing, setResyncing] = useState(false)

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

  const loadPairingInfo = useCallback(async () => {
    if (!lan) return
    try {
      const res = await lan.getPairingInfo()
      if (res?.ok) setPairingInfo(res.info)
    } catch (_) {}
  }, [lan])

  useEffect(() => {
    loadStatus()
    const off  = lan?.onStatusChange?.((s) => setStatus(s))
    const off2 = lan?.onSyncFailures?.((f) => setFailureLog(prev => [...f, ...prev].slice(0, 20)))
    const off3 = lan?.onClockSkew?.((d) => setClockSkew(d))
    return () => { try { off?.(); off2?.(); off3?.() } catch (_) {} }
  }, [loadStatus, lan])

  useEffect(() => {
    window.stocka?.till?.getIdentity().then(id => {
      setTillIdentity(id)
      setTillLabelInput(id?.label || '')
    }).catch(() => {})
  }, [])

  const handleSaveTillLabel = async () => {
    if (!tillLabelInput.trim()) return
    setSavingLabel(true)
    try {
      const res = await window.stocka.till.setLabel(tillLabelInput.trim())
      if (res?.success) {
        setTillIdentity(res.identity)
        setMsg({ type: 'ok', text: 'Till name saved.' })
      } else {
        setMsg({ type: 'err', text: res?.error || 'Failed to save till name.' })
      }
    } catch (e) {
      setMsg({ type: 'err', text: e.message || 'Failed to save till name.' })
    } finally {
      setSavingLabel(false)
    }
  }

  // Keep the pairing PIN (and its countdown) fresh while in Main computer mode
  useEffect(() => {
    if (mode !== 'server' || !status?.isRunning) return
    loadPairingInfo()
    const timer = setInterval(() => {
      loadPairingInfo()
      setPairingTick(t => t + 1)
    }, 1000)
    return () => clearInterval(timer)
  }, [mode, status?.isRunning, loadPairingInfo])

  const handleSave = async () => {
    if (!lan) return
    setSaving(true)
    setMsg(null)
    try {
      const res = await lan.saveConfig({ mode, serverIp: serverIp.trim() || null, serverPort: parseInt(serverPort) || 7821 })
      if (res?.ok) {
        setStatus(res.status)
        setMsg({ type: 'ok', text: mode === 'server' ? 'Server starting — other computers can now connect.'
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

  const handleRegenerateCode = async () => {
    if (!lan) return
    try {
      const res = await lan.regeneratePairingCode()
      if (res?.ok) setPairingInfo(res.info)
    } catch (_) {}
  }

  const handlePairAndConnect = async () => {
    if (!lan) return
    if (!serverIp.trim()) { setMsg({ type: 'err', text: "Enter the Main computer's IP address." }); return }
    if (pairCode.trim().length !== 6) { setMsg({ type: 'err', text: 'Enter the 6-digit pairing code shown on the Main computer.' }); return }
    setPairing(true)
    setMsg(null)
    try {
      const res = await lan.pairAndConnect({
        serverIp: serverIp.trim(),
        serverPort: parseInt(serverPort) || 7821,
        code: pairCode.trim(),
      })
      if (res?.ok) {
        setStatus(res.status)
        setPairCode('')
        await loadStatus()
        setMsg({ type: 'ok', text: `Paired with "${res.shopName}". All data has been mirrored to this computer.` })
      } else {
        setMsg({ type: 'err', text: res?.error || 'Pairing failed.' })
      }
    } catch (e) {
      setMsg({ type: 'err', text: e.message || 'Pairing failed.' })
    } finally {
      setPairing(false)
    }
  }

  const handleClearQueue = async () => {
    if (!lan) return
    if (!window.confirm(`Clear ${status?.queueSize} queued write(s)? This cannot be undone — any sales or changes made while offline will be permanently discarded.`)) return
    setClearingQueue(true)
    try {
      await lan.clearQueue()
      await loadStatus()
      setMsg({ type: 'ok', text: 'Offline queue cleared.' })
    } catch (e) {
      setMsg({ type: 'err', text: 'Failed to clear queue: ' + e.message })
    } finally {
      setClearingQueue(false)
    }
  }

  const handleForceResync = async () => {
    if (!lan) return
    setResyncing(true)
    setMsg(null)
    try {
      const res = await lan.forceResync()
      if (res?.ok) {
        setStatus(res.status)
        setMsg({ type: 'ok', text: 'Full resync complete — local data now mirrors the Main computer exactly.' })
      } else {
        setMsg({ type: 'err', text: res?.error || 'Resync failed.' })
      }
    } catch (e) {
      setMsg({ type: 'err', text: e.message || 'Resync failed.' })
    } finally {
      setResyncing(false)
    }
  }

  const localIp = status?.ip
  const isPaired = mode === 'client' && !!config?.hasSecret && status?.mode === 'client'

  return (
    <div className="lan-settings">
      <h3 className="lan-title">Network / LAN Sync</h3>
      <p className="lan-subtitle">
        Share your inventory and sales across multiple computers in the same shop over WiFi.
      </p>

      {/* This till's identity — local only, drives its receipt-number prefix */}
      {tillIdentity && (
        <div className="lan-section">
          <label className="lan-section-label">This Till</label>
          <div className="lan-ip-field">
            <div className="lan-ip-row">
              <input
                type="text"
                className="lan-ip-input"
                value={tillLabelInput}
                maxLength={40}
                onChange={e => setTillLabelInput(e.target.value)}
                placeholder="e.g. Front Counter"
              />
              <button className="lan-discover-btn" onClick={handleSaveTillLabel} disabled={savingLabel || !tillLabelInput.trim()}>
                {savingLabel ? 'Saving…' : 'Save'}
              </button>
            </div>
            <div className="lan-secret-desc" style={{ marginTop: 6 }}>
              Receipt code <strong>{tillIdentity.code}</strong> — every sale here prints as{' '}
              <strong>{tillIdentity.code}-YYYYMMDD-0001</strong> and so on. Each till counts its own
              receipts, so two computers can never issue the same number, online or offline.
            </div>
          </div>
        </div>
      )}

      {msg && <div className={`lan-msg ${msg.type}`}>{msg.text}</div>}

      {clockSkew && (
        <div className="lan-msg err">
          Clock out of sync: this computer's clock differs from the Main computer by{' '}
          {Math.round(clockSkew.skewMs / 1000)} seconds. Delta sync may miss recent changes.
          Please sync both computers to the same time source.
          <button className="lan-clear-btn" style={{ marginLeft: 8 }} onClick={() => setClockSkew(null)}>Dismiss</button>
        </div>
      )}

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
          ) : status?.starting ? (
            <div className="lan-server-offline">Starting server…</div>
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

          {status?.isRunning && (
            <div className="lan-secret-box">
              <div className="lan-secret-title">Pairing code for new satellites</div>
              {pairingInfo ? (
                <>
                  <div className="lan-pairing-code">{pairingInfo.code}</div>
                  <div className="lan-secret-desc">
                    On the satellite computer, choose "Satellite Computer", enter this code,
                    and it will connect and mirror this shop's data automatically.
                    Expires in <strong>{formatCountdown(pairingInfo.expiresAt)}</strong>
                  </div>
                </>
              ) : (
                <div className="lan-secret-desc">Code expired or not yet generated.</div>
              )}
              <button className="lan-regen-btn" onClick={handleRegenerateCode}>Generate new code</button>
            </div>
          )}
        </div>
      )}

      {/* CLIENT mode details */}
      {mode === 'client' && (
        <div className="lan-client-card">
          <div className="lan-card-title">Main Computer Connection</div>

          {isPaired && (
            <div className="lan-status-row">
              <span className={`lan-status-dot ${status.clientOnline ? 'online' : 'offline'}`} />
              <span>
                {status.clientOnline
                  ? `Connected · last synced ${status.lastSyncAt ? new Date(status.lastSyncAt).toLocaleTimeString() : 'never'}`
                  : `Offline · ${status.queueSize || 0} writes queued`}
              </span>
              {status.clientOnline && (
                <button className="lan-sync-now-btn" onClick={handleSyncNow}>Sync Now</button>
              )}
              {status.queueSize > 0 && (
                <button className="lan-clear-btn" onClick={handleClearQueue} disabled={clearingQueue}>
                  {clearingQueue ? 'Clearing…' : `Clear Queue (${status.queueSize})`}
                </button>
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

          {!isPaired ? (
            <>
              <div className="lan-ip-field" style={{ marginTop: '12px' }}>
                <label className="lan-ip-label">Pairing Code (shown on Main computer)</label>
                <input
                  type="text"
                  value={pairCode}
                  onChange={e => setPairCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="123456"
                  className="lan-ip-input"
                  inputMode="numeric"
                  maxLength={6}
                />
              </div>
              <button className="lan-save-btn" onClick={handlePairAndConnect} disabled={pairing}>
                {pairing ? 'Pairing & mirroring data…' : 'Pair & Connect'}
              </button>
              <div className="lan-pair-warning">
                Pairing will replace any existing products, users and sales on this computer with
                a copy of the Main computer's data. Use this only when first connecting this till.
              </div>
            </>
          ) : (
            <div className="lan-resync-box">
              <button className="lan-regen-btn" onClick={handleForceResync} disabled={resyncing}>
                {resyncing ? 'Resyncing…' : 'Force Full Resync'}
              </button>
              <div className="lan-secret-desc">
                Wipes local data and re-mirrors everything from the Main computer. Use this if this
                till's data looks out of sync and "Sync Now" doesn't fix it.
              </div>
            </div>
          )}
        </div>
      )}

      {mode !== 'client' && (
        <button className="lan-save-btn" onClick={handleSave} disabled={saving}>
          {saving ? 'Applying...' : 'Save & Apply'}
        </button>
      )}

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
