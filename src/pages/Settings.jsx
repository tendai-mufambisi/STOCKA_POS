import { useState, useEffect } from 'react'
import { getShop, updateShop, getUsers, addUser, updateUser, deactivateUser } from '../database/db'
import { validatePasswordStrength } from '../utils/authUtils'
import './Settings.css'

function Settings({ user }) {
  const isCashier = user?.role === 'Cashier'
  const [activeTab, setActiveTab] = useState(isCashier ? 'password' : 'shop')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [users, setUsers] = useState([])
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  })
  const [formData, setFormData] = useState({
    name: '',
    address: '',
    phone: '',
    email: '',
    currency: 'USD',
    printer_name: '',
    printer_port: '',
    auto_print: 1,
    print_duplicate: 0
  })
  const [showNewUserForm, setShowNewUserForm] = useState(false)
  const [newUserForm, setNewUserForm] = useState({
    username: '',
    password: '',
    confirmPassword: '',
    role: 'Cashier'
  })
  const [resetPasswordUserId, setResetPasswordUserId] = useState(null)
  const [resetPasswordForm, setResetPasswordForm] = useState({
    newPassword: '',
    confirmPassword: ''
  })

  // Printer states
  const [availablePrinters, setAvailablePrinters] = useState([])
  const [scanningPrinters, setScanningPrinters] = useState(false)
  const [testingPrinter, setTestingPrinter] = useState(false)
  const [printStatus, setPrintStatus] = useState('')

  const isAdmin = user?.role === 'Admin'

  useEffect(() => {
    loadSettings()
    if (isAdmin) loadUsers()
  }, [isAdmin])

  const handleChangePassword = async (e) => {
    e.preventDefault()
    setError('')
    setSuccess('')

    if (!passwordForm.currentPassword) {
      setError('Current password is required')
      return
    }

    if (!passwordForm.newPassword) {
      setError('New password is required')
      return
    }

    if (passwordForm.newPassword.length < 6) {
      setError('New password must be at least 6 characters')
      return
    }

    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setError('New passwords do not match')
      return
    }

    try {
      await updateUser(user.id, {
        password: passwordForm.newPassword,
        currentPassword: passwordForm.currentPassword
      })
      setSuccess('Password changed successfully')
      setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' })
      setTimeout(() => setSuccess(''), 3000)
    } catch (err) {
      console.error('Failed to change password:', err)
      setError('Failed to change password. Please verify your current password.')
    }
  }

  const loadSettings = async () => {
    try {
      const shop = await getShop()
      if (shop) {
        setFormData(shop)
      }
      setLoading(false)
    } catch (err) {
      console.error('Failed to load settings:', err)
      setError('Failed to load settings')
      setLoading(false)
    }
  }

  const loadUsers = async () => {
    try {
      const allUsers = await getUsers()
      setUsers(allUsers)
    } catch (err) {
      console.error('Failed to load users:', err)
    }
  }

  const handleScanPrinters = async () => {
    setScanningPrinters(true)
    setError('')
    setPrintStatus('')
    try {
      const result = await window.stocka.printer.scan()
      if (result.success) {
        setAvailablePrinters(result.printers)
        if (result.printers.length === 0) {
          let errorMsg = 'No printers detected on this computer.'
          if (result.diagnosticMessage) {
            errorMsg += '\n\n' + result.diagnosticMessage
          }
          errorMsg += '\n\nTroubleshooting steps:\n1. Check if printer is connected via USB or Bluetooth\n2. Power on the printer\n3. Go to Windows Settings → Printers & scanners\n4. Install printer drivers if needed'
          setError(errorMsg)
        } else {
          setPrintStatus(`Found ${result.printers.length} printer(s)`)
          setTimeout(() => setPrintStatus(''), 3000)
        }
      } else {
        setError(result.error || 'Failed to scan for printers')
      }
    } catch (err) {
      console.error('Printer scan error:', err)
      setError('Failed to scan for printers: ' + err.message)
    } finally {
      setScanningPrinters(false)
    }
  }

  const handleTestPrint = async () => {
    setError('')
    setPrintStatus('')
    if (!formData.printer_port) {
      setError('Please select a printer first')
      return
    }

    setTestingPrinter(true)
    try {
      const result = await window.stocka.printer.test(formData.printer_port)
      if (result.success) {
        setPrintStatus('Test print sent successfully! Check your printer.')
        setTimeout(() => setPrintStatus(''), 5000)
      } else {
        setError(result.error || 'Test print failed')
      }
    } catch (err) {
      console.error('Test print error:', err)
      setError('Failed to send test print. Printer may be disconnected.')
    } finally {
      setTestingPrinter(false)
    }
  }

  const handleSaveShop = async (e) => {
    e.preventDefault()
    setError('')
    setSuccess('')

    if (!formData.name.trim()) {
      setError('Shop name is required')
      return
    }

    try {
      await updateShop(formData.id, formData)
      setSuccess('Settings saved successfully')
      setTimeout(() => setSuccess(''), 3000)
    } catch (err) {
      console.error('Failed to save settings:', err)
      setError('Failed to save settings')
    }
  }

  const handleAddUser = async (e) => {
    e.preventDefault()
    setError('')
    setSuccess('')

    if (!newUserForm.username.trim()) {
      setError('Username is required')
      return
    }

    if (!newUserForm.password) {
      setError('Password is required')
      return
    }

    if (newUserForm.password !== newUserForm.confirmPassword) {
      setError('Passwords do not match')
      return
    }

    // Validate password strength
    const passwordValidation = validatePasswordStrength(newUserForm.password)
    if (!passwordValidation.isValid) {
      setError(`Password is too weak: ${passwordValidation.message}`)
      return
    }

    try {
      await addUser({
        username: newUserForm.username,
        password: newUserForm.password,
        role: newUserForm.role,
        created_by: user.username
      })

      setSuccess('User added successfully')
      setNewUserForm({ username: '', password: '', confirmPassword: '', role: 'Cashier' })
      setShowNewUserForm(false)
      loadUsers()
      setTimeout(() => setSuccess(''), 3000)
    } catch (err) {
      console.error('Failed to add user:', err)
      setError('Failed to add user. Username may already exist.')
    }
  }

  const handleResetPassword = async (e) => {
    e.preventDefault()
    setError('')
    setSuccess('')

    if (!resetPasswordForm.newPassword) {
      setError('New password is required')
      return
    }

    if (resetPasswordForm.newPassword !== resetPasswordForm.confirmPassword) {
      setError('Passwords do not match')
      return
    }

    // Validate password strength
    const passwordValidation = validatePasswordStrength(resetPasswordForm.newPassword)
    if (!passwordValidation.isValid) {
      setError(`Password is too weak: ${passwordValidation.message}`)
      return
    }

    try {
      await updateUser(resetPasswordUserId, {
        password: resetPasswordForm.newPassword
      })

      setSuccess('Password reset successfully')
      setResetPasswordUserId(null)
      setResetPasswordForm({ newPassword: '', confirmPassword: '' })
      loadUsers()
      setTimeout(() => setSuccess(''), 3000)
    } catch (err) {
      console.error('Failed to reset password:', err)
      setError('Failed to reset password')
    }
  }

  const handleDeactivateUser = async (userId) => {
    if (!confirm('Are you sure you want to deactivate this user? They will not be able to log in.')) {
      return
    }

    const activeAdmins = users.filter(u => u.role === 'Admin' && u.is_active === 1)
    if (activeAdmins.length === 1 && activeAdmins[0].id === userId) {
      setError('Cannot deactivate the last active admin user')
      return
    }

    try {
      await deactivateUser(userId)
      setSuccess('User deactivated successfully')
      loadUsers()
      setTimeout(() => setSuccess(''), 3000)
    } catch (err) {
      console.error('Failed to deactivate user:', err)
      setError('Failed to deactivate user')
    }
  }

  if (loading) return <div className="settings-page"><div className="loading">Loading...</div></div>

  return (
    <div className="settings-page">
      <div className="page-header">
        <h1>Settings</h1>
        <p>Configure your shop and system preferences</p>
      </div>

      {error && <div className="error-banner">{error}</div>}
      {success && <div className="success-banner">{success}</div>}

      <div className="settings-tabs">
        {!isCashier && (
          <button
            className={`tab-btn ${activeTab === 'shop' ? 'active' : ''}`}
            onClick={() => setActiveTab('shop')}
          >
            🏪 Shop Details
          </button>
        )}
        {isAdmin && (
          <button
            className={`tab-btn ${activeTab === 'users' ? 'active' : ''}`}
            onClick={() => setActiveTab('users')}
          >
            👥 User Management
          </button>
        )}
        {isAdmin && (
          <button
            className={`tab-btn ${activeTab === 'printer' ? 'active' : ''}`}
            onClick={() => setActiveTab('printer')}
          >
            🖨️ Printer Settings
          </button>
        )}
        <button
          className={`tab-btn ${activeTab === 'password' ? 'active' : ''}`}
          onClick={() => setActiveTab('password')}
        >
          🔐 Change Password
        </button>
        {!isCashier && (
          <button
            className={`tab-btn ${activeTab === 'system' ? 'active' : ''}`}
            onClick={() => setActiveTab('system')}
          >
            ⚙️ System
          </button>
        )}
      </div>

      <div className="settings-container">
        {activeTab === 'shop' && (
          <div className="settings-section">
            <h3>🏪 Shop Details</h3>
            <form onSubmit={handleSaveShop}>
              <div className="form-row">
                <div className="form-group">
                  <label>Shop Name *</label>
                  <input
                    type="text"
                    name="name"
                    value={formData.name}
                    onChange={(e) => setFormData({...formData, name: e.target.value})}
                    required
                  />
                </div>
                <div className="form-group">
                  <label>Currency</label>
                  <select
                    name="currency"
                    value={formData.currency}
                    onChange={(e) => setFormData({...formData, currency: e.target.value})}
                  >
                    <option>USD</option>
                    <option>ZWL</option>
                    <option>EUR</option>
                    <option>GBP</option>
                  </select>
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Email</label>
                  <input
                    type="email"
                    name="email"
                    value={formData.email}
                    onChange={(e) => setFormData({...formData, email: e.target.value})}
                  />
                </div>
                <div className="form-group">
                  <label>Phone</label>
                  <input
                    type="tel"
                    name="phone"
                    value={formData.phone}
                    onChange={(e) => setFormData({...formData, phone: e.target.value})}
                  />
                </div>
              </div>
              <div className="form-group">
                <label>Address</label>
                <textarea
                  name="address"
                  value={formData.address}
                  onChange={(e) => setFormData({...formData, address: e.target.value})}
                  rows="3"
                />
              </div>
              <button type="submit" className="btn btn-primary">💾 Save Changes</button>
            </form>
          </div>
        )}

        {activeTab === 'users' && isAdmin && (
          <div className="settings-section">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h3>👥 User Management</h3>
              <button
                className="btn btn-primary"
                onClick={() => setShowNewUserForm(!showNewUserForm)}
              >
                {showNewUserForm ? '✕ Cancel' : '➕ Add New User'}
              </button>
            </div>

            {showNewUserForm && (
              <div style={{ marginBottom: '30px', padding: '20px', border: '1px solid #ddd', borderRadius: '8px' }}>
                <h4>Add New User</h4>
                <form onSubmit={handleAddUser}>
                  <div className="form-row">
                    <div className="form-group">
                      <label>Username *</label>
                      <input
                        type="text"
                        value={newUserForm.username}
                        onChange={(e) => setNewUserForm({...newUserForm, username: e.target.value})}
                        required
                      />
                    </div>
                    <div className="form-group">
                      <label>Role *</label>
                      <select
                        value={newUserForm.role}
                        onChange={(e) => setNewUserForm({...newUserForm, role: e.target.value})}
                      >
                        <option value="Admin">Admin</option>
                        <option value="Manager">Manager</option>
                        <option value="Cashier">Cashier</option>
                      </select>
                    </div>
                  </div>
                  <div className="form-row">
                    <div className="form-group">
                      <label>Password *</label>
                      <input
                        type="password"
                        value={newUserForm.password}
                        onChange={(e) => setNewUserForm({...newUserForm, password: e.target.value})}
                        required
                      />
                    </div>
                    <div className="form-group">
                      <label>Confirm Password *</label>
                      <input
                        type="password"
                        value={newUserForm.confirmPassword}
                        onChange={(e) => setNewUserForm({...newUserForm, confirmPassword: e.target.value})}
                        required
                      />
                    </div>
                  </div>
                  <button type="submit" className="btn btn-primary">Add User</button>
                </form>
              </div>
            )}

            <div className="users-table">
              <table>
                <thead>
                  <tr>
                    <th>Username</th>
                    <th>Role</th>
                    <th>Status</th>
                    <th>Created</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map(u => (
                    <tr key={u.id}>
                      <td>{u.username}</td>
                      <td>{u.role}</td>
                      <td>
                        <span className={`badge ${u.is_active ? 'active' : 'inactive'}`}>
                          {u.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td>{u.created_at ? new Date(u.created_at).toLocaleDateString('en-ZW') : '-'}</td>
                      <td>
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <button
                            className="btn btn-small btn-secondary"
                            onClick={() => {
                              setResetPasswordUserId(u.id)
                              setResetPasswordForm({ newPassword: '', confirmPassword: '' })
                            }}
                          >
                            🔑 Reset
                          </button>
                          {u.is_active && (
                            <button
                              className="btn btn-small btn-danger"
                              onClick={() => handleDeactivateUser(u.id)}
                              disabled={u.role === 'Admin' && users.filter(x => x.role === 'Admin' && x.is_active === 1).length === 1}
                            >
                              🔒 Deactivate
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {resetPasswordUserId && (
              <div style={{ marginTop: '30px', padding: '20px', border: '1px solid #ddd', borderRadius: '8px' }}>
                <h4>Reset Password for {users.find(u => u.id === resetPasswordUserId)?.username}</h4>
                <form onSubmit={handleResetPassword}>
                  <div className="form-row">
                    <div className="form-group">
                      <label>New Password *</label>
                      <input
                        type="password"
                        value={resetPasswordForm.newPassword}
                        onChange={(e) => setResetPasswordForm({...resetPasswordForm, newPassword: e.target.value})}
                        required
                      />
                    </div>
                    <div className="form-group">
                      <label>Confirm Password *</label>
                      <input
                        type="password"
                        value={resetPasswordForm.confirmPassword}
                        onChange={(e) => setResetPasswordForm({...resetPasswordForm, confirmPassword: e.target.value})}
                        required
                      />
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '10px' }}>
                    <button type="submit" className="btn btn-primary">Reset Password</button>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => setResetPasswordUserId(null)}
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              </div>
            )}
          </div>
        )}

        {activeTab === 'printer' && isAdmin && (
          <div className="settings-section">
            <h3>🖨️ Printer Settings</h3>
            
            <div style={{ marginBottom: '30px', padding: '20px', backgroundColor: '#f9f9f9', borderRadius: '8px' }}>
              <h4 style={{ marginTop: 0 }}>Detect Printer</h4>
              <p style={{ marginBottom: '15px', color: '#666', fontSize: '14px' }}>
                Click the button below to scan for available USB/Bluetooth thermal printers connected to your computer.
              </p>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleScanPrinters}
                disabled={scanningPrinters}
                style={{ marginRight: '10px' }}
              >
                {scanningPrinters ? '🔍 Scanning...' : '🔍 Scan for Printers'}
              </button>
              
              {availablePrinters.length > 0 && (
                <div style={{ marginTop: '15px' }}>
                  <label htmlFor="printer_select" style={{ display: 'block', marginBottom: '8px', fontWeight: '600' }}>
                    Available Printers:
                  </label>
                  <select
                    id="printer_select"
                    value={formData.printer_port || ''}
                    onChange={(e) => {
                      const port = e.target.value
                      const printer = availablePrinters.find(p => p.port === port)
                      setFormData({
                        ...formData,
                        printer_port: port,
                        printer_name: printer?.name || ''
                      })
                    }}
                    style={{ padding: '8px', borderRadius: '4px', border: '1px solid #ddd', width: '100%', maxWidth: '400px' }}
                  >
                    <option value="">-- Select a printer --</option>
                    {availablePrinters.map(printer => (
                      <option key={printer.port} value={printer.port}>
                        {printer.name} ({printer.port})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {formData.printer_port && (
                <div style={{ marginTop: '15px' }}>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={handleTestPrint}
                    disabled={testingPrinter}
                  >
                    {testingPrinter ? '🖨️ Printing...' : '🖨️ Test Print'}
                  </button>
                  <p style={{ marginTop: '8px', fontSize: '13px', color: '#666' }}>
                    Click to send a test receipt to your printer
                  </p>
                </div>
              )}
            </div>

            <form onSubmit={handleSaveShop} style={{ marginTop: '30px' }}>
              <div style={{ padding: '20px', backgroundColor: '#fff9f0', borderRadius: '8px', marginBottom: '20px' }}>
                <h4 style={{ marginTop: 0 }}>Auto-Print Settings</h4>
                
                <div className="form-group" style={{ marginBottom: '20px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', fontWeight: 'normal' }}>
                    <input
                      type="checkbox"
                      checked={formData.auto_print === 1}
                      onChange={(e) => setFormData({...formData, auto_print: e.target.checked ? 1 : 0})}
                      style={{ width: '20px', height: '20px', cursor: 'pointer' }}
                    />
                    <span>Auto-print receipts after every sale</span>
                  </label>
                  <p style={{ marginTop: '8px', fontSize: '13px', color: '#666', marginLeft: '30px' }}>
                    If enabled, receipts will automatically print when a sale is completed
                  </p>
                </div>

                <div className="form-group">
                  <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', fontWeight: 'normal' }}>
                    <input
                      type="checkbox"
                      checked={formData.print_duplicate === 1}
                      onChange={(e) => setFormData({...formData, print_duplicate: e.target.checked ? 1 : 0})}
                      style={{ width: '20px', height: '20px', cursor: 'pointer' }}
                    />
                    <span>Print duplicate receipts (2 copies)</span>
                  </label>
                  <p style={{ marginTop: '8px', fontSize: '13px', color: '#666', marginLeft: '30px' }}>
                    If enabled, each receipt will print twice
                  </p>
                </div>
              </div>

              <button type="submit" className="btn btn-primary">💾 Save Printer Settings</button>
            </form>
          </div>
        )}

        {activeTab === 'password' && (
          <div className="settings-section">
            <h3>🔐 Change Password</h3>
            <form onSubmit={handleChangePassword} style={{ maxWidth: '400px' }}>
              <div className="form-group">
                <label>Current Password *</label>
                <input
                  type="password"
                  name="currentPassword"
                  value={passwordForm.currentPassword}
                  onChange={(e) => setPasswordForm({...passwordForm, currentPassword: e.target.value})}
                  required
                  placeholder="Enter your current password"
                />
              </div>
              <div className="form-group">
                <label>New Password *</label>
                <input
                  type="password"
                  name="newPassword"
                  value={passwordForm.newPassword}
                  onChange={(e) => setPasswordForm({...passwordForm, newPassword: e.target.value})}
                  required
                  placeholder="Enter new password (minimum 6 characters)"
                />
              </div>
              <div className="form-group">
                <label>Confirm New Password *</label>
                <input
                  type="password"
                  name="confirmPassword"
                  value={passwordForm.confirmPassword}
                  onChange={(e) => setPasswordForm({...passwordForm, confirmPassword: e.target.value})}
                  required
                  placeholder="Confirm new password"
                />
              </div>
              <button type="submit" className="btn btn-primary">Update Password</button>
            </form>
          </div>
        )}

        {activeTab === 'system' && !isCashier && (
          <div className="settings-section">
            <h3>⚙️ System Information</h3>
            <div className="info-box">
              <div className="info-row">
                <span className="label">App Version:</span>
                <span className="value">1.0.0</span>
              </div>
              <div className="info-row">
                <span className="label">Database:</span>
                <span className="value">SQL.js (Local)</span>
              </div>
              <div className="info-row">
                <span className="label">Mode:</span>
                <span className="value">Offline</span>
              </div>
              <div className="info-row">
                <span className="label">Status:</span>
                <span className="value online">🟢 Online</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default Settings
