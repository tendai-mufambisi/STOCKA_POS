import { useState, useEffect } from 'react'
import { FiDelete, FiCheckCircle } from 'react-icons/fi'
import { getUsers, getShop, loginUser, resetOwnerPin } from '../database/db'
import iconPng from '../assets/icon.png'
import fullLogo from '../assets/full_logo.png'
import { useAuthStore } from '../store/useAuthStore'

// ── PIN display (4 dots) ─────────────────────────────────────────────────────
function PinDots({ value, shake }) {
  return (
    <div style={{
      display: 'flex',
      gap: '14px',
      justifyContent: 'center',
      marginBottom: '28px',
      animation: shake ? 'shake 0.4s ease' : 'none',
    }}>
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          style={{
            width: '16px',
            height: '16px',
            borderRadius: '50%',
            background: i < value.length ? '#2e7d32' : 'transparent',
            border: '2px solid',
            borderColor: i < value.length ? '#2e7d32' : '#ccc',
            transition: 'all 0.15s',
          }}
        />
      ))}
    </div>
  )
}

// ── Numeric PIN keypad ───────────────────────────────────────────────────────
function PinPad({ onDigit, onBackspace, onClear, disabled }) {
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫']

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(3, 1fr)',
      gap: '10px',
      maxWidth: '260px',
      margin: '0 auto',
    }}>
      {keys.map((k) => {
        const isAction = k === 'C' || k === '⌫'
        return (
          <button
            key={k}
            onClick={() => {
              if (k === '⌫') onBackspace()
              else if (k === 'C') onClear()
              else onDigit(k)
            }}
            disabled={disabled}
            style={{
              height: '56px',
              borderRadius: '10px',
              border: '1px solid #e0e0e0',
              background: isAction ? '#f5f5f5' : '#fff',
              fontSize: isAction ? '18px' : '22px',
              fontWeight: isAction ? 400 : 600,
              color: isAction ? '#888' : '#1a1a1a',
              cursor: disabled ? 'not-allowed' : 'pointer',
              transition: 'background 0.1s',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
            }}
            onMouseDown={(e) => { if (!disabled) e.currentTarget.style.background = '#f0f0f0' }}
            onMouseUp={(e) => { if (!disabled) e.currentTarget.style.background = isAction ? '#f5f5f5' : '#fff' }}
            onMouseLeave={(e) => { if (!disabled) e.currentTarget.style.background = isAction ? '#f5f5f5' : '#fff' }}
          >
            {k}
          </button>
        )
      })}
    </div>
  )
}

// ── User avatar chip ─────────────────────────────────────────────────────────
function UserChip({ user, selected, onClick }) {
  const initials = user.username.slice(0, 2).toUpperCase()
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '6px',
        padding: '10px 14px',
        border: `2px solid ${selected ? '#2e7d32' : '#e0e0e0'}`,
        borderRadius: '10px',
        background: selected ? '#f0f7f0' : '#fff',
        cursor: 'pointer',
        transition: 'all 0.15s',
        minWidth: '72px',
      }}
    >
      <div style={{
        width: '40px',
        height: '40px',
        borderRadius: '50%',
        background: selected
          ? 'linear-gradient(135deg, #2e7d32, #1b5e20)'
          : 'linear-gradient(135deg, #bbb, #999)',
        color: '#fff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '15px',
        fontWeight: 700,
      }}>
        {initials}
      </div>
      <span style={{ fontSize: '12px', color: selected ? '#2e7d32' : '#555', fontWeight: selected ? 600 : 400 }}>
        {user.username}
      </span>
    </button>
  )
}

