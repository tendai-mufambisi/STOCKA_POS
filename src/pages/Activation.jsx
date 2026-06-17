import { useState, useRef } from 'react'
import { FiCheckCircle } from 'react-icons/fi'
import { FcGoogle } from 'react-icons/fc'
import fullLogo from '../assets/full_logo.png'
import './Activation.css'

const KEY_LENGTH = 16
const BOX_LAYOUT = [0, 1, 2, 3, '-', 4, 5, 6, 7, '-', 8, 9, 10, 11, '-', 12, 13, 14, 15]

function LicenseKeyBoxes({ value, onChange, disabled, hasError, onEnter }) {
  const refs = useRef([])
  const chars = Array.from({ length: KEY_LENGTH }, (_, i) => value[i] || '')

  const focusBox = (i) => refs.current[i]?.focus()

  const setCharAt = (i, ch) => {
    const next = chars.slice()
    next[i] = ch
    onChange(next.join('').replace(/\s+$/, ''))
  }

  const handleInput = (i, e) => {
    const ch = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(-1)
    setCharAt(i, ch)
    if (ch && i < KEY_LENGTH - 1) focusBox(i + 1)
  }

  const handleKeyDown = (i, e) => {
    if (e.key === 'Backspace' && !chars[i] && i > 0) {
      focusBox(i - 1)
    } else if (e.key === 'ArrowLeft' && i > 0) {
      focusBox(i - 1)
    } else if (e.key === 'ArrowRight' && i < KEY_LENGTH - 1) {
      focusBox(i + 1)
    } else if (e.key === 'Enter') {
      onEnter?.()
    }
  }

  const handlePaste = (e) => {
    e.preventDefault()
    const text = e.clipboardData.getData('text').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, KEY_LENGTH)
    onChange(text)
    requestAnimationFrame(() => focusBox(Math.min(text.length, KEY_LENGTH - 1)))
  }

  return (
    <div className={`license-boxes${hasError ? ' error' : ''}`}>
      {BOX_LAYOUT.map((slot, pos) =>
        slot === '-' ? (
          <span key={pos} className="license-box license-box--dash">–</span>
        ) : (
          <input
            key={pos}
            ref={(el) => (refs.current[slot] = el)}
            className={`license-box${chars[slot] ? ' filled' : ''}`}
            value={chars[slot]}
            onChange={(e) => handleInput(slot, e)}
            onKeyDown={(e) => handleKeyDown(slot, e)}
            onPaste={handlePaste}
            disabled={disabled}
            maxLength={1}
            autoFocus={slot === 0}
            spellCheck={false}
            autoComplete="off"
          />
        )
      )}
    </div>
  )
}

const cardStyle = {
  background: '#fff',
  borderRadius: '12px',
  padding: '48px 40px',
  maxWidth: '480px',
  width: '100%',
  boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
  textAlign: 'center',
  fontFamily: 'system-ui, -apple-system, sans-serif',
}

