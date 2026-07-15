const shop         = require('./domains/shop')
const products     = require('./domains/products')
const suppliers    = require('./domains/suppliers')
const stock        = require('./domains/stock')
const sales        = require('./domains/sales')
const expenses     = require('./domains/expenses')
const users        = require('./domains/users')
const shifts       = require('./domains/shifts')
const notifications = require('./domains/notifications')
const reports      = require('./domains/reports')
const audit        = require('./domains/audit')
const backup       = require('./domains/backup')
const eod          = require('./domains/eod')
const branches     = require('./domains/branches')
const holds        = require('./domains/holds')

let _makeHandler = null

function updateMakeHandler(mh) {
  _makeHandler = mh
}

function wrap(fn) {
  return (event, ...args) => {
    try { return fn(...args) }
    catch (err) { return { __error: err.message } }
  }
}

function registerAll(ipcMain, userDataPath, customMakeHandler = null) {
  const path = require('path')
  const backupsDir = path.join(userDataPath, 'backups')

  _makeHandler = customMakeHandler

  // h resolves _makeHandler at call time so mid-session mode switches take effect immediately
  const h = (ch, fn) => (event, ...args) => {
    const mh = _makeHandler
    return mh ? mh(ch, fn)(event, ...args) : wrap(fn)(event, ...args)
  }

  // ── SHOP ──
  ipcMain.handle('domain:shop:get',           h('domain:shop:get',        shop.getShop))
  ipcMain.handle('domain:shop:init',          h('domain:shop:init',       shop.initializeShop))
  ipcMain.handle('domain:shop:update',        h('domain:shop:update',     shop.updateShop))
  ipcMain.handle('domain:shop:resetPin',      h('domain:shop:resetPin',   shop.resetOwnerPin))
  // Always local — each machine manages its own printer; never proxied via LAN
  ipcMain.handle('domain:shop:updatePrinter', wrap(shop.updateShopPrinterSettings))

  // ── PRODUCTS ──
  ipcMain.handle('domain:products:getAll',          h('domain:products:getAll',          products.getProducts))
  ipcMain.handle('domain:products:getById',         h('domain:products:getById',         products.getProductById))
  ipcMain.handle('domain:products:add',             h('domain:products:add',             products.addProduct))
  ipcMain.handle('domain:products:update',          h('domain:products:update',          products.updateProduct))
  ipcMain.handle('domain:products:delete',          h('domain:products:delete',          products.deleteProduct))
  ipcMain.handle('domain:products:updateQty',       h('domain:products:updateQty',       products.updateProductQuantity))
  ipcMain.handle('domain:products:updateImage',     h('domain:products:updateImage',     products.updateProductImage))
  ipcMain.handle('domain:products:updateLastSold',  h('domain:products:updateLastSold',  products.updateProductLastSoldDate))
  ipcMain.handle('domain:products:getLatestPrice',  h('domain:products:getLatestPrice',  products.getLatestProductPrice))
  ipcMain.handle('domain:products:getAllCostPrices',h('domain:products:getAllCostPrices', products.getAllLatestCostPrices))
  ipcMain.handle('domain:products:getMostSold',     h('domain:products:getMostSold',     products.getMostSoldProducts))
  ipcMain.handle('domain:products:importBatch',     h('domain:products:importBatch',     products.addProductsBatch))

  // ── SUPPLIERS ──
  ipcMain.handle('domain:suppliers:getAll',             h('domain:suppliers:getAll',             suppliers.getSuppliers))
  ipcMain.handle('domain:suppliers:getById',            h('domain:suppliers:getById',            suppliers.getSupplierById))
  ipcMain.handle('domain:suppliers:add',                h('domain:suppliers:add',                suppliers.addSupplier))
  ipcMain.handle('domain:suppliers:update',             h('domain:suppliers:update',             suppliers.updateSupplier))
  ipcMain.handle('domain:suppliers:delete',             h('domain:suppliers:delete',             suppliers.deleteSupplier))
  ipcMain.handle('domain:suppliers:getPurchaseHistory', h('domain:suppliers:getPurchaseHistory', suppliers.getSupplierPurchaseHistory))
  ipcMain.handle('domain:suppliers:getProductHistory',  h('domain:suppliers:getProductHistory',  suppliers.getProductPurchaseHistory))

  // ── STOCK ──
  ipcMain.handle('domain:stock:addReceiving',    h('domain:stock:addReceiving',    stock.addStockReceiving))
  ipcMain.handle('domain:stock:getAll',          h('domain:stock:getAll',          stock.getStockReceivings))
  ipcMain.handle('domain:stock:getById',         h('domain:stock:getById',         stock.getStockReceivingById))
  ipcMain.handle('domain:stock:getAllPurchases',  h('domain:stock:getAllPurchases',  stock.getAllPurchaseHistory))
  ipcMain.handle('domain:stock:recordDirect',    h('domain:stock:recordDirect',    stock.recordDirectPurchase))
  ipcMain.handle('domain:stock:getDeadStock',    h('domain:stock:getDeadStock',    stock.getDeadStockProducts))
  ipcMain.handle('domain:stock:getRestock',      h('domain:stock:getRestock',      stock.getRestockNeeded))
  ipcMain.handle('domain:stock:getVelocity',     h('domain:stock:getVelocity',     stock.getProductSalesVelocity))
  ipcMain.handle('domain:stock:getExpiring',     h('domain:stock:getExpiring',     stock.getExpiringProducts))
  ipcMain.handle('domain:stock:getExpired',      h('domain:stock:getExpired',      stock.getExpiredProducts))
  ipcMain.handle('domain:stock:getExpiryReport',    h('domain:stock:getExpiryReport',    stock.getExpiryReport))
  ipcMain.handle('domain:stock:importReceivings',   h('domain:stock:importReceivings',   stock.importStockReceivings))
  ipcMain.handle('domain:stock:reconcileProduct',   h('domain:stock:reconcileProduct',   stock.reconcileProduct))
  ipcMain.handle('domain:stock:reconcileProducts',  h('domain:stock:reconcileProducts',  stock.reconcileProducts))
  ipcMain.handle('domain:stock:recordInitialCost',  h('domain:stock:recordInitialCost',  stock.recordInitialCost))
  ipcMain.handle('domain:stock:correctReceiving',   h('domain:stock:correctReceiving',   stock.correctStockReceiving))

  // ── SALES ──
  ipcMain.handle('domain:sales:add',           h('domain:sales:add',           sales.addSale))
  ipcMain.handle('domain:sales:getAll',        h('domain:sales:getAll',        sales.getSales))
  ipcMain.handle('domain:sales:getById',       h('domain:sales:getById',       sales.getSaleById))
  ipcMain.handle('domain:sales:getItems',      h('domain:sales:getItems',      sales.getSaleItems))
  ipcMain.handle('domain:sales:hold',          h('domain:sales:hold',          sales.holdSale))
  ipcMain.handle('domain:sales:getHeld',       h('domain:sales:getHeld',       sales.getHeldSales))
  ipcMain.handle('domain:sales:recall',        h('domain:sales:recall',        sales.recallHeldSale))
  ipcMain.handle('domain:sales:discard',       h('domain:sales:discard',       sales.discardHeldSale))
  ipcMain.handle('domain:sales:void',          h('domain:sales:void',          sales.voidSale))
  ipcMain.handle('domain:sales:complete',      h('domain:sales:complete',      sales.completeHeldSale))
  ipcMain.handle('domain:sales:getVoided',     h('domain:sales:getVoided',     sales.getVoidedSales))
  ipcMain.handle('domain:sales:getLastReceipt',h('domain:sales:getLastReceipt',sales.getLastReceiptNumber))
  ipcMain.handle('domain:sales:getReceipt',    h('domain:sales:getReceipt',    sales.getReceiptBySaleId))
  ipcMain.handle('domain:sales:updateReceipt', h('domain:sales:updateReceipt', sales.updateSaleReceiptNumber))
  ipcMain.handle('domain:sales:getByShift',    h('domain:sales:getByShift',    sales.getSalesByShift))
  ipcMain.handle('domain:sales:getByTill',     h('domain:sales:getByTill',     sales.getSalesByTillCode))

  // ── EXPENSES ──
  ipcMain.handle('domain:expenses:add',    h('domain:expenses:add',    expenses.addExpense))
  ipcMain.handle('domain:expenses:getAll', h('domain:expenses:getAll', expenses.getExpenses))
  ipcMain.handle('domain:expenses:getById',h('domain:expenses:getById',expenses.getExpenseById))
  ipcMain.handle('domain:expenses:update', h('domain:expenses:update', expenses.updateExpense))
  ipcMain.handle('domain:expenses:delete', h('domain:expenses:delete', expenses.deleteExpense))

  // ── USERS ──
  ipcMain.handle('domain:users:getAll',           h('domain:users:getAll',           users.getUsers))
  ipcMain.handle('domain:users:getByUsername',    h('domain:users:getByUsername',    users.getUserByUsername))
  ipcMain.handle('domain:users:login',            h('domain:users:login',            users.loginUser))
  ipcMain.handle('domain:users:add',              h('domain:users:add',              users.addUser))
  ipcMain.handle('domain:users:update',           h('domain:users:update',           users.updateUser))
  ipcMain.handle('domain:users:deactivate',       h('domain:users:deactivate',       users.deactivateUser))
  ipcMain.handle('domain:users:getAdminCount',    h('domain:users:getAdminCount',    users.getActiveAdminCount))
  ipcMain.handle('domain:users:validatePassword', h('domain:users:validatePassword', users.validateUserPassword))

  // ── SHIFTS ──
  ipcMain.handle('domain:shifts:start',           h('domain:shifts:start',           shifts.startShift))
  ipcMain.handle('domain:shifts:updateSales',     h('domain:shifts:updateSales',     shifts.updateShiftSalesForPaymentMethod))
  ipcMain.handle('domain:shifts:close',           h('domain:shifts:close',           shifts.closeShift))
  ipcMain.handle('domain:shifts:getById',         h('domain:shifts:getById',         shifts.getShiftById))
  ipcMain.handle('domain:shifts:getCurrent',      h('domain:shifts:getCurrent',      shifts.getCurrentShift))
  ipcMain.handle('domain:shifts:getExistingOpen', h('domain:shifts:getExistingOpen', shifts.getExistingOpenShift))
  ipcMain.handle('domain:shifts:getByCashier',    h('domain:shifts:getByCashier',    shifts.getShiftsByCashier))
  ipcMain.handle('domain:shifts:getAll',          h('domain:shifts:getAll',          shifts.getAllShifts))
  ipcMain.handle('domain:shifts:getActive',       h('domain:shifts:getActive',       shifts.getActiveShifts))
  ipcMain.handle('domain:shifts:getSummary',      h('domain:shifts:getSummary',      shifts.getShiftSummary))
  ipcMain.handle('domain:shifts:reopen',          h('domain:shifts:reopen',          shifts.reopenShift))
  ipcMain.handle('domain:shifts:previewOrphaned',   h('domain:shifts:previewOrphaned',   shifts.previewOrphanedSales))
  ipcMain.handle('domain:shifts:reconcileOrphaned', h('domain:shifts:reconcileOrphaned', shifts.reconcileOrphanedSales))

  // closeAll runs locally (admin is always on main machine) and broadcasts to all renderer windows
  // so cashiers get the force-close notification immediately without waiting for the next LAN sync.
  ipcMain.handle('domain:shifts:closeAll', (event, ...args) => {
    try {
      const result = shifts.closeAllOpenShifts(...args)
      try {
        const { BrowserWindow } = require('electron')
        BrowserWindow.getAllWindows().forEach(win => {
          if (!win.isDestroyed()) win.webContents.send('shift:force-closed', { timestamp: Date.now() })
        })
      } catch (_) {}
      return result
    } catch (err) {
      return { __error: err.message }
    }
  })

  // ── NOTIFICATIONS ──
  ipcMain.handle('domain:notifications:create',          h('domain:notifications:create',          notifications.createNotification))
  ipcMain.handle('domain:notifications:getActive',       h('domain:notifications:getActive',       notifications.getActiveNotifications))
  ipcMain.handle('domain:notifications:getAll',          h('domain:notifications:getAll',          notifications.getAllNotifications))
  ipcMain.handle('domain:notifications:clearForProduct', h('domain:notifications:clearForProduct', notifications.clearNotificationsForProduct))
  ipcMain.handle('domain:notifications:markRead',        h('domain:notifications:markRead',        notifications.markNotificationAsRead))
  ipcMain.handle('domain:notifications:markAllRead',     h('domain:notifications:markAllRead',     notifications.markAllNotificationsAsRead))
  ipcMain.handle('domain:notifications:delete',          h('domain:notifications:delete',          notifications.deleteNotification))
  ipcMain.handle('domain:notifications:deleteAllRead',   h('domain:notifications:deleteAllRead',   notifications.deleteAllReadNotifications))

  // ── REPORTS ──
  ipcMain.handle('domain:reports:getDashboard',        h('domain:reports:getDashboard',        reports.getDashboardStats))
  ipcMain.handle('domain:reports:getSalesDay',         h('domain:reports:getSalesDay',         reports.getSalesForDay))
  ipcMain.handle('domain:reports:getDailyRev',         h('domain:reports:getDailyRev',         reports.getDailyRevenue))
  ipcMain.handle('domain:reports:getDailyCOGS',        h('domain:reports:getDailyCOGS',        reports.getDailyCOGS))
  ipcMain.handle('domain:reports:getMonthly',          h('domain:reports:getMonthly',          reports.getMonthlyData))
  ipcMain.handle('domain:reports:getRecent',           h('domain:reports:getRecent',           reports.getRecentTransactions))
  ipcMain.handle('domain:reports:getLowStock',         h('domain:reports:getLowStock',         reports.getLowStockItems))
  ipcMain.handle('domain:reports:getStockValue',       h('domain:reports:getStockValue',       reports.getStockValue))
  ipcMain.handle('domain:reports:getManagerAnalytics', h('domain:reports:getManagerAnalytics', reports.getManagerAnalytics))

  // ── AUDIT ──
  ipcMain.handle('domain:audit:log',       h('domain:audit:log',       audit.logAuditAction))
  ipcMain.handle('domain:audit:getLog',    h('domain:audit:getLog',    audit.getAuditLog))
  ipcMain.handle('domain:audit:getEntity', h('domain:audit:getEntity', audit.getEntityAuditTrail))
  ipcMain.handle('domain:audit:getRecent', h('domain:audit:getRecent', audit.getRecentAuditActions))
  ipcMain.handle('domain:audit:cleanup',   h('domain:audit:cleanup',   audit.cleanupOldAuditLogs))

  // ── EOD ──
  ipcMain.handle('domain:eod:add',       h('domain:eod:add',       eod.addEndOfDay))
  ipcMain.handle('domain:eod:getAll',    h('domain:eod:getAll',    eod.getEndOfDayRecords))
  ipcMain.handle('domain:eod:getByDate', h('domain:eod:getByDate', eod.getEndOfDayByDate))

  // ── BRANCHES ──
  ipcMain.handle('domain:branches:getAll',  h('domain:branches:getAll',  branches.getBranches))
  ipcMain.handle('domain:branches:getById', h('domain:branches:getById', branches.getBranchById))
  ipcMain.handle('domain:branches:add',     h('domain:branches:add',     branches.addBranch))
  ipcMain.handle('domain:branches:update',  h('domain:branches:update',  branches.updateBranch))
  ipcMain.handle('domain:branches:delete',  h('domain:branches:delete',  branches.deleteBranch))

  // ── HOLDS ──
  ipcMain.handle('domain:holds:create',         h('domain:holds:create',         holds.createHold))
  ipcMain.handle('domain:holds:getByShift',     h('domain:holds:getByShift',     holds.getHoldsByShift))
  ipcMain.handle('domain:holds:deleteOnLogout', h('domain:holds:deleteOnLogout', holds.deleteHoldsOnLogout))
  ipcMain.handle('domain:holds:release',        h('domain:holds:release',        holds.releaseHold))

  // ── BACKUP (always local — not routed through LAN) ──
  ipcMain.handle('domain:backup:exportAsFile',   (event, filename) => backup.exportBackupAsFile(backupsDir, filename))
  ipcMain.handle('domain:backup:importFromFile', wrap(backup.importBackupFromFile))
}

module.exports = { registerAll, updateMakeHandler }
