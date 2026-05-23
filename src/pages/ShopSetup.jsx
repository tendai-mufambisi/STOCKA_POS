import { useState, useRef } from 'react'
import { FiCheckCircle, FiInfo } from 'react-icons/fi'
import { initializeShop, addProduct, loginUser } from '../database/db'
import { validateEmail } from '../utils/validation'
import iconPng from '../assets/icon.png'
import fullLogo from '../assets/full_logo.png'
import './ShopSetup.css'

// ── Reusable 4-digit PIN box component ──────────────────────────────────────
function PinBoxes({ value, onChange, id, disabled }) {
  const refs = [useRef(), useRef(), useRef(), useRef()]
  const digits = value.split('')

  const handleInput = (i, e) => {
    const d = e.target.value.replace(/\D/g, '').slice(-1)
    const next = [...digits]
    next[i] = d
    onChange(next.join(''))
    if (d && i < 3) refs[i + 1].current?.focus()
  }

  const handleKeyDown = (i, e) => {
    if (e.key === 'Backspace') {
      if (digits[i]) {
        const next = [...digits]
        next[i] = ''
        onChange(next.join(''))
      } else if (i > 0) {
        refs[i - 1].current?.focus()
      }
    }
  }

  const handlePaste = (e) => {
    e.preventDefault()
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 4)
    onChange(pasted.padEnd(4, '').slice(0, 4))
    if (pasted.length >= 4) refs[3].current?.focus()
    else if (pasted.length > 0) refs[Math.min(pasted.length, 3)].current?.focus()
  }

  return (
    <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
      {[0, 1, 2, 3].map((i) => (
        <input
          key={i}
          ref={refs[i]}
          type="password"
          inputMode="numeric"
          maxLength={1}
          value={digits[i] || ''}
          onChange={(e) => handleInput(i, e)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onPaste={handlePaste}
          disabled={disabled}
          autoComplete="off"
          style={{
            width: '56px',
            height: '56px',
            fontSize: '20px',
            textAlign: 'center',
            border: `2px solid ${digits[i] ? '#2e7d32' : '#ddd'}`,
            borderRadius: '10px',
            outline: 'none',
            background: '#fff',
            transition: 'border-color 0.15s',
            cursor: disabled ? 'not-allowed' : 'text',
          }}
        />
      ))}
    </div>
  )
}

// ── Step indicator ──────────────────────────────────────────────────────────
function StepDots({ current, total }) {
  return (
    <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', marginBottom: '28px' }}>
      {Array.from({ length: total }, (_, i) => (
        <div
          key={i}
          style={{
            width: i === current - 1 ? '24px' : '8px',
            height: '8px',
            borderRadius: '4px',
            background: i < current ? '#2e7d32' : '#ddd',
            transition: 'all 0.2s',
          }}
        />
      ))}
    </div>
  )
}

