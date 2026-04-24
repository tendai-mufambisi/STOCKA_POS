import { useState, useEffect } from 'react'
import { getShop, initializeShop, getDb } from '../database/db'
import './ShopSetup.css'

function ShopSetup({ onSetupComplete }) {
  const [shop, setShop] = useState(null)
  const [loading, setLoading] = useState(true)
  const [formData, setFormData] = useState({
    name: '',
    address: '',
    phone: '',
    email: '',
    currency: 'USD',
    adminPassword: '',
    confirmPassword: ''
  })
  const [error, setError] = useState('')
  const [setupStep, setSetupStep] = useState(1) // Step 1: Shop Details, Step 2: Admin Account

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
      if (!formData.name.trim()) {
        setError('Shop name is required')
        return
      }
      // Move to admin account setup
      setSetupStep(2)
      return
    }

    if (setupStep === 2) {
      // Validate admin account
      if (!formData.adminPassword) {
        setError('Admin password is required')
        return
      }
      if (formData.adminPassword.length < 6) {
        setError('Password must be at least 6 characters')
        return
      }
      if (formData.adminPassword !== formData.confirmPassword) {
        setError('Passwords do not match')
        return
      }

      try {
        await initializeShop(formData)
        onSetupComplete()
      } catch (err) {
        setError('Failed to complete setup. Please try again.')
        console.error(err)
      }
    }
  }

  const handleBackStep = () => {
    setSetupStep(1)
    setError('')
  }

  if (loading) {
    return <div className="setup-loading">Loading...</div>
  }

  if (shop?.setup_complete) {
    onSetupComplete()
    return null
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
                <label>Admin Username</label>
                <input
                  type="text"
                  disabled
                  value={formData.name}
                  placeholder="Auto-populated from shop name"
                  className="disabled-input"
                />
                <small className="form-hint">Username is automatically set to your shop name</small>
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
                <small className="form-hint">Minimum 6 characters</small>
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