// ── Forgot PIN modal ─────────────────────────────────────────────────────────
function ForgotPinModal({ selectedUser, onClose, onReset }) {
  const [modalStep, setModalStep] = useState('key') // 'key' | 'newpin' | 'done'
  const [keyInput, setKeyInput] = useState('')
  const [newPin, setNewPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const formatKey = (raw) => {
    const clean = raw.replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, 16)
    return clean.match(/.{1,4}/g)?.join('-') || ''
  }

  const keyComplete = keyInput.replace(/-/g, '').length === 16

  const handleVerifyKey = async () => {
    if (!keyComplete || loading) return
    setLoading(true)
    setError('')
    try {
      const result = await window.stocka.license.activate(keyInput)
      const msg = (result?.error || '').toLowerCase()
      if (result?.success || msg.includes('already') || msg.includes('activated')) {
        setModalStep('newpin')
      } else {
        setError("That key doesn't match. Check for typos and try again.")
      }
    } catch {
      setError('Could not verify key. Please restart the app and try again.')
    } finally {
      setLoading(false)
    }
  }

  const handleSavePin = async () => {
    if (newPin.length !== 4) { setError('PIN must be 4 digits.'); return }
    if (newPin !== confirmPin) { setError('PINs do not match.'); return }
    setLoading(true)
    setError('')
    try {
      await resetOwnerPin(selectedUser.username, newPin)
      setModalStep('done')
      setTimeout(() => { onReset(newPin) }, 1200)
    } catch {
      setError('Failed to save new PIN. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const PinBoxes4 = ({ value, onChange }) => {
    const digits = value.split('')
    const refs = [null, null, null, null].map(() => ({ current: null }))
    const handleInput = (i, e) => {
      const d = e.target.value.replace(/\D/g, '').slice(-1)
      const next = [...digits]; next[i] = d
      onChange(next.join(''))
      if (d && i < 3) document.getElementById(`modal-pin-${i + 1}`)?.focus()
    }
    const handleKd = (i, e) => {
      if (e.key === 'Backspace' && !digits[i] && i > 0) document.getElementById(`modal-pin-${i - 1}`)?.focus()
    }
    return (
      <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
        {[0, 1, 2, 3].map((i) => (
          <input
            key={i}
            id={`modal-pin-${i}`}
            type="password"
            inputMode="numeric"
            maxLength={1}
            value={digits[i] || ''}
            onChange={(e) => handleInput(i, e)}
            onKeyDown={(e) => handleKd(i, e)}
            style={{
              width: '52px', height: '52px',
              fontSize: '20px', textAlign: 'center',
              border: `2px solid ${digits[i] ? '#2e7d32' : '#ddd'}`,
              borderRadius: '8px', outline: 'none',
            }}
          />
        ))}
      </div>
    )
  }

  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: 'rgba(0,0,0,0.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 1000, padding: '24px',
    }}>
      <div style={{
        background: '#fff',
        borderRadius: '12px',
        padding: '36px 32px',
        maxWidth: '420px',
        width: '100%',
        boxShadow: '0 16px 48px rgba(0,0,0,0.2)',
        textAlign: 'center',
      }}>
        {modalStep === 'done' ? (
          <>
            <FiCheckCircle size={48} color="#2e7d32" style={{ marginBottom: '12px' }} />
            <h2 style={{ margin: '0 0 6px', color: '#2e7d32' }}>PIN Reset!</h2>
            <p style={{ color: '#666', fontSize: '14px' }}>Logging you in...</p>
          </>
        ) : modalStep === 'newpin' ? (
          <>
            <h2 style={{ margin: '0 0 8px', fontSize: '20px', color: '#1a1a1a' }}>Set a new PIN</h2>
            <p style={{ color: '#777', fontSize: '13px', margin: '0 0 24px' }}>
              Choose a new 4-digit PIN for {selectedUser?.username}.
            </p>
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', marginBottom: '10px', fontSize: '13px', fontWeight: 600, color: '#333' }}>New PIN</label>
              <PinBoxes4 value={newPin} onChange={(v) => { setNewPin(v); setError('') }} />
            </div>
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', marginBottom: '10px', fontSize: '13px', fontWeight: 600, color: '#333' }}>Confirm PIN</label>
              <PinBoxes4 value={confirmPin} onChange={(v) => { setConfirmPin(v); setError('') }} />
            </div>
            {error && <p style={{ color: '#e53935', fontSize: '13px', margin: '0 0 12px' }}>{error}</p>}
            <button
              onClick={handleSavePin}
              disabled={loading}
              style={{
                width: '100%', padding: '13px',
                background: 'linear-gradient(135deg, #2e7d32, #1b5e20)',
                color: '#fff', border: 'none', borderRadius: '8px',
                fontSize: '15px', fontWeight: 600, cursor: 'pointer',
                marginBottom: '10px',
              }}
            >
              {loading ? 'Saving…' : 'Save New PIN'}
            </button>
            <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#aaa', cursor: 'pointer', fontSize: '13px' }}>
              Cancel
            </button>
          </>
        ) : (
          <>
            <h2 style={{ margin: '0 0 8px', fontSize: '20px', color: '#1a1a1a' }}>Forgot your PIN?</h2>
            <p style={{ color: '#777', fontSize: '13px', margin: '0 0 24px', lineHeight: 1.5 }}>
              Enter your Stocka activation key to verify your identity and reset your PIN.
            </p>
            <div style={{ textAlign: 'left', marginBottom: '16px' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontSize: '13px', fontWeight: 600, color: '#333' }}>
                Activation Key
              </label>
              <input
                type="text"
                value={keyInput}
                onChange={(e) => {
                  const clean = e.target.value.replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, 16)
                  setKeyInput(clean.match(/.{1,4}/g)?.join('-') || '')
                  setError('')
                }}
                placeholder="XXXX-XXXX-XXXX-XXXX"
                spellCheck={false}
                autoFocus
                style={{
                  width: '100%', padding: '12px 14px',
                  fontSize: '17px', fontFamily: 'monospace',
                  letterSpacing: '2px', textAlign: 'center',
                  border: `2px solid ${error ? '#e53935' : keyComplete ? '#2e7d32' : '#ddd'}`,
                  borderRadius: '8px', boxSizing: 'border-box', outline: 'none',
                }}
              />
              {error && <p style={{ color: '#e53935', fontSize: '13px', margin: '6px 0 0', lineHeight: 1.4 }}>{error}</p>}
            </div>
            <button
              onClick={handleVerifyKey}
              disabled={!keyComplete || loading}
              style={{
                width: '100%', padding: '13px',
                background: keyComplete ? 'linear-gradient(135deg, #2e7d32, #1b5e20)' : '#ccc',
                color: '#fff', border: 'none', borderRadius: '8px',
                fontSize: '15px', fontWeight: 600,
                cursor: keyComplete && !loading ? 'pointer' : 'not-allowed',
                marginBottom: '10px',
              }}
            >
              {loading ? 'Verifying…' : 'Verify Key'}
            </button>
            <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#aaa', cursor: 'pointer', fontSize: '13px' }}>
              Cancel
            </button>
          </>
        )}
      </div>
    </div>
  )
}

