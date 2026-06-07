import { useState, useEffect, useCallback } from 'react'

const S = { idle: 'idle', scanning: 'scanning', printing: 'printing', success: 'success', error: 'error' }

export default function PrinterSettingsBt({ shopId, initialPort, shopName, onSave }) {
  const [ports,    setPorts]    = useState([])
  const [selected, setSelected] = useState(initialPort || '')
  const [status,   setStatus]   = useState(S.idle)
  const [message,  setMessage]  = useState('')

  useEffect(() => { if (initialPort) setSelected(initialPort) }, [initialPort])

  const flash = useCallback((type, msg, ms = 6000) => {
    setStatus(type)
    setMessage(msg)
    if (type === S.success || type === S.error) {
      setTimeout(() => { setStatus(S.idle); setMessage('') }, ms)
    }
  }, [])

  const handleScan = async () => {
    setStatus(S.scanning)
    setMessage('Scanning for Bluetooth serial ports…')
    setPorts([])
    const res = await window.stocka.btPrinter.scan()
    if (!res.success || res.ports.length === 0) {
      flash(S.error, res.error || 'No Bluetooth serial ports found. See setup guide below.')
      return
    }
    setPorts(res.ports)
    setStatus(S.idle)
    setMessage(`Found ${res.ports.length} port(s) — select yours below.`)
  }

  const handleSave = async () => {
    if (!selected) { flash(S.error, 'Select a port first.'); return }
    try {
      await onSave(selected)
      flash(S.success, `Saved: ${selected}`)
    } catch (err) {
      flash(S.error, 'Save failed: ' + err.message)
    }
  }

  const handleTest = async () => {
    if (!selected) { flash(S.error, 'Select and save a port first.'); return }
    setStatus(S.printing)
    setMessage(`Sending test page to ${selected}…`)
    const res = await window.stocka.btPrinter.testPrint(selected, shopName || 'Stocka Shop')
    res.success
      ? flash(S.success, 'Test page sent — check the printer for output.')
      : flash(S.error, res.error || 'Print failed.')
  }

  const busy = status === S.scanning || status === S.printing

  const bannerColor = {
    [S.error]:   { bg: '#fdecea', border: '#ef5350', text: '#c62828' },
    [S.success]: { bg: '#e8f5e9', border: '#43a047', text: '#2e7d32' },
    [S.scanning]:{ bg: '#e3f2fd', border: '#1e88e5', text: '#0d47a1' },
    [S.printing]:{ bg: '#e3f2fd', border: '#1e88e5', text: '#0d47a1' },
  }[status] || {}

  return (
    <div style={{ padding: '20px 0', maxWidth: '580px' }}>

      {/* Active port */}
      {selected && (
        <div style={{ marginBottom: '14px', padding: '10px 14px', background: '#e8f5e9',
          borderRadius: '6px', borderLeft: '4px solid #43a047', fontSize: '13px' }}>
          <strong>Active port:</strong> {selected}
        </div>
      )}

      {/* Banner */}
      {message && (
        <div style={{ marginBottom: '14px', padding: '10px 14px', borderRadius: '6px',
          background: bannerColor.bg, borderLeft: `4px solid ${bannerColor.border}`,
          color: bannerColor.text, fontSize: '13px' }}>
          {busy && <span style={{ marginRight: 6 }}>⏳</span>}
          {message}
        </div>
      )}

      {/* Buttons */}
      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '20px' }}>
        <Btn onClick={handleScan}  disabled={busy}                  color="#1976d2">
          {status === S.scanning ? 'Scanning…' : '🔍 Scan for Ports'}
        </Btn>
        <Btn onClick={handleSave}  disabled={busy || !selected}     color="#388e3c">
          💾 Save Selection
        </Btn>
        <Btn onClick={handleTest}  disabled={busy || !selected}     color="#f57c00">
          {status === S.printing ? 'Printing…' : '🖨️ Test Print'}
        </Btn>
      </div>

      {/* Port list */}
      {ports.length > 0 && (
        <div style={{ border: '1px solid #ddd', borderRadius: '8px', overflow: 'hidden', marginBottom: '20px' }}>
          <div style={{ padding: '8px 14px', background: '#f5f5f5', fontSize: '12px',
            fontWeight: 600, color: '#555', borderBottom: '1px solid #ddd' }}>
            Click a port to select it
          </div>
          <div style={{ maxHeight: '260px', overflowY: 'auto' }}>
            {ports.map(port => {
              const active = selected === port.path
              return (
                <div key={port.path} onClick={() => !busy && setSelected(port.path)} style={{
                  padding: '11px 14px', cursor: busy ? 'default' : 'pointer',
                  borderBottom: '1px solid #f0f0f0',
                  background:   active ? '#e3f2fd' : 'white',
                  borderLeft:   active ? '4px solid #1976d2' : '4px solid transparent',
                }}>
                  <div style={{ fontWeight: 600, fontSize: '14px' }}>
                    {active ? '✓ ' : ''}{port.path}
                  </div>
                  {port.name && port.name !== port.path && (
                    <div style={{ fontSize: '12px', color: '#555', marginTop: 2 }}>{port.name}</div>
                  )}
                  {port.manufacturer && (
                    <div style={{ fontSize: '11px', color: '#888' }}>{port.manufacturer}</div>
                  )}
                  {port.hint && (
                    <div style={{ fontSize: '11px', color: '#e65100', marginTop: 4,
                      fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>{port.hint}</div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Setup guide */}
      <details style={{ fontSize: '12px', color: '#666' }}>
        <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '13px', marginBottom: 6 }}>
          📋 No ports showing? Setup guide
        </summary>
        <div style={{ padding: '12px', background: '#fafafa', borderRadius: '6px',
          border: '1px solid #eee', lineHeight: 1.8, marginTop: 6 }}>
          <strong>Windows</strong>
          <ol style={{ margin: '4px 0 10px', paddingLeft: 18 }}>
            <li>Pair the printer in <em>Settings → Bluetooth & devices</em></li>
            <li>Open <em>Control Panel → Bluetooth settings → More Bluetooth options</em></li>
            <li>Go to the <strong>COM Ports</strong> tab → <strong>Add → Outgoing</strong></li>
            <li>Select your printer → OK. Note the COM number assigned.</li>
            <li>Click <strong>Scan for Ports</strong> above — your COM port will appear.</li>
          </ol>
          <strong>macOS</strong>
          <ol style={{ margin: '4px 0 10px', paddingLeft: 18 }}>
            <li>Pair in <em>System Settings → Bluetooth</em></li>
            <li>Scan — it appears as <code style={{ background: '#eee', padding: '0 3px' }}>/dev/cu.PrinterName</code></li>
          </ol>
          <strong>Linux</strong>
          <ol style={{ margin: '4px 0', paddingLeft: 18 }}>
            <li>Pair: <code style={{ background: '#eee', padding: '0 3px' }}>bluetoothctl → pair AA:BB:CC:DD:EE:FF</code></li>
            <li>Bind: <code style={{ background: '#eee', padding: '0 3px' }}>sudo rfcomm bind rfcomm0 AA:BB:CC:DD:EE:FF</code></li>
            <li>Dialout group: <code style={{ background: '#eee', padding: '0 3px' }}>sudo usermod -a -G dialout $USER</code> then log out/in</li>
          </ol>
        </div>
      </details>
    </div>
  )
}

function Btn({ children, onClick, disabled, color }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      padding: '9px 16px', background: disabled ? '#bbb' : color,
      color: 'white', border: 'none', borderRadius: '6px',
      cursor: disabled ? 'not-allowed' : 'pointer',
      fontSize: '13px', fontWeight: 500,
    }}>
      {children}
    </button>
  )
}
