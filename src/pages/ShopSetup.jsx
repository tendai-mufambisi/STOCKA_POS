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
    currency: 'USD'
  })
  const [error, setError] = useState('')

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

    if (!formData.name.trim()) {
      setError('Shop name is required')
      return
    }

    try {
      await initializeShop(formData)
      onSetupComplete()
    } catch (err) {
      setError('Failed to save shop details. Please try again.')
      console.error(err)
    }
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

          {error && <div className="error-msg">{error}</div>}

          <button type="submit" className="setup-submit-btn">
            Complete Setup
          </button>
        </form>

        <p className="setup-note">You can change these details later in Settings</p>
      </div>
    </div>
  )
}

export default ShopSetup
