import { useState, useEffect } from 'react'
import { FiCheckCircle } from 'react-icons/fi'
import { getUsers, getShop, loginUser, resetOwnerPin } from '../database/db'
import iconPng from '../assets/icon.png'
import fullLogo from '../assets/full_logo.png'
import { useAuthStore } from '../store/useAuthStore'

function getClockData() {
  const now = new Date()
  return {
    time: now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false }),
    date: now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
  }
}

// ── PIN display (4 dots) ─────────────────────────────────────────────────────
function PinDots({ value, shake }) {
  return (
    <div style={{
      display: 'flex',
      gap: '18px',
      justifyContent: 'center',
      marginBottom: '28px',
      animation: shake ? 'shake 0.4s ease' : 'none',
    }}>
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          style={{
            width: '18px',
            height: '18px',
            borderRadius: '50%',
            background: i < value.length ? '#2e7d32' : 'transparent',
            border: '2.5px solid',
            borderColor: i < value.length ? '#2e7d32' : '#d0d0d0',
            transition: 'all 0.18s cubic-bezier(0.34, 1.56, 0.64, 1)',
            transform: i < value.length ? 'scale(1.2)' : 'scale(1)',
            boxShadow: i < value.length ? '0 0 0 4px rgba(46,125,50,0.12)' : 'none',
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
      maxWidth: '288px',
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
              height: '58px',
              borderRadius: '12px',
              border: '1.5px solid #ebebeb',
              background: isAction ? '#f7f7f7' : '#fff',
              fontSize: isAction ? '19px' : '22px',
              fontWeight: isAction ? 400 : 600,
              color: isAction ? '#999' : '#1a1a1a',
              cursor: disabled ? 'not-allowed' : 'pointer',
              transition: 'all 0.1s',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
              opacity: disabled ? 0.45 : 1,
            }}
            onMouseDown={(e) => {
              if (!disabled) {
                e.currentTarget.style.background = isAction ? '#ebebeb' : '#edf7ed'
                e.currentTarget.style.transform = 'scale(0.94)'
                e.currentTarget.style.borderColor = isAction ? '#ddd' : '#a5d6a7'
              }
            }}
            onMouseUp={(e) => {
              if (!disabled) {
                e.currentTarget.style.background = isAction ? '#f7f7f7' : '#fff'
                e.currentTarget.style.transform = 'scale(1)'
                e.currentTarget.style.borderColor = '#ebebeb'
              }
            }}
            onMouseLeave={(e) => {
              if (!disabled) {
                e.currentTarget.style.background = isAction ? '#f7f7f7' : '#fff'
                e.currentTarget.style.transform = 'scale(1)'
                e.currentTarget.style.borderColor = '#ebebeb'
              }
            }}
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
        gap: '8px',
        padding: '14px 16px',
        border: `2px solid ${selected ? '#2e7d32' : '#ebebeb'}`,
        borderRadius: '14px',
        background: selected ? '#f0f8f0' : '#fafafa',
        cursor: 'pointer',
        transition: 'all 0.15s',
        minWidth: '82px',
        boxShadow: selected ? '0 0 0 4px rgba(46,125,50,0.1)' : 'none',
      }}
      onMouseEnter={(e) => { if (!selected) { e.currentTarget.style.borderColor = '#c8e6c9'; e.currentTarget.style.background = '#f5faf5' } }}
      onMouseLeave={(e) => { if (!selected) { e.currentTarget.style.borderColor = '#ebebeb'; e.currentTarget.style.background = '#fafafa' } }}
    >
      <div style={{
        width: '46px',
        height: '46px',
        borderRadius: '50%',
        background: selected
          ? 'linear-gradient(135deg, #2e7d32, #1b5e20)'
          : 'linear-gradient(135deg, #bdbdbd, #9e9e9e)',
        color: '#fff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '16px',
        fontWeight: 700,
        transition: 'all 0.15s',
        boxShadow: selected ? '0 4px 12px rgba(46,125,50,0.3)' : 'none',
      }}>
        {initials}
      </div>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: '12px', fontWeight: 600, color: selected ? '#2e7d32' : '#555' }}>
          {user.username}
        </div>
        <div style={{ fontSize: '10px', color: selected ? '#558b2f' : '#bbb', marginTop: '1px', fontWeight: 500 }}>
          {user.role}
        </div>
      </div>
    </button>
  )
}

