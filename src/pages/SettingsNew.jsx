import { useState, useEffect } from 'react'
import { getShop, updateShop, getUsers, addUser, updateUser, deactivateUser } from '../database/db'
import './Settings.css'

function Settings({ user }) {
  const [activeTab, setActiveTab] = useState('shop')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [users, setUsers] = useState([])
  const [formData, setFormData] = useState({
    name: '',
    address: '',
    phone: '',
    email: '',
    currency: 'USD'
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

  const isAdmin = user?.role === 'Admin'

  useEffect(() => {
    loadSettings()
    if (isAdmin) loadUsers()
  }, [isAdmin])

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
        <button
          className={`tab-btn ${activeTab === 'shop' ? 'active' : ''}`}
          onClick={() => setActiveTab('shop')}
        >
          🏪 Shop Details
        </button>
        {isAdmin && (
          <button
            className={`tab-btn ${activeTab === 'users' ? 'active' : ''}`}
            onClick={() => setActiveTab('users')}
          >
            👥 User Management
          </button>
        )}
        <button
          className={`tab-btn ${activeTab === 'system' ? 'active' : ''}`}
          onClick={() => setActiveTab('system')}
        >
          ⚙️ System
        </button>
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

        {activeTab === 'system' && (
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
