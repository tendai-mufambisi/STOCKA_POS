import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import './Dashboard.css'
import Products from './Products'
import StockControl from './StockControl'
import Suppliers from './Suppliers'
import Sales from './Sales'
import Expenses from './Expenses'
import EndOfDay from './EndOfDay'
import Reports from './Reports'
import Branches from './Branches'
import Settings from './Settings'
import ShiftDashboard from './ShiftDashboard'
import CashierSessions from './CashierSessions'
import RestockNeeded from './RestockNeeded'
import DeadStock from './DeadStock'
import DirectPurchases from './DirectPurchases'
import ExpiryTracking from './ExpiryTracking'
import Notifications from '../components/Notifications'
import { getDashboardStats, getSales, getExpenses, getProducts, getActiveShifts, closeShift } from '../database/db'

import {
  FiHome,
  FiPackage,
  FiTrendingDown,
  FiTruck,
  FiShoppingCart,
  FiCreditCard,
  FiClock,
  FiMapPin,
  FiSettings,
  FiDollarSign,
  FiAlertTriangle,
  FiBarChart2,
  FiPlus,
  FiDownload,
  FiLogOut,
  FiMenu,
  FiTrendingUp,
  FiCalendar
} from 'react-icons/fi'


function Dashboard() {
  const navigate = useNavigate()
  const user = JSON.parse(localStorage.getItem('stocka_user') || '{}')
  const [activePage, setActivePage] = useState('dashboard')
  const [dashboardStats, setDashboardStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [activeCashiers, setActiveCashiers] = useState([])
  const [activeCashiersLoading, setActiveCashiersLoading] = useState(false)

  const handleLogout = () => {
    performLogout()
  }

  const performLogout = async () => {
    try {
      // If user is a cashier with an active shift, close it first
      if (user?.role === 'Cashier' && user?.current_shift_id) {
        try {
          // Close the shift with zeros for all payment methods (will be auto-calculated as short/balanced)
          const closingFloat = {
            closing_usd_cash: 0,
            closing_zwg_cash: 0,
            closing_swipe_usd: 0,
            closing_swipe_zwg: 0,
            closing_ecocash_usd: 0,
            closing_ecocash_zwg: 0
          }
          await closeShift(user.current_shift_id, closingFloat, 'Shift auto-closed on logout')
        } catch (err) {
          console.warn('Could not close shift on logout:', err)
          // Continue with logout even if shift close fails
        }
      }
    } catch (err) {
      console.warn('Error during logout cleanup:', err)
    }
    
    // Clear all authentication and session data
    localStorage.removeItem('stocka_user')
    localStorage.removeItem('stocka_db_init')
    sessionStorage.clear()

    // Reset all state and navigate
    setActivePage('dashboard')
    setDashboardStats(null)
    setSidebarOpen(true)
    
    // Navigate to login
    navigate('/login', { replace: true })
    
    // Fallback: reload page after a short delay to ensure clean state
    setTimeout(() => {
      window.location.href = '/login'
    }, 100)
  }

  // Check authentication on component mount
  useEffect(() => {
    if (!user.id) {
      // User is not authenticated, redirect to login
      navigate('/login', { replace: true })
    }
  }, [navigate, user.id])

  useEffect(() => {
    if (user.id) {
      loadDashboardData()
    }
  }, [user.id])

  const loadDashboardData = async () => {
    try {
      const [stats, sales, expenses, products] = await Promise.all([
        getDashboardStats(),
        getSales(),
        getExpenses(),
        getProducts()
      ])
      
      // Load active cashiers if user is admin or manager
      if (user.role === 'Admin' || user.role === 'Manager') {
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
      
      const today = new Date().toISOString().split('T')[0]
      const todayStart = new Date(today).getTime()
      const todayEnd = todayStart + 24 * 60 * 60 * 1000

      const todaysSales = sales.filter(s => {
        const saleDate = new Date(s.date_created).getTime()
        return saleDate >= todayStart && saleDate < todayEnd
      })
      
      const todaysExpenses = expenses.filter(e => {
        const expenseDate = new Date(e.date).getTime()
        return expenseDate >= todayStart && expenseDate < todayEnd
      })

      const lowStockItems = products.filter(p => p.current_quantity <= p.reorder_level)
      const stockValue = products.reduce((sum, p) => sum + ((p.current_quantity || 0) * 10), 0)
      
      setDashboardStats({
        todaysSales: todaysSales.reduce((sum, s) => sum + (s.total || 0), 0),
        totalProducts: products.length,
        lowStockCount: lowStockItems.length,
        stockValue: stockValue,
        todaysExpenses: todaysExpenses.reduce((sum, e) => sum + (e.amount || 0), 0),
        lowStockItems: lowStockItems,
        recentSales: todaysSales.reverse().slice(0, 5)
      })
    } catch (err) {
      console.error('Failed to load dashboard stats', err)
    } finally {
      setLoading(false)
    }
  }

  const navItems = [
    { id: 'dashboard',  icon: 'home',       label: 'Dashboard',       group: 'main',    roles: ['Admin', 'Manager', 'Cashier'] },
    { id: 'products',   icon: 'package',    label: 'Products',         group: 'stock',   roles: ['Admin', 'Manager'] },
    { id: 'stock',      icon: 'trending-down', label: 'Stock Control',    group: 'stock',   roles: ['Admin', 'Manager'] },
    { id: 'suppliers',  icon: 'truck',      label: 'Suppliers',        group: 'stock',   roles: ['Admin', 'Manager'] },
    { id: 'restock',    icon: 'trending-up', label: 'Restock Needed',    group: 'stock',   roles: ['Admin', 'Manager'] },
    { id: 'deadstock',  icon: 'trending-down', label: 'Dead Stock',       group: 'stock',   roles: ['Admin', 'Manager'] },
    { id: 'sales',      icon: 'shopping-cart', label: 'Sales / POS',      group: 'sales',   roles: ['Admin', 'Manager', 'Cashier'] },
    { id: 'expenses',   icon: 'credit-card', label: 'Expenses',         group: 'finance', roles: ['Admin', 'Manager'] },
    { id: 'reports',    icon: 'bar-chart-2', label: 'Reports',          group: 'finance', roles: ['Admin', 'Manager'] },
    { id: 'endofday',   icon: 'clock',      label: 'End of Day',       group: 'finance', roles: ['Admin', 'Manager'] },
    { id: 'shifts',     icon: 'clock',      label: 'Shift Management', group: 'finance', roles: ['Admin', 'Manager'] },
    { id: 'cashier-sessions',  icon: 'shopping-cart', label: 'Cashier Sessions', group: 'finance', roles: ['Admin', 'Manager'] },
    { id: 'purchases',  icon: 'package',    label: 'Direct Purchases',  group: 'stock',   roles: ['Admin', 'Manager'] },
    { id: 'expiry',     icon: 'calendar',   label: 'Expiry Tracking',   group: 'stock',   roles: ['Admin', 'Manager'] },
    { id: 'branches',   icon: 'map-pin',    label: 'Branches',         group: 'ops',     roles: ['Admin'] },
    { id: 'settings',   icon: 'settings',   label: 'Settings',        group: 'ops',     roles: ['Admin', 'Manager', 'Cashier'] },
  ]

  // Filter nav items based on user role
  const userRole = user.role || 'Cashier'
  const filteredNavItems = navItems.filter(item => 
    !item.roles || item.roles.some(role => role.toLowerCase() === userRole.toLowerCase())
  )

  // Debug logging
  console.log('🔍 User role:', userRole)
  console.log('🔍 Filtered nav items:', filteredNavItems.length, filteredNavItems)

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
      case 'map-pin': return <FiMapPin {...iconProps} />
      case 'calendar': return <FiCalendar {...iconProps} />
      case 'settings': return <FiSettings {...iconProps} />
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
      sub: `${dashboardStats.recentSales?.length || 0} sales today`,
      type: 'gold'
    },
    {
      icon: 'package',
      label: 'Total Products',
      value: dashboardStats.totalProducts.toString(),
      sub: 'Products in inventory',
      type: ''
    },
    {
      icon: 'alert-triangle',
      label: 'Low Stock Items',
      value: dashboardStats.lowStockCount.toString(),
      sub: 'Below reorder level',
      type: 'danger'
    },
    {
      icon: 'bar-chart-2',
      label: 'Stock Value',
      value: `$${dashboardStats.stockValue.toFixed(2)}`,
      sub: 'Total inventory value',
      type: 'blue'
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
      icon: 'package',
      label: 'Total Products',
      value: '0',
      sub: 'No products added yet',
      type: ''
    },
    {
      icon: 'alert-triangle',
      label: 'Low Stock Items',
      value: '0',
      sub: 'All stock levels good',
      type: 'danger'
    },
    {
      icon: 'bar-chart-2',
      label: 'Stock Value',
      value: '$0.00',
      sub: 'Total inventory value',
      type: 'blue'
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
    { icon: 'shopping-cart', label: 'New Sale',        page: 'sales' },
    { icon: 'plus', label: 'Add Product',     page: 'products' },
    { icon: 'download', label: 'Receive Stock',   page: 'stock' },
    { icon: 'credit-card', label: 'Add Expense',     page: 'expenses' },
    { icon: 'bar-chart-2', label: 'View Reports',    page: 'reports' },
    { icon: 'clock', label: 'End of Day',      page: 'endofday' },
  ]

  // Check if current page should use full-screen layout
  const isFullScreenPage = activePage === 'sales'
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
                  lowStockItems={dashboardStats?.lowStockItems || []}
                  recentSales={dashboardStats?.recentSales || []}
                  renderIcon={renderIcon}
                  renderNavIcon={renderNavIcon}
                  activeCashiers={activeCashiers}
                  activeCashiersLoading={activeCashiersLoading}
                />
      case 'products':
        return <Products />
      case 'stock':
        return <StockControl />
      case 'suppliers':
        return <Suppliers />
      case 'sales':
        return <Sales user={user} />
      case 'expenses':
        return <Expenses />
      case 'reports':
        return <Reports user={user} />
      case 'cashier-sessions':
        return <CashierSessions />
      case 'endofday':
        return <EndOfDay user={user} />
      case 'shifts':
        return <ShiftDashboard user={user} />
      case 'restock':
        return <RestockNeeded user={user} />
      case 'deadstock':
        return <DeadStock user={user} />
      case 'purchases':
        return <DirectPurchases user={user} />
      case 'expiry':
        return <ExpiryTracking user={user} />
      case 'branches':
        return <Branches />
      case 'settings':
        return <Settings user={user} />
      default:
        return <ComingSoon page={activePage} />
    }
  }
  // Group nav items for sidebar sections
  let lastGroup = null

  // Don't render dashboard if user is not authenticated
  if (!user.id) {
    return null
  }

  return (
    <div className="dashboard-layout">
      <aside className={`sidebar ${sidebarOpen ? 'open' : 'closed'}`}>
        <div className="sidebar-logo">
          <h2>Stocka</h2>
          <p>Retail Management</p>
        </div>

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
                >
                  <span className="nav-icon">{renderNavIcon(item.icon)}</span>
                  <span>{item.label}</span>
                </div>
              </div>
            )
          })}
        </nav>

        <div className="sidebar-footer">
          <div className="user-info">
            <div className="user-avatar">
              {user.username?.[0]?.toUpperCase() || 'U'}
            </div>
            <div>
              <div className="user-name">{user.username}</div>
              <div className="user-role">{user.role}</div>
            </div>
          </div>
          <button className="logout-btn" onClick={handleLogout}>
            <FiLogOut size={18} style={{ marginRight: '8px' }} />
            Sign Out
          </button>
        </div>
      </aside>

      <button 
        className="sidebar-toggle-caret"
        onClick={() => setSidebarOpen(!sidebarOpen)}
        title={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
        style={{ left: sidebarOpen ? '240px' : '0' }}
      >
        {sidebarOpen ? '‹' : '›'}
      </button>

      <main className="main-content" style={{ marginLeft: sidebarOpen ? '240px' : '0', padding: isFullScreenPage ? '0' : '32px' }}>
        {!isFullScreenPage && <div className="main-header">
          <div className="header-right">
            {user.role !== 'Cashier' && <Notifications user={user} />}
            
          </div>
        </div>}
        {renderPage()}
      </main>
    </div>
  )
}

