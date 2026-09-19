import { useState, useEffect } from 'react'
import {
  getShop, updateShop, getUsers, addUser, updateUser, deactivateUser
} from '../database/db'
import { validatePin } from '../utils/authUtils'
import { canUseNativePrinter } from '../services/runtime'
import { useAuthStore } from '../store/useAuthStore'
import { useLanSync } from '../hooks/useLanSync'
import { NAV_PRIVILEGES, NAV_GROUPS, CONFIGURABLE_ROLES, parseRolePrivileges, canRoleAccessNav } from '../utils/rolePrivileges'
import LanSettings from './LanSettings'
import { toast } from '../store/useToastStore'
import BackupsPanel from '../components/BackupsPanel'
import Modal from '../components/Modal'
import ConfirmModal from '../components/ConfirmModal'
import Field from '../components/Field'
import { SettingsSection, InfoRow } from '../components/SettingsSection'
import './Settings.css'
import {
  FiShoppingBag, FiUsers, FiPrinter, FiShield, FiFileText,
  FiSliders, FiMonitor, FiHardDrive, FiWifi, FiSave, FiRefreshCw,
  FiZap, FiUserPlus, FiKey, FiUserX, FiDownload, FiUpload,
  FiAlertCircle, FiX, FiCheck, FiLock,
  FiEye, FiEyeOff, FiCopy, FiAlertTriangle
} from 'react-icons/fi'

// Read-only views show these instead of raw stored values.
const CURRENCY_NAMES = {
  USD: 'US Dollar (USD)',
  ZWL: 'Zimbabwe Dollar (ZWL)',
  EUR: 'Euro (EUR)',
  GBP: 'British Pound (GBP)',
}

const RECEIPT_WIDTHS = [
  { value: 58, title: '58 mm', sub: 'Narrow roll · 32 characters wide' },
  { value: 80, title: '80 mm', sub: 'Wide roll · 42 characters wide' },
]

const RECEIPT_NAME_SIZES = [
  { value: 'large',  title: 'Large', sub: 'Double size, shrinks if the name is long' },
  { value: 'medium', title: 'Medium', sub: 'Tall but normal width, always fits' },
  { value: 'normal', title: 'Normal', sub: 'Same size as the rest, always one line' },
]

const ROLE_HINTS = {
  Cashier: 'Sells and sees their own transactions.',
  Manager: 'Runs the shop day to day: stock, money, reports.',
  Admin: 'Everything, including staff and settings.',
}