// ── Forgot PIN modal ─────────────────────────────────────────────────────────
function ForgotPinModal({ selectedUser, onClose, onReset }) {
  const [modalStep, setModalStep] = useState('key')
  const [keyInput, setKeyInput] = useState('')
  const [newPin, setNewPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

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
      background: 'rgba(0,0,0,0.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 1000, padding: '24px',
    }}>
      <div style={{
        background: '#fff',
        borderRadius: '16px',
        padding: '40px 36px',
        maxWidth: '420px',
        width: '100%',
        boxShadow: '0 24px 64px rgba(0,0,0,0.2)',
        textAlign: 'center',
      }}>
        {modalStep === 'done' ? (
          <>
            <FiCheckCircle size={52} color="#2e7d32" style={{ marginBottom: '16px' }} />
            <h2 style={{ margin: '0 0 6px', color: '#2e7d32', fontSize: '22px' }}>PIN Reset!</h2>
            <p style={{ color: '#999', fontSize: '14px', margin: 0 }}>Logging you in...</p>
          </>
        ) : modalStep === 'newpin' ? (
          <>
            <h2 style={{ margin: '0 0 8px', fontSize: '20px', color: '#1a1a1a' }}>Set a new PIN</h2>
            <p style={{ color: '#999', fontSize: '13px', margin: '0 0 24px' }}>
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
                color: '#fff', border: 'none', borderRadius: '10px',
                fontSize: '15px', fontWeight: 600, cursor: 'pointer',
                marginBottom: '10px',
              }}
            >
              {loading ? 'Saving…' : 'Save New PIN'}
            </button>
            <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#bbb', cursor: 'pointer', fontSize: '13px' }}>
              Cancel
            </button>
          </>
        ) : (
          <>
            <h2 style={{ margin: '0 0 8px', fontSize: '20px', color: '#1a1a1a' }}>Forgot your PIN?</h2>
            <p style={{ color: '#999', fontSize: '13px', margin: '0 0 24px', lineHeight: 1.6 }}>
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
                background: keyComplete ? 'linear-gradient(135deg, #2e7d32, #1b5e20)' : '#e0e0e0',
                color: keyComplete ? '#fff' : '#aaa', border: 'none', borderRadius: '10px',
                fontSize: '15px', fontWeight: 600,
                cursor: keyComplete && !loading ? 'pointer' : 'not-allowed',
                marginBottom: '10px', transition: 'all 0.2s',
              }}
            >
              {loading ? 'Verifying…' : 'Verify Key'}
            </button>
            <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#bbb', cursor: 'pointer', fontSize: '13px' }}>
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
  const [clock, setClock] = useState(getClockData)

  useEffect(() => {
    getUsers().then(u => {
      setUsers((u || []).filter(x => x.is_active))
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  useEffect(() => {
    const tick = setInterval(() => setClock(getClockData()), 1000)
    return () => clearInterval(tick)
  }, [])

  const loginAs = (user) => {
    useAuthStore.getState().setUser({ id: user.id, username: user.username, role: user.role, is_active: user.is_active })
    window.location.hash = '#/dashboard'
  }

  return (
    <div style={{
      display: 'flex', height: '100vh', overflow: 'hidden',
      fontFamily: 'system-ui, -apple-system, sans-serif',
    }}>
      <LeftPanel shopName="Stocka" clock={clock} />
      <div style={{
        flex: 1, background: '#fff',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        padding: '48px',
      }}>
        <div style={{ width: '100%', maxWidth: '320px' }}>
          <div style={{
            display: 'inline-block', padding: '5px 14px',
            background: '#fff8e1', borderRadius: '20px',
            fontSize: '12px', fontWeight: 600, color: '#f57f17',
            marginBottom: '24px', border: '1px solid #ffe082',
          }}>
            DEV MODE — PIN bypassed
          </div>
          <h2 style={{ margin: '0 0 6px', fontSize: '24px', fontWeight: 700, color: '#1a1a1a' }}>Sign in as</h2>
          <p style={{ margin: '0 0 28px', fontSize: '14px', color: '#aaa' }}>Choose an account to continue</p>
          {loading ? (
            <p style={{ color: '#ccc', textAlign: 'center' }}>Loading users...</p>
          ) : users.length === 0 ? (
            <p style={{ color: '#bbb', fontSize: '13px', textAlign: 'center' }}>
              No users found. Complete shop setup first.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {users.map(u => (
                <button
                  key={u.id}
                  onClick={() => loginAs(u)}
                  style={{
                    padding: '14px 16px',
                    background: '#fafafa',
                    border: '1.5px solid #ebebeb',
                    borderRadius: '12px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '14px',
                    fontSize: '14px',
                    color: '#1a1a1a',
                    transition: 'all 0.15s',
                    textAlign: 'left',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#a5d6a7'; e.currentTarget.style.background = '#f5faf5' }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#ebebeb'; e.currentTarget.style.background = '#fafafa' }}
                >
                  <div style={{
                    width: '40px', height: '40px', borderRadius: '50%',
                    background: 'linear-gradient(135deg, #2e7d32, #1b5e20)',
                    color: '#fff', fontWeight: 700, fontSize: '15px',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0,
                    boxShadow: '0 3px 10px rgba(46,125,50,0.25)',
                  }}>
                    {u.username.slice(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '15px' }}>{u.username}</div>
                    <div style={{ fontSize: '12px', color: '#aaa', marginTop: '1px' }}>{u.role}</div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Shared left branding panel ───────────────────────────────────────────────
function LeftPanel({ shopName, clock }) {
  return (
    <div style={{
      width: '38%',
      flexShrink: 0,
      background: 'linear-gradient(160deg, #1a5c2a 0%, #2e7d32 55%, #3a8f3d 100%)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '48px 40px',
      color: '#fff',
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* Decorative circles */}
      <div style={{
        position: 'absolute', top: '-100px', right: '-100px',
        width: '320px', height: '320px', borderRadius: '50%',
        background: 'rgba(255,255,255,0.06)', pointerEvents: 'none',
      }} />
      <div style={{
        position: 'absolute', bottom: '-80px', left: '-80px',
        width: '260px', height: '260px', borderRadius: '50%',
        background: 'rgba(255,255,255,0.06)', pointerEvents: 'none',
      }} />
      <div style={{
        position: 'absolute', top: '35%', left: '-50px',
        width: '120px', height: '120px', borderRadius: '50%',
        background: 'rgba(255,255,255,0.04)', pointerEvents: 'none',
      }} />

      {/* Icon */}
      <div style={{
        width: '76px', height: '76px',
        background: 'rgba(255,255,255,0.15)',
        borderRadius: '22px',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        marginBottom: '20px',
        boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
      }}>
        <img src={iconPng} alt="Stocka" style={{ width: '56px', height: '56px', borderRadius: '14px' }} />
      </div>

      {/* Shop name */}
      <h1 style={{
        margin: '0 0 8px',
        fontSize: '26px', fontWeight: 800,
        letterSpacing: '-0.5px', textAlign: 'center',
      }}>
        {shopName}
      </h1>

      {/* Tagline */}
      <p style={{
        margin: 0,
        fontSize: '13px', opacity: 0.7,
        textAlign: 'center', lineHeight: 1.6,
      }}>
        Smart Retail Management<br />for Zimbabwe
      </p>

      {/* Divider */}
      <div style={{
        width: '48px', height: '2px',
        background: 'rgba(255,255,255,0.25)',
        borderRadius: '1px',
        margin: '36px 0',
      }} />

      {/* Clock */}
      <div style={{ textAlign: 'center' }}>
        <div style={{
          fontSize: '52px', fontWeight: 200,
          letterSpacing: '-2px', lineHeight: 1,
          fontVariantNumeric: 'tabular-nums',
        }}>
          {clock.time}
        </div>
        <div style={{
          fontSize: '13px', opacity: 0.6,
          marginTop: '10px', letterSpacing: '0.3px',
        }}>
          {clock.date}
        </div>
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
  const [clock, setClock] = useState(getClockData)

  useEffect(() => {
    const load = async () => {
      try {
        const [usersData, shop] = await Promise.all([getUsers(), getShop()])
        const activeUsers = (usersData || []).filter(u => u.is_active)
        setUsers(activeUsers)
        if (shop?.name) setShopName(shop.name)
        if (activeUsers.length === 1) setSelectedUser(activeUsers[0])
      } catch (err) {
        console.error('Login load error:', err)
      } finally {
        setDataLoading(false)
      }
    }
    load()
  }, [])

  useEffect(() => {
    const tick = setInterval(() => setClock(getClockData()), 1000)
    return () => clearInterval(tick)
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
    } catch {
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
    setTimeout(() => attemptLogin(newPin), 1400)
  }

  const handleSetupRedirect = () => {
    window.location.hash = '#/setup'
  }

  if (dataLoading) {
    return (
      <div style={{
        display: 'flex', height: '100vh', overflow: 'hidden',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}>
        <LeftPanel shopName={shopName} clock={clock} />
        <div style={{
          flex: 1, background: '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{
              width: '36px', height: '36px',
              border: '3px solid #e8f5e9',
              borderTopColor: '#2e7d32',
              borderRadius: '50%',
              animation: 'spin 0.8s linear infinite',
              margin: '0 auto 14px',
            }} />
            <p style={{ color: '#ccc', fontSize: '14px', margin: 0 }}>Loading...</p>
          </div>
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    )
  }

  // No users — first run, redirect to setup
  if (!dataLoading && users.length === 0) {
    return (
      <div style={{
        display: 'flex', height: '100vh', overflow: 'hidden',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}>
        <LeftPanel shopName="Stocka" clock={clock} />
        <div style={{
          flex: 1, background: '#fff',
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          padding: '48px',
        }}>
          <div style={{ width: '100%', maxWidth: '320px', textAlign: 'center' }}>
            <img src={fullLogo} alt="Stocka" style={{ height: '44px', objectFit: 'contain', display: 'block', margin: '0 auto 24px' }} />
            <h2 style={{ margin: '0 0 8px', fontSize: '22px', fontWeight: 700, color: '#1a1a1a' }}>
              Welcome to Stocka
            </h2>
            <p style={{ color: '#aaa', margin: '0 0 36px', fontSize: '14px', lineHeight: 1.6 }}>
              Smart Retail Management for Zimbabwe.<br />Let's set up your shop to get started.
            </p>
            <button
              onClick={handleSetupRedirect}
              style={{
                width: '100%', padding: '15px',
                background: 'linear-gradient(135deg, #2e7d32, #1b5e20)',
                color: '#fff', border: 'none', borderRadius: '12px',
                fontSize: '16px', fontWeight: 600, cursor: 'pointer',
                boxShadow: '0 4px 16px rgba(46,125,50,0.3)',
                transition: 'all 0.2s',
              }}
            >
              Set Up My Shop
            </button>
            <p style={{ margin: '28px 0 0', fontSize: '12px', color: '#ddd' }}>
              v1.2.0 — Proudly Zimbabwean
</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={{
      display: 'flex',
      height: '100vh',
      overflow: 'hidden',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      animation: 'fadeIn 0.35s ease',
    }}>
      {/* LEFT — Branding panel */}
      <LeftPanel shopName={shopName} clock={clock} />

      {/* RIGHT — Sign-in panel */}
      <div style={{
        flex: 1,
        background: '#fff',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '32px 48px',
        overflowY: 'auto',
      }}>
        <div style={{ width: '100%', maxWidth: '340px' }}>

          <h2 style={{ margin: '0 0 4px', fontSize: '26px', fontWeight: 700, color: '#1a1a1a' }}>
            Sign in
          </h2>
          <p style={{ margin: '0 0 28px', fontSize: '14px', color: '#bbb' }}>
            {users.length > 1 ? 'Select your account and enter your PIN' : 'Enter your PIN to continue'}
          </p>

          {/* Multi-user selector */}
          {users.length > 1 && (
            <div style={{
              display: 'flex', gap: '10px',
              justifyContent: 'center', flexWrap: 'wrap',
              marginBottom: '28px',
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

          {/* Single user display */}
          {users.length === 1 && selectedUser && (
            <div style={{ textAlign: 'center', marginBottom: '28px' }}>
              <div style={{
                width: '60px', height: '60px', borderRadius: '50%',
                background: 'linear-gradient(135deg, #2e7d32, #1b5e20)',
                color: '#fff', fontSize: '22px', fontWeight: 700,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                margin: '0 auto 10px',
                boxShadow: '0 6px 20px rgba(46,125,50,0.3)',
              }}>
                {selectedUser.username.slice(0, 2).toUpperCase()}
              </div>
              <p style={{ margin: 0, fontSize: '17px', fontWeight: 600, color: '#1a1a1a' }}>
                {selectedUser.username}
              </p>
              <p style={{ margin: '3px 0 0', fontSize: '12px', color: '#bbb' }}>
                {selectedUser.role}
              </p>
            </div>
          )}

          {/* No-selection hint */}
          {!selectedUser && users.length > 1 && (
            <p style={{ color: '#ccc', fontSize: '13px', textAlign: 'center', marginBottom: '28px' }}>
              Select who is signing in
            </p>
          )}

          {/* PIN dots + pad */}
          {selectedUser && (
            <>
              <PinDots value={pin} shake={shake} />

              {error && (
                <p style={{
                  color: '#e53935', fontSize: '13px',
                  textAlign: 'center', margin: '-16px 0 18px',
                  fontWeight: 500,
                }}>
                  {error}
                </p>
              )}

              <PinPad
                onDigit={handleDigit}
                onBackspace={handleBackspace}
                onClear={handleClear}
                disabled={loading || pin.length >= 4}
              />

              <button
                onClick={() => setShowForgotPin(true)}
                style={{
                  display: 'block', margin: '22px auto 0',
                  background: 'none', border: 'none',
                  color: '#ccc', cursor: 'pointer',
                  fontSize: '13px', textDecoration: 'underline',
                  textDecorationColor: '#e0e0e0',
                  transition: 'color 0.15s',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.color = '#2e7d32' }}
                onMouseLeave={(e) => { e.currentTarget.style.color = '#ccc' }}
              >
                Forgot PIN?
              </button>
            </>
          )}

          <p style={{ margin: '28px 0 0', fontSize: '11px', color: '#e0e0e0', textAlign: 'center' }}>
            v1.2.0 — Proudly Zimbabwean
          </p>
        </div>
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
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  )
}

export default Login