// ── Dev-mode bypass login ────────────────────────────────────────────────────
function DevLogin() {
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getUsers().then(u => {
      setUsers((u || []).filter(x => x.is_active))
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  const loginAs = (user) => {
    useAuthStore.getState().setUser({ id: user.id, username: user.username, role: user.role, is_active: user.is_active })
    window.location.hash = '#/dashboard'
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      minHeight: '100vh', background: '#f5f5f0',
      fontFamily: 'system-ui, -apple-system, sans-serif',
    }}>
      <div style={{
        background: '#fff', borderRadius: '12px',
        padding: '32px', maxWidth: '360px', width: '100%',
        boxShadow: '0 4px 16px rgba(0,0,0,0.1)', textAlign: 'center',
      }}>
        <img src={iconPng} alt="Stocka" style={{ width: '52px', height: '52px', borderRadius: '14px', display: 'block', margin: '0 auto 16px' }} />
        <div style={{
          display: 'inline-block', padding: '6px 14px',
          background: '#fff3cd', borderRadius: '20px',
          fontSize: '12px', fontWeight: 600, color: '#856404',
          marginBottom: '20px', border: '1px solid #ffc107',
        }}>
          DEV MODE — PIN bypassed
        </div>
        <h2 style={{ margin: '0 0 20px', fontSize: '18px', color: '#333' }}>Sign in as</h2>
        {loading ? (
          <p style={{ color: '#aaa' }}>Loading users...</p>
        ) : users.length === 0 ? (
          <p style={{ color: '#aaa', fontSize: '13px' }}>
            No users found. Complete shop setup first.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {users.map(u => (
              <button
                key={u.id}
                onClick={() => loginAs(u)}
                style={{
                  padding: '12px 16px',
                  background: '#f0f7f0',
                  border: '1px solid #a5d6a7',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  fontSize: '14px',
                  color: '#1a1a1a',
                }}
              >
                <div style={{
                  width: '36px', height: '36px', borderRadius: '50%',
                  background: 'linear-gradient(135deg, #2e7d32, #1b5e20)',
                  color: '#fff', fontWeight: 700, fontSize: '14px',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0,
                }}>
                  {u.username.slice(0, 2).toUpperCase()}
                </div>
                <div style={{ textAlign: 'left' }}>
                  <div style={{ fontWeight: 600 }}>{u.username}</div>
                  <div style={{ fontSize: '12px', color: '#888' }}>{u.role}</div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main Login component ─────────────────────────────────────────────────────
function Login() {
  // In development (npm run dev), skip the PIN entirely
  if (import.meta.env.DEV) return <DevLogin />

  const [users, setUsers] = useState([])
  const [shopName, setShopName] = useState('Stocka')
  const [selectedUser, setSelectedUser] = useState(null)
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [shake, setShake] = useState(false)
  const [loading, setLoading] = useState(false)
  const [dataLoading, setDataLoading] = useState(true)
  const [showForgotPin, setShowForgotPin] = useState(false)

  useEffect(() => {
    const load = async () => {
      try {
        const [usersData, shop] = await Promise.all([getUsers(), getShop()])
        const activeUsers = (usersData || []).filter(u => u.is_active)
        setUsers(activeUsers)
        if (shop?.name) setShopName(shop.name)
        // Auto-select if only one user
        if (activeUsers.length === 1) setSelectedUser(activeUsers[0])
      } catch (err) {
        console.error('Login load error:', err)
      } finally {
        setDataLoading(false)
      }
    }
    load()
  }, [])

  // Physical keyboard support
  useEffect(() => {
    const handleKey = (e) => {
      if (showForgotPin || loading) return
      if (e.key >= '0' && e.key <= '9') handleDigit(e.key)
      else if (e.key === 'Backspace') handleBackspace()
      else if (e.key === 'Escape') handleClear()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [pin, selectedUser, loading, showForgotPin])

  const handleDigit = (d) => {
    if (!selectedUser || loading) return
    if (pin.length >= 4) return
    const next = pin + d
    setPin(next)
    setError('')
    if (next.length === 4) attemptLogin(next)
  }

  const handleBackspace = () => {
    setPin((p) => p.slice(0, -1))
    setError('')
  }

  const handleClear = () => {
    setPin('')
    setError('')
  }

  const attemptLogin = async (enteredPin) => {
    if (!selectedUser) return
    setLoading(true)
    try {
      const user = await loginUser(selectedUser.username, enteredPin)
      if (user) {
        useAuthStore.getState().setUser(user)
        window.location.hash = '#/dashboard'
      } else {
        triggerError('Wrong PIN. Try again.')
      }
    } catch (err) {
      triggerError('Login error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const triggerError = (msg) => {
    setError(msg)
    setPin('')
    setShake(true)
    setTimeout(() => setShake(false), 500)
  }

  const handleForgotPinReset = async (newPin) => {
    setShowForgotPin(false)
    setPin('')
    setError('')
    // Brief pause so the modal can show its "done" state, then log in
    setTimeout(() => attemptLogin(newPin), 1400)
  }

  const handleSetupRedirect = () => {
    window.location.hash = '#/setup'
  }

  if (dataLoading) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        minHeight: '100vh', background: '#f5f5f0',
      }}>
        <div style={{ textAlign: 'center', color: '#aaa' }}>
          <img src={iconPng} alt="Stocka" style={{ width: '40px', height: '40px', borderRadius: '10px', opacity: 0.3, display: 'block', margin: '0 auto' }} />
          <p style={{ marginTop: '12px', fontSize: '14px' }}>Loading...</p>
        </div>
      </div>
    )
  }

  // No users at all — first run, go to setup
  if (!dataLoading && users.length === 0) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        minHeight: '100vh', background: '#f5f5f0',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}>
        <div style={{
          background: '#fff', borderRadius: '12px',
          padding: '48px 40px', maxWidth: '420px', width: '100%',
          boxShadow: '0 8px 32px rgba(0,0,0,0.1)', textAlign: 'center',
        }}>
          <img src={fullLogo} alt="Stocka" style={{ height: '52px', objectFit: 'contain', display: 'block', margin: '0 auto 24px' }} />
          <p style={{ color: '#888', margin: '0 0 32px', fontSize: '14px' }}>
            Smart Retail Management for Zimbabwe
          </p>
          <button
            onClick={handleSetupRedirect}
            style={{
              width: '100%', padding: '14px',
              background: 'linear-gradient(135deg, #2e7d32, #1b5e20)',
              color: '#fff', border: 'none', borderRadius: '8px',
              fontSize: '16px', fontWeight: 600, cursor: 'pointer',
            }}
          >
            Set Up My Shop
          </button>
          <p style={{ margin: '24px 0 0', fontSize: '12px', color: '#bbb' }}>
            v1.0 — Proudly Zimbabwean
          </p>
        </div>
      </div>
    )
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      minHeight: '100vh', background: '#f5f5f0',
      fontFamily: 'system-ui, -apple-system, sans-serif',
    }}>
      <div style={{
        background: '#fff', borderRadius: '14px',
        padding: '40px 36px', maxWidth: '380px', width: '100%',
        boxShadow: '0 8px 32px rgba(0,0,0,0.1)', textAlign: 'center',
      }}>
        {/* Shop branding */}
        <img src={iconPng} alt="Stocka" style={{ width: '52px', height: '52px', borderRadius: '14px', margin: '0 auto 12px', display: 'block' }} />
        <h2 style={{ margin: '0 0 4px', fontSize: '18px', color: '#1a1a1a', fontWeight: 700 }}>
          {shopName}
        </h2>
        <p style={{ margin: '0 0 24px', fontSize: '13px', color: '#aaa' }}>
          Enter your PIN to sign in
        </p>

        {/* User selector */}
        {users.length > 1 && (
          <div style={{
            display: 'flex', gap: '8px', justifyContent: 'center',
            flexWrap: 'wrap', marginBottom: '20px',
          }}>
            {users.map((u) => (
              <UserChip
                key={u.id}
                user={u}
                selected={selectedUser?.id === u.id}
                onClick={() => { setSelectedUser(u); setPin(''); setError('') }}
              />
            ))}
          </div>
        )}

        {/* Selected user name (single user, no switcher) */}
        {users.length === 1 && selectedUser && (
          <div style={{ marginBottom: '20px' }}>
            <div style={{
              width: '52px', height: '52px', borderRadius: '50%',
              background: 'linear-gradient(135deg, #2e7d32, #1b5e20)',
              color: '#fff', fontSize: '18px', fontWeight: 700,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              margin: '0 auto 8px',
            }}>
              {selectedUser.username.slice(0, 2).toUpperCase()}
            </div>
            <p style={{ margin: 0, fontSize: '15px', fontWeight: 600, color: '#333' }}>
              {selectedUser.username}
            </p>
            <p style={{ margin: '2px 0 0', fontSize: '12px', color: '#aaa' }}>
              {selectedUser.role}
            </p>
          </div>
        )}

        {/* No user selected hint */}
        {!selectedUser && users.length > 1 && (
          <p style={{ color: '#bbb', fontSize: '13px', marginBottom: '20px' }}>
            Select who is signing in
          </p>
        )}

        {/* PIN dots */}
        {selectedUser && (
          <PinDots value={pin} shake={shake} />
        )}

        {/* Error */}
        {error && (
          <p style={{
            color: '#e53935', fontSize: '13px',
            margin: '-16px 0 16px', fontWeight: 500,
          }}>
            {error}
          </p>
        )}

        {/* PIN pad */}
        {selectedUser && (
          <PinPad
            onDigit={handleDigit}
            onBackspace={handleBackspace}
            onClear={handleClear}
            disabled={loading || pin.length >= 4}
          />
        )}

        {/* Forgot PIN */}
        {selectedUser && (
          <button
            onClick={() => setShowForgotPin(true)}
            style={{
              background: 'none', border: 'none',
              color: '#aaa', cursor: 'pointer',
              fontSize: '13px', marginTop: '20px',
              textDecoration: 'underline',
            }}
          >
            Forgot PIN?
          </button>
        )}

        <p style={{ margin: '20px 0 0', fontSize: '12px', color: '#ccc' }}>
          v1.0 — Proudly Zimbabwean
        </p>
      </div>

      {/* Forgot PIN modal */}
      {showForgotPin && (
        <ForgotPinModal
          selectedUser={selectedUser}
          onClose={() => setShowForgotPin(false)}
          onReset={handleForgotPinReset}
        />
      )}

      <style>{`
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          20%, 60% { transform: translateX(-6px); }
          40%, 80% { transform: translateX(6px); }
        }
      `}</style>
    </div>
  )
}

export default Login
