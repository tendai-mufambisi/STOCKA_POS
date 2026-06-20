import { useState, useEffect } from 'react'
import {
  getShop, updateShop, getUsers, addUser, updateUser, deactivateUser,
  getBackupHistory, createDatabaseBackup, restoreFromBackup, exportBackupAsFile
} from '../database/db'
import { validatePin } from '../utils/authUtils'
import { canUseNativePrinter } from '../services/runtime'
import { useAuthStore } from '../store/useAuthStore'
import { useLanSync } from '../hooks/useLanSync'
import LanSettings from './LanSettings'
import './Settings.css'
import {
  FiShoppingBag, FiUsers, FiPrinter, FiShield, FiFileText,
  FiSliders, FiMonitor, FiHardDrive, FiWifi, FiSave, FiRefreshCw,
  FiZap, FiUserPlus, FiKey, FiUserX, FiDownload, FiUpload,
  FiAlertCircle, FiCheckCircle, FiX, FiCheck, FiLock
} from 'react-icons/fi'

function Settings() {
  const { user } = useAuthStore()
  const isCashier = user?.role === 'Cashier'
  const isAdmin   = user?.role === 'Admin'

  const [activeTab, setActiveTab] = useState(isCashier ? 'password' : 'shop')
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState('')
  const [success, setSuccess]   = useState('')

  const [formData, setFormData] = useState({
    name: '', address: '', phone: '', email: '', currency: 'USD',
    printer_name: '', printer_port: 'COM3', auto_print: 1, print_duplicate: 0,
    receipt_width_mm: 58, receipt_footer: 'Thank you for your business!', receipt_name_size: 'large',
    vat_rate: 0, default_reorder_level: 5, variance_tolerance: 0.01
  })

  const [users, setUsers]               = useState([])
  const [showNewUserForm, setShowNewUserForm] = useState(false)
  const [newUserForm, setNewUserForm]   = useState({ username: '', password: '', confirmPassword: '', role: 'Cashier' })
  const [resetPasswordUserId, setResetPasswordUserId] = useState(null)
  const [resetPasswordForm, setResetPasswordForm]     = useState({ newPassword: '', confirmPassword: '' })
  const [passwordForm, setPasswordForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' })

  const [availablePrinters, setAvailablePrinters] = useState([])
  const [scanningPrinters, setScanningPrinters]   = useState(false)
  const [testingPrinter, setTestingPrinter]       = useState(false)
  const [printStatus, setPrintStatus]             = useState('')

  const [backups, setBackups]           = useState([])
  const [creatingBackup, setCreatingBackup]   = useState(false)
  const [restoringBackup, setRestoringBackup] = useState(false)

  const [systemInfo, setSystemInfo]         = useState(null)
  const [checkingUpdate, setCheckingUpdate] = useState(false)
  const [updateStatus, setUpdateStatus]     = useState('')

  // Reload users whenever another LAN machine creates/updates an account
  useLanSync(() => { if (isAdmin) loadUsers() })

  // ── Load on mount ───────────────────────────────────
  useEffect(() => {
    loadSettings()
    if (isAdmin) { loadUsers(); loadBackups() }
  }, [isAdmin])

  useEffect(() => {
    if (activeTab === 'system') loadSystemInfo()
  }, [activeTab])

  // ── Loaders ──────────────────────────────────────────
  const loadSettings = async () => {
    try {
      const shop = await getShop()
      if (shop) {
        setFormData({
          id: shop.id || '',
          name: shop.name || '',
          address: shop.address || '',
          phone: shop.phone || '',
          email: shop.email || '',
          currency: shop.currency || 'USD',
          printer_name: shop.printer_name || '',
          printer_port: (shop.printer_port && String(shop.printer_port).trim()) || 'COM3',
          auto_print: shop.auto_print !== undefined ? shop.auto_print : 1,
          print_duplicate: shop.print_duplicate !== undefined ? shop.print_duplicate : 0,
          receipt_width_mm: shop.receipt_width_mm || 58,
          receipt_footer: shop.receipt_footer !== undefined ? shop.receipt_footer : 'Thank you for your business!',
          receipt_name_size: shop.receipt_name_size || 'large',
          vat_rate: shop.vat_rate !== undefined ? shop.vat_rate : 0,
          default_reorder_level: shop.default_reorder_level || 5,
          variance_tolerance: shop.variance_tolerance !== undefined ? shop.variance_tolerance : 0.01
        })
      }
      setLoading(false)
    } catch { setError('Failed to load settings'); setLoading(false) }
  }

  const loadUsers = async () => {
    try { setUsers(await getUsers()) } catch { /* silent */ }
  }

  const loadBackups = async () => {
    try { setBackups(await getBackupHistory()) } catch { /* silent */ }
  }

  const loadSystemInfo = async () => {
    const w = window.stocka
    const info = {
      version: w?.version || 'Unknown',
      platform: { win32: 'Windows', darwin: 'macOS', linux: 'Linux' }[w?.platform] || w?.platform || 'Unknown',
      electronVersion: w?.electronVersion || 'N/A',
      nodeVersion: w?.nodeVersion || 'N/A',
      dbPath: null,
    }
    if (w?.db?.getPaths) {
      try {
        const paths = await w.db.getPaths()
        if (paths?.success) info.dbPath = paths.dbPath
      } catch { /* silent */ }
    }
    setSystemInfo(info)
  }

  // ── Helpers ───────────────────────────────────────────
  const flash = (type, msg) => {
    if (type === 'success') { setSuccess(msg); setError('') }
    else { setError(msg); setSuccess('') }
    setTimeout(() => type === 'success' ? setSuccess('') : setError(''), 5000)
  }

  // ── Handlers ─────────────────────────────────────────
  const handleSaveShop = async (e) => {
    e.preventDefault()
    if (!formData.name.trim()) { flash('error', 'Shop name is required'); return }
    try {
      await updateShop(formData.id, formData)
      flash('success', 'Settings saved successfully')
    } catch { flash('error', 'Failed to save settings') }
  }

  // Printer settings are always saved locally — each machine has its own printer.
  // Uses domain:shop:updatePrinter which is never proxied to the LAN server.
  const handleSavePrinter = async (e) => {
    e.preventDefault()
    try {
      await window.stocka.shop.updatePrinter({
        printer_name:    formData.printer_name,
        printer_port:    formData.printer_port,
        auto_print:      formData.auto_print,
        print_duplicate: formData.print_duplicate,
        receipt_width_mm: formData.receipt_width_mm,
      })
      flash('success', 'Printer settings saved')
    } catch { flash('error', 'Failed to save printer settings') }
  }

  const handleChangePassword = async (e) => {
    e.preventDefault()
    if (!passwordForm.currentPassword) { flash('error', 'Current PIN is required'); return }
    const pv = validatePin(passwordForm.newPassword)
    if (!pv.isValid) { flash('error', pv.message); return }
    if (passwordForm.newPassword !== passwordForm.confirmPassword) { flash('error', 'PINs do not match'); return }
    try {
      await updateUser(user.id, { password: passwordForm.newPassword, currentPassword: passwordForm.currentPassword })
      flash('success', 'PIN updated successfully')
      setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' })
    } catch { flash('error', 'Failed to change PIN — check your current PIN') }
  }

  const handleAddUser = async (e) => {
    e.preventDefault()
    if (!newUserForm.username.trim()) { flash('error', 'Username is required'); return }
    const pv = validatePin(newUserForm.password)
    if (!pv.isValid) { flash('error', pv.message); return }
    if (newUserForm.password !== newUserForm.confirmPassword) { flash('error', 'PINs do not match'); return }
    try {
      await addUser({ username: newUserForm.username, password: newUserForm.password, role: newUserForm.role, created_by: user.username })
      flash('success', `User "${newUserForm.username}" created`)
      setNewUserForm({ username: '', password: '', confirmPassword: '', role: 'Cashier' })
      setShowNewUserForm(false)
      loadUsers()
    } catch { flash('error', 'Failed to add user — username may already exist') }
  }

  const handleResetPassword = async (e) => {
    e.preventDefault()
    const pv = validatePin(resetPasswordForm.newPassword)
    if (!pv.isValid) { flash('error', pv.message); return }
    if (resetPasswordForm.newPassword !== resetPasswordForm.confirmPassword) { flash('error', 'PINs do not match'); return }
    try {
      await updateUser(resetPasswordUserId, { password: resetPasswordForm.newPassword })
      flash('success', 'PIN reset successfully')
      setResetPasswordUserId(null)
      setResetPasswordForm({ newPassword: '', confirmPassword: '' })
      loadUsers()
    } catch { flash('error', 'Failed to reset PIN') }
  }

  const handleDeactivateUser = async (userId) => {
    if (!confirm('Deactivate this user? They will not be able to log in.')) return
    const activeAdmins = users.filter(u => u.role === 'Admin' && u.is_active === 1)
    if (activeAdmins.length === 1 && activeAdmins[0].id === userId) {
      flash('error', 'Cannot deactivate the last active admin'); return
    }
    try {
      await deactivateUser(userId)
      flash('success', 'User deactivated')
      loadUsers()
    } catch { flash('error', 'Failed to deactivate user') }
  }

  const handleScanPrinters = async () => {
    if (!canUseNativePrinter()) { flash('error', 'Printer scanning only available in desktop app'); return }
    setScanningPrinters(true)
    setError(''); setPrintStatus('')
    try {
      const result = await window.stocka.printer.scan()
      if (result.success) {
        setAvailablePrinters(result.printers)
        if (result.printers.length === 0) flash('error', 'No printers found. Check that your printer is connected and powered on.')
        else setPrintStatus(`Found ${result.printers.length} printer(s)`)
      } else flash('error', result.error || 'Failed to scan for printers')
    } catch (err) { flash('error', 'Printer scan failed: ' + err.message) }
    finally { setScanningPrinters(false) }
  }

  const handleTestPrint = async () => {
    if (!canUseNativePrinter()) { flash('error', 'Printer test only available in desktop app'); return }
    if (!formData.printer_name?.trim()) { flash('error', 'Select a printer first'); return }
    setTestingPrinter(true); setPrintStatus('')
    try {
      const result = await window.stocka.printer.testByName(formData.printer_name)
      if (result.success) setPrintStatus(`✓ Test page sent to "${formData.printer_name}"`)
      else flash('error', `Test print failed: ${result.error || 'Unknown error'}`)
    } catch (err) { flash('error', 'Test print failed: ' + err.message) }
    finally { setTestingPrinter(false) }
  }

  const handleCreateBackup = async () => {
    setCreatingBackup(true)
    try {
      const result = await createDatabaseBackup()
      if (result?.success) { flash('success', `Backup created: ${result.filename}`); loadBackups() }
      else flash('error', result?.error || 'Failed to create backup')
    } catch (err) { flash('error', 'Backup failed: ' + err.message) }
    finally { setCreatingBackup(false) }
  }

  const handleRestoreBackup = async (key) => {
    if (!confirm('⚠️ This will overwrite your current database. Are you sure?')) return
    setRestoringBackup(true)
    try {
      const result = await restoreFromBackup(key)
      if (result?.success) { flash('success', 'Database restored. Reloading…'); setTimeout(() => window.location.reload(), 2000) }
      else flash('error', result?.error || 'Restore failed')
    } catch (err) { flash('error', 'Restore failed: ' + err.message) }
    finally { setRestoringBackup(false) }
  }

  const handleExportBackup = async (key) => {
    try {
      const json = await exportBackupAsFile(key)
      const a = document.createElement('a')
      a.href = 'data:text/plain;charset=utf-8,' + encodeURIComponent(json)
      a.download = `stocka-backup-${key}.json`
      document.body.appendChild(a); a.click(); document.body.removeChild(a)
      flash('success', 'Backup exported')
    } catch (err) { flash('error', 'Export failed: ' + err.message) }
  }

  const handleCheckUpdates = async () => {
    setCheckingUpdate(true); setUpdateStatus('')
    try {
      await window.stocka?.updater?.checkNow()
      setUpdateStatus('Checking for updates…')
      setTimeout(() => setUpdateStatus(''), 5000)
    } catch { setUpdateStatus('Could not check for updates') }
    finally { setCheckingUpdate(false) }
  }

  // ── Nav items ─────────────────────────────────────────
  const navItems = [
    { id: 'shop',     label: 'Shop Details',   Icon: FiShoppingBag, group: 'STORE',      show: !isCashier },
    { id: 'printer',  label: 'Printer',         Icon: FiPrinter,     group: 'STORE',      show: true },
    { id: 'receipt',  label: 'Receipt',         Icon: FiFileText,    group: 'STORE',      show: !isCashier },
    { id: 'users',    label: 'Team & Users',   Icon: FiUsers,        group: 'STAFF',      show: isAdmin },
    { id: 'password', label: 'Security',        Icon: FiShield,      group: 'ACCOUNT',    show: true },
    { id: 'business', label: 'Business Rules',  Icon: FiSliders,     group: 'OPERATIONS', show: isAdmin },
    { id: 'system',   label: 'System',          Icon: FiMonitor,     group: 'SYSTEM',     show: !isCashier },
    { id: 'backup',   label: 'Backups',         Icon: FiHardDrive,   group: 'SYSTEM',     show: isAdmin },
    { id: 'network',  label: 'Network',         Icon: FiWifi,        group: 'SYSTEM',     show: isAdmin },
  ].filter(i => i.show)

  if (loading) {
    return (
      <div className="settings-page">
        <div className="s-loading s-loading--page">Loading settings…</div>
      </div>
    )
  }

  return (
    <div className="settings-page">
      {/* Header */}
      <div className="settings-header">
        <h1 className="settings-header-title">Settings</h1>
        <p className="settings-header-sub">Manage your shop, team, and system preferences</p>
      </div>

      {/* Notifications */}
      {error && (
        <div className="settings-alert error">
          <FiAlertCircle size={15} />
          <span>{error}</span>
          <button className="settings-alert-close" onClick={() => setError('')}><FiX size={13} /></button>
        </div>
      )}
      {success && (
        <div className="settings-alert success">
          <FiCheckCircle size={15} />
          <span>{success}</span>
        </div>
      )}

      <div className="settings-body">
        {/* ── Left Nav ── */}
        <nav className="settings-nav">
          {navItems.reduce((acc, item, i) => {
            const prevGroup = i > 0 ? navItems[i - 1].group : null
            if (item.group !== prevGroup) {
              acc.push(
                <div key={`group-${item.group}`} className="settings-nav-group">{item.group}</div>
              )
            }
            acc.push(
              <button
                key={item.id}
                className={`settings-nav-item ${activeTab === item.id ? 'active' : ''}`}
                onClick={() => setActiveTab(item.id)}
              >
                <span className="s-nav-icon"><item.Icon size={14} /></span>
                {item.label}
              </button>
            )
            return acc
          }, [])}
        </nav>

        {/* ── Content ── */}
        <div className="settings-content">

          {/* ── SHOP ── */}
          {activeTab === 'shop' && (
            <div className="s-card">
              <div className="s-card-head">
                <div>
                  <h2 className="s-card-title"><FiShoppingBag size={17} /> Shop Details</h2>
                  <p className="s-card-desc">Your business identity shown on receipts and reports</p>
                </div>
              </div>
              <form onSubmit={handleSaveShop}>
                <div className="s-grid-2">
                  <div className="s-field">
                    <label className="s-label">Shop Name <span className="s-req">*</span></label>
                    <input className="s-input" type="text" value={formData.name}
                      onChange={e => setFormData({ ...formData, name: e.target.value })}
                      placeholder="e.g. Blessed Stores" required />
                  </div>
                  <div className="s-field">
                    <label className="s-label">Currency</label>
                    <select className="s-select" value={formData.currency}
                      onChange={e => setFormData({ ...formData, currency: e.target.value })}>
                      <option>USD</option><option>ZWL</option><option>EUR</option><option>GBP</option>
                    </select>
                  </div>
                </div>
                <div className="s-grid-2">
                  <div className="s-field">
                    <label className="s-label">Email Address</label>
                    <input className="s-input" type="email" value={formData.email}
                      onChange={e => setFormData({ ...formData, email: e.target.value })}
                      placeholder="shop@example.com" />
                  </div>
                  <div className="s-field">
                    <label className="s-label">Phone Number</label>
                    <input className="s-input" type="tel" value={formData.phone}
                      onChange={e => setFormData({ ...formData, phone: e.target.value })}
                      placeholder="+263 77 123 4567" />
                  </div>
                </div>
                <div className="s-field">
                  <label className="s-label">Physical Address</label>
                  <textarea className="s-textarea" value={formData.address}
                    onChange={e => setFormData({ ...formData, address: e.target.value })}
                    rows="2" placeholder="Street address, city, country" />
                </div>
                <div className="s-form-footer">
                  <button type="submit" className="s-btn-primary"><FiSave size={13} /> Save Changes</button>
                </div>
              </form>
            </div>
          )}

          {/* ── USERS ── */}
          {activeTab === 'users' && isAdmin && (
            <div className="s-card">
              <div className="s-card-head">
                <div>
                  <h2 className="s-card-title"><FiUsers size={17} /> Team & Users</h2>
                  <p className="s-card-desc">Manage staff accounts and access levels</p>
                </div>
                <button className="s-btn-primary s-btn-sm" onClick={() => setShowNewUserForm(!showNewUserForm)}>
                  {showNewUserForm ? <><FiX size={12} /> Cancel</> : <><FiUserPlus size={12} /> Add User</>}
                </button>
              </div>

              {showNewUserForm && (
                <div className="s-inline-form">
                  <h4 className="s-inline-form-title"><FiUserPlus size={14} /> New Staff Account</h4>
                  <form onSubmit={handleAddUser}>
                    <div className="s-grid-2">
                      <div className="s-field">
                        <label className="s-label">Username</label>
                        <input className="s-input" type="text" value={newUserForm.username}
                          onChange={e => setNewUserForm({ ...newUserForm, username: e.target.value })}
                          placeholder="e.g. john_cashier" required />
                      </div>
                      <div className="s-field">
                        <label className="s-label">Role</label>
                        <select className="s-select" value={newUserForm.role}
                          onChange={e => setNewUserForm({ ...newUserForm, role: e.target.value })}>
                          <option value="Admin">Admin</option>
                          <option value="Manager">Manager</option>
                          <option value="Cashier">Cashier</option>
                        </select>
                      </div>
                    </div>
                    <div className="s-grid-2">
                      <div className="s-field">
                        <label className="s-label">PIN (4 digits)</label>
                        <input className="s-input" type="password" inputMode="numeric" pattern="\d{4}" maxLength={4}
                          value={newUserForm.password}
                          onChange={e => setNewUserForm({ ...newUserForm, password: e.target.value.replace(/\D/g, '').slice(0, 4) })} required />
                      </div>
                      <div className="s-field">
                        <label className="s-label">Confirm PIN</label>
                        <input className="s-input" type="password" inputMode="numeric" pattern="\d{4}" maxLength={4}
                          value={newUserForm.confirmPassword}
                          onChange={e => setNewUserForm({ ...newUserForm, confirmPassword: e.target.value.replace(/\D/g, '').slice(0, 4) })} required />
                      </div>
                    </div>
                    <div className="s-form-footer">
                      <button type="submit" className="s-btn-primary s-btn-sm"><FiCheck size={12} /> Create Account</button>
                      <button type="button" className="s-btn-secondary s-btn-sm" onClick={() => setShowNewUserForm(false)}>Cancel</button>
                    </div>
                  </form>
                </div>
              )}

              <table className="s-table">
                <thead>
                  <tr>
                    <th>Staff Member</th><th>Role</th><th>Status</th><th>Joined</th><th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map(u => (
                    <tr key={u.id}>
                      <td>
                        <div className="s-user-chip">
                          <div className="s-user-avatar">{u.username[0]?.toUpperCase()}</div>
                          <span className="s-user-name">{u.username}</span>
                        </div>
                      </td>
                      <td><span className={`s-badge ${u.role.toLowerCase()}`}>{u.role}</span></td>
                      <td><span className={`s-badge ${u.is_active ? 'active' : 'inactive'}`}>{u.is_active ? 'Active' : 'Inactive'}</span></td>
                      <td className="s-table-date-cell">{u.created_at ? new Date(u.created_at).toLocaleDateString() : '—'}</td>
                      <td>
                        <div className="s-btn-row">
                          <button className="s-btn-secondary s-btn-sm"
                            onClick={() => { setResetPasswordUserId(u.id); setResetPasswordForm({ newPassword: '', confirmPassword: '' }) }}>
                            <FiKey size={11} /> Reset PIN
                          </button>
                          {u.is_active && (
                            <button className="s-btn-danger s-btn-sm"
                              onClick={() => handleDeactivateUser(u.id)}
                              disabled={u.role === 'Admin' && users.filter(x => x.role === 'Admin' && x.is_active === 1).length === 1}>
                              <FiUserX size={11} /> Deactivate
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {resetPasswordUserId && (
                <div className="s-reset-panel">
                  <h4 className="s-reset-panel-title">
                    <FiKey size={13} /> Reset PIN — {users.find(u => u.id === resetPasswordUserId)?.username}
                  </h4>
                  <form onSubmit={handleResetPassword}>
                    <div className="s-grid-2">
                      <div className="s-field">
                        <label className="s-label">New PIN (4 digits)</label>
                        <input className="s-input" type="password" inputMode="numeric" pattern="\d{4}" maxLength={4}
                          value={resetPasswordForm.newPassword}
                          onChange={e => setResetPasswordForm({ ...resetPasswordForm, newPassword: e.target.value.replace(/\D/g, '').slice(0, 4) })} required />
                      </div>
                      <div className="s-field">
                        <label className="s-label">Confirm PIN</label>
                        <input className="s-input" type="password" inputMode="numeric" pattern="\d{4}" maxLength={4}
                          value={resetPasswordForm.confirmPassword}
                          onChange={e => setResetPasswordForm({ ...resetPasswordForm, confirmPassword: e.target.value.replace(/\D/g, '').slice(0, 4) })} required />
                      </div>
                    </div>
                    <div className="s-form-footer">
                      <button type="submit" className="s-btn-primary s-btn-sm"><FiCheck size={12} /> Save PIN</button>
                      <button type="button" className="s-btn-secondary s-btn-sm" onClick={() => setResetPasswordUserId(null)}>Cancel</button>
                    </div>
                  </form>
                </div>
              )}
            </div>
          )}

          {/* ── PRINTER ── */}
          {activeTab === 'printer' && (
            <div className="s-card">
              <div className="s-card-head">
                <div>
                  <h2 className="s-card-title"><FiPrinter size={17} /> Thermal Printer</h2>
                  <p className="s-card-desc">Configure your receipt printer connection</p>
                </div>
              </div>

              <div className="s-field">
                <label className="s-label">Selected Printer</label>
                <div className="s-printer-input-row">
                  <input className="s-input" type="text"
                    placeholder="Printer name — click Scan to detect"
                    value={formData.printer_name || ''}
                    onChange={e => setFormData({ ...formData, printer_name: e.target.value })} />
                  <button type="button" className="s-btn-secondary" onClick={handleScanPrinters} disabled={scanningPrinters}>
                    <FiRefreshCw size={13} className={scanningPrinters ? 'spin' : ''} />
                    {scanningPrinters ? 'Scanning…' : 'Scan'}
                  </button>
                </div>
              </div>

              {availablePrinters.filter(p => !p.isVirtual).length > 0 && (
                <div className="s-printer-list">
                  {availablePrinters.filter(p => !p.isVirtual).map(printer => (
                    <div key={printer.name}
                      className={`s-printer-item ${formData.printer_name === printer.name ? 'chosen' : ''}`}
                      onClick={() => setFormData({ ...formData, printer_name: printer.name })}>
                      <div className="s-printer-icon"><FiPrinter size={15} /></div>
                      <span className="s-printer-name">{printer.name}</span>
                      {formData.printer_name === printer.name && <span className="s-printer-check"><FiCheck size={15} /></span>}
                    </div>
                  ))}
                </div>
              )}

              {printStatus && <div className="s-print-status">{printStatus}</div>}

              <div className="s-form-footer s-form-footer--mb">
                <button type="button" className="s-btn-secondary"
                  onClick={handleTestPrint} disabled={testingPrinter || !formData.printer_name}>
                  <FiZap size={13} /> {testingPrinter ? 'Printing…' : 'Test Print'}
                </button>
              </div>

              <hr className="s-divider" />

              <form onSubmit={handleSavePrinter}>
                <div className="s-toggle-row"
                  onClick={() => setFormData({ ...formData, auto_print: formData.auto_print === 1 ? 0 : 1 })}>
                  <div className="s-toggle-info">
                    <div className="s-toggle-label">Auto-print receipts</div>
                    <div className="s-toggle-sub">Automatically print after every completed sale</div>
                  </div>
                  <label className="s-switch" onClick={e => e.stopPropagation()}>
                    <input type="checkbox" checked={formData.auto_print === 1}
                      onChange={e => setFormData({ ...formData, auto_print: e.target.checked ? 1 : 0 })} />
                    <span className="s-switch-track" />
                  </label>
                </div>

                <div className="s-toggle-row"
                  onClick={() => setFormData({ ...formData, print_duplicate: formData.print_duplicate === 1 ? 0 : 1 })}>
                  <div className="s-toggle-info">
                    <div className="s-toggle-label">Print duplicate receipts</div>
                    <div className="s-toggle-sub">Print 2 copies — one for customer, one for your records</div>
                  </div>
                  <label className="s-switch" onClick={e => e.stopPropagation()}>
                    <input type="checkbox" checked={formData.print_duplicate === 1}
                      onChange={e => setFormData({ ...formData, print_duplicate: e.target.checked ? 1 : 0 })} />
                    <span className="s-switch-track" />
                  </label>
                </div>

                <div className="s-form-footer s-form-footer--mt">
                  <button type="submit" className="s-btn-primary"><FiSave size={13} /> Save Printer Settings</button>
                </div>
              </form>
            </div>
          )}

          {/* ── RECEIPT ── */}
          {activeTab === 'receipt' && !isCashier && (
            <div className="s-card">
              <div className="s-card-head">
                <div>
                  <h2 className="s-card-title"><FiFileText size={17} /> Receipt Configuration</h2>
                  <p className="s-card-desc">Customize what customers see on their printed receipts</p>
                </div>
              </div>
              <form onSubmit={handleSaveShop}>
                <div className="s-field">
                  <label className="s-label">Paper Roll Width</label>
                  <div className="s-radio-group s-radio-group--mt">
                    {[
                      { value: 58, title: '58mm', sub: 'Narrow roll · 32 chars wide' },
                      { value: 80, title: '80mm', sub: 'Wide roll · 42 chars wide' },
                    ].map(opt => (
                      <label key={opt.value}
                        className={`s-radio-option ${Number(formData.receipt_width_mm) === opt.value ? 'chosen' : ''}`}>
                        <input type="radio" name="receipt_width_mm" value={opt.value}
                          checked={Number(formData.receipt_width_mm) === opt.value}
                          onChange={() => setFormData({ ...formData, receipt_width_mm: opt.value })} />
                        <span>
                          <div className="s-radio-title">{opt.title}</div>
                          <div className="s-radio-sub">{opt.sub}</div>
                        </span>
                      </label>
                    ))}
                  </div>
                  <p className="s-hint">Match this to the paper roll in your printer. Wrong setting causes split lines on receipts.</p>
                </div>

                <div className="s-field">
                  <label className="s-label">Shop Name Font Size</label>
                  <div className="s-radio-group s-radio-group--mt">
                    {[
                      { value: 'large',  title: 'Large (auto-fit)', sub: 'Double-size · shrinks if name is too long' },
                      { value: 'medium', title: 'Medium',           sub: 'Double height, normal width · always fits' },
                      { value: 'normal', title: 'Normal',           sub: 'Same size as body text · guaranteed single line' },
                    ].map(opt => (
                      <label key={opt.value}
                        className={`s-radio-option ${formData.receipt_name_size === opt.value ? 'chosen' : ''}`}>
                        <input type="radio" name="receipt_name_size" value={opt.value}
                          checked={formData.receipt_name_size === opt.value}
                          onChange={() => setFormData({ ...formData, receipt_name_size: opt.value })} />
                        <span>
                          <div className="s-radio-title">{opt.title}</div>
                          <div className="s-radio-sub">{opt.sub}</div>
                        </span>
                      </label>
                    ))}
                  </div>
                  <p className="s-hint">If your shop name wraps to a second line on receipts, switch to Medium or Normal.</p>
                </div>

                <div className="s-field">
                  <label className="s-label">Footer Message</label>
                  <textarea className="s-textarea" rows="3"
                    value={formData.receipt_footer}
                    onChange={e => setFormData({ ...formData, receipt_footer: e.target.value })}
                    placeholder="e.g. Thank you! WhatsApp: +263 77 123 4567" />
                  <p className="s-hint">Printed at the bottom of every receipt — great for your contact or a thank-you note.</p>
                </div>

                <div className="s-form-footer">
                  <button type="submit" className="s-btn-primary"><FiSave size={13} /> Save Receipt Settings</button>
                </div>
              </form>
            </div>
          )}

          {/* ── SECURITY ── */}
          {activeTab === 'password' && (
            <div className="s-card">
              <div className="s-card-head">
                <div>
                  <h2 className="s-card-title"><FiShield size={17} /> Security</h2>
                  <p className="s-card-desc">Change your login PIN</p>
                </div>
              </div>
              <form onSubmit={handleChangePassword} className="s-password-form">
                <div className="s-field">
                  <label className="s-label">Current PIN</label>
                  <input className="s-input" type="password" inputMode="numeric" pattern="\d{4}" maxLength={4}
                    value={passwordForm.currentPassword}
                    onChange={e => setPasswordForm({ ...passwordForm, currentPassword: e.target.value.replace(/\D/g, '').slice(0, 4) })}
                    placeholder="Enter your current PIN" required />
                </div>
                <div className="s-field">
                  <label className="s-label">New PIN</label>
                  <input className="s-input" type="password" inputMode="numeric" pattern="\d{4}" maxLength={4}
                    value={passwordForm.newPassword}
                    onChange={e => setPasswordForm({ ...passwordForm, newPassword: e.target.value.replace(/\D/g, '').slice(0, 4) })}
                    placeholder="4 digits" required />
                </div>
                <div className="s-field">
                  <label className="s-label">Confirm New PIN</label>
                  <input className="s-input" type="password" inputMode="numeric" pattern="\d{4}" maxLength={4}
                    value={passwordForm.confirmPassword}
                    onChange={e => setPasswordForm({ ...passwordForm, confirmPassword: e.target.value.replace(/\D/g, '').slice(0, 4) })}
                    placeholder="Repeat new PIN" required />
                </div>
                <div className="s-form-footer">
                  <button type="submit" className="s-btn-primary"><FiShield size={13} /> Update PIN</button>
                </div>
              </form>
            </div>
          )}

          {/* ── BUSINESS RULES ── */}
          {activeTab === 'business' && isAdmin && (
            <div className="s-card">
              <div className="s-card-head">
                <div>
                  <h2 className="s-card-title"><FiSliders size={17} /> Business Rules</h2>
                  <p className="s-card-desc">Tax rates, inventory thresholds, and cash handling policies</p>
                </div>
              </div>
              <form onSubmit={handleSaveShop}>
                <div className="s-grid-3">
                  <div className="s-field">
                    <label className="s-label">VAT / Tax Rate (%)</label>
                    <input className="s-input" type="number" min="0" max="100" step="0.5"
                      value={formData.vat_rate}
                      onChange={e => setFormData({ ...formData, vat_rate: parseFloat(e.target.value) || 0 })} />
                    <p className="s-hint">Set to 0 to disable. Zimbabwe VAT is 15%. Shown as a separate line on receipts.</p>
                  </div>
                  <div className="s-field">
                    <label className="s-label">Default Reorder Level</label>
                    <input className="s-input" type="number" min="1" step="1"
                      value={formData.default_reorder_level}
                      onChange={e => setFormData({ ...formData, default_reorder_level: parseInt(e.target.value) || 5 })} />
                    <p className="s-hint">Low-stock alert threshold applied to new products. Each product can override individually.</p>
                  </div>
                  <div className="s-field">
                    <label className="s-label">Shift Variance Tolerance ($)</label>
                    <input className="s-input" type="number" min="0" step="0.01"
                      value={formData.variance_tolerance}
                      onChange={e => setFormData({ ...formData, variance_tolerance: parseFloat(e.target.value) || 0.01 })} />
                    <p className="s-hint">Maximum acceptable cash difference before a shift is flagged short or over.</p>
                  </div>
                </div>
                <div className="s-form-footer">
                  <button type="submit" className="s-btn-primary"><FiSave size={13} /> Save Business Rules</button>
                </div>
              </form>
            </div>
          )}

          {/* ── SYSTEM ── */}
          {activeTab === 'system' && !isCashier && (
            <div className="s-card">
              <div className="s-card-head">
                <div>
                  <h2 className="s-card-title"><FiMonitor size={17} /> System Information</h2>
                  <p className="s-card-desc">Application environment and runtime details</p>
                </div>
              </div>

              {!systemInfo ? (
                <div className="s-loading">Loading system info…</div>
              ) : (
                <>
                  <div className="s-info-row">
                    <span className="s-info-label">App Version</span>
                    <span className="s-info-value"><code className="s-code">v{systemInfo.version}</code></span>
                  </div>
                  <div className="s-info-row">
                    <span className="s-info-label">Platform</span>
                    <span className="s-info-value">{systemInfo.platform}</span>
                  </div>
                  <div className="s-info-row">
                    <span className="s-info-label">Electron</span>
                    <span className="s-info-value"><code className="s-code">{systemInfo.electronVersion}</code></span>
                  </div>
                  <div className="s-info-row">
                    <span className="s-info-label">Node.js</span>
                    <span className="s-info-value"><code className="s-code">{systemInfo.nodeVersion}</code></span>
                  </div>
                  <div className="s-info-row">
                    <span className="s-info-label">Storage Engine</span>
                    <span className="s-info-value">SQLite · Local</span>
                  </div>
                  {systemInfo.dbPath && (
                    <div className="s-info-row">
                      <span className="s-info-label">Database File</span>
                      <span className="s-info-value s-info-value--db">
                        <code className="s-code">{systemInfo.dbPath}</code>
                      </span>
                    </div>
                  )}
                  <div className="s-info-row">
                    <span className="s-info-label">Data Mode</span>
                    <span className="s-info-value s-offline-badge"><FiLock size={12} /> Offline Only</span>
                  </div>
                </>
              )}

              {isAdmin && (
                <div className="s-update-row">
                  <button className="s-btn-secondary" onClick={handleCheckUpdates} disabled={checkingUpdate}>
                    <FiRefreshCw size={13} className={checkingUpdate ? 'spin' : ''} />
                    {checkingUpdate ? 'Checking…' : 'Check for Updates'}
                  </button>
                  {updateStatus && <span className="s-update-status">{updateStatus}</span>}
                </div>
              )}
            </div>
          )}

          {/* ── BACKUPS ── */}
          {activeTab === 'backup' && isAdmin && (
            <div className="s-card">
              <div className="s-card-head">
                <div>
                  <h2 className="s-card-title"><FiHardDrive size={17} /> Database Backups</h2>
                  <p className="s-card-desc">Protect your data. Automatic backups run daily — create a manual one anytime.</p>
                </div>
                <button className="s-btn-primary" onClick={handleCreateBackup} disabled={creatingBackup}>
                  <FiDownload size={13} /> {creatingBackup ? 'Creating…' : 'Create Backup'}
                </button>
              </div>

              {backups.length === 0 ? (
                <div className="s-empty">
                  <div className="s-empty-icon"><FiHardDrive size={30} /></div>
                  <p>No backups yet. Create one now to protect your data.</p>
                </div>
              ) : (
                backups.map(backup => (
                  <div key={backup.filename} className="s-backup-row">
                    <div className="s-backup-icon"><FiHardDrive size={15} /></div>
                    <div className="s-backup-info">
                      <div className="s-backup-date">
                        {new Date(backup.createdAt).toLocaleDateString()} · {new Date(backup.createdAt).toLocaleTimeString()}
                      </div>
                      <div className="s-backup-size">{(backup.sizeBytes / 1024).toFixed(1)} KB</div>
                    </div>
                    <div className="s-btn-row">
                      <button className="s-btn-secondary s-btn-sm" onClick={() => handleExportBackup(backup.filename)}>
                        <FiDownload size={11} /> Export
                      </button>
                      <button className="s-btn-danger s-btn-sm" onClick={() => handleRestoreBackup(backup.filename)} disabled={restoringBackup}>
                        <FiUpload size={11} /> Restore
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* ── NETWORK ── */}
          {activeTab === 'network' && isAdmin && (
            <div className="s-card">
              <div className="s-card-head">
                <div>
                  <h2 className="s-card-title"><FiWifi size={17} /> Network & LAN Sync</h2>
                  <p className="s-card-desc">Connect multiple tills over your local network</p>
                </div>
              </div>
              <LanSettings />
            </div>
          )}

        </div>
      </div>
    </div>
  )
}

export default Settings
