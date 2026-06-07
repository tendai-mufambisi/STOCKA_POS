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

function wrap(fn) {
  return (event, ...args) => {
    try { return fn(...args) }
    catch (err) { return { __error: err.message } }
  }
}

function registerAll(ipcMain, userDataPath) {
  const path = require('path')
  const backupsDir = path.join(userDataPath, 'backups')

  // ── SHOP ──
  ipcMain.handle('domain:shop:get',        wrap(shop.getShop))
  ipcMain.handle('domain:shop:init',       wrap(shop.initializeShop))
  ipcMain.handle('domain:shop:update',     wrap(shop.updateShop))
  ipcMain.handle('domain:shop:resetPin',   wrap(shop.resetOwnerPin))

  // ── PRODUCTS ──
  ipcMain.handle('domain:products:getAll',          wrap(products.getProducts))
  ipcMain.handle('domain:products:getById',         wrap(products.getProductById))
  ipcMain.handle('domain:products:add',             wrap(products.addProduct))
  ipcMain.handle('domain:products:update',          wrap(products.updateProduct))
  ipcMain.handle('domain:products:delete',          wrap(products.deleteProduct))
  ipcMain.handle('domain:products:updateQty',       wrap(products.updateProductQuantity))
  ipcMain.handle('domain:products:updateImage',     wrap(products.updateProductImage))
  ipcMain.handle('domain:products:updateLastSold',  wrap(products.updateProductLastSoldDate))
  ipcMain.handle('domain:products:getLatestPrice',  wrap(products.getLatestProductPrice))
  ipcMain.handle('domain:products:getAllCostPrices',wrap(products.getAllLatestCostPrices))
  ipcMain.handle('domain:products:getMostSold',     wrap(products.getMostSoldProducts))

  // ── SUPPLIERS ──
  ipcMain.handle('domain:suppliers:getAll',          wrap(suppliers.getSuppliers))
  ipcMain.handle('domain:suppliers:getById',         wrap(suppliers.getSupplierById))
  ipcMain.handle('domain:suppliers:add',             wrap(suppliers.addSupplier))
  ipcMain.handle('domain:suppliers:update',          wrap(suppliers.updateSupplier))
  ipcMain.handle('domain:suppliers:delete',          wrap(suppliers.deleteSupplier))
  ipcMain.handle('domain:suppliers:getPurchaseHistory',  wrap(suppliers.getSupplierPurchaseHistory))
  ipcMain.handle('domain:suppliers:getProductHistory',   wrap(suppliers.getProductPurchaseHistory))

  // ── STOCK ──
  ipcMain.handle('domain:stock:addReceiving',      wrap(stock.addStockReceiving))
  ipcMain.handle('domain:stock:getAll',            wrap(stock.getStockReceivings))
  ipcMain.handle('domain:stock:getById',           wrap(stock.getStockReceivingById))
  ipcMain.handle('domain:stock:getAllPurchases',   wrap(stock.getAllPurchaseHistory))
  ipcMain.handle('domain:stock:recordDirect',      wrap(stock.recordDirectPurchase))
  ipcMain.handle('domain:stock:getDeadStock',      wrap(stock.getDeadStockProducts))
  ipcMain.handle('domain:stock:getRestock',        wrap(stock.getRestockNeeded))
  ipcMain.handle('domain:stock:getVelocity',       wrap(stock.getProductSalesVelocity))
  ipcMain.handle('domain:stock:getExpiring',       wrap(stock.getExpiringProducts))
  ipcMain.handle('domain:stock:getExpired',        wrap(stock.getExpiredProducts))
  ipcMain.handle('domain:stock:getExpiryReport',   wrap(stock.getExpiryReport))

  // ── SALES ──
  ipcMain.handle('domain:sales:add',              wrap(sales.addSale))
  ipcMain.handle('domain:sales:getAll',           wrap(sales.getSales))
  ipcMain.handle('domain:sales:getById',          wrap(sales.getSaleById))
  ipcMain.handle('domain:sales:getItems',         wrap(sales.getSaleItems))
  ipcMain.handle('domain:sales:hold',             wrap(sales.holdSale))
  ipcMain.handle('domain:sales:getHeld',          wrap(sales.getHeldSales))
  ipcMain.handle('domain:sales:recall',           wrap(sales.recallHeldSale))
  ipcMain.handle('domain:sales:discard',          wrap(sales.discardHeldSale))
  ipcMain.handle('domain:sales:void',             wrap(sales.voidSale))
  ipcMain.handle('domain:sales:complete',         wrap(sales.completeHeldSale))
  ipcMain.handle('domain:sales:getVoided',        wrap(sales.getVoidedSales))
  ipcMain.handle('domain:sales:getLastReceipt',   wrap(sales.getLastReceiptNumber))
  ipcMain.handle('domain:sales:getReceipt',       wrap(sales.getReceiptBySaleId))
  ipcMain.handle('domain:sales:updateReceipt',    wrap(sales.updateSaleReceiptNumber))

  // ── EXPENSES ──
  ipcMain.handle('domain:expenses:add',    wrap(expenses.addExpense))
  ipcMain.handle('domain:expenses:getAll', wrap(expenses.getExpenses))
  ipcMain.handle('domain:expenses:getById',wrap(expenses.getExpenseById))
  ipcMain.handle('domain:expenses:update', wrap(expenses.updateExpense))
  ipcMain.handle('domain:expenses:delete', wrap(expenses.deleteExpense))

  // ── USERS ──
  ipcMain.handle('domain:users:getAll',          wrap(users.getUsers))
  ipcMain.handle('domain:users:getByUsername',   wrap(users.getUserByUsername))
  ipcMain.handle('domain:users:login',           wrap(users.loginUser))
  ipcMain.handle('domain:users:add',             wrap(users.addUser))
  ipcMain.handle('domain:users:update',          wrap(users.updateUser))
  ipcMain.handle('domain:users:deactivate',       wrap(users.deactivateUser))
  ipcMain.handle('domain:users:getAdminCount',   wrap(users.getActiveAdminCount))
  ipcMain.handle('domain:users:validatePassword', wrap(users.validateUserPassword))

  // ── SHIFTS ──
  ipcMain.handle('domain:shifts:start',           wrap(shifts.startShift))
  ipcMain.handle('domain:shifts:updateSales',     wrap(shifts.updateShiftSalesForPaymentMethod))
  ipcMain.handle('domain:shifts:close',           wrap(shifts.closeShift))
  ipcMain.handle('domain:shifts:getById',         wrap(shifts.getShiftById))
  ipcMain.handle('domain:shifts:getCurrent',      wrap(shifts.getCurrentShift))
  ipcMain.handle('domain:shifts:getExistingOpen', wrap(shifts.getExistingOpenShift))
  ipcMain.handle('domain:shifts:getByCashier',    wrap(shifts.getShiftsByCashier))
  ipcMain.handle('domain:shifts:getAll',          wrap(shifts.getAllShifts))
  ipcMain.handle('domain:shifts:getActive',       wrap(shifts.getActiveShifts))
  ipcMain.handle('domain:shifts:getSummary',      wrap(shifts.getShiftSummary))

  // ── NOTIFICATIONS ──
  ipcMain.handle('domain:notifications:create',          wrap(notifications.createNotification))
  ipcMain.handle('domain:notifications:getActive',       wrap(notifications.getActiveNotifications))
  ipcMain.handle('domain:notifications:getAll',          wrap(notifications.getAllNotifications))
  ipcMain.handle('domain:notifications:clearForProduct', wrap(notifications.clearNotificationsForProduct))
  ipcMain.handle('domain:notifications:markRead',        wrap(notifications.markNotificationAsRead))

  // ── REPORTS ──
  ipcMain.handle('domain:reports:getDashboard',  wrap(reports.getDashboardStats))
  ipcMain.handle('domain:reports:getSalesDay',   wrap(reports.getSalesForDay))
  ipcMain.handle('domain:reports:getDailyRev',   wrap(reports.getDailyRevenue))
  ipcMain.handle('domain:reports:getDailyCOGS',  wrap(reports.getDailyCOGS))
  ipcMain.handle('domain:reports:getMonthly',    wrap(reports.getMonthlyData))
  ipcMain.handle('domain:reports:getRecent',     wrap(reports.getRecentTransactions))
  ipcMain.handle('domain:reports:getLowStock',   wrap(reports.getLowStockItems))
  ipcMain.handle('domain:reports:getStockValue', wrap(reports.getStockValue))
  ipcMain.handle('domain:reports:getManagerAnalytics', wrap(reports.getManagerAnalytics))

  // ── AUDIT ──
  ipcMain.handle('domain:audit:log',         wrap(audit.logAuditAction))
  ipcMain.handle('domain:audit:getLog',      wrap(audit.getAuditLog))
  ipcMain.handle('domain:audit:getEntity',   wrap(audit.getEntityAuditTrail))
  ipcMain.handle('domain:audit:getRecent',   wrap(audit.getRecentAuditActions))
  ipcMain.handle('domain:audit:cleanup',     wrap(audit.cleanupOldAuditLogs))

  // ── EOD ──
  ipcMain.handle('domain:eod:add',      wrap(eod.addEndOfDay))
  ipcMain.handle('domain:eod:getAll',   wrap(eod.getEndOfDayRecords))
  ipcMain.handle('domain:eod:getByDate',wrap(eod.getEndOfDayByDate))

  // ── BRANCHES ──
  ipcMain.handle('domain:branches:getAll', wrap(branches.getBranches))
  ipcMain.handle('domain:branches:getById',wrap(branches.getBranchById))
  ipcMain.handle('domain:branches:add',    wrap(branches.addBranch))
  ipcMain.handle('domain:branches:update', wrap(branches.updateBranch))
  ipcMain.handle('domain:branches:delete', wrap(branches.deleteBranch))

  // ── HOLDS ──
  ipcMain.handle('domain:holds:create',          wrap(holds.createHold))
  ipcMain.handle('domain:holds:getByShift',      wrap(holds.getHoldsByShift))
  ipcMain.handle('domain:holds:deleteOnLogout',  wrap(holds.deleteHoldsOnLogout))
  ipcMain.handle('domain:holds:release',         wrap(holds.releaseHold))

  // ── BACKUP (export/import JSON) ──
  ipcMain.handle('domain:backup:exportAsFile',    (event, filename) => backup.exportBackupAsFile(backupsDir, filename))
  ipcMain.handle('domain:backup:importFromFile',  wrap(backup.importBackupFromFile))
}

module.exports = { registerAll }
