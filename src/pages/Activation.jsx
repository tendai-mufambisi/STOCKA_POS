import { useState } from 'react'
import { FiCheckCircle } from 'react-icons/fi'
import fullLogo from '../assets/full_logo.png'

export default function Activation({ onActivated }) {
  const [key, setKey] = useState('')
  const [error, setError] = useState('')
  const [errorType, setErrorType] = useState('') // 'invalid' | 'already_used'
  const [state, setState] = useState('idle') // 'idle' | 'validating' | 'success'

  // Require at least 8 chars before enabling the button
  const isReady = key.trim().length >= 8

  const handleChange = (e) => {
    setKey(e.target.value.toUpperCase())
    if (error) {
      setError('')
      setErrorType('')
    }
  }

  const handleActivate = async () => {
    if (!isReady || state === 'validating') return
    setError('')
    setState('validating')
    try {
      const result = await window.stocka.license.activate(key.trim())
      if (result.success) {
        setState('success')
        setTimeout(onActivated, 800)
      } else {
        const msg = (result.error || '').toLowerCase()
        if (msg.includes('another machine') || msg.includes('different machine')) {
          setState('idle')
          setErrorType('already_used')
          setError('This key is already activated on another computer. Each Stocka licence works on one machine. Contact us to transfer it.')
        } else if (msg.includes('already') || msg.includes('activated')) {
          // Already activated on this machine — treat as valid
          setState('success')
          setTimeout(onActivated, 800)
        } else {
          setState('idle')
          setErrorType('invalid')
          setError("This key isn't valid. Check for typos, or WhatsApp us to get a new one.")
        }
      }
    } catch {
      setState('idle')
      setError('Activation failed. Please restart the app and try again.')
    }
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && isReady && state === 'idle') handleActivate()
  }

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      background: '#f5f5f0',
      padding: '24px',
      fontFamily: 'system-ui, -apple-system, sans-serif',
    }}>
      <div style={{
        background: '#fff',
        borderRadius: '12px',
        padding: '48px 40px',
        maxWidth: '480px',
        width: '100%',
        boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
        textAlign: 'center',
      }}>
        {/* Logo */}
        <img
          src={fullLogo}
          alt="Stocka"
          style={{ height: '60px', objectFit: 'contain', display: 'block', margin: '0 auto 24px' }}
        />

        <p style={{ margin: '0 0 6px', fontSize: '14px', color: '#555', lineHeight: 1.5 }}>
          Welcome! Let's get your shop running.
        </p>
        <p style={{ margin: '0 0 32px', fontSize: '13px', color: '#999' }}>
          Paste your activation key below to begin.
        </p>

        {state === 'success' ? (
          <div style={{ padding: '24px 0' }}>
            <FiCheckCircle size={52} color="#2e7d32" style={{ marginBottom: '16px' }} />
            <h2 style={{ color: '#2e7d32', margin: '0 0 8px', fontSize: '22px' }}>Activated!</h2>
            <p style={{ color: '#666', margin: 0, fontSize: '14px' }}>Setting up your shop...</p>
          </div>
        ) : (
          <>
            <div style={{ marginBottom: '8px', textAlign: 'left' }}>
              <label style={{
                display: 'block',
                marginBottom: '8px',
                fontSize: '13px',
                fontWeight: 600,
                color: '#333',
              }}>
                Activation Key
              </label>
              <textarea
                value={key}
                onChange={handleChange}
                onKeyDown={handleKeyDown}
                placeholder="Paste your activation key here"
                disabled={state === 'validating'}
                autoFocus
                spellCheck={false}
                rows={3}
                style={{
                  width: '100%',
                  padding: '14px 16px',
                  fontSize: '14px',
                  fontFamily: 'monospace',
                  letterSpacing: '1px',
                  border: `2px solid ${error ? '#e53935' : isReady ? '#2e7d32' : '#ddd'}`,
                  borderRadius: '8px',
                  boxSizing: 'border-box',
                  outline: 'none',
                  transition: 'border-color 0.2s',
                  background: state === 'validating' ? '#f9f9f9' : '#fff',
                  color: '#1a1a1a',
                  resize: 'none',
                  lineHeight: 1.6,
                }}
              />
              {error && (
                <p style={{
                  margin: '8px 0 0',
                  fontSize: '13px',
                  color: '#e53935',
                  textAlign: 'left',
                  lineHeight: 1.4,
                }}>
                  {error}
                </p>
              )}
            </div>

            <button
              onClick={handleActivate}
              disabled={!isReady || state === 'validating'}
              style={{
                width: '100%',
                padding: '14px',
                marginTop: '12px',
                background: isReady && state !== 'validating'
                  ? 'linear-gradient(135deg, #2e7d32 0%, #1b5e20 100%)'
                  : '#ccc',
                color: '#fff',
                border: 'none',
                borderRadius: '8px',
                fontSize: '16px',
                fontWeight: 600,
                cursor: isReady && state !== 'validating' ? 'pointer' : 'not-allowed',
                transition: 'background 0.2s',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
              }}
            >
              {state === 'validating' ? (
                <>
                  <span style={{
                    width: '16px',
                    height: '16px',
                    border: '2px solid rgba(255,255,255,0.4)',
                    borderTopColor: '#fff',
                    borderRadius: '50%',
                    display: 'inline-block',
                    animation: 'spin 0.7s linear infinite',
                  }} />
                  Activating...
                </>
              ) : 'Activate Stocka'}
            </button>

            <p style={{ margin: '24px 0 0', fontSize: '13px', color: '#aaa' }}>
              Lost your key?{' '}
              <a
                href="https://wa.me/263XXXXXXXXX"
                target="_blank"
                rel="noreferrer"
                style={{ color: '#2e7d32', textDecoration: 'none', fontWeight: 600 }}
              >
                WhatsApp us
              </a>
            </p>
          </>
        )}
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
