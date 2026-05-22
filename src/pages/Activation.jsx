import { useState } from 'react'
import { FiPackage, FiKey, FiCheckCircle } from 'react-icons/fi'

export default function Activation({ onActivated }) {
  const [key, setKey] = useState('')
  const [error, setError] = useState('')
  const [activating, setActivating] = useState(false)
  const [activated, setActivated] = useState(null) // holds license data after success

  const handleActivate = async () => {
    if (!key.trim()) return
    setError('')
    setActivating(true)
    try {
      const result = await window.stocka.license.activate(key.trim())
      if (result.success) {
        setActivated(result.data)
        setTimeout(onActivated, 1500) // brief success pause before reload
      } else {
        setError(result.error || 'Invalid license key. Please check the key and try again.')
      }
    } catch {
      setError('Activation failed. Please restart the app and try again.')
    } finally {
      setActivating(false)
    }
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleActivate()
    }
  }

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)',
      padding: '24px',
      fontFamily: 'system-ui, -apple-system, sans-serif',
    }}>
      <div style={{
        background: '#fff',
        borderRadius: '16px',
        padding: '48px 40px',
        maxWidth: '480px',
        width: '100%',
        boxShadow: '0 24px 64px rgba(0,0,0,0.4)',
        textAlign: 'center',
      }}>
        {/* Logo */}
        <div style={{
          width: '64px',
          height: '64px',
          borderRadius: '16px',
          background: 'linear-gradient(135deg, #2e7d32 0%, #1b5e20 100%)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          margin: '0 auto 20px',
        }}>
          <FiPackage size={32} color="#fff" />
        </div>

        <h1 style={{ margin: '0 0 4px', fontSize: '26px', fontWeight: 700, color: '#1a1a2e' }}>
          Stocka
        </h1>
        <p style={{ margin: '0 0 32px', fontSize: '13px', color: '#999' }}>
          POS &amp; Inventory Management
        </p>

        {activated ? (
          <div style={{ padding: '24px 0' }}>
            <FiCheckCircle size={48} color="#2e7d32" style={{ marginBottom: '16px' }} />
            <h2 style={{ color: '#2e7d32', margin: '0 0 8px', fontSize: '20px' }}>Activated!</h2>
            <p style={{ color: '#555', margin: 0, fontSize: '14px' }}>
              Licensed to <strong>{activated.customer}</strong>
            </p>
            <p style={{ color: '#999', margin: '4px 0 0', fontSize: '12px' }}>
              Loading Stocka...
            </p>
          </div>
        ) : (
          <>
            <div style={{ textAlign: 'left', marginBottom: '24px' }}>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#333', marginBottom: '8px' }}>
                <FiKey size={13} style={{ marginRight: '6px', verticalAlign: 'middle' }} />
                License Key
              </label>
              <textarea
                value={key}
                onChange={e => setKey(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Paste your license key here..."
                rows={4}
                style={{
                  width: '100%',
                  padding: '12px',
                  border: error ? '1px solid #e53935' : '1px solid #ddd',
                  borderRadius: '8px',
                  fontSize: '12px',
                  fontFamily: 'monospace',
                  resize: 'vertical',
                  outline: 'none',
                  boxSizing: 'border-box',
                  color: '#333',
                  background: '#fafafa',
                  lineHeight: '1.5',
                }}
              />
              {error && (
                <p style={{ margin: '8px 0 0', fontSize: '13px', color: '#e53935' }}>
                  {error}
                </p>
              )}
            </div>

            <button
              onClick={handleActivate}
              disabled={activating || !key.trim()}
              style={{
                width: '100%',
                padding: '14px',
                background: activating || !key.trim()
                  ? '#ccc'
                  : 'linear-gradient(135deg, #2e7d32 0%, #1b5e20 100%)',
                color: '#fff',
                border: 'none',
                borderRadius: '8px',
                fontSize: '15px',
                fontWeight: 600,
                cursor: activating || !key.trim() ? 'not-allowed' : 'pointer',
                transition: 'opacity 0.2s',
                marginBottom: '20px',
              }}
            >
              {activating ? 'Activating…' : 'Activate Stocka'}
            </button>

            <p style={{ margin: 0, fontSize: '12px', color: '#aaa' }}>
              Need a license key?{' '}
              <span style={{ color: '#2e7d32', fontWeight: 600 }}>
                Contact support@digitsdigital.co.zw
              </span>
            </p>
          </>
        )}
      </div>
    </div>
  )
}