// initialTab lets another screen send the user somewhere specific — the backup
// health strip on the dashboard opens this straight on Backups, because landing
// on the general settings page and asking them to find it defeats the point of
// putting the warning in front of them.
function Settings({ initialTab }) {
  const { user } = useAuthStore()
  const isCashier = user?.role === 'Cashier'
  const isAdmin   = user?.role === 'Admin'

  const [activeTab, setActiveTab] = useState(initialTab || (isCashier ? 'password' : 'shop'))
  const [loading, setLoading]   = useState(true)

  const [formData, setFormData] = useState({
    name: '', address: '', phone: '', email: '', currency: 'USD',
    printer_name: '', printer_port: 'COM3', auto_print: 1, print_duplicate: 0,
    receipt_width_mm: 58, receipt_footer: 'Thank you for your business!', receipt_name_size: 'large',
    vat_rate: 0, default_reorder_level: 5, variance_tolerance: 0.01,
    role_privileges: null
  })

  const [users, setUsers]               = useState([])
  // Role privileges editor (Settings → Role Privileges, admin only)
  const [privRole, setPrivRole]   = useState('Cashier')
  const [rolePrivs, setRolePrivs] = useState({})
  const [showNewUserForm, setShowNewUserForm] = useState(false)
  const [newUserForm, setNewUserForm]   = useState({ username: '', password: '', confirmPassword: '', role: 'Cashier' })
  const [resetPasswordUserId, setResetPasswordUserId] = useState(null)
  const [resetPasswordForm, setResetPasswordForm]     = useState({ newPassword: '', confirmPassword: '' })
  const [passwordForm, setPasswordForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' })

  const [availablePrinters, setAvailablePrinters] = useState([])
  const [scanningPrinters, setScanningPrinters]   = useState(false)
  const [testingPrinter, setTestingPrinter]       = useState(false)


  const [systemInfo, setSystemInfo]         = useState(null)
  const [checkingUpdate, setCheckingUpdate] = useState(false)
  const [updateStatus, setUpdateStatus]     = useState('')

  // Test-data reset (danger zone)
  const [resetConfirmText, setResetConfirmText] = useState('')
  const [resetPin, setResetPin]                 = useState('')
  const [resetting, setResetting]               = useState(false)
  const [resetResult, setResetResult]           = useState(null) // { totalRemoved, backupFilename }
  // Bumped after a reset so the Backups panel re-reads its list — the reset takes a
  // pre-reset safety copy the owner is about to be told the name of.
  const [backupsRefresh, setBackupsRefresh]     = useState(0)

  // License key reveal
  const [licenseReveal, setLicenseReveal]         = useState('hidden') // 'hidden' | 'pin' | 'revealed'
  const [licensePin, setLicensePin]               = useState('')
  const [licenseKey, setLicenseKey]               = useState('')
  const [licenseRevealError, setLicenseRevealError] = useState('')
  const [licenseCountdown, setLicenseCountdown]   = useState(30)

  // ── Read-only / edit ──
  // One section editable at a time. Shop details, receipt and business rules all
  // save the same shop record, so letting two be half-edited at once would mean
  // saving one silently saved the other's unfinished changes.
  const [editing, setEditing]               = useState(null)
  const [savedData, setSavedData]           = useState(null)   // what is actually saved
  const [savedRolePrivs, setSavedRolePrivs] = useState({})
  const [sectionSaving, setSectionSaving]   = useState(false)
  const [secErrors, setSecErrors]           = useState({})
  const [attempt, setAttempt]               = useState(0)
  const [pendingTab, setPendingTab]         = useState(null)   // tab waiting on "discard changes?"
  const [userErrors, setUserErrors]         = useState({})

  // Reload users whenever another LAN machine creates/updates an account
  useLanSync(() => { if (isAdmin) loadUsers() })

  // ── Load on mount ───────────────────────────────────
  useEffect(() => {
    loadSettings()
    if (isAdmin) loadUsers()
  }, [isAdmin])

  useEffect(() => {
    if (activeTab === 'system') loadSystemInfo()
  }, [activeTab])

  // ── Loaders ──────────────────────────────────────────
  const loadSettings = async () => {
    try {
      const shop = await getShop()
      if (shop) {
        const loaded = {
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
          variance_tolerance: shop.variance_tolerance !== undefined ? shop.variance_tolerance : 0.01,
          allow_admin_sales: shop.allow_admin_sales ? 1 : 0,
          role_privileges: shop.role_privileges || null
        }
        const privs = parseRolePrivileges(shop.role_privileges)
        setFormData(loaded)
        setSavedData(loaded)
        setRolePrivs(privs)
        setSavedRolePrivs(privs)
      }
      setLoading(false)
    } catch { toast.error('Failed to load settings'); setLoading(false) }
  }

  const loadUsers = async () => {
    try { setUsers(await getUsers()) } catch { /* silent */ }
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
  // Kept as a function with the same shape so every existing call site — and
  // BackupsPanel, which takes it as a prop — needed no change. It used to push a
  // banner into the top of the document, where a message triggered from the bottom
  // of a scrolled page was simply never seen.
  const flash = (type, msg) => (type === 'success' ? toast.success(msg) : toast.error(msg))

  // ── Handlers ─────────────────────────────────────────
  const startEdit = (key) => {
    setSecErrors({})
    setEditing(key)
  }

  // Cancel puts everything back exactly as it was saved.
  const cancelEdit = () => {
    if (savedData) setFormData(savedData)
    setRolePrivs(savedRolePrivs)
    setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' })
    setAvailablePrinters([])
    setSecErrors({})
    setEditing(null)
  }

  // Leaving a tab mid-edit asks first — otherwise the half-made changes would still
  // be sitting in the form and the next section's Save would write them.
  const goToTab = (tab) => {
    if (editing && tab !== activeTab) { setPendingTab(tab); return }
    setActiveTab(tab)
  }

  const failSection = (errs) => {
    setSecErrors(errs)
    setAttempt(n => n + 1)
    requestAnimationFrame(() => document.querySelector('.ss-card.is-editing [aria-invalid="true"]')?.focus())
  }

  const SECTION_SAVED = {
    shop: 'Shop details saved',
    receipt: 'Receipt settings saved',
    business: 'Business rules saved',
  }

  // Shop, receipt and business rules share one record, so one save for all three —
  // each with its own confirmation, so it is clear which one just went through.
  const saveSection = (key) => async (e) => {
    e.preventDefault()
    if (key === 'shop' && !formData.name.trim()) { failSection({ name: 'Your shop needs a name' }); return }
    if (key === 'business') {
      const errs = {}
      const vat = Number(formData.vat_rate)
      if (!Number.isFinite(vat) || vat < 0 || vat > 100) errs.vat_rate = 'Between 0 and 100'
      if (!(Number(formData.default_reorder_level) >= 1)) errs.default_reorder_level = 'At least 1'
      if (!(Number(formData.variance_tolerance) >= 0)) errs.variance_tolerance = '0 or more'
      if (Object.keys(errs).length) { failSection(errs); return }
    }
    setSectionSaving(true)
    try {
      const next = { ...formData, name: formData.name.trim() }
      await updateShop(next.id, next)
      setFormData(next)
      setSavedData(next)
      setEditing(null)
      setSecErrors({})
      toast.success(SECTION_SAVED[key] || 'Saved')
    } catch {
      toast.error('Could not save — nothing was changed')
    } finally {
      setSectionSaving(false)
    }
  }

  // Flip one tab's visibility for the role being edited. Stored as an
  // override only — untouched tabs keep following the role defaults.
  const togglePrivilege = (navId) => {
    const current = canRoleAccessNav(privRole, navId, rolePrivs)
    setRolePrivs(p => ({ ...p, [privRole]: { ...(p[privRole] || {}), [navId]: !current } }))
  }

  const handleSavePrivileges = async (e) => {
    e.preventDefault()
    setSectionSaving(true)
    try {
      const json = JSON.stringify(rolePrivs)
      const next = { ...(savedData || formData), role_privileges: json }
      await updateShop(formData.id, next)
      setFormData(next)
      setSavedData(next)
      setSavedRolePrivs(rolePrivs)
      setEditing(null)
      toast.success('Role privileges saved', { detail: 'They apply the next time each person moves between pages or signs in.' })
    } catch {
      toast.error('Could not save role privileges')
    } finally {
      setSectionSaving(false)
    }
  }

  // Printer settings are always saved locally — each machine has its own printer.
  // Uses domain:shop:updatePrinter which is never proxied to the LAN server.
  const handleSavePrinter = async (e) => {
    e.preventDefault()
    setSectionSaving(true)
    try {
      await window.stocka.shop.updatePrinter({
        printer_name:    formData.printer_name,
        printer_port:    formData.printer_port,
        auto_print:      formData.auto_print,
        print_duplicate: formData.print_duplicate,
        receipt_width_mm: formData.receipt_width_mm,
      })
      setSavedData(formData)
      setEditing(null)
      setAvailablePrinters([])
      toast.success('Printer settings saved', { detail: formData.printer_name ? `Printing to ${formData.printer_name}` : undefined })
    } catch {
      toast.error('Could not save printer settings')
    } finally {
      setSectionSaving(false)
    }
  }

  // Danger zone: wipe transactional history, keep products/users/settings.
  // PIN is re-verified in the main process; a .db backup is taken automatically first.
  const handleResetTransactions = async () => {
    if (resetConfirmText.trim().toUpperCase() !== 'RESET') { flash('error', 'Type RESET in the confirmation box to continue'); return }
    if (!resetPin) { flash('error', 'Enter your admin PIN to confirm'); return }
    setResetting(true)
    setResetResult(null)
    try {
      const res = await window.stocka.maintenance.resetTransactions({ username: user.username, pin: resetPin })
      if (!res?.success) { flash('error', res?.error || 'Reset failed'); return }
      setResetResult(res)
      setResetConfirmText('')
      setResetPin('')
      setBackupsRefresh((n) => n + 1)
      flash('success', `Reset complete — ${res.totalRemoved} record${res.totalRemoved !== 1 ? 's' : ''} removed. Backup saved first: ${res.backupFilename}`)
    } catch (e) {
      flash('error', 'Reset failed: ' + e.message)
    } finally {
      setResetting(false)
    }
  }

  const handleChangePassword = async (e) => {
    e.preventDefault()
    const errs = {}
    if (!passwordForm.currentPassword) errs.currentPassword = 'Enter the PIN you use now'
    const pv = validatePin(passwordForm.newPassword)
    if (!pv.isValid) errs.newPassword = pv.message
    else if (passwordForm.newPassword !== passwordForm.confirmPassword) errs.confirmPassword = 'This does not match the new PIN'
    if (Object.keys(errs).length) { failSection(errs); return }
    setSectionSaving(true)
    try {
      await updateUser(user.id, { password: passwordForm.newPassword, currentPassword: passwordForm.currentPassword })
      setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' })
      setEditing(null)
      toast.success('Your PIN has been changed', { detail: 'Use the new one next time you sign in.' })
    } catch {
      // The one failure here that is really about a single box.
      failSection({ currentPassword: 'That is not your current PIN' })
    } finally {
      setSectionSaving(false)
    }
  }

  const failUser = (errs) => {
    setUserErrors(errs)
    setAttempt(n => n + 1)
    requestAnimationFrame(() => document.querySelector('.smodal [aria-invalid="true"]')?.focus())
  }

  const openAddUser = () => {
    setNewUserForm({ username: '', password: '', confirmPassword: '', role: 'Cashier' })
    setUserErrors({})
    setShowNewUserForm(true)
  }

  const handleAddUser = async (e) => {
    e.preventDefault()
    const errs = {}
    const name = newUserForm.username.trim()
    if (!name) errs.username = 'Give them a name to sign in with'
    else if (users.some(u => u.username.toLowerCase() === name.toLowerCase())) errs.username = 'Someone already uses that name'
    const pv = validatePin(newUserForm.password)
    if (!pv.isValid) errs.password = pv.message
    else if (newUserForm.password !== newUserForm.confirmPassword) errs.confirmPassword = 'This does not match the PIN'
    if (Object.keys(errs).length) { failUser(errs); return }
    try {
      await addUser({ username: name, password: newUserForm.password, role: newUserForm.role, created_by: user.username })
      setNewUserForm({ username: '', password: '', confirmPassword: '', role: 'Cashier' })
      setShowNewUserForm(false)
      loadUsers()
      toast.success(`${name} can now sign in`, { detail: `Added as ${newUserForm.role}` })
    } catch {
      failUser({ username: 'Could not add them — that name may already be taken' })
    }
  }

  const handleResetPassword = async (e) => {
    e.preventDefault()
    const errs = {}
    const pv = validatePin(resetPasswordForm.newPassword)
    if (!pv.isValid) errs.newPassword = pv.message
    else if (resetPasswordForm.newPassword !== resetPasswordForm.confirmPassword) errs.confirmPassword = 'This does not match the new PIN'
    if (Object.keys(errs).length) { failUser(errs); return }
    const who = users.find(u => u.id === resetPasswordUserId)?.username || 'Their'
    try {
      await updateUser(resetPasswordUserId, { password: resetPasswordForm.newPassword })
      setResetPasswordUserId(null)
      setResetPasswordForm({ newPassword: '', confirmPassword: '' })
      loadUsers()
      toast.success(`${who}'s PIN has been reset`, { detail: 'Tell them the new one in person.' })
    } catch {
      toast.error('Could not reset that PIN')
    }
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
    try {
      const result = await window.stocka.printer.scan()
      if (result.success) {
        setAvailablePrinters(result.printers)
        if (result.printers.length === 0) flash('error', 'No printers found. Check that your printer is connected and powered on.')
        else toast.info(`Found ${result.printers.length} printer${result.printers.length === 1 ? '' : 's'}`, { detail: 'Pick yours from the list.' })
      } else flash('error', result.error || 'Failed to scan for printers')
    } catch (err) { flash('error', 'Printer scan failed: ' + err.message) }
    finally { setScanningPrinters(false) }
  }

  const handleTestPrint = async () => {
    if (!canUseNativePrinter()) { flash('error', 'Printer test only available in desktop app'); return }
    if (!formData.printer_name?.trim()) { flash('error', 'Select a printer first'); return }
    setTestingPrinter(true)
    try {
      const result = await window.stocka.printer.testByName(formData.printer_name)
      if (result.success) toast.success('Test receipt sent', { detail: `Check ${formData.printer_name} for a printed page.` })
      else flash('error', `Test print failed: ${result.error || 'Unknown error'}`)
    } catch (err) { flash('error', 'Test print failed: ' + err.message) }
    finally { setTestingPrinter(false) }
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

  // ── License reveal ───────────────────────────────────
  const handleRevealLicense = async (e) => {
    e.preventDefault()
    setLicenseRevealError('')
    const result = await window.stocka.license.getRaw({ username: user.username, pin: licensePin })
    if (!result.success) {
      setLicenseRevealError(result.error || 'Incorrect PIN')
      setLicensePin('')
      return
    }
    setLicenseKey(result.key)
    setLicenseReveal('revealed')
    setLicensePin('')
    setLicenseCountdown(30)
  }

  useEffect(() => {
    if (licenseReveal !== 'revealed') return
    const interval = setInterval(() => {
      setLicenseCountdown(c => {
        if (c <= 1) { setLicenseReveal('hidden'); setLicenseKey(''); return 30 }
        return c - 1
      })
    }, 1000)
    return () => clearInterval(interval)
  }, [licenseReveal])

  // ── Nav items ─────────────────────────────────────────
  const navItems = [
    { id: 'shop',     label: 'Shop Details',   Icon: FiShoppingBag, group: 'STORE',      show: !isCashier },
    { id: 'printer',  label: 'Printer',         Icon: FiPrinter,     group: 'STORE',      show: true },
    { id: 'receipt',  label: 'Receipt',         Icon: FiFileText,    group: 'STORE',      show: !isCashier },
    { id: 'users',    label: 'Team & Users',   Icon: FiUsers,        group: 'STAFF',      show: isAdmin },
    { id: 'privileges', label: 'Role Privileges', Icon: FiKey,       group: 'STAFF',      show: isAdmin },
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
                onClick={() => goToTab(item.id)}
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
            <SettingsSection
              icon={<FiShoppingBag size={17} />}
              title="Shop Details"
              desc="Your business identity, printed on receipts and reports."
              sectionKey="shop" editing={editing}
              onEdit={startEdit} onCancel={cancelEdit} onSubmit={saveSection('shop')} saving={sectionSaving}
            >
              {(isEditing) => isEditing ? (
                <>
                  <div className="fl-row">
                    <Field label="Shop name" required autoFocus
                      value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })}
                      error={secErrors.name} shakeKey={attempt} placeholder="e.g. Blessed Stores" />
                    <Field as="select" label="Currency"
                      value={formData.currency} onChange={e => setFormData({ ...formData, currency: e.target.value })}>
                      {Object.entries(CURRENCY_NAMES).map(([code, label]) => <option key={code} value={code}>{label}</option>)}
                    </Field>
                  </div>
                  <div className="fl-row">
                    <Field label="Email" type="email"
                      value={formData.email} onChange={e => setFormData({ ...formData, email: e.target.value })}
                      placeholder="shop@example.com" />
                    <Field label="Phone" type="tel"
                      value={formData.phone} onChange={e => setFormData({ ...formData, phone: e.target.value })}
                      placeholder="+263 77 123 4567" />
                  </div>
                  <Field as="textarea" label="Address" rows={2}
                    value={formData.address} onChange={e => setFormData({ ...formData, address: e.target.value })}
                    placeholder="Street, city" />
                </>
              ) : (
                <>
                  <InfoRow label="Shop name" value={formData.name} />
                  <InfoRow label="Currency" value={CURRENCY_NAMES[formData.currency] || formData.currency} />
                  <InfoRow label="Email" value={formData.email} />
                  <InfoRow label="Phone" value={formData.phone} />
                  <InfoRow label="Address" value={formData.address} />
                </>
              )}
            </SettingsSection>
          )}

          {/* ── USERS ── */}
          {activeTab === 'users' && isAdmin && (
            <div className="s-card">
              <div className="s-card-head">
                <div>
                  <h2 className="s-card-title"><FiUsers size={17} /> Team & Users</h2>
                  <p className="s-card-desc">The people who can sign in to Stocka, and what they can do.</p>
                </div>
                <button className="ss-edit-btn" onClick={openAddUser}>
                  <FiUserPlus size={13} /> Add User
                </button>
              </div>

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
                            onClick={() => { setUserErrors({}); setResetPasswordUserId(u.id); setResetPasswordForm({ newPassword: '', confirmPassword: '' }) }}>
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
            </div>
          )}

          {/* Add a person — a dialog, not a form that opens above the table. */}
          <Modal
            open={showNewUserForm}
            size="medium"
            title="Add a Staff Member"
            subtitle="They sign in with this name and a 4-digit PIN. Tell them the PIN in person."
            onClose={() => setShowNewUserForm(false)}
            footer={
              <>
                <button type="button" className="smodal-btn-away" onClick={() => setShowNewUserForm(false)}>Cancel</button>
                <button type="submit" form="add-user-form" className="smodal-btn-primary">
                  <FiUserPlus size={14} /> Add Staff Member
                </button>
              </>
            }
          >
            <form id="add-user-form" className="fl-stack" onSubmit={handleAddUser} noValidate>
              <div className="fl-row">
                <Field label="Name they sign in with" required autoFocus
                  value={newUserForm.username}
                  onChange={e => { setNewUserForm({ ...newUserForm, username: e.target.value }); setUserErrors(x => ({ ...x, username: null })) }}
                  error={userErrors.username} shakeKey={attempt} placeholder="e.g. Tendai" />
                <Field as="select" label="Role"
                  value={newUserForm.role} onChange={e => setNewUserForm({ ...newUserForm, role: e.target.value })}
                  hint={ROLE_HINTS[newUserForm.role]}>
                  <option value="Cashier">Cashier</option>
                  <option value="Manager">Manager</option>
                  <option value="Admin">Admin</option>
                </Field>
              </div>
              <div className="fl-row">
                <Field label="PIN" required type="password" inputMode="numeric" maxLength={4} autoComplete="new-password"
                  value={newUserForm.password}
                  onChange={e => { setNewUserForm({ ...newUserForm, password: e.target.value.replace(/\D/g, '').slice(0, 4) }); setUserErrors(x => ({ ...x, password: null })) }}
                  error={userErrors.password} shakeKey={attempt} hint="4 digits" />
                <Field label="Type the PIN again" required type="password" inputMode="numeric" maxLength={4} autoComplete="new-password"
                  value={newUserForm.confirmPassword}
                  onChange={e => { setNewUserForm({ ...newUserForm, confirmPassword: e.target.value.replace(/\D/g, '').slice(0, 4) }); setUserErrors(x => ({ ...x, confirmPassword: null })) }}
                  error={userErrors.confirmPassword} shakeKey={attempt} />
              </div>
            </form>
          </Modal>

          {/* Reset a PIN — opens over the table, next to the person it is for, instead
              of appearing under the whole table away from the row that asked. */}
          <Modal
            open={Boolean(resetPasswordUserId)}
            size="small"
            title={`Reset ${users.find(u => u.id === resetPasswordUserId)?.username || ''}'s PIN`}
            subtitle="Choose a new 4-digit PIN and tell them in person."
            onClose={() => setResetPasswordUserId(null)}
            footer={
              <>
                <button type="button" className="smodal-btn-away" onClick={() => setResetPasswordUserId(null)}>Cancel</button>
                <button type="submit" form="reset-pin-form" className="smodal-btn-primary">Save New PIN</button>
              </>
            }
          >
            <form id="reset-pin-form" className="fl-stack" onSubmit={handleResetPassword} noValidate>
              <Field label="New PIN" required type="password" inputMode="numeric" maxLength={4} autoFocus autoComplete="new-password"
                value={resetPasswordForm.newPassword}
                onChange={e => { setResetPasswordForm({ ...resetPasswordForm, newPassword: e.target.value.replace(/\D/g, '').slice(0, 4) }); setUserErrors(x => ({ ...x, newPassword: null })) }}
                error={userErrors.newPassword} shakeKey={attempt} hint="4 digits" />
              <Field label="Type it again" required type="password" inputMode="numeric" maxLength={4} autoComplete="new-password"
                value={resetPasswordForm.confirmPassword}
                onChange={e => { setResetPasswordForm({ ...resetPasswordForm, confirmPassword: e.target.value.replace(/\D/g, '').slice(0, 4) }); setUserErrors(x => ({ ...x, confirmPassword: null })) }}
                error={userErrors.confirmPassword} shakeKey={attempt} />
            </form>
          </Modal>

          {/* ── ROLE PRIVILEGES ── */}
          {activeTab === 'privileges' && isAdmin && (
            <SettingsSection
              icon={<FiKey size={17} />}
              title="Role Privileges"
              desc="Which pages each role can open. Admins can always open everything."
              sectionKey="privileges" editing={editing}
              onEdit={startEdit} onCancel={cancelEdit} onSubmit={handleSavePrivileges} saving={sectionSaving}
              saveLabel="Save privileges"
            >
              {(isEditing) => (
                <>
                  <div className="s-role-pills">
                    {CONFIGURABLE_ROLES.map(role => (
                      <button key={role} type="button"
                        className={`s-role-pill ${privRole === role ? 'active' : ''}`}
                        onClick={() => setPrivRole(role)}>
                        {role}
                      </button>
                    ))}
                  </div>

                  {NAV_GROUPS.map(group => {
                    const items = NAV_PRIVILEGES.filter(n => n.group === group)
                    if (items.length === 0) return null
                    return (
                      <div key={group}>
                        <div className="s-priv-group">{group}</div>
                        {isEditing ? items.map(item => {
                          const visible = canRoleAccessNav(privRole, item.id, rolePrivs)
                          return (
                            <div key={item.id}
                              className={`s-toggle-row s-priv-row ${item.locked ? 's-toggle-row--locked' : ''}`}
                              onClick={() => !item.locked && togglePrivilege(item.id)}>
                              <div className="s-toggle-info">
                                <div className="s-toggle-label">{item.label}</div>
                                {item.locked && <div className="s-toggle-sub">Always available to every role</div>}
                              </div>
                              <label className="s-switch" onClick={e => e.stopPropagation()}>
                                <input type="checkbox" checked={visible} disabled={item.locked}
                                  onChange={() => togglePrivilege(item.id)} />
                                <span className="s-switch-track" />
                              </label>
                            </div>
                          )
                        }) : (
                          <div className="ss-chips">
                            {items.map(item => {
                              const visible = canRoleAccessNav(privRole, item.id, rolePrivs)
                              return (
                                <span key={item.id} className={`ss-chip${visible ? '' : ' is-off'}`}
                                  title={visible ? `${privRole} can open this` : `${privRole} cannot open this`}>
                                  {item.label}
                                </span>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </>
              )}
            </SettingsSection>
          )}

          {/* ── PRINTER ── */}
          {activeTab === 'printer' && (
            <SettingsSection
              icon={<FiPrinter size={17} />}
              title="Receipt Printer"
              desc="The printer on this computer. Each till keeps its own setting."
              sectionKey="printer" editing={editing}
              onEdit={startEdit} onCancel={cancelEdit} onSubmit={handleSavePrinter} saving={sectionSaving}
            >
              {(isEditing) => isEditing ? (
                <>
                  <div className="s-printer-input-row">
                    <Field label="Printer" className="s-printer-field"
                      value={formData.printer_name || ''}
                      onChange={e => setFormData({ ...formData, printer_name: e.target.value })}
                      placeholder="Press Find Printers, or type its name" />
                    <button type="button" className="smodal-btn" onClick={handleScanPrinters} disabled={scanningPrinters}>
                      <FiRefreshCw size={13} className={scanningPrinters ? 'spin' : ''} />
                      {scanningPrinters ? 'Looking...' : 'Find Printers'}
                    </button>
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

                  <div className="s-toggle-row"
                    onClick={() => setFormData({ ...formData, auto_print: formData.auto_print === 1 ? 0 : 1 })}>
                    <div className="s-toggle-info">
                      <div className="s-toggle-label">Print a receipt after every sale</div>
                      <div className="s-toggle-sub">Otherwise the cashier prints one only when asked</div>
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
                      <div className="s-toggle-label">Print a second copy</div>
                      <div className="s-toggle-sub">One for the customer, one for your records</div>
                    </div>
                    <label className="s-switch" onClick={e => e.stopPropagation()}>
                      <input type="checkbox" checked={formData.print_duplicate === 1}
                        onChange={e => setFormData({ ...formData, print_duplicate: e.target.checked ? 1 : 0 })} />
                      <span className="s-switch-track" />
                    </label>
                  </div>
                </>
              ) : (
                <>
                  <InfoRow label="Printer" value={formData.printer_name} placeholder="None chosen yet" />
                  <InfoRow label="Print after every sale" value={formData.auto_print === 1 ? 'On' : 'Off'} />
                  <InfoRow label="Second copy" value={formData.print_duplicate === 1 ? 'On' : 'Off'} />
                  {/* Testing changes nothing, so it does not need Edit first. */}
                  <div className="ss-inline-action">
                    <button type="button" className="smodal-btn"
                      onClick={handleTestPrint} disabled={testingPrinter || !formData.printer_name}>
                      <FiZap size={13} /> {testingPrinter ? 'Printing...' : 'Print a Test Receipt'}
                    </button>
                  </div>
                </>
              )}
            </SettingsSection>
          )}

          {/* ── RECEIPT ── */}
          {activeTab === 'receipt' && !isCashier && (
            <SettingsSection
              icon={<FiFileText size={17} />}
              title="Receipt"
              desc="What customers see on their printed receipt."
              sectionKey="receipt" editing={editing}
              onEdit={startEdit} onCancel={cancelEdit} onSubmit={saveSection('receipt')} saving={sectionSaving}
            >
              {(isEditing) => isEditing ? (
                <>
                  <div className="s-field">
                    <label className="s-label">Paper roll width</label>
                    <div className="s-radio-group s-radio-group--mt">
                      {RECEIPT_WIDTHS.map(opt => (
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
                    <p className="s-hint">Match the roll in your printer, or lines split in half.</p>
                  </div>

                  <div className="s-field">
                    <label className="s-label">Shop name size</label>
                    <div className="s-radio-group s-radio-group--mt">
                      {RECEIPT_NAME_SIZES.map(opt => (
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
                  </div>

                  <Field as="textarea" label="Message at the bottom" rows={3}
                    value={formData.receipt_footer}
                    onChange={e => setFormData({ ...formData, receipt_footer: e.target.value })}
                    placeholder="e.g. Thank you! WhatsApp: +263 77 123 4567"
                    hint="A thank-you, your WhatsApp number, or your returns policy." />
                </>
              ) : (
                <>
                  <InfoRow label="Paper roll" value={RECEIPT_WIDTHS.find(o => o.value === Number(formData.receipt_width_mm))?.title} />
                  <InfoRow label="Shop name size" value={RECEIPT_NAME_SIZES.find(o => o.value === formData.receipt_name_size)?.title} />
                  <InfoRow label="Message at the bottom" value={formData.receipt_footer} placeholder="None" />
                </>
              )}
            </SettingsSection>
          )}

          {/* ── SECURITY ── */}
          {/* A PIN is a secret, so there is nothing to "view" — the section offers to
              change it, and the form exists only while you are doing that. */}
          {activeTab === 'password' && (
            <SettingsSection
              icon={<FiShield size={17} />}
              title="Your PIN"
              desc="The 4 digits you sign in with."
              sectionKey="password" editing={editing}
              onEdit={startEdit} onCancel={cancelEdit} onSubmit={handleChangePassword} saving={sectionSaving}
              editLabel="Change PIN" saveLabel="Change PIN"
            >
              {(isEditing) => isEditing ? (
                <div className="ss-narrow">
                  <Field label="Current PIN" required type="password" inputMode="numeric" maxLength={4} autoFocus autoComplete="current-password"
                    value={passwordForm.currentPassword}
                    onChange={e => { setPasswordForm({ ...passwordForm, currentPassword: e.target.value.replace(/\D/g, '').slice(0, 4) }); setSecErrors(x => ({ ...x, currentPassword: null })) }}
                    error={secErrors.currentPassword} shakeKey={attempt} />
                  <Field label="New PIN" required type="password" inputMode="numeric" maxLength={4} autoComplete="new-password"
                    value={passwordForm.newPassword}
                    onChange={e => { setPasswordForm({ ...passwordForm, newPassword: e.target.value.replace(/\D/g, '').slice(0, 4) }); setSecErrors(x => ({ ...x, newPassword: null })) }}
                    error={secErrors.newPassword} shakeKey={attempt} hint="4 digits" />
                  <Field label="Type the new PIN again" required type="password" inputMode="numeric" maxLength={4} autoComplete="new-password"
                    value={passwordForm.confirmPassword}
                    onChange={e => { setPasswordForm({ ...passwordForm, confirmPassword: e.target.value.replace(/\D/g, '').slice(0, 4) }); setSecErrors(x => ({ ...x, confirmPassword: null })) }}
                    error={secErrors.confirmPassword} shakeKey={attempt} />
                </div>
              ) : (
                <InfoRow label="Signed in as" value={user?.username} hint="Your PIN is never shown." />
              )}
            </SettingsSection>
          )}

          {/* ── BUSINESS RULES ── */}
          {activeTab === 'business' && isAdmin && (
            <SettingsSection
              icon={<FiSliders size={17} />}
              title="Business Rules"
              desc="Tax, low-stock warnings, and how much a till may be out before it is flagged."
              sectionKey="business" editing={editing}
              onEdit={startEdit} onCancel={cancelEdit} onSubmit={saveSection('business')} saving={sectionSaving}
            >
              {(isEditing) => isEditing ? (
                <>
                  <div className="fl-row-3">
                    <Field label="VAT rate" suffix="%" type="number" min="0" max="100" step="0.5" autoFocus
                      value={formData.vat_rate}
                      onChange={e => setFormData({ ...formData, vat_rate: e.target.value })}
                      error={secErrors.vat_rate} shakeKey={attempt}
                      hint="0 turns it off. Zimbabwe VAT is 15%." />
                    <Field label="Default reorder level" type="number" min="1" step="1"
                      value={formData.default_reorder_level}
                      onChange={e => setFormData({ ...formData, default_reorder_level: e.target.value })}
                      error={secErrors.default_reorder_level} shakeKey={attempt}
                      hint="For new products. Each can be changed." />
                    <Field label="Till allowed out by" prefix="$" type="number" min="0" step="0.01"
                      value={formData.variance_tolerance}
                      onChange={e => setFormData({ ...formData, variance_tolerance: e.target.value })}
                      error={secErrors.variance_tolerance} shakeKey={attempt}
                      hint="More than this and the shift is flagged." />
                  </div>

                  <div className="s-toggle-row"
                    onClick={() => setFormData({ ...formData, allow_admin_sales: formData.allow_admin_sales === 1 ? 0 : 1 })}>
                    <div className="s-toggle-info">
                      <div className="s-toggle-label">Let admins make sales</div>
                      <div className="s-toggle-sub">Off by default, so admins manage and cashiers sell. Applies on every till.</div>
                    </div>
                    <label className="s-switch" onClick={e => e.stopPropagation()}>
                      <input type="checkbox" checked={formData.allow_admin_sales === 1}
                        onChange={e => setFormData({ ...formData, allow_admin_sales: e.target.checked ? 1 : 0 })} />
                      <span className="s-switch-track" />
                    </label>
                  </div>
                </>
              ) : (
                <>
                  <InfoRow label="VAT rate" value={Number(formData.vat_rate) > 0 ? `${formData.vat_rate}%` : 'Off'} />
                  <InfoRow label="Default reorder level" value={`${formData.default_reorder_level} units`} />
                  <InfoRow label="Till allowed out by" value={`$${Number(formData.variance_tolerance || 0).toFixed(2)}`} />
                  <InfoRow label="Admins can make sales" value={formData.allow_admin_sales === 1 ? 'Yes' : 'No'} />
                </>
              )}
            </SettingsSection>
          )}

          {/* Leaving a tab while a section is open for editing. */}
          {pendingTab && (
            <ConfirmModal
              message="Discard your changes?"
              detail="You were part-way through editing. Leaving now puts everything back the way it was saved."
              confirmLabel="Discard changes"
              cancelLabel="Keep editing"
              danger
              onConfirm={() => { cancelEdit(); setActiveTab(pendingTab); setPendingTab(null) }}
              onCancel={() => setPendingTab(null)}
            />
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
                <>
                  <div className="s-info-row s-license-row">
                    <span className="s-info-label"><FiKey size={13} style={{ marginRight: 5, verticalAlign: 'middle' }} />License Key</span>
                    <div className="s-license-reveal-area">
                      {licenseReveal === 'hidden' && (
                        <>
                          <code className="s-code s-code-masked">••••-••••-••••-••••</code>
                          <button
                            className="s-btn-secondary s-btn-sm"
                            onClick={() => { setLicenseReveal('pin'); setLicenseRevealError('') }}
                          >
                            <FiEye size={12} /> Reveal
                          </button>
                        </>
                      )}
                      {licenseReveal === 'pin' && (
                        <form onSubmit={handleRevealLicense} className="s-license-pin-form">
                          <input
                            className="s-input s-input-sm"
                            type="password"
                            inputMode="numeric"
                            maxLength={4}
                            autoFocus
                            placeholder="Admin PIN"
                            value={licensePin}
                            onChange={e => { setLicensePin(e.target.value.replace(/\D/g, '').slice(0, 4)); setLicenseRevealError('') }}
                          />
                          <button type="submit" className="s-btn-primary s-btn-sm" disabled={licensePin.length !== 4}>
                            <FiLock size={12} /> Confirm
                          </button>
                          <button type="button" className="s-btn-secondary s-btn-sm"
                            onClick={() => { setLicenseReveal('hidden'); setLicensePin(''); setLicenseRevealError('') }}>
                            <FiX size={12} /> Cancel
                          </button>
                          {licenseRevealError && <span className="s-license-error">{licenseRevealError}</span>}
                        </form>
                      )}
                      {licenseReveal === 'revealed' && (
                        <>
                          <code className="s-code">{licenseKey}</code>
                          <button className="s-btn-secondary s-btn-sm"
                            onClick={() => { navigator.clipboard.writeText(licenseKey); flash('success', 'License key copied to clipboard') }}>
                            <FiCopy size={12} /> Copy
                          </button>
                          <button className="s-btn-secondary s-btn-sm"
                            onClick={() => { setLicenseReveal('hidden'); setLicenseKey('') }}>
                            <FiEyeOff size={12} /> Hide
                          </button>
                          <span className="s-license-countdown">Hides in {licenseCountdown}s</span>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="s-update-row">
                    <button className="s-btn-secondary" onClick={handleCheckUpdates} disabled={checkingUpdate}>
                      <FiRefreshCw size={13} className={checkingUpdate ? 'spin' : ''} />
                      {checkingUpdate ? 'Checking…' : 'Check for Updates'}
                    </button>
                    {updateStatus && <span className="s-update-status">{updateStatus}</span>}
                  </div>
                </>
              )}
            </div>
          )}

          {/* ── BACKUPS ──
              Lives in its own component: it owns a fair amount of state, and
              Settings was already long enough without it. */}
          {activeTab === 'backup' && isAdmin && <BackupsPanel flash={flash} refreshToken={backupsRefresh} />}

          {/* ── DANGER ZONE: test-data reset (inside Backup tab) ── */}
          {activeTab === 'backup' && isAdmin && (
            <div className="s-card" style={{ border: '1px solid #fecaca', marginTop: 16 }}>
              <div className="s-card-head">
                <div>
                  <h2 className="s-card-title" style={{ color: '#dc2626' }}>
                    <FiAlertCircle size={17} /> Danger Zone — Reset Transaction Data
                  </h2>
                  <p className="s-card-desc">
                    Start over with a clean slate. This permanently deletes all <strong>sales, shifts,
                    end-of-day records, stock receiving history, stock movements, expenses, notifications
                    and activity logs</strong>. Your <strong>products (with current stock levels), users,
                    suppliers, branches and shop settings are kept</strong>. A database backup is created
                    automatically before anything is deleted.
                  </p>
                </div>
              </div>

              <div className="s-grid-3" style={{ alignItems: 'end' }}>
                <div className="s-field">
                  <label className="s-label">Type RESET to confirm</label>
                  <input className="s-input" type="text" placeholder="RESET"
                    value={resetConfirmText}
                    onChange={e => setResetConfirmText(e.target.value)}
                    disabled={resetting} />
                </div>
                <div className="s-field">
                  <label className="s-label">Your Admin PIN</label>
                  <input className="s-input" type="password" placeholder="••••" maxLength={4}
                    value={resetPin}
                    onChange={e => setResetPin(e.target.value)}
                    disabled={resetting} />
                </div>
                <div className="s-field">
                  <button
                    className="s-btn-danger"
                    onClick={handleResetTransactions}
                    disabled={resetting || resetConfirmText.trim().toUpperCase() !== 'RESET' || !resetPin}
                    style={{ width: '100%' }}
                  >
                    {resetting ? 'Resetting…' : 'Reset Transaction Data'}
                  </button>
                </div>
              </div>

              {resetResult && (
                <p className="s-hint" style={{ marginTop: 10 }}>
                  Removed {resetResult.totalRemoved} records. A pre-reset backup
                  (<code className="s-code">{resetResult.backupFilename}</code>) is in your backups list above —
                  restore it if this was a mistake.
                </p>
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
