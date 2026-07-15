import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/useAuthStore'
import { useShiftStore } from '../store/useShiftStore'
import './Dashboard.css'
import fullLogo from '../assets/full_logo.png'
import iconLogo from '../assets/icon.png'
import Products from './Products'
import StockControl from './StockControl'
import CurrentInventory from './CurrentInventory'
import InventoryReconciliation from './InventoryReconciliation'
import Suppliers from './Suppliers'
import Sales from './Sales'
import Expenses from './Expenses'
import EndOfDay from './EndOfDay'
import Reports from './Reports'
import Settings from './Settings'
import ShiftDashboard from './ShiftDashboard'
import CashierSessions from './CashierSessions'
import RestockNeeded from './RestockNeeded'
import DeadStock from './DeadStock'
import ExpiryTracking from './ExpiryTracking'
import ActivityLogs from './ActivityLogs'
import MyTransactions from './MyTransactions'
import Notifications from '../components/Notifications'
import LanStatusBar from '../components/LanStatusBar'
import { getSales, getExpenses, getProducts, getActiveShifts, closeShift, getCurrentShift, startShift, getShop, logAuditAction, getShiftSummary, getDailyRevenue, getDailyCOGS } from '../database/db'
import { useLanSync } from '../hooks/useLanSync'
import { isToday, todayCompletedSales, localDateStr, formatDbTime } from '../utils/salesDay'
import { parseRolePrivileges, canRoleAccessNav } from '../utils/rolePrivileges'
import ClosingFloatModal from '../components/ClosingFloatModal'
import OpeningFloatModal from '../components/OpeningFloatModal'
import ShiftForceClosedModal from '../components/ShiftForceClosedModal'
import EodClosedModal from '../components/EodClosedModal'
import SignOutModal from '../components/SignOutModal'
import { useShiftGuard } from '../hooks/useShiftGuard'

import {
  FiHome,
  FiPackage,
  FiTrendingDown,
  FiTruck,
  FiShoppingCart,
  FiCreditCard,
  FiClock,
  FiSettings,
  FiDollarSign,
  FiAlertTriangle,
  FiBarChart2,
  FiPlus,
  FiDownload,
  FiLogOut,
  FiMenu,
  FiTrendingUp,
  FiCalendar,
  FiArrowRight,
  FiUsers,
  FiList,
  FiFileText,
  FiX
} from 'react-icons/fi'


