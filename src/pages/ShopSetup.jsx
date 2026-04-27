import { useState, useEffect } from 'react'
import { getShop, initializeShop, loginUser } from '../database/db'
import { validateRequired, validateEmail, validatePhone, validateUsername, validatePassword } from '../utils/validation'
import './ShopSetup.css'

function ShopSetup({ onSetupComplete }) {
  const [shop, setShop] = useState(null)
  const [loading, setLoading] = useState(true)
  const [setupComplete, setSetupCompleted] = useState(false)
  const [formData, setFormData] = useState({
    name: '',
    address: '',
    phone: '',
    email: '',
    currency: 'USD',
    adminUsername: '',
    adminPassword: '',
    confirmPassword: ''
  })
  const [error, setError] = useState('')
  const [setupStep, setSetupStep] = useState(1) // Step 1: Shop Details, Step 2: Admin Account, Step 3: Complete

  useEffect(() => {
    const checkSetup = async () => {
      const existingShop = await getShop()
      setShop(existingShop)
      setLoading(false)
    }
    checkSetup()
  }, [])

  const handleChange = (e) => {
    const { name, value } = e.target
    setFormData(prev => ({
      ...prev,
      [name]: value
    }))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')

    if (setupStep === 1) {
      // Validate shop details
      const nameValidation = validateRequired(formData.name, 'Shop name')
      if (!nameValidation.valid) {
        setError(nameValidation.error)
        return
      }
      
      // Validate email if provided
      if (formData.email) {
        const emailValidation = validateEmail(formData.email)
        if (!emailValidation.valid) {
          setError(emailValidation.error)
          return
        }
      }
      
      // Validate phone if provided
      if (formData.phone) {
        const phoneValidation = validatePhone(formData.phone)
        if (!phoneValidation.valid) {
          setError(phoneValidation.error)
          return
        }
      }
      
      // Move to admin account setup
      setSetupStep(2)
      return
    }

    if (setupStep === 2) {
      // Validate admin account
      const usernameValidation = validateUsername(formData.adminUsername)
      if (!usernameValidation.valid) {
        setError(usernameValidation.error)
        return
      }
      
      const passwordValidation = validatePassword(formData.adminPassword)
      if (!passwordValidation.valid) {
        setError(passwordValidation.error)
        return
      }
      
      if (formData.adminPassword !== formData.confirmPassword) {
        setError('Passwords do not match')
        return
      }

      try {
        setLoading(true)
        await initializeShop(formData)
        setSetupCompleted(true)
        setSetupStep(3)
        setLoading(false)
        
        // Auto-login after 2 seconds
        setTimeout(async () => {
          try {
            const user = await loginUser(formData.adminUsername, formData.adminPassword)
            if (user) {
              localStorage.setItem('stocka_user', JSON.stringify(user))
              onSetupComplete()
              window.location.hash = '#/dashboard'
            }
          } catch (err) {
            console.error('Auto-login failed:', err)
            setError('Setup complete, but auto-login failed. Please sign in manually.')
          }
        }, 2000)
      } catch (err) {
        setError('Failed to complete setup. Please try again.')
        console.error(err)
        setLoading(false)
      }
    }
  }

  const handleBackStep = () => {
    setSetupStep(1)
    setError('')
  }

  if (loading && setupStep !== 3) {
    return <div className="setup-loading">Loading...</div>
  }

  if (shop?.setup_complete && setupStep !== 3) {
    onSetupComplete()
    return null
  }

  // Step 3: Setup Complete
  if (setupStep === 3 && setupComplete) {
    return (
      <div className="shop-setup-page">
        <div className="setup-container" style={{ maxWidth: '500px' }}>
          <div className="setup-header" style={{ textAlign: 'center' }}>
            <div style={{
              width: '80px',
              height: '80px',
              background: 'linear-gradient(135deg, #2e7d32 0%, #1a5c2a 100%)',
              color: 'white',
              fontSize: '40px',
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 20px'
            }}>
              ✓
            </div>
            <h1 style={{ margin: '0 0 12px 0', fontSize: '28px', color: '#2e7d32' }}>
              Stocka is Ready! 🎉
            </h1>
            <p style={{ margin: '0 0 30px 0', color: '#666', fontSize: '16px' }}>
              Your shop has been successfully set up.
            </p>
          </div>

          <div style={{
            background: '#f5f5f5',
            padding: '20px',
            borderRadius: '8px',
            marginBottom: '30px'
          }}>
            <p style={{ margin: '0 0 15px 0', color: '#333', fontWeight: '600' }}>
              Shop Details:
            </p>
            <div style={{ fontSize: '14px', color: '#666', lineHeight: '1.8' }}>
              <div><strong>Shop Name:</strong> {formData.name}</div>
              <div><strong>Admin Username:</strong> {formData.adminUsername}</div>
              <div><strong>Currency:</strong> {formData.currency}</div>
            </div>
          </div>

          <div style={{
            background: '#e8f5e9',
            padding: '16px',
            borderRadius: '8px',
            borderLeft: '4px solid #2e7d32',
            marginBottom: '30px'
          }}>
            <p style={{ margin: '0', color: '#1b5e20', fontSize: '14px' }}>
              ✓ Admin account created<br/>
              ✓ Database initialized<br/>
              ✓ Redirecting to dashboard...
            </p>
          </div>

          <p style={{ textAlign: 'center', color: '#999', fontSize: '13px' }}>
            You are being logged in as Admin. Redirecting in a moment...
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="shop-setup-page">
      <div className="setup-container">
        <div className="setup-header">
          <div className="setup-logo">S</div>
          <h1>Welcome to Stocka</h1>
          <p>Let's set up your retail shop</p>
        </div>

        <form onSubmit={handleSubmit} className="setup-form">
          {setupStep === 1 ? (
            <>
              <h2 className="step-title">Step 1: Shop Details</h2>
              <div className="form-group">
                <label>Shop Name *</label>
                <input
                  type="text"
                  name="name"
                  placeholder="Enter your shop name"
                  value={formData.name}
                  onChange={handleChange}
                  maxLength={100}
                />
              </div>

              <div className="form-group">
                <label>Address</label>
                <input
                  type="text"
                  name="address"
                  placeholder="Enter shop address"
                  value={formData.address}
                  onChange={handleChange}
                  maxLength={200}
                />
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Phone Number</label>
                  <input
                    type="tel"
                    name="phone"
                    placeholder="Enter phone number"
                    value={formData.phone}
                    onChange={handleChange}
                    maxLength={20}
                  />
                </div>

                <div className="form-group">
                  <label>Email</label>
                  <input
                    type="email"
                    name="email"
                    placeholder="Enter email"
                    value={formData.email}
                    onChange={handleChange}
                  />
                </div>
              </div>

              <div className="form-group">
                <label>Currency</label>
                <select name="currency" value={formData.currency} onChange={handleChange}>
                  <option value="USD">USD ($)</option>
                  <option value="ZWL">ZWL (ZWL)</option>
                  <option value="EUR">EUR (€)</option>
                  <option value="GBP">GBP (£)</option>
                </select>
              </div>
            </>
          ) : (
            <>
              <h2 className="step-title">Step 2: Create Admin Account</h2>
              <div className="form-group">
                <label>Admin Username *</label>
                <input
                  type="text"
                  name="adminUsername"
                  placeholder="Enter admin username"
                  value={formData.adminUsername}
                  onChange={handleChange}
                  minLength={3}
                />
                <small className="form-hint">Minimum 3 characters</small>
              </div>

              <div className="form-group">
                <label>Admin Password *</label>
                <input
                  type="password"
                  name="adminPassword"
                  placeholder="Enter admin password"
                  value={formData.adminPassword}
                  onChange={handleChange}
                  minLength={6}
                />
                <small className="form-hint">Minimum 6 characters. Keep this safe!</small>
              </div>

              <div className="form-group">
                <label>Confirm Password *</label>
                <input
                  type="password"
                  name="confirmPassword"
                  placeholder="Confirm admin password"
                  value={formData.confirmPassword}
                  onChange={handleChange}
                  minLength={6}
                />
              </div>
            </>
          )}

          {error && <div className="error-msg">{error}</div>}

          <div className="setup-button-group">
            {setupStep === 2 && (
              <button type="button" className="setup-back-btn" onClick={handleBackStep}>
                Back
              </button>
            )}
            <button type="submit" className="setup-submit-btn">
              {setupStep === 1 ? 'Next' : 'Complete Setup'}
            </button>
          </div>
        </form>

        <p className="setup-note">You can change these details later in Settings</p>
      </div>
    </div>
  )
}

export default ShopSetup