// ── DASHBOARD HOME ──
function DashboardHome({ stats, quickActions, setActivePage, user, lowStockItems, recentSales, renderIcon, renderNavIcon, activeCashiers, activeCashiersLoading }) {
  const today = new Date().toLocaleDateString('en-ZW', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  })

  // Simplified dashboard for Cashiers
  if (user.role === 'Cashier') {
    return (
      <>
        <div className="page-header">
          <h1>Welcome back, {user.username}!</h1>
          <p>{today}</p>
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
        <h1>Good day, {user.username}!</h1>
        <p>{today}</p>
      </div>

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
        <h3>Quick Actions</h3>
        <div className="actions-grid">
          {quickActions.map((action, i) => (
            <button
              key={i}
              className="action-btn"
              onClick={() => setActivePage(action.page)}
            >
              <span className="action-icon">{renderIcon(action.icon, 24)}</span>
              <span>{action.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Live Cashiers Widget (Admin/Manager only) */}
      {(user.role === 'Admin' || user.role === 'Manager') && (
        <div className="dashboard-section live-cashiers-widget">
          <div className="section-header">
            <h3>⏱️ Live Cashiers</h3>
            <button 
              className="section-link"
              onClick={() => setActivePage('cashier-sessions')}
            >
              View All Sessions →
            </button>
          </div>
          {activeCashiersLoading ? (
            <div className="loading-state">
              <p>Loading active sessions...</p>
            </div>
          ) : activeCashiers && activeCashiers.length > 0 ? (
            <div className="live-cashiers-content">
              <div className="cashiers-stats">
                <div className="stat-box">
                  <div className="stat-label">Active Cashiers</div>
                  <div className="stat-number">{activeCashiers.length}</div>
                </div>
                <div className="stat-box">
                  <div className="stat-label">Total Sales (Today)</div>
                  <div className="stat-number">
                    ${activeCashiers.reduce((sum, shift) => sum + (shift.total_sales_value || 0), 0).toFixed(2)}
                  </div>
                </div>
              </div>
              
              {activeCashiers.some(shift => Math.abs(shift.overall_variance || 0) > 0.01) && (
                <div className="variance-alerts">
                  <div className="alert-header">⚠️ Shifts with Variances</div>
                  {activeCashiers.filter(shift => Math.abs(shift.overall_variance || 0) > 0.01).map((shift, idx) => (
                    <div key={idx} className="variance-alert-item">
                      <span className="cashier-name">{shift.cashier_username}</span>
                      <span className={shift.overall_variance < 0 ? 'shortage' : 'overage'}>
                        {shift.overall_variance < 0 ? '- $' : '+ $'}{Math.abs(shift.overall_variance).toFixed(2)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="empty-state">
              <div className="empty-icon">{renderIcon('clock', 32)}</div>
              <p>No active cashier sessions</p>
            </div>
          )}
        </div>
      )}

      <div className="dashboard-grid">
        <div className="dashboard-section">
          <div className="section-header">
            <h3>{renderIcon('alert-triangle', 20)} Low Stock Items ({lowStockItems?.length || 0})</h3>
            {lowStockItems && lowStockItems.length > 0 && (
              <button 
                className="section-link"
                onClick={() => setActivePage('stock')}
              >
                View All →
              </button>
            )}
          </div>
          {lowStockItems && lowStockItems.length > 0 ? (
            <div className="low-stock-list">
              {lowStockItems.slice(0, 5).map((item, idx) => (
                <div key={idx} className="stock-item">
                  <div className="item-name">{item.name}</div>
                  <div className="item-qty">
                    <span className="current">Qty: {item.current_quantity}</span>
                    <span className="reorder">Reorder: {item.reorder_level}</span>
                  </div>
                </div>
              ))}
              {lowStockItems.length > 5 && (
                <div className="more-items">+{lowStockItems.length - 5} more items</div>
              )}
            </div>
          ) : (
            <div className="empty-state">
              <div className="empty-icon">{renderIcon('package', 32)}</div>
              <p>All stock levels are good!</p>
            </div>
          )}
        </div>

        <div className="dashboard-section">
          <h3>{renderIcon('bar-chart-2', 20)} Recent Sales ({recentSales?.length || 0})</h3>
          {recentSales && recentSales.length > 0 ? (
            <div className="recent-sales-list">
              {recentSales.slice(0, 5).map((sale, idx) => (
                <div key={idx} className="sale-item">
                  <div className="sale-time">
                    {new Date(sale.date_created).toLocaleTimeString('en-ZW', { hour: '2-digit', minute: '2-digit' })}
                  </div>
                  <div className="sale-amount">${sale.total?.toFixed(2)}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <div className="empty-icon">{renderIcon('shopping-cart', 32)}</div>
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
    customers:  'Customers',
    quotations: 'Quotations',
    expenses:   'Expenses',
    reports:    'Reports',
    endofday:   'End of Day',
    branches:   'Branches',
    settings:   'Settings',
  }

  return (
    <div className="coming-soon">
      <div className="coming-icon">{renderIcon('plus', 64)}</div>
      <h2>{labels[page] || page}</h2>
      <p>This module is being built. Check back soon!</p>
    </div>
  )
}

export default Dashboard