export default function Activation({ onActivated }) {
  // 'choose' | 'license' | 'google-waiting' | 'success'
  const [screen, setScreen] = useState('choose')
  const [key, setKey] = useState('')
  const [error, setError] = useState('')
  const [errorType, setErrorType] = useState('')

  const isReady = key.length === KEY_LENGTH

  // ── License key path ──────────────────────────────────────

  const handleKeyChange = (next) => {
    setKey(next)
    if (error) { setError(''); setErrorType('') }
  }

  const handleActivate = async () => {
    if (!isReady || screen === 'validating') return
    setError('')
    setScreen('validating')
    try {
      const result = await window.stocka.license.activate(key.trim())
      if (result.success) {
        setScreen('success')
        setTimeout(onActivated, 800)
      } else {
        const msg = (result.error || '').toLowerCase()
        if (msg.includes('another machine') || msg.includes('different machine')) {
          setScreen('license')
          setErrorType('already_used')
          setError('This key is already activated on another computer. Each Stocka licence works on one machine. Contact us to transfer it.')
        } else if (msg.includes('already') || msg.includes('activated')) {
          setScreen('success')
          setTimeout(onActivated, 800)
        } else {
          setScreen('license')
          setErrorType('invalid')
          setError("This key isn't valid. Check for typos, or WhatsApp us to get a new one.")
        }
      }
    } catch {
      setScreen('license')
      setError('Activation failed. Please restart the app and try again.')
    }
  }

  // ── Google sign-in path ───────────────────────────────────

  const handleGoogleSignIn = () => {
    setScreen('google-waiting')
    setError('')

    window.stocka.cloud.onAuthComplete(async ({ access_token, refresh_token }) => {
      if (!access_token) {
        setScreen('choose')
        setError('Sign-in failed. Please try again.')
        return
      }
      await window.stocka.cloud.saveToken({ access_token, refresh_token })
      setScreen('success')
      setTimeout(onActivated, 800)
    })

    window.stocka.cloud.onAuthCancelled(() => {
      setScreen('choose')
    })

    window.stocka.cloud.onAuthError((err) => {
      setScreen('choose')
      setError(err || 'Google sign-in failed. Please try again.')
    })

    window.stocka.cloud.openGoogleAuth()
  }

  // ── Render ────────────────────────────────────────────────

  const logo = (
    <img
      src={fullLogo}
      alt="Stocka"
      style={{ height: '60px', objectFit: 'contain', display: 'block', margin: '0 auto 24px' }}
    />
  )

  if (screen === 'success') {
    return (
      <Wrapper>
        <div style={cardStyle}>
          {logo}
          <FiCheckCircle size={52} color="#2e7d32" style={{ marginBottom: '16px' }} />
          <h2 style={{ color: '#2e7d32', margin: '0 0 8px', fontSize: '22px' }}>All set!</h2>
          <p style={{ color: '#666', margin: 0, fontSize: '14px' }}>Setting up your shop...</p>
        </div>
      </Wrapper>
    )
  }

  if (screen === 'google-waiting') {
    return (
      <Wrapper>
        <div style={cardStyle}>
          {logo}
          <div style={{
            width: '40px', height: '40px', margin: '0 auto 20px',
            border: '3px solid #e0e0e0', borderTopColor: '#2e7d32',
            borderRadius: '50%', animation: 'spin 0.8s linear infinite',
          }} />
          <h2 style={{ fontSize: '18px', margin: '0 0 8px', color: '#333' }}>Waiting for Google...</h2>
          <p style={{ fontSize: '13px', color: '#888', margin: '0 0 24px' }}>
            Complete sign-in in the popup window.
          </p>
          <button onClick={() => setScreen('choose')} style={linkBtnStyle}>
            Cancel
          </button>
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </Wrapper>
    )
  }

  if (screen === 'license' || screen === 'validating') {
    const validating = screen === 'validating'
    return (
      <Wrapper>
        <div style={cardStyle}>
          {logo}
          <p style={{ margin: '0 0 6px', fontSize: '14px', color: '#555' }}>
            Enter your activation key below.
          </p>

          <div style={{ marginBottom: '8px', textAlign: 'left', marginTop: '24px' }}>
            <label style={{ display: 'block', marginBottom: '8px', fontSize: '13px', fontWeight: 600, color: '#333' }}>
              Activation Key
            </label>
            <LicenseKeyBoxes
              value={key}
              onChange={handleKeyChange}
              disabled={validating}
              hasError={!!error}
              onEnter={handleActivate}
            />
            {error && (
              <p style={{ margin: '8px 0 0', fontSize: '13px', color: '#e53935', textAlign: 'left', lineHeight: 1.4 }}>
                {error}
              </p>
            )}
          </div>

          <button
            onClick={handleActivate}
            disabled={!isReady || validating}
            style={{
              width: '100%', padding: '14px', marginTop: '12px',
              background: isReady && !validating
                ? 'linear-gradient(135deg, #2e7d32 0%, #1b5e20 100%)'
                : '#ccc',
              color: '#fff', border: 'none', borderRadius: '8px',
              fontSize: '16px', fontWeight: 600,
              cursor: isReady && !validating ? 'pointer' : 'not-allowed',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
            }}
          >
            {validating ? (
              <>
                <span style={{
                  width: '16px', height: '16px',
                  border: '2px solid rgba(255,255,255,0.4)', borderTopColor: '#fff',
                  borderRadius: '50%', display: 'inline-block', animation: 'spin 0.7s linear infinite',
                }} />
                Activating...
              </>
            ) : 'Activate Stocka'}
          </button>

          <button onClick={() => { setError(''); setScreen('choose') }} style={{ ...linkBtnStyle, marginTop: '20px' }}>
            ← Back
          </button>
          <p style={{ margin: '16px 0 0', fontSize: '13px', color: '#aaa' }}>
            Lost your key?{' '}
            <a href="https://wa.me/263XXXXXXXXX" target="_blank" rel="noreferrer"
              style={{ color: '#2e7d32', textDecoration: 'none', fontWeight: 600 }}>
              WhatsApp us
            </a>
          </p>
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </Wrapper>
    )
  }

  // Default: choose screen
  return (
    <Wrapper>
      <div style={cardStyle}>
        {logo}
        <p style={{ margin: '0 0 6px', fontSize: '14px', color: '#555', lineHeight: 1.5 }}>
          Welcome! Let's get your shop running.
        </p>
        <p style={{ margin: '0 0 32px', fontSize: '13px', color: '#999' }}>
          Choose how you'd like to activate Stocka.
        </p>

        {error && (
          <p style={{ margin: '-16px 0 20px', fontSize: '13px', color: '#e53935', lineHeight: 1.4 }}>
            {error}
          </p>
        )}

        {/* Cloud tier — Google sign-in */}
        <button onClick={handleGoogleSignIn} style={googleBtnStyle}>
          <FcGoogle size={22} />
          Continue with Google
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', margin: '20px 0' }}>
          <div style={{ flex: 1, height: '1px', background: '#eee' }} />
          <span style={{ fontSize: '12px', color: '#bbb' }}>or</span>
          <div style={{ flex: 1, height: '1px', background: '#eee' }} />
        </div>

        {/* Offline tier — license key */}
        <button onClick={() => setScreen('license')} style={outlineBtnStyle}>
          I have a licence key
        </button>

        <p style={{ margin: '24px 0 0', fontSize: '12px', color: '#bbb', lineHeight: 1.6 }}>
          Google sign-in enables multi-device sync and cloud backup.
          <br />Licence keys work offline only.
        </p>
      </div>
    </Wrapper>
  )
}

function Wrapper({ children }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      minHeight: '100vh', background: '#f5f5f0', padding: '24px',
      fontFamily: 'system-ui, -apple-system, sans-serif',
    }}>
      {children}
    </div>
  )
}

const googleBtnStyle = {
  width: '100%', padding: '13px 16px',
  background: '#fff', color: '#333',
  border: '2px solid #e0e0e0', borderRadius: '8px',
  fontSize: '15px', fontWeight: 600,
  cursor: 'pointer', display: 'flex', alignItems: 'center',
  justifyContent: 'center', gap: '10px',
  transition: 'border-color 0.2s, box-shadow 0.2s',
}

const outlineBtnStyle = {
  width: '100%', padding: '13px 16px',
  background: 'transparent', color: '#2e7d32',
  border: '2px solid #2e7d32', borderRadius: '8px',
  fontSize: '15px', fontWeight: 600,
  cursor: 'pointer',
}

const linkBtnStyle = {
  background: 'none', border: 'none', color: '#888',
  fontSize: '13px', cursor: 'pointer', padding: '4px',
  textDecoration: 'underline',
}