function Dashboard() {
  const navigate = useNavigate()
  const { user, logout } = useAuthStore()
  const { currentShift, setCurrentShift, clearShift } = useShiftStore()
  const [activePage, setActivePage] = useState('dashboard')
  const [dashboardStats, setDashboardStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [sidebarExpanded, setSidebarExpanded] = useState(false)
  const [shopSettings, setShopSettings] = useState(null)
  const [activeCashiers, setActiveCashiers] = useState([])
  const [activeCashiersLoading, setActiveCashiersLoading] = useState(false)
  const [showSignOutModal, setShowSignOutModal] = useState(false)

  // App update state
  const [updateInfo, setUpdateInfo] = useState(null)   // { version, releaseCount }
  const [updateDownloading, setUpdateDownloading] = useState(false)
  const [updateProgress, setUpdateProgress] = useState(0)
  const [updateReady, setUpdateReady] = useState(false)

  useEffect(() => {
    if (!window.stocka?.updater) return

    window.stocka.updater.onUpdateAvailable((info) => setUpdateInfo(info))
    window.stocka.updater.onDownloadProgress(({ percent }) => {
      setUpdateDownloading(true)
      setUpdateProgress(percent)
    })
    window.stocka.updater.onUpdateDownloaded(() => {
      setUpdateDownloading(false)
      setUpdateReady(true)
    })

    // When the device comes back online, re-check for updates
    const handleOnline = () => {
      if (!updateInfo && !updateReady) {
        window.stocka.updater.checkNow()
      }
    }
    window.addEventListener('online', handleOnline)
    return () => window.removeEventListener('online', handleOnline)
  }, [])

  // LAN sync failure banner
  const [lanSyncFailures, setLanSyncFailures] = useState([])

  useEffect(() => {
    const lan = window.stocka?.lan
    if (!lan?.onSyncFailures) return
    const off = lan.onSyncFailures((failures) => {
      if (failures?.length > 0) setLanSyncFailures(f => [...failures, ...f].slice(0, 10))
    })
    return () => off?.()
  }, [])

  // Shift UI state
  const [showClosingFloatModal, setShowClosingFloatModal] = useState(false)
  const [closingShiftData, setClosingShiftData] = useState(null)
  const [isClosingShift, setIsClosingShift] = useState(false)
  const [showOpeningFloatModal, setShowOpeningFloatModal] = useState(false)
  const [isStartingShift, setIsStartingShift] = useState(false)
  // Why the shift is being closed: 'closeOnly' keeps the user logged in (e.g. an
  // admin cashing up their own drawer); 'signout' logs them out afterwards.
  const [closeShiftIntent, setCloseShiftIntent] = useState('closeOnly')

  const { shiftForceClosed } = useShiftGuard()

  const [eodClosed, setEodClosed] = useState(null) // { date, closedBy } or null

  useEffect(() => {
    const lan = window.stocka?.lan
    if (!lan?.onEodClosed) return
    // Admin/Manager is the one closing the day — never show them this modal
    if (user?.role === 'Admin' || user?.role === 'Manager') return
    const off = lan.onEodClosed((data) => setEodClosed(data))
    return () => off?.()
  }, [user?.role])

  const loadCurrentShift = async () => {
    try {
      const shift = await getCurrentShift(user?.username)
      setCurrentShift(shift)
      // No forced opening-float modal here — the prompt appears when the user
      // opens the Sales page (see the activePage effect below) and is cancellable.
    } catch (err) {
      console.error('Failed to load shift:', err)
    }
  }

  // Prompt for an opening float when entering Sales without an open shift.
  // Cancelling leaves Sales in a browse-only "shift not started" state.
  useEffect(() => {
    if (activePage === 'sales' && !currentShift) setShowOpeningFloatModal(true)
  }, [activePage])

  // Refetch on page change too, so toggling a setting (e.g. admin sales) applies
  // as soon as the user navigates back — not only after an app restart.
  useEffect(() => {
    getShop().then(s => setShopSettings(s)).catch(() => {})
  }, [activePage])

  // Admins may only sell when the shop-level toggle allows it (Settings → Business Rules)
  const adminCanSell = user?.role !== 'Admin' || !!shopSettings?.allow_admin_sales

  // If the admin revokes the tab this user is sitting on, send them home
  useEffect(() => {
    if (!shopSettings) return
    const privs = parseRolePrivileges(shopSettings.role_privileges)
    if (!canRoleAccessNav(user?.role || 'Cashier', activePage, privs)) setActivePage('dashboard')
  }, [shopSettings, activePage])


  const handleOpeningFloatSubmit = async (floatData) => {
    setIsStartingShift(true)
    try {
      const shift = await startShift(user, floatData)
      if (shift?.__queued) {
        // Main couldn't be reached at this exact moment — the real shift-start is
        // safely queued and will land once reconnected, but it has no id yet.
        // Storing that raw placeholder used to be the bug: every sale made before
        // it resolved silently wrote shift_id: null and became invisible to Shift
        // Management / End of Day forever. Instead we mark a PROVISIONAL shift —
        // selling still works immediately, but shift_id honestly stays null until
        // useShiftGuard confirms the real shift and reconciles anything made in
        // the gap (see useShiftGuard.js).
        setCurrentShift({
          __provisional: true,
          id: null,
          cashier_username: user.username,
          cashier_display_name: user.name || user.username,
          opening_cash: (typeof floatData === 'object' ? floatData.opening_cash : floatData) || 0,
          started_at: new Date().toISOString(),
          status: 'open',
        })
      } else {
        setCurrentShift(shift)
      }
      setShowOpeningFloatModal(false)
    } catch (err) {
      console.error('Failed to start shift:', err)
    } finally {
      setIsStartingShift(false)
    }
  }


  const handleCloseShiftClick = async (intent = 'closeOnly') => {
    if (!currentShift) return
    setCloseShiftIntent(intent)
    // Fetch the real sales/expenses totals from the DB so the closing modal
    // shows the correct expected cash (opening float + actual sales − expenses).
    // The shifts.total_sales_value column is never incremented after sales, so
    // we always query getShiftSummary instead of relying on that stale column.
    let enriched = currentShift
    try {
      const summary = await getShiftSummary(currentShift.id)
      enriched = {
        ...currentShift,
        total_sales:       summary.total_sales,
        cash_sales:        summary.cash_sales,
        transfer_sales:    summary.transfer_sales,
        total_expenses:    summary.total_expenses,
        expected_cash:     summary.expected_cash,
        expected_transfer: summary.expected_transfer,
      }
    } catch { /* fall back to raw shift if summary fails */ }
    setClosingShiftData(enriched)
    setShowClosingFloatModal(true)
  }

  const handleClosingFloatSubmit = async (closingFloat, notes) => {
    setIsClosingShift(true)
    try {
      await closeShift(currentShift.id, closingFloat, notes)
      setShowClosingFloatModal(false)
      setClosingShiftData(null)
      clearShift()
      if (closeShiftIntent === 'signout') {
        logout()
        navigate('/login', { replace: true })
      } else {
        // Closing your own drawer is not signing out — admins keep working.
        setIsClosingShift(false)
        loadDashboardData()
      }
    } catch (err) {
      console.error('Failed to close shift:', err)
      setIsClosingShift(false)
    }
  }

  const handleClosingFloatCancel = () => {
    setClosingShiftData(null)
    setShowClosingFloatModal(false)
  }

  const performLogout = async () => {
    // "Sign Out Only" deliberately leaves any open shift untouched — the
    // SignOutModal promises "another admin can close it later", and the stale-shift
    // auto-close sweeps up anything forgotten overnight.
    try { await logAuditAction(user?.username || 'unknown', 'LOGOUT', 'USER', String(user?.id || ''), `${user?.role || ''} signed out`) } catch (_) {}

    // Clear all authentication and session data
    logout()
    clearShift()
    localStorage.removeItem('stocka_db_init')
    sessionStorage.clear()

    // Reset all state and navigate
    setActivePage('dashboard')
    setDashboardStats(null)
    setSidebarExpanded(false)
    
    // Navigate to login
    navigate('/login', { replace: true })
  }

  // Called from ShiftForceClosedModal — shift is already closed by admin, skip closeShift
  const forceLogout = async () => {
    try { await logAuditAction(user?.username || 'unknown', 'LOGOUT', 'USER', String(user?.id || ''), 'Force-logged out via End of Day') } catch (_) {}
    logout()
    clearShift()
    localStorage.removeItem('stocka_db_init')
    sessionStorage.clear()
    setActivePage('dashboard')
    setDashboardStats(null)
    navigate('/login', { replace: true })
  }

  // Check authentication on component mount
  useEffect(() => {
    if (!user?.id) {
      // User is not authenticated, redirect to login
      navigate('/login', { replace: true })
    }
  }, [navigate, user?.id])

  useEffect(() => {
    if (user?.id) {
      loadDashboardData()
      loadCurrentShift()
    }
  }, [user?.id])

  // Reload dashboard stats when any LAN machine changes data
  useLanSync(() => { if (user?.id) loadDashboardData() })

  const loadDashboardData = async () => {
    try {
      const [sales, expenses, products] = await Promise.all([
        getSales(),
        getExpenses(),
        getProducts()
      ])
      
      // Load active cashiers if user is admin or manager
      if (user?.role === 'Admin' || user?.role === 'Manager') {
        setActiveCashiersLoading(true)
        try {
          const shifts = await getActiveShifts()
          setActiveCashiers(shifts || [])
        } catch (err) {
          console.error('Failed to load active cashiers:', err)
          setActiveCashiers([])
        } finally {
          setActiveCashiersLoading(false)
        }
      }
      
      const todaysSales = todayCompletedSales(sales)
      const todaysExpenses = expenses.filter(e => isToday(e.date))

      // Gross profit so far today = completed revenue − cost of goods sold
      let grossProfit = null
      try {
        const day = localDateStr()
        const [rev, cogs] = await Promise.all([getDailyRevenue(day), getDailyCOGS(day)])
        grossProfit = (rev || 0) - (cogs || 0)
      } catch { /* leave null — card shows a dash */ }

      const lowStockItems = products.filter(p => p.current_quantity <= p.reorder_level)
      const stockValue = products.reduce((sum, p) => sum + ((p.current_quantity || 0) * (p.selling_price || 0)), 0)
      
      setDashboardStats({
        grossProfit,
        todaysSales: todaysSales.reduce((sum, s) => sum + (s.total || 0), 0),
        todaysSalesCount: todaysSales.length,
        totalProducts: products.length,
        lowStockCount: lowStockItems.length,
        stockValue: stockValue,
        todaysExpenses: todaysExpenses.reduce((sum, e) => sum + (e.amount || 0), 0),
        lowStockItems: lowStockItems,
        recentSales: todaysSales.reverse().slice(0, 5),
        totalCompletedSales: sales.filter(s => s.status === 'completed').length,
      })
    } catch (err) {
      console.error('Failed to load dashboard stats', err)
    } finally {
      setLoading(false)
    }
  }

  const navItems = [
    { id: 'dashboard',  icon: 'home',       label: 'Dashboard',       group: 'main' },
    { id: 'products',   icon: 'package',    label: 'Products',         group: 'stock' },
    { id: 'inventory',  icon: 'package',    label: 'Current Inventory', group: 'stock' },
    { id: 'reconciliation', icon: 'bar-chart-2', label: 'Reconciliation',   group: 'stock' },
    { id: 'stock',      icon: 'trending-down', label: 'Receive Stock',    group: 'stock' },
    { id: 'suppliers',  icon: 'truck',      label: 'Suppliers',        group: 'stock' },
    { id: 'restock',    icon: 'trending-up', label: 'Restock Needed',    group: 'stock' },
    { id: 'deadstock',  icon: 'trending-down', label: 'Dead Stock',       group: 'stock' },
    { id: 'my-transactions', icon: 'file-text', label: 'Transactions',   group: 'sales' },
    { id: 'expenses',   icon: 'credit-card', label: 'Expenses',         group: 'finance' },
    { id: 'reports',    icon: 'bar-chart-2', label: 'Reports',          group: 'finance' },
    { id: 'endofday',   icon: 'clock',      label: 'End of Day',       group: 'finance' },
    { id: 'shifts',     icon: 'clock',      label: 'Shift Management', group: 'finance' },
    { id: 'cashier-sessions',  icon: 'shopping-cart', label: 'Cashier Sessions', group: 'finance' },
    { id: 'expiry',       icon: 'calendar',   label: 'Expiry Tracking',  group: 'stock' },
    { id: 'activitylogs', icon: 'list',       label: 'Activity Logs',    group: 'ops' },
    { id: 'settings',   icon: 'settings',   label: 'Settings',         group: 'ops' },
  ]

  // Role defaults + admin overrides (Settings → Role Privileges) decide which
  // tabs this user sees — see src/utils/rolePrivileges.js
  const userRole = user?.role || 'Cashier'
  const rolePrivileges = parseRolePrivileges(shopSettings?.role_privileges)
  const filteredNavItems = navItems.filter(item => canRoleAccessNav(userRole, item.id, rolePrivileges))

  const groupLabels = {
    main:    '',
    stock:   'INVENTORY',
    sales:   'SALES',
    finance: 'FINANCE',
    ops:     'OPERATIONS',
  }


  // Function to render nav icons
  const renderNavIcon = (iconName) => {
    const iconProps = { size: 20 }
    switch (iconName) {
      case 'home': return <FiHome {...iconProps} />
      case 'package': return <FiPackage {...iconProps} />
      case 'trending-down': return <FiTrendingDown {...iconProps} />
      case 'trending-up': return <FiTrendingUp {...iconProps} />
      case 'truck': return <FiTruck {...iconProps} />
      case 'shopping-cart': return <FiShoppingCart {...iconProps} />
      case 'credit-card': return <FiCreditCard {...iconProps} />
      case 'bar-chart-2': return <FiBarChart2 {...iconProps} />
      case 'clock': return <FiClock {...iconProps} />
      case 'calendar': return <FiCalendar {...iconProps} />
      case 'settings': return <FiSettings {...iconProps} />
      case 'list': return <FiList {...iconProps} />
      case 'file-text': return <FiFileText {...iconProps} />
      default: return null
    }
  }

  // Function to render stat/action icons
  const renderIcon = (iconName, size = 24) => {
    const iconProps = { size }
    switch (iconName) {
      case 'dollar-sign': return <FiDollarSign {...iconProps} />
      case 'package': return <FiPackage {...iconProps} />
      case 'alert-triangle': return <FiAlertTriangle {...iconProps} />
      case 'bar-chart-2': return <FiBarChart2 {...iconProps} />
      case 'trending-down': return <FiTrendingDown {...iconProps} />
      case 'shopping-cart': return <FiShoppingCart {...iconProps} />
      case 'plus': return <FiPlus {...iconProps} />
      case 'download': return <FiDownload {...iconProps} />
      case 'credit-card': return <FiCreditCard {...iconProps} />
      case 'clock': return <FiClock {...iconProps} />
      default: return null
    }
  }

  const stats = dashboardStats ? [
    {
      icon: 'dollar-sign',
      label: "Today's Sales",
      value: `$${dashboardStats.todaysSales.toFixed(2)}`,
      sub: `${dashboardStats.todaysSalesCount || 0} ${dashboardStats.todaysSalesCount === 1 ? 'sale' : 'sales'} today`,
      type: 'gold'
    },
    {
      icon: 'trending-up',
      label: "Today's Gross Profit",
      value: dashboardStats.grossProfit === null ? '—' : `$${dashboardStats.grossProfit.toFixed(2)}`,
      sub: 'Sales minus cost of goods',
      type: 'gold'
    },
    {
      icon: 'alert-triangle',
      label: 'Low Stock Items',
      value: dashboardStats.lowStockCount.toString(),
      sub: 'Below reorder level',
      type: 'danger'
    },
    {
      icon: 'trending-down',
      label: "Today's Expenses",
      value: `$${dashboardStats.todaysExpenses.toFixed(2)}`,
      sub: 'Recorded expenses',
      type: 'expense'
    },
  ] : [
    {
      icon: 'dollar-sign',
      label: "Today's Sales",
      value: '$0.00',
      sub: 'No sales recorded yet',
      type: 'gold'
    },
    {
      icon: 'trending-up',
      label: "Today's Gross Profit",
      value: '$0.00',
      sub: 'Sales minus cost of goods',
      type: 'gold'
    },
    {
      icon: 'alert-triangle',
      label: 'Low Stock Items',
      value: '0',
      sub: 'All stock levels good',
      type: 'danger'
    },
    {
      icon: 'trending-down',
      label: "Today's Expenses",
      value: '$0.00',
      sub: 'No expenses recorded',
      type: 'expense'
    },
  ]

  const quickActions = [
    ...(adminCanSell ? [{ icon: 'shopping-cart', label: 'New Sale', hint: 'Open the POS terminal', page: 'sales', theme: 'green' }] : []),
    { icon: 'plus',          label: 'Add Product',    hint: 'Register a new stock item',       page: 'products', theme: 'blue'   },
    { icon: 'download',      label: 'Receive Stock',  hint: 'Record incoming inventory',       page: 'stock',    theme: 'teal'   },
    { icon: 'credit-card',   label: 'Add Expense',    hint: 'Log a business expense',          page: 'expenses', theme: 'red'    },
    { icon: 'bar-chart-2',   label: 'View Reports',   hint: 'Sales and stock analytics',       page: 'reports',  theme: 'purple' },
    { icon: 'clock',         label: 'End of Day',     hint: 'Close out and reconcile',         page: 'endofday', theme: 'orange' },
  ]

  // Sales and Settings manage their own layout — no outer padding/header
  const isFullScreenPage = activePage === 'sales' || activePage === 'settings'
  const shouldHideSidebar = isFullScreenPage

  // Render the correct page content
 const renderPage = () => {
    switch (activePage) {
      case 'dashboard':
        return <DashboardHome
                  stats={stats}
                  quickActions={quickActions}
                  setActivePage={setActivePage}
                  user={user}
                  shopSettings={shopSettings}
                  lowStockItems={dashboardStats?.lowStockItems || []}
                  recentSales={dashboardStats?.recentSales || []}
                  renderIcon={renderIcon}
                  renderNavIcon={renderNavIcon}
                  activeCashiers={activeCashiers}
                  activeCashiersLoading={activeCashiersLoading}
                  totalProducts={dashboardStats?.totalProducts ?? null}
                  totalCompletedSales={dashboardStats?.totalCompletedSales ?? null}
                />
      case 'products':
        return <Products />
      case 'inventory':
        return <CurrentInventory onNavigateToAddStock={setActivePage} />
      case 'reconciliation':
        return <InventoryReconciliation />
      case 'stock':
        return <StockControl />
      case 'suppliers':
        return <Suppliers />
      case 'sales':
        return <Sales
                 onRequestStartShift={() => setShowOpeningFloatModal(true)}
                 onRequestCloseShift={() => handleCloseShiftClick('closeOnly')}
               />
      case 'expenses':
        return <Expenses />
      case 'reports':
        return <Reports />
      case 'cashier-sessions':
        return <CashierSessions />
      case 'endofday':
        return <EndOfDay />
      case 'shifts':
        return <ShiftDashboard />
      case 'restock':
        return <RestockNeeded />
      case 'deadstock':
        return <DeadStock />
      case 'expiry':
        return <ExpiryTracking />
      case 'my-transactions':
        return <MyTransactions />
      case 'activitylogs':
        return <ActivityLogs />
      case 'settings':
        return <Settings />
      default:
        return <ComingSoon page={activePage} />
    }
  }
  // Group nav items for sidebar sections
  let lastGroup = null

  // Don't render dashboard if user is not authenticated
  if (!user?.id) {
    return null
  }

  return (
    <div className="dashboard-layout">
      <aside
        className={`sidebar ${sidebarExpanded ? 'expanded' : 'collapsed'}`}
        onMouseEnter={() => setSidebarExpanded(true)}
        onMouseLeave={() => { setSidebarExpanded(false) }}
      >
        {/* Logo area */}
        <div className="sidebar-logo">
          <div className="logo-icon-wrap">
            <img src={iconLogo} alt="Stocka" className="logo-icon" />
          </div>
          <div className="logo-full-wrap">
            <img src={fullLogo} alt="Stocka" className="logo-full" />
          </div>
        </div>

        {/* Sales / POS — primary CTA (hidden for admins unless the shop allows admin sales) */}
        {adminCanSell && (
          <div className="sidebar-pos-cta-wrap">
            <button
              className={`sidebar-pos-cta ${activePage === 'sales' ? 'active' : ''}`}
              onClick={() => setActivePage('sales')}
              title={!sidebarExpanded ? 'Sales / POS' : ''}
            >
              <span className="pos-cta-icon"><FiShoppingCart size={22} /></span>
              <span className="pos-cta-label">New Sale</span>
            </button>
          </div>
        )}

        {/* Navigation */}
        <nav className="sidebar-nav">
          {filteredNavItems.map(item => {
            const showGroupLabel = item.group !== lastGroup && groupLabels[item.group] !== ''
            lastGroup = item.group
            return (
              <div key={item.id}>
                {showGroupLabel && (
                  <div className="nav-group-label">{groupLabels[item.group]}</div>
                )}
                <div
                  className={`nav-item ${activePage === item.id ? 'active' : ''}`}
                  onClick={() => setActivePage(item.id)}
                  title={!sidebarExpanded ? item.label : ''}
                >
                  <span className="nav-icon">{renderNavIcon(item.icon)}</span>
                  <span className="nav-label">{item.label}</span>
                  {activePage === item.id && <span className="nav-active-dot" />}
                </div>
              </div>
            )
          })}
        </nav>

        {/* Footer */}
        <div className="sidebar-footer">
          <div className="user-info" title={!sidebarExpanded ? `${user.username} · ${user.role}` : ''}>
            <div className="user-avatar">
              {user.username?.[0]?.toUpperCase() || 'U'}
            </div>
            <div className="user-info-text">
              <div className="user-name">{user.username}</div>
              <div className="user-role">{user.role}</div>
              {shopSettings?.name && <div className="user-shop">{shopSettings.name}</div>}
            </div>
          </div>

          <LanStatusBar />

          <div className="footer-actions">
            <button
              className="footer-action-btn logout-btn"
              onClick={() => setShowSignOutModal(true)}
              title={!sidebarExpanded ? 'Sign Out' : ''}
            >
              <span className="footer-btn-icon"><FiLogOut size={18} /></span>
              <span className="btn-label">Sign Out</span>
            </button>
          </div>
        </div>
      </aside>

      <main className={`main-content${isFullScreenPage ? ' fullscreen' : ''}`}>
        {!isFullScreenPage && (() => {
          const pageTitles = {
            dashboard: null,
            products: 'Products',
            inventory: 'Current Inventory',
            reconciliation: 'Reconciliation',
            stock: 'Receive Stock',
            suppliers: 'Suppliers',
            restock: 'Restock Needed',
            deadstock: 'Dead Stock',
            expenses: 'Expenses',
            reports: 'Reports',
            endofday: 'End of Day',
            shifts: 'Shift Management',
            'cashier-sessions': 'Cashier Sessions',
            expiry: 'Expiry Tracking',
            activitylogs: 'Activity Logs',
          }
          const title = pageTitles[activePage]
          return (
            <div className="main-header">
              <div className="header-left">
                {shopSettings?.name && <span className="main-header-shop">{shopSettings.name}</span>}
                {shopSettings?.name && title && <span className="main-header-divider">·</span>}
                {title && <span className="main-header-title">{title}</span>}
              </div>
              <div className="header-right">
                {user.role !== 'Cashier' && <Notifications onNavigate={setActivePage} />}
              </div>
            </div>
          )
        })()}

        {(updateInfo || updateDownloading || updateReady) && (
          <div className={`update-banner ${updateReady ? 'ready' : ''}`}>
            <FiDownload size={15} />
            {updateReady ? (
              <>
                <span className="update-text">Update ready — restart to apply the new version.</span>
                <button className="update-action-btn" onClick={() => window.stocka.updater.install()}>
                  Restart &amp; Install
                </button>
              </>
            ) : updateDownloading ? (
              <>
                <span className="update-text">Downloading update… {updateProgress}%</span>
                <div className="update-progress-track">
                  <div className="update-progress-fill" style={{ width: `${updateProgress}%` }} />
                </div>
              </>
            ) : (
              <>
                <span className="update-text">
                  {updateInfo.releaseCount > 1
                    ? `${updateInfo.releaseCount} updates available — latest v${updateInfo.version}`
                    : `New version v${updateInfo.version} available`}
                </span>
                <button className="update-action-btn"
                  onClick={() => { setUpdateDownloading(true); window.stocka.updater.download().catch(() => setUpdateDownloading(false)) }}>
                  Update Now
                </button>
              </>
            )}
          </div>
        )}

        {lanSyncFailures.length > 0 && (
          <div className="sync-failure-banner">
            <FiAlertTriangle size={15} style={{ flexShrink: 0 }} />
            <span>
              <strong>{lanSyncFailures.length} operation{lanSyncFailures.length !== 1 ? 's' : ''} failed to sync</strong>
              {' '}after reconnecting to the Main computer. Please verify that the following records were saved:
              {' '}{[...new Set(lanSyncFailures.map(f => f.channel?.split(':')[2] || 'data'))].join(', ')}.
            </span>
            <button onClick={() => setLanSyncFailures([])}>
              <FiX size={14} />
            </button>
          </div>
        )}

        {renderPage()}
      </main>

      {showOpeningFloatModal && (
        <OpeningFloatModal
          user={user}
          onConfirm={handleOpeningFloatSubmit}
          onCancel={() => setShowOpeningFloatModal(false)}
          isLoading={isStartingShift}
        />
      )}

      {showSignOutModal && (
        <SignOutModal
          hasShift={!!currentShift}
          onCloseShift={() => { setShowSignOutModal(false); handleCloseShiftClick('signout') }}
          onSignOutOnly={() => { setShowSignOutModal(false); performLogout() }}
          onStay={() => setShowSignOutModal(false)}
        />
      )}
      {showClosingFloatModal && (closingShiftData || currentShift) && (
        <ClosingFloatModal
          shift={closingShiftData || currentShift}
          onConfirm={handleClosingFloatSubmit}
          onCancel={handleClosingFloatCancel}
          isLoading={isClosingShift}
          varianceTolerance={shopSettings?.variance_tolerance ?? 0.01}
        />
      )}

      {shiftForceClosed && (
        <ShiftForceClosedModal onLogout={forceLogout} />
      )}

      {eodClosed && (
        <EodClosedModal
          date={eodClosed.date}
          closedBy={eodClosed.closedBy}
          onCloseShift={currentShift ? () => { setEodClosed(null); handleCloseShiftClick('signout') } : null}
          onLogout={!currentShift ? forceLogout : null}
        />
      )}
    </div>
  )
}

// ── DASHBOARD HOME ──
function OnboardingPanel({ totalProducts, totalCompletedSales, setActivePage }) {
  const [dismissed, setDismissed] = React.useState(
    () => localStorage.getItem('stocka_onboarding_dismissed') === '1'
  )

  const hasSale = totalCompletedSales !== null && totalCompletedSales > 0
  const hasProducts = totalProducts !== null && totalProducts > 0
  const allDone = hasSale && hasProducts

  if (dismissed || allDone) return null

  const handleDismiss = () => {
    localStorage.setItem('stocka_onboarding_dismissed', '1')
    setDismissed(true)
  }

  const items = [
    {
      done: hasSale,
      label: 'Make a test sale',
      hint: 'Head to Sales / POS to ring up your first transaction.',
      action: () => setActivePage('sales'),
      actionLabel: 'Open Sales',
    },
    {
      done: hasProducts,
      label: 'Add products to your inventory',
      hint: 'Add the items your shop carries so you can sell them.',
      action: () => setActivePage('products'),
      actionLabel: 'Add Products',
    },
  ]

  return (
    <div className="onboarding-panel">
      <div className="onboarding-header">
        <div>
          <p className="onboarding-header-title">You're ready to sell!</p>
          <p className="onboarding-header-sub">
            {items.filter(i => i.done).length} of {items.length} steps done
          </p>
        </div>
        <button className="onboarding-dismiss-btn" onClick={handleDismiss}>Dismiss</button>
      </div>
      <div className="onboarding-body">
        {items.map((item, i) => (
          <div key={i} className="onboarding-item">
            <div className={`onboarding-step-circle${item.done ? ' done' : ''}`}>
              {item.done && <span className="onboarding-step-check">✓</span>}
            </div>
            <div className="onboarding-item-content">
              <p className={`onboarding-item-label${item.done ? ' done' : ''}`}>{item.label}</p>
              {!item.done && (
                <>
                  <p className="onboarding-item-hint">{item.hint}</p>
                  <button className="onboarding-action-btn" onClick={item.action}>
                    {item.actionLabel} →
                  </button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function DashboardHome({ stats, quickActions, setActivePage, user, shopSettings, lowStockItems, recentSales, renderIcon, renderNavIcon, activeCashiers, activeCashiersLoading, totalProducts, totalCompletedSales }) {
  const now = new Date()
  const hour = now.getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const today = now.toLocaleDateString('en-ZW', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  })

  // Simplified dashboard for Cashiers
  if (user.role === 'Cashier') {
    return (
      <>
        <div className="page-header">
          <h1>{greeting}, {user.username}!</h1>
          <p>{today}{shopSettings?.name && <> · <span className="page-header-shop">{shopSettings.name}</span></>}</p>
        </div>

        <div className="cashier-home">
          <div className="cashier-greeting">
            <p>You're ready to process sales!</p>
          </div>

          <div className="cashier-actions">
            <button
              className="cashier-action-btn primary"
              onClick={() => setActivePage('sales')}
            >
              <span className="action-icon">{renderIcon('shopping-cart', 32)}</span>
              <span className="action-label">Process Sale</span>
              <span className="action-hint">Record a new transaction</span>
            </button>

            {/* <button
              className="cashier-action-btn"
              onClick={() => setActivePage('endofday')}
            >
              <span className="action-icon">{renderIcon('bar-chart-2', 32)}</span>
              <span className="action-label">End of Day</span>
              <span className="action-hint">Close and reconcile</span>
            </button> */}
          </div>
        </div>
      </>
    )
  }

  return (
    <>
      <div className="page-header">
        <h1>{greeting}, {user.username}!</h1>
        <p>{today}{shopSettings?.name && <> · <span className="page-header-shop">{shopSettings.name}</span></>}</p>
      </div>

      {/* Onboarding checklist — shown to Admin only, disappears when done or dismissed */}
      {(user.role === 'Admin' || user.role === 'Manager') && (
        <OnboardingPanel
          totalProducts={totalProducts}
          totalCompletedSales={totalCompletedSales}
          setActivePage={setActivePage}
        />
      )}

      <div className="stats-grid">
        {stats.map((stat, i) => {
          // Define navigation based on stat type
          let navPage = null
          if (stat.label === "Low Stock Items") navPage = 'stock'
          else if (stat.label === "Total Products") navPage = 'products'
          else if (stat.label === "Stock Value") navPage = 'products'
          else if (stat.label === "Today's Sales") navPage = 'sales'
          else if (stat.label === "Today's Expenses") navPage = 'expenses'

          return (
            <div 
              key={i} 
              className={`stat-card ${stat.type} ${navPage ? 'clickable' : ''}`}
              onClick={() => navPage && setActivePage(navPage)}
              role={navPage ? 'button' : undefined}
              tabIndex={navPage ? 0 : undefined}
              onKeyDown={(e) => navPage && (e.key === 'Enter' || e.key === ' ') && setActivePage(navPage)}
            >
              <div className="stat-icon">{renderIcon(stat.icon, 28)}</div>
              <div className="stat-label">{stat.label}</div>
              <div className="stat-value">{stat.value}</div>
              <div className="stat-sub">{stat.sub}</div>
            </div>
          )
        })}
      </div>

      <div className="quick-actions">
        <h3 className="section-eyebrow">Quick Actions</h3>
        <div className="actions-grid">
          {quickActions.map((action, i) => (
            <button
              key={i}
              className={`action-btn theme-${action.theme}`}
              onClick={() => setActivePage(action.page)}
            >
              <span className="action-icon-wrap">{renderIcon(action.icon, 18)}</span>
              <span className="action-text">
                <span className="action-label">{action.label}</span>
                <span className="action-hint">{action.hint}</span>
              </span>
              <FiArrowRight className="action-arrow" size={14} />
            </button>
          ))}
        </div>
      </div>

      {/* Live Cashiers Widget (Admin/Manager only) */}
      {(user.role === 'Admin' || user.role === 'Manager') && (
        <div className="dashboard-section live-cashiers-widget">
          <div className="section-header">
            <h3><FiUsers size={15} /> Live Cashiers</h3>
            <button className="section-link" onClick={() => setActivePage('cashier-sessions')}>
              View All Sessions
            </button>
          </div>
          {activeCashiersLoading ? (
            <div className="loading-state"><p>Loading active sessions...</p></div>
          ) : activeCashiers && activeCashiers.length > 0 ? (
            <div className="live-cashiers-content">
              <div className="cashiers-stats">
                <div className="stat-box">
                  <div className="stat-box-label">Active Cashiers</div>
                  <div className="stat-box-number">{activeCashiers.length}</div>
                </div>
                <div className="stat-box">
                  {/* Sum of the OPEN shifts only — closed shifts today are not included,
                      so this is deliberately labelled differently from "Today's Sales". */}
                  <div className="stat-box-label">Active Shift Sales</div>
                  <div className="stat-box-number">
                    ${activeCashiers.reduce((sum, shift) => sum + (shift.total_sales_value || 0), 0).toFixed(2)}
                  </div>
                </div>
              </div>
              {activeCashiers.some(shift => Math.abs(shift.overall_variance || 0) > 0.01) && (
                <div className="variance-alerts">
                  <div className="alert-header"><FiAlertTriangle size={12} /> Shifts with Variances</div>
                  {activeCashiers.filter(shift => Math.abs(shift.overall_variance || 0) > 0.01).map((shift, idx) => (
                    <div key={idx} className="variance-alert-item">
                      <span className="cashier-name">{shift.cashier_username}</span>
                      <span className={shift.overall_variance < 0 ? 'shortage' : 'overage'}>
                        {shift.overall_variance < 0 ? '-' : '+'}${Math.abs(shift.overall_variance).toFixed(2)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="empty-state">
              <FiClock size={32} />
              <p>No active cashier sessions</p>
            </div>
          )}
        </div>
      )}

      <div className="dashboard-grid">
        <div className="dashboard-section">
          <div className="section-header">
            <h3><FiAlertTriangle size={15} /> Low Stock ({lowStockItems?.length || 0})</h3>
            {lowStockItems && lowStockItems.length > 0 && (
              <button className="section-link" onClick={() => setActivePage('stock')}>View All</button>
            )}
          </div>
          {lowStockItems && lowStockItems.length > 0 ? (
            <div className="low-stock-list">
              {lowStockItems.slice(0, 5).map((item, idx) => (
                <div key={idx} className="stock-item">
                  <div className="item-name">{item.name}</div>
                  <div className="item-qty">
                    <span className="current">{item.current_quantity}</span>
                    <span className="reorder">/ {item.reorder_level}</span>
                  </div>
                </div>
              ))}
              {lowStockItems.length > 5 && (
                <div className="more-items">+{lowStockItems.length - 5} more items</div>
              )}
            </div>
          ) : (
            <div className="empty-state">
              <FiPackage size={32} />
              <p>All stock levels are good</p>
            </div>
          )}
        </div>

        <div className="dashboard-section">
          <div className="section-header">
            <h3><FiBarChart2 size={15} /> Recent Sales ({recentSales?.length || 0})</h3>
            {recentSales && recentSales.length > 0 && (
              <button className="section-link" onClick={() => setActivePage('sales')}>New Sale</button>
            )}
          </div>
          {recentSales && recentSales.length > 0 ? (
            <div className="recent-sales-list">
              {recentSales.slice(0, 5).map((sale, idx) => (
                <div key={idx} className="sale-item">
                  <div className="sale-time">
                    {formatDbTime(sale.created_at)}
                  </div>
                  <div className="sale-amount">${sale.total?.toFixed(2)}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <FiShoppingCart size={32} />
              <p>No sales yet today</p>
            </div>
          )}
        </div>
      </div>
    </>
  )
}

// ── COMING SOON placeholder for unbuilt pages ──
function ComingSoon({ page }) {
  const labels = {
    products:   'Products',
    stock:      'Stock Control',
    suppliers:  'Suppliers',
    sales:      'Sales / POS',
    expenses:   'Expenses',
    reports:    'Reports',
    endofday:   'End of Day',
    settings:   'Settings',
  }

  return (
    <div className="coming-soon">
      <div className="coming-icon"><FiPlus size={64} /></div>
      <h2>{labels[page] || page}</h2>
      <p>This module is being built. Check back soon!</p>
    </div>
  )
}

export default Dashboard