// ── Main component ──────────────────────────────────────────────────────────
function ShopSetup({ onSetupComplete }) {
  const [step, setStep] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  // Step 1 — shop details
  const [shopName, setShopName] = useState('')
  const [address, setAddress] = useState('')
  const [phoneSuffix, setPhoneSuffix] = useState('')
  const [email, setEmail] = useState('')

  // Step 2 — currency
  const [currency, setCurrency] = useState('USD')

  // Step 3 — owner PIN
  const [ownerName, setOwnerName] = useState('')
  const [pin, setPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')

  // Step 4 — first product (optional)
  const [productName, setProductName] = useState('')
  const [productPrice, setProductPrice] = useState('')
  const [productQty, setProductQty] = useState('')
  const [productSaving, setProductSaving] = useState(false)

  const TOTAL_STEPS = 4

  const go = (n) => {
    setError('')
    setStep(n)
  }

  // ── Step 1 validation ──
  const handleStep1 = () => {
    if (!shopName.trim()) { setError('Shop name is required.'); return }
    if (!address.trim()) { setError('Address is required — it appears on every receipt.'); return }
    if (email.trim()) {
      const v = validateEmail(email.trim())
      if (!v.valid) { setError(v.error); return }
    }
    go(2)
  }

  // ── Step 2 — just a select, always valid ──

  // ── Step 3 validation ──
  const handleStep3 = () => {
    if (!ownerName.trim()) { setError('Please enter your name.'); return }
    if (pin.length !== 4) { setError('PIN must be exactly 4 digits.'); return }
    if (confirmPin !== pin) { setError('PINs do not match. Please re-enter.'); return }
    go(4)
  }

  // ── Finish setup + optional first product ──
  const finishSetup = async (withProduct = false) => {
    setLoading(true)
    setError('')
    try {
      const phone = phoneSuffix.trim() ? `+263${phoneSuffix.trim()}` : ''
      await initializeShop({
        name: shopName.trim(),
        address: address.trim(),
        phone,
        email: email.trim(),
        currency,
        ownerName: ownerName.trim(),
        ownerPin: pin,
      })

      if (withProduct && productName.trim()) {
        await addProduct({
          name: productName.trim(),
          selling_price: parseFloat(productPrice) || 0,
          current_quantity: parseInt(productQty) || 0,
          category: '',
          unit: 'each',
          reorder_level: 5,
        })
      }

      // Auto-login as owner
      const user = await loginUser(ownerName.trim(), pin)
      if (user) {
        localStorage.setItem('stocka_user', JSON.stringify(user))
      }

      setDone(true)
      onSetupComplete()
      setTimeout(() => { window.location.hash = '#/dashboard' }, 800)
    } catch (err) {
      setError('Setup failed. Please try again.')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  // ── Success screen ──
  if (done) {
    return (
      <div className="shop-setup-page">
        <div className="setup-container" style={{ maxWidth: '440px', textAlign: 'center' }}>
          <img src={iconPng} alt="Stocka" style={{ width: '72px', height: '72px', borderRadius: '18px', display: 'block', margin: '0 auto 16px' }} />
          <h1 style={{ margin: '0 0 8px', fontSize: '26px', color: '#2e7d32' }}>You're all set!</h1>
          <p style={{ color: '#666', margin: '0 0 4px' }}>Welcome, {ownerName}.</p>
          <p style={{ color: '#999', fontSize: '13px', margin: 0 }}>Opening your dashboard...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="shop-setup-page">
      <div className="setup-container" style={{ maxWidth: step === 4 ? '520px' : '480px' }}>

        {/* Header */}
        <div className="setup-header" style={{ marginBottom: '8px' }}>
          <img src={fullLogo} alt="Stocka" style={{ height: '48px', objectFit: 'contain', display: 'block', margin: '0 auto 16px' }} />
          <h1 style={{ fontSize: '22px' }}>
            {step === 1 && 'Tell us about your shop'}
            {step === 2 && 'How does your shop handle money?'}
            {step === 3 && 'Set up your owner PIN'}
            {step === 4 && 'Add your first product'}
          </h1>
          <p style={{ fontSize: '13px', color: '#888', marginTop: '4px' }}>
            {step === 1 && 'This information will appear on every receipt your customers receive.'}
            {step === 2 && 'You can change this later in Settings.'}
            {step === 3 && 'This PIN unlocks Stocka every time you open it.'}
            {step === 4 && 'Optional — you can add products later from the Products page.'}
          </p>
        </div>

        <StepDots current={step} total={TOTAL_STEPS} />

        {/* ── Step 1: Shop Details ── */}
        {step === 1 && (
          <div className="setup-form">
            <div className="form-group">
              <label>Shop Name *</label>
              <input
                type="text"
                placeholder="e.g. Tatenda General Dealer"
                value={shopName}
                onChange={e => { setShopName(e.target.value); setError('') }}
                maxLength={100}
                autoFocus
              />
            </div>

            <div className="form-group">
              <label>Address *</label>
              <textarea
                placeholder="e.g. 42 Robert Mugabe Rd, Harare"
                value={address}
                onChange={e => { setAddress(e.target.value); setError('') }}
                maxLength={200}
                rows={2}
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  border: '1px solid #ddd',
                  borderRadius: '6px',
                  fontSize: '14px',
                  resize: 'vertical',
                  fontFamily: 'inherit',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            <div className="form-group">
              <label>Phone Number</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0' }}>
                <span style={{
                  padding: '10px 12px',
                  background: '#f5f5f5',
                  border: '1px solid #ddd',
                  borderRight: 'none',
                  borderRadius: '6px 0 0 6px',
                  fontSize: '14px',
                  color: '#555',
                  whiteSpace: 'nowrap',
                }}>
                  +263
                </span>
                <input
                  type="tel"
                  placeholder="77 123 4567"
                  value={phoneSuffix}
                  onChange={e => setPhoneSuffix(e.target.value.replace(/\D/g, ''))}
                  maxLength={12}
                  style={{
                    flex: 1,
                    padding: '10px 12px',
                    border: '1px solid #ddd',
                    borderRadius: '0 6px 6px 0',
                    fontSize: '14px',
                    outline: 'none',
                    boxSizing: 'border-box',
                  }}
                />
              </div>
            </div>

            <div className="form-group">
              <label>Email <span style={{ fontWeight: 400, color: '#aaa' }}>(Optional)</span></label>
              <input
                type="email"
                placeholder="shop@example.com"
                value={email}
                onChange={e => { setEmail(e.target.value); setError('') }}
              />
            </div>

            {error && <div className="error-msg">{error}</div>}

            <div className="setup-button-group">
              <button className="setup-submit-btn" onClick={handleStep1}>
                Next →
              </button>
            </div>
          </div>
        )}

        {/* ── Step 2: Currency ── */}
        {step === 2 && (
          <div className="setup-form">
            <div className="form-group">
              <label>Default Currency</label>
              <select
                value={currency}
                onChange={e => setCurrency(e.target.value)}
                style={{ fontSize: '15px', padding: '12px' }}
              >
                <option value="USD">USD — US Dollar ($)</option>
                <option value="ZWL">ZWL — Zimbabwe Gold (ZiG)</option>
                <option value="ZAR">ZAR — South African Rand (R)</option>
                <option value="GBP">GBP — British Pound (£)</option>
              </select>
            </div>

            {error && <div className="error-msg">{error}</div>}

            <div className="setup-button-group">
              <button className="setup-back-btn" onClick={() => go(1)}>← Back</button>
              <button className="setup-submit-btn" onClick={() => go(3)}>Continue →</button>
            </div>
          </div>
        )}

        {/* ── Step 3: Owner PIN ── */}
        {step === 3 && (
          <div className="setup-form">
            <div className="form-group">
              <label>Your Name</label>
              <input
                type="text"
                placeholder="e.g. Tatenda"
                value={ownerName}
                onChange={e => { setOwnerName(e.target.value); setError('') }}
                maxLength={50}
                autoFocus
              />
              <small className="form-hint">This name appears on reports and receipts.</small>
            </div>

            <div className="form-group" style={{ textAlign: 'center' }}>
              <label style={{ display: 'block', marginBottom: '14px' }}>Create your PIN</label>
              <PinBoxes value={pin} onChange={(v) => { setPin(v); setError('') }} id="pin" />
            </div>

            <div className="form-group" style={{ textAlign: 'center' }}>
              <label style={{ display: 'block', marginBottom: '14px' }}>Confirm PIN</label>
              <PinBoxes value={confirmPin} onChange={(v) => { setConfirmPin(v); setError('') }} id="confirm" />
            </div>

            {/* Info box */}
            <div style={{
              display: 'flex',
              gap: '10px',
              background: '#e8f5e9',
              border: '1px solid #a5d6a7',
              borderRadius: '8px',
              padding: '14px 16px',
              marginBottom: '16px',
            }}>
              <FiInfo size={18} color="#2e7d32" style={{ flexShrink: 0, marginTop: '1px' }} />
              <p style={{ margin: 0, fontSize: '13px', color: '#1b5e20', lineHeight: 1.5 }}>
                <strong>Important:</strong> If you forget this PIN, you'll need your Stocka activation key to reset it.
                Write your activation key down somewhere safe — not on this computer.
              </p>
            </div>

            {error && <div className="error-msg">{error}</div>}

            <div className="setup-button-group">
              <button className="setup-back-btn" onClick={() => go(2)}>← Back</button>
              <button className="setup-submit-btn" onClick={handleStep3}>Continue →</button>
            </div>
          </div>
        )}

        {/* ── Step 4: First Product (skippable) ── */}
        {step === 4 && (
          <div className="setup-form">
            <div className="form-group">
              <label>Product Name</label>
              <input
                type="text"
                placeholder="e.g. Mazoe Orange 2L"
                value={productName}
                onChange={e => setProductName(e.target.value)}
                maxLength={100}
                autoFocus
              />
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>Selling Price ({currency})</label>
                <input
                  type="number"
                  placeholder="0.00"
                  value={productPrice}
                  onChange={e => setProductPrice(e.target.value)}
                  min="0"
                  step="0.01"
                />
              </div>
              <div className="form-group">
                <label>Opening Stock (units)</label>
                <input
                  type="number"
                  placeholder="0"
                  value={productQty}
                  onChange={e => setProductQty(e.target.value)}
                  min="0"
                  step="1"
                />
              </div>
            </div>

            {error && <div className="error-msg">{error}</div>}

            <div className="setup-button-group" style={{ flexDirection: 'column', gap: '10px' }}>
              <button
                className="setup-submit-btn"
                disabled={loading || !productName.trim()}
                onClick={() => finishSetup(true)}
                style={{ opacity: !productName.trim() ? 0.5 : 1 }}
              >
                {loading ? 'Saving…' : 'Add Product & Open Stocka'}
              </button>
              <button
                onClick={() => finishSetup(false)}
                disabled={loading}
                style={{
                  padding: '11px',
                  background: 'none',
                  border: '1px solid #ddd',
                  borderRadius: '6px',
                  fontSize: '14px',
                  color: '#888',
                  cursor: loading ? 'not-allowed' : 'pointer',
                }}
              >
                Skip for now — I'll add products later
              </button>
            </div>

            <p className="setup-note" style={{ marginTop: '16px' }}>← <button
              onClick={() => go(3)}
              style={{ background: 'none', border: 'none', color: '#2e7d32', cursor: 'pointer', fontSize: '13px' }}
            >Back to PIN setup</button></p>
          </div>
        )}

        {step < 4 && (
          <p className="setup-note">You can change any of these details later in Settings.</p>
        )}
      </div>
    </div>
  )
}

export default ShopSetup
