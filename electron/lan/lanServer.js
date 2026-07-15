const http = require('http')
const logger = require('../logger')
const shop         = require('../database/domains/shop')
const products     = require('../database/domains/products')
const suppliers    = require('../database/domains/suppliers')
const stockDomain  = require('../database/domains/stock')
const sales        = require('../database/domains/sales')
const expenses     = require('../database/domains/expenses')
const users        = require('../database/domains/users')
const shifts       = require('../database/domains/shifts')
const notifications= require('../database/domains/notifications')
const reports      = require('../database/domains/reports')
const branches     = require('../database/domains/branches')
const audit        = require('../database/domains/audit')
const eod          = require('../database/domains/eod')
const holds        = require('../database/domains/holds')
const { allocateSatelliteCode } = require('./tillIdentity')

// Channels that mutate data — used to decide what to broadcast over SSE and
// notify the main-window renderer after a satellite write via /lan/invoke.
const WRITE_CHANNELS_SERVER = new Set([
  'domain:shop:init', 'domain:shop:update', 'domain:shop:resetPin',
  'domain:products:add', 'domain:products:update', 'domain:products:delete',
  'domain:products:updateQty', 'domain:products:updateImage', 'domain:products:updateLastSold',
  'domain:suppliers:add', 'domain:suppliers:update', 'domain:suppliers:delete',
  'domain:stock:addReceiving', 'domain:stock:recordDirect', 'domain:stock:importReceivings', 'domain:stock:recordInitialCost',
  'domain:stock:reconcileProduct', 'domain:stock:reconcileProducts', 'domain:stock:correctReceiving',
  'domain:sales:add', 'domain:sales:void', 'domain:sales:hold', 'domain:sales:recall',
  'domain:sales:discard', 'domain:sales:complete', 'domain:sales:updateReceipt',
  'domain:expenses:add', 'domain:expenses:update', 'domain:expenses:delete',
  'domain:users:add', 'domain:users:update', 'domain:users:deactivate',
  'domain:shifts:start', 'domain:shifts:close', 'domain:shifts:updateSales', 'domain:shifts:closeAll', 'domain:shifts:reopen',
  'domain:shifts:reconcileOrphaned',
  'domain:notifications:create', 'domain:notifications:clearForProduct', 'domain:notifications:markRead',
  'domain:eod:add',
  'domain:audit:log', 'domain:audit:cleanup',
  'domain:branches:add', 'domain:branches:update', 'domain:branches:delete',
  'domain:holds:create', 'domain:holds:deleteOnLogout', 'domain:holds:release',
])

// SSE clients waiting for push notifications: clientId → ServerResponse
const sseClients = new Map()

// Called after any write via /lan/invoke — pushes a tiny event so satellites
// call syncFromServer() immediately instead of waiting for the poll interval.
function broadcastChange(channel) {
  if (sseClients.size === 0) return
  const event = `data: ${JSON.stringify({ type: 'change', channel })}\n\n`
  for (const [id, res] of sseClients) {
    try { res.write(event) }
    catch (_) { sseClients.delete(id) }
  }
}

// Called after EOD is saved — pushes a dedicated event so satellites can show
// a day-closed modal without waiting for the next sync cycle.
function broadcastEodClosed(date, closedBy) {
  if (sseClients.size === 0) return
  const event = `data: ${JSON.stringify({ type: 'eod_closed', date, closedBy })}\n\n`
  for (const [id, res] of sseClients) {
    try { res.write(event) }
    catch (_) { sseClients.delete(id) }
  }
}

// Called after Main wipes/resets its data. Delta sync can't remove rows on
// satellites (upsert-only), so they must re-mirror from a full snapshot.
function broadcastResyncRequired() {
  if (sseClients.size === 0) return
  const event = `data: ${JSON.stringify({ type: 'resync_required' })}\n\n`
  for (const [id, res] of sseClients) {
    try { res.write(event) }
    catch (_) { sseClients.delete(id) }
  }
}

// Set by createServer(); used inside route handlers (defined at module scope).
let _notifyMain = null
let _userDataPath = null

// Unified dispatch table: maps IPC channel → domain function.
// Used by POST /lan/invoke so client satellites can proxy any domain call.
const DISPATCH = {
  'domain:shop:get':       () => shop.getShop(),
  'domain:shop:init':      (...a) => shop.initializeShop(...a),
  'domain:shop:update':    (...a) => shop.updateShop(...a),
  'domain:shop:resetPin':  (...a) => shop.resetOwnerPin(...a),

  'domain:products:getAll':          () => products.getProducts(),
  'domain:products:getById':         (...a) => products.getProductById(...a),
  'domain:products:add':             (...a) => products.addProduct(...a),
  'domain:products:update':          (...a) => products.updateProduct(...a),
  'domain:products:delete':          (...a) => products.deleteProduct(...a),
  'domain:products:updateQty':       (...a) => products.updateProductQuantity(...a),
  'domain:products:updateImage':     (...a) => products.updateProductImage(...a),
  'domain:products:updateLastSold':  (...a) => products.updateProductLastSoldDate(...a),
  'domain:products:getLatestPrice':  (...a) => products.getLatestProductPrice(...a),
  'domain:products:getAllCostPrices': () => products.getAllLatestCostPrices(),
  'domain:products:getMostSold':     (...a) => products.getMostSoldProducts(...a),

  'domain:suppliers:getAll':             () => suppliers.getSuppliers(),
  'domain:suppliers:getById':            (...a) => suppliers.getSupplierById(...a),
  'domain:suppliers:add':                (...a) => suppliers.addSupplier(...a),
  'domain:suppliers:update':             (...a) => suppliers.updateSupplier(...a),
  'domain:suppliers:delete':             (...a) => suppliers.deleteSupplier(...a),
  'domain:suppliers:getPurchaseHistory': (...a) => suppliers.getSupplierPurchaseHistory(...a),
  'domain:suppliers:getProductHistory':  (...a) => suppliers.getProductPurchaseHistory(...a),

  'domain:stock:addReceiving':   (...a) => stockDomain.addStockReceiving(...a),
  'domain:stock:getAll':         () => stockDomain.getStockReceivings(),
  'domain:stock:getById':        (...a) => stockDomain.getStockReceivingById(...a),
  'domain:stock:getAllPurchases': () => stockDomain.getAllPurchaseHistory(),
  'domain:stock:recordDirect':   (...a) => stockDomain.recordDirectPurchase(...a),
  'domain:stock:getDeadStock':   (...a) => stockDomain.getDeadStockProducts(...a),
  'domain:stock:getRestock':     () => stockDomain.getRestockNeeded(),
  'domain:stock:getVelocity':    (...a) => stockDomain.getProductSalesVelocity(...a),
  'domain:stock:getExpiring':    (...a) => stockDomain.getExpiringProducts(...a),
  'domain:stock:getExpired':     () => stockDomain.getExpiredProducts(),
  'domain:stock:getExpiryReport':() => stockDomain.getExpiryReport(),
  'domain:stock:importReceivings':    (...a) => stockDomain.importStockReceivings(...a),
  'domain:stock:recordInitialCost':   (...a) => stockDomain.recordInitialCost(...a),
  'domain:stock:reconcileProduct':    (...a) => stockDomain.reconcileProduct(...a),
  'domain:stock:reconcileProducts':   (...a) => stockDomain.reconcileProducts(...a),
  'domain:stock:correctReceiving':    (...a) => stockDomain.correctStockReceiving(...a),

  'domain:sales:add':           (...a) => sales.addSale(...a),
  'domain:sales:getAll':        () => sales.getSales(),
  'domain:sales:getById':       (...a) => sales.getSaleById(...a),
  'domain:sales:getItems':      (...a) => sales.getSaleItems(...a),
  'domain:sales:hold':          (...a) => sales.holdSale(...a),
  'domain:sales:getHeld':       () => sales.getHeldSales(),
  'domain:sales:recall':        (...a) => sales.recallHeldSale(...a),
  'domain:sales:discard':       (...a) => sales.discardHeldSale(...a),
  'domain:sales:void':          (...a) => sales.voidSale(...a),
  'domain:sales:complete':      (...a) => sales.completeHeldSale(...a),
  'domain:sales:getVoided':     () => sales.getVoidedSales(),
  'domain:sales:getLastReceipt':() => sales.getLastReceiptNumber(),
  'domain:sales:getReceipt':    (...a) => sales.getReceiptBySaleId(...a),
  'domain:sales:updateReceipt': (...a) => sales.updateSaleReceiptNumber(...a),
  'domain:sales:getByShift':    (...a) => sales.getSalesByShift(...a),
  'domain:sales:getByTill':     (...a) => sales.getSalesByTillCode(...a),

  'domain:expenses:add':    (...a) => expenses.addExpense(...a),
  'domain:expenses:getAll': () => expenses.getExpenses(),
  'domain:expenses:getById':(...a) => expenses.getExpenseById(...a),
  'domain:expenses:update': (...a) => expenses.updateExpense(...a),
  'domain:expenses:delete': (...a) => expenses.deleteExpense(...a),

  'domain:users:getAll':         () => users.getUsers(),
  'domain:users:getByUsername':  (...a) => users.getUserByUsername(...a),
  'domain:users:login':          (...a) => users.loginUser(...a),
  'domain:users:add':            (...a) => users.addUser(...a),
  'domain:users:update':         (...a) => users.updateUser(...a),
  'domain:users:deactivate':     (...a) => users.deactivateUser(...a),
  'domain:users:getAdminCount':  () => users.getActiveAdminCount(),
  'domain:users:validatePassword':(...a) => users.validateUserPassword(...a),

  'domain:shifts:start':          (...a) => shifts.startShift(...a),
  'domain:shifts:updateSales':    (...a) => shifts.updateShiftSalesForPaymentMethod(...a),
  'domain:shifts:close':          (...a) => shifts.closeShift(...a),
  'domain:shifts:getById':        (...a) => shifts.getShiftById(...a),
  'domain:shifts:getCurrent':     (...a) => shifts.getCurrentShift(...a),
  'domain:shifts:getExistingOpen':(...a) => shifts.getExistingOpenShift(...a),
  'domain:shifts:getByCashier':   (...a) => shifts.getShiftsByCashier(...a),
  'domain:shifts:getAll':         (...a) => shifts.getAllShifts(...a),
  'domain:shifts:getActive':      () => shifts.getActiveShifts(),
  'domain:shifts:getSummary':     (...a) => shifts.getShiftSummary(...a),
  'domain:shifts:closeAll':       (...a) => shifts.closeAllOpenShifts(...a),
  'domain:shifts:reopen':         (...a) => shifts.reopenShift(...a),
  'domain:shifts:previewOrphaned':   (...a) => shifts.previewOrphanedSales(...a),
  'domain:shifts:reconcileOrphaned': (...a) => shifts.reconcileOrphanedSales(...a),

  'domain:notifications:create':          (...a) => notifications.createNotification(...a),
  'domain:notifications:getActive':       () => notifications.getActiveNotifications(),
  'domain:notifications:getAll':          () => notifications.getAllNotifications(),
  'domain:notifications:clearForProduct': (...a) => notifications.clearNotificationsForProduct(...a),
  'domain:notifications:markRead':        (...a) => notifications.markNotificationAsRead(...a),

  'domain:reports:getDashboard':       () => reports.getDashboardStats(),
  'domain:reports:getSalesDay':        (...a) => reports.getSalesForDay(...a),
  'domain:reports:getDailyRev':        (...a) => reports.getDailyRevenue(...a),
  'domain:reports:getDailyCOGS':       (...a) => reports.getDailyCOGS(...a),
  'domain:reports:getMonthly':         (...a) => reports.getMonthlyData(...a),
  'domain:reports:getRecent':          (...a) => reports.getRecentTransactions(...a),
  'domain:reports:getLowStock':        () => reports.getLowStockItems(),
  'domain:reports:getStockValue':      () => reports.getStockValue(),
  'domain:reports:getManagerAnalytics':() => reports.getManagerAnalytics(),

  'domain:audit:log':       (...a) => audit.logAuditAction(...a),
  'domain:audit:getLog':    (...a) => audit.getAuditLog(...a),
  'domain:audit:getEntity': (...a) => audit.getEntityAuditTrail(...a),
  'domain:audit:getRecent': () => audit.getRecentAuditActions(),
  'domain:audit:cleanup':   () => audit.cleanupOldAuditLogs(),

  'domain:eod:add':       (...a) => eod.addEndOfDay(...a),
  'domain:eod:getAll':    () => eod.getEndOfDayRecords(),
  'domain:eod:getByDate': (...a) => eod.getEndOfDayByDate(...a),

  'domain:branches:getAll': () => branches.getBranches(),
  'domain:branches:getById':(...a) => branches.getBranchById(...a),
  'domain:branches:add':    (...a) => branches.addBranch(...a),
  'domain:branches:update': (...a) => branches.updateBranch(...a),
  'domain:branches:delete': (...a) => branches.deleteBranch(...a),

  'domain:holds:create':        (...a) => holds.createHold(...a),
  'domain:holds:getByShift':    (...a) => holds.getHoldsByShift(...a),
  'domain:holds:deleteOnLogout':(...a) => holds.deleteHoldsOnLogout(...a),
  'domain:holds:release':       (...a) => holds.releaseHold(...a),
}

// Track connected satellite clients: ip → { ip, lastSeen }
const clients = new Map()

// ── Pairing (PIN-based secret exchange, replaces manual lan_config.json copy) ──
const PAIR_TTL_MS = 15 * 60 * 1000
const PAIR_MAX_ATTEMPTS = 8

let _pairing = null // { code, expiresAt, attempts }

function generatePairingCode() {
  const code = String(Math.floor(100000 + Math.random() * 900000))
  _pairing = { code, expiresAt: Date.now() + PAIR_TTL_MS, attempts: 0 }
  return { code: _pairing.code, expiresAt: _pairing.expiresAt }
}

function getPairingInfo() {
  if (!_pairing || Date.now() > _pairing.expiresAt) return null
  return { code: _pairing.code, expiresAt: _pairing.expiresAt }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function send(res, status, data) {
  const body = JSON.stringify(data)
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    'X-Stocka-Server': '1'
  })
  res.end(body)
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = ''
    let size = 0
    req.on('data', chunk => {
      size += chunk.length
      if (size > 2_000_000) { req.destroy(); return reject(new Error('Request too large')) }
      data += chunk
    })
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}) }
      catch (e) { reject(new Error('Invalid JSON')) }
    })
    req.on('error', reject)
  })
}

// Simple path matcher: returns params object if pattern matches, null otherwise.
// Supports :param segments. Does NOT support wildcards.
function match(pattern, pathname) {
  const pp = pattern.split('/')
  const up = pathname.split('/')
  if (pp.length !== up.length) return null
  const params = {}
  for (let i = 0; i < pp.length; i++) {
    if (pp[i].startsWith(':')) {
      params[pp[i].slice(1)] = decodeURIComponent(up[i])
    } else if (pp[i] !== up[i]) {
      return null
    }
  }
  return params
}

// ── Route table ──────────────────────────────────────────────────────────────
// [METHOD, PATTERN, HANDLER(req, res, params, query, body)]

const ROUTES = [

  // SSE push — satellites hold this connection open; server sends a tiny event
  // on every write so they call syncFromServer() immediately.
  ['GET', '/lan/events', (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    })
    res.write(':ok\n\n')
    if (req.socket) {
      req.socket.setKeepAlive(true)
      req.socket.setTimeout(0)
    }
    const clientId = `${req.socket?.remoteAddress || 'x'}:${Date.now()}`
    sseClients.set(clientId, res)
    const heartbeat = setInterval(() => {
      try { res.write(':ping\n\n') }
      catch (_) { clearInterval(heartbeat); sseClients.delete(clientId) }
    }, 25000)
    req.on('close', () => { clearInterval(heartbeat); sseClients.delete(clientId) })
    req.on('error', () => { clearInterval(heartbeat); sseClients.delete(clientId) })
    // Returns immediately — response stays open via the stream until client disconnects
  }],

  // UNIFIED INVOKE — used by satellite clients to proxy any domain call
  ['POST', '/lan/invoke', async (req, res, _p, _q, body) => {
    const { channel, args = [] } = body
    if (!channel || typeof channel !== 'string') return send(res, 400, { error: 'Missing channel' })
    const fn = DISPATCH[channel]
    if (!fn) return send(res, 404, { error: `Unknown channel: ${channel}` })
    // Tag audit entries with the satellite's IP so the admin log shows which machine acted
    const clientIp = req.socket.remoteAddress || 'unknown'
    audit.setRequestMachine(clientIp)
    try {
      const result = fn(...args)
      audit.clearRequestMachine()
      send(res, 200, { result })
      if (WRITE_CHANNELS_SERVER.has(channel)) {
        broadcastChange(channel)
        if (channel === 'domain:eod:add') broadcastEodClosed(args[0]?.date, args[0]?.cashier)
        if (_notifyMain) _notifyMain('lan:data-changed', { channel })
      }
    } catch (err) {
      audit.clearRequestMachine()
      const status = err.message.includes('Insufficient stock') ? 409
        : err.message.includes('not found') ? 404 : 500
      send(res, status, { error: err.message })
    }
  }],

  // SHOP
  ['GET',  '/lan/shop',       async (req, res) => send(res, 200, shop.getShop())],
  ['PUT',  '/lan/shop',       async (req, res, _p, _q, body) => { shop.updateShop(body.id, body); send(res, 200, { ok: true }) }],

  // PRODUCTS
  ['GET',  '/lan/products',          async (req, res) => send(res, 200, products.getProducts())],
  ['POST', '/lan/products',          async (req, res, _p, _q, body) => send(res, 201, { id: products.addProduct(body) })],
  ['PUT',  '/lan/products/:id',      async (req, res, p, _q, body) => { products.updateProduct(p.id, body); send(res, 200, { ok: true }) }],
  ['DELETE','/lan/products/:id',     async (req, res, p) => { products.deleteProduct(p.id); send(res, 200, { ok: true }) }],
  ['PUT',  '/lan/products/:id/qty',  async (req, res, p, _q, body) => { products.updateProductQuantity(p.id, body.qty); send(res, 200, { ok: true }) }],
  ['GET',  '/lan/products/most-sold',async (req, res, _p, q) => send(res, 200, products.getMostSoldProducts(parseInt(q.get('limit') || '10')))],
  ['GET',  '/lan/products/prices',   async (req, res) => send(res, 200, products.getAllLatestCostPrices())],

  // SUPPLIERS
  ['GET',  '/lan/suppliers',       async (req, res) => send(res, 200, suppliers.getSuppliers())],
  ['POST', '/lan/suppliers',       async (req, res, _p, _q, body) => { suppliers.addSupplier(body); send(res, 201, { ok: true }) }],
  ['PUT',  '/lan/suppliers/:id',   async (req, res, p, _q, body) => { suppliers.updateSupplier(p.id, body); send(res, 200, { ok: true }) }],
  ['DELETE','/lan/suppliers/:id',  async (req, res, p) => { suppliers.deleteSupplier(p.id); send(res, 200, { ok: true }) }],

  // STOCK
  ['GET',  '/lan/stock/receivings',  async (req, res) => send(res, 200, stockDomain.getStockReceivings())],
  ['POST', '/lan/stock/receivings',  async (req, res, _p, _q, body) => { stockDomain.addStockReceiving(body); send(res, 201, { ok: true }) }],
  ['GET',  '/lan/stock/purchases',   async (req, res) => send(res, 200, stockDomain.getAllPurchaseHistory())],
  ['POST', '/lan/stock/direct',      async (req, res, _p, _q, body) => { stockDomain.recordDirectPurchase(body); send(res, 201, { ok: true }) }],
  ['GET',  '/lan/stock/restock',     async (req, res) => send(res, 200, stockDomain.getRestockNeeded())],
  ['GET',  '/lan/stock/dead',        async (req, res, _p, q) => send(res, 200, stockDomain.getDeadStockProducts(parseInt(q.get('days') || '30')))],
  ['GET',  '/lan/stock/velocity',    async (req, res, _p, q) => send(res, 200, stockDomain.getProductSalesVelocity(parseInt(q.get('days') || '30')))],

  // SALES — specific paths before parameterised ones
  ['GET',  '/lan/sales/held',        async (req, res) => send(res, 200, sales.getHeldSales())],
  ['GET',  '/lan/sales/voided',      async (req, res) => send(res, 200, sales.getVoidedSales())],
  ['GET',  '/lan/sales',             async (req, res) => send(res, 200, sales.getSales())],
  ['POST', '/lan/sales',             async (req, res, _p, _q, body) => {
    // Critical write: stock guard + atomic transaction inside sales.addSale
    const saleId = sales.addSale(body.sale, body.items)
    send(res, 201, { id: saleId })
  }],
  ['GET',  '/lan/sales/:id',         async (req, res, p) => {
    const s = sales.getSaleById(parseInt(p.id)); s ? send(res, 200, s) : send(res, 404, { error: 'Not found' })
  }],
  ['GET',  '/lan/sales/:id/items',   async (req, res, p) => send(res, 200, sales.getSaleItems(parseInt(p.id)))],
  ['POST', '/lan/sales/:id/void',    async (req, res, p, _q, body) => {
    sales.voidSale(parseInt(p.id), body.reason, body.voidedBy); send(res, 200, { ok: true })
  }],
  ['POST', '/lan/sales/:id/hold',    async (req, res, p, _q, body) => {
    sales.holdSale(parseInt(p.id), body.name); send(res, 200, { ok: true })
  }],
  ['POST', '/lan/sales/:id/recall',  async (req, res, p) => send(res, 200, sales.recallHeldSale(parseInt(p.id)))],
  ['POST', '/lan/sales/:id/discard', async (req, res, p) => { sales.discardHeldSale(parseInt(p.id)); send(res, 200, { ok: true }) }],
  ['POST', '/lan/sales/:id/complete',async (req, res, p, _q, body) => {
    const id = sales.completeHeldSale(parseInt(p.id), body.cashTendered, body.changeGiven, body.shiftId)
    send(res, 200, { id })
  }],

  // EXPENSES
  ['GET',  '/lan/expenses',      async (req, res) => send(res, 200, expenses.getExpenses())],
  ['POST', '/lan/expenses',      async (req, res, _p, _q, body) => { expenses.addExpense(body); send(res, 201, { ok: true }) }],
  ['PUT',  '/lan/expenses/:id',  async (req, res, p, _q, body) => { expenses.updateExpense(p.id, body); send(res, 200, { ok: true }) }],
  ['DELETE','/lan/expenses/:id', async (req, res, p) => { expenses.deleteExpense(p.id); send(res, 200, { ok: true }) }],

  // USERS
  ['GET',  '/lan/users',          async (req, res) => send(res, 200, users.getUsers())],
  ['POST', '/lan/users',          async (req, res, _p, _q, body) => { users.addUser(body); send(res, 201, { ok: true }) }],
  ['POST', '/lan/users/login',    async (req, res, _p, _q, body) => {
    const user = users.loginUser(body.username, body.password)
    user ? send(res, 200, user) : send(res, 401, { error: 'Invalid credentials' })
  }],
  ['PUT',  '/lan/users/:id',      async (req, res, p, _q, body) => { users.updateUser(p.id, body); send(res, 200, { ok: true }) }],
  ['POST', '/lan/users/:id/deactivate', async (req, res, p) => { users.deactivateUser(p.id); send(res, 200, { ok: true }) }],

  // SHIFTS
  ['GET',  '/lan/shifts',                 async (req, res, _p, q) => send(res, 200, shifts.getAllShifts(q.get('status')))],
  ['GET',  '/lan/shifts/active',          async (req, res) => send(res, 200, shifts.getActiveShifts())],
  ['POST', '/lan/shifts/start',           async (req, res, _p, _q, body) => {
    const shift = shifts.startShift(body.userData, body.openingFloat, body.branchId)
    send(res, 201, shift)
  }],
  ['GET',  '/lan/shifts/current/:username', async (req, res, p) => {
    const s = shifts.getCurrentShift(decodeURIComponent(p.username))
    s ? send(res, 200, s) : send(res, 404, { error: 'No open shift' })
  }],
  ['GET',  '/lan/shifts/:id',             async (req, res, p) => {
    const s = shifts.getShiftById(parseInt(p.id)); s ? send(res, 200, s) : send(res, 404, { error: 'Not found' })
  }],
  ['POST', '/lan/shifts/:id/close',       async (req, res, p, _q, body) => {
    const s = shifts.closeShift(parseInt(p.id), body.closingFloat, body.notes)
    send(res, 200, s)
  }],
  ['GET',  '/lan/shifts/:id/summary',     async (req, res, p) => send(res, 200, shifts.getShiftSummary(parseInt(p.id)))],

  // NOTIFICATIONS
  ['GET',  '/lan/notifications',          async (req, res) => send(res, 200, notifications.getActiveNotifications())],
  ['POST', '/lan/notifications/:id/read', async (req, res, p) => { notifications.markNotificationAsRead(p.id); send(res, 200, { ok: true }) }],

  // BRANCHES
  ['GET',  '/lan/branches',     async (req, res) => send(res, 200, branches.getBranches())],

  // REPORTS
  ['GET',  '/lan/reports/dashboard',    async (req, res) => send(res, 200, reports.getDashboardStats())],
  ['GET',  '/lan/reports/low-stock',    async (req, res) => send(res, 200, reports.getLowStockItems())],
  ['GET',  '/lan/reports/stock-value',  async (req, res) => send(res, 200, { value: reports.getStockValue() })],
  ['GET',  '/lan/reports/manager',      async (req, res) => send(res, 200, reports.getManagerAnalytics())],
  ['GET',  '/lan/reports/sales/:date',  async (req, res, p) => send(res, 200, reports.getSalesForDay(p.date))],
  ['GET',  '/lan/reports/monthly/:year/:month', async (req, res, p) => send(res, 200, reports.getMonthlyData(p.year, p.month))],

  // DELTA SYNC — returns records newer than ?since= ISO timestamp.
  // users/suppliers/branches/shop are always returned in full — they are small
  // admin-managed tables and updates don't reliably bump a timestamp column.
  ['GET',  '/lan/changes', async (req, res, _p, q) => {
    const since = q.get('since') || '1970-01-01T00:00:00.000Z'
    // SQLite stores datetime as 'YYYY-MM-DD HH:MM:SS' (space, no Z, no milliseconds).
    // JS ISO strings use 'YYYY-MM-DDTHH:MM:SS.mmmZ' (T separator, Z suffix).
    // SQLite string comparison: space (0x20) < T (0x54), so any SQLite-format date
    // is always "less than" a JS ISO string at the same instant — making every delta
    // query return nothing after the first sync. Convert before querying.
    //
    // Overlap window: timestamps have 1-second resolution and the queries use strict '>',
    // so a row written in the same second as the cursor would be skipped forever once the
    // cursor advances. Rewind the cursor 3s; client upserts are INSERT OR REPLACE, so the
    // few re-sent rows are harmless.
    const sinceMs = Date.parse(since)
    const sinceForSql = (Number.isFinite(sinceMs) ? new Date(sinceMs - 3000).toISOString() : since)
      .replace('T', ' ').replace(/\.\d{3}Z?$|Z$/, '')
    const { getDb } = require('../database/index')
    const db = getDb()
    send(res, 200, {
      since,
      fetched_at: new Date().toISOString(),
      products:   db.prepare(`SELECT * FROM products WHERE created_at > ? OR last_sold_date > ? OR sync_updated_at > ?`).all(sinceForSql, sinceForSql, sinceForSql),
      sales:      db.prepare(`SELECT * FROM sales WHERE created_at > ? OR sync_updated_at > ?`).all(sinceForSql, sinceForSql),
      sale_items: db.prepare(`SELECT si.* FROM sale_items si JOIN sales s ON si.sale_id = s.id WHERE s.created_at > ? OR s.sync_updated_at > ?`).all(sinceForSql, sinceForSql),
      expenses:   db.prepare(`SELECT * FROM expenses WHERE created_at > ? OR sync_updated_at > ?`).all(sinceForSql, sinceForSql),
      shifts:     db.prepare(`SELECT * FROM shifts WHERE started_at > ? OR closed_at > ? OR sync_updated_at > ?`).all(sinceForSql, sinceForSql, sinceForSql),
      stock:      db.prepare(`SELECT * FROM stock_receivings WHERE created_at > ?`).all(sinceForSql),
      users:      db.prepare(`SELECT * FROM users`).all(),
      suppliers:  db.prepare(`SELECT * FROM suppliers`).all(),
      branches:   db.prepare(`SELECT * FROM branches`).all(),
      shop:       db.prepare(`SELECT * FROM shops LIMIT 1`).get() || null,
    })
  }],

  // FULL SNAPSHOT — every row of every shared table; used to seed a satellite on first pairing
  // or to force a clean resync. Authenticated (unlike /lan/pair).
  ['GET',  '/lan/snapshot', async (req, res) => {
    const { getDb } = require('../database/index')
    const db = getDb()
    const all = (table) => db.prepare(`SELECT * FROM ${table}`).all()
    send(res, 200, {
      fetched_at:       new Date().toISOString(),
      shop:             shop.getShop(),
      users:            all('users'),
      products:         all('products'),
      suppliers:        all('suppliers'),
      branches:         all('branches'),
      stock_receivings: all('stock_receivings'),
      sales:            all('sales'),
      sale_items:       all('sale_items'),
      expenses:         all('expenses'),
      shifts:           all('shifts'),
      sale_holds:       all('sale_holds'),
      notifications:    all('notifications'),
      end_of_day:       all('end_of_day'),
    })
  }],
]

// ── Server factory ────────────────────────────────────────────────────────────

function createServer(secret, port, notifyMain, userDataPath) {
  _notifyMain = notifyMain || null
  _userDataPath = userDataPath || null
  async function router(req, res) {
    const url = new URL(req.url, 'http://x')
    const pathname = url.pathname

    // Unauthenticated ping — returns server identity only
    if (pathname === '/lan/ping' && req.method === 'GET') {
      const shopInfo = (() => { try { return shop.getShop() } catch (_) { return null } })()
      return send(res, 200, {
        ok: true,
        mode: 'server',
        version: 2,
        shopName: shopInfo?.name || 'Stocka',
        port,
        serverTime: new Date().toISOString(),
      })
    }

    // Unauthenticated pairing — exchanges a one-time PIN for the server's secret
    if (pathname === '/lan/pair' && req.method === 'POST') {
      const remoteIp = req.socket.remoteAddress || 'unknown'
      let pairBody = {}
      try { pairBody = await parseBody(req) } catch (e) {
        logger.warn(`[LAN Server] Pairing request from ${remoteIp} had an invalid body: ${e.message}`)
        return send(res, 400, { error: e.message })
      }

      if (!_pairing || Date.now() > _pairing.expiresAt) {
        logger.warn(`[LAN Server] Pairing attempt from ${remoteIp} rejected — no active code or it expired`)
        return send(res, 410, { error: 'Pairing code expired. Generate a new one on the Main computer.' })
      }
      _pairing.attempts++
      if (_pairing.attempts > PAIR_MAX_ATTEMPTS) {
        logger.warn(`[LAN Server] Pairing attempt from ${remoteIp} rejected — too many incorrect attempts, code invalidated`)
        _pairing = null
        return send(res, 429, { error: 'Too many incorrect attempts. Generate a new pairing code on the Main computer.' })
      }
      if (pairBody.code !== _pairing.code) {
        logger.warn(`[LAN Server] Pairing attempt from ${remoteIp} rejected — incorrect code (attempt ${_pairing.attempts}/${PAIR_MAX_ATTEMPTS})`)
        return send(res, 401, { error: 'Incorrect pairing code.' })
      }

      _pairing = null // one-time use
      // Hand out a till code this satellite will keep forever — its receipt
      // numbers are scoped to this code, so it can never collide with Main's
      // or another satellite's numbering, even fully offline.
      const tillCode = allocateSatelliteCode(_userDataPath)
      logger.info(`[LAN Server] Satellite at ${remoteIp} paired successfully — assigned till code ${tillCode}`)
      const shopInfo = (() => { try { return shop.getShop() } catch (_) { return null } })()
      return send(res, 200, { secret, shopName: shopInfo?.name || 'Stocka', tillCode })
    }

    // Auth check
    const token = req.headers['x-stocka-token']
    if (!token || token !== secret) {
      logger.warn(`[LAN Server] Rejected unauthorized request from ${req.socket.remoteAddress} to ${req.method} ${pathname} (missing or invalid token — likely a stale secret after re-pairing)`)
      return send(res, 401, { error: 'Unauthorized' })
    }

    // Track satellite client
    const ip = req.socket.remoteAddress || 'unknown'
    if (!clients.has(ip)) logger.info(`[LAN Server] New satellite connected from ${ip}`)
    clients.set(ip, { ip, lastSeen: Date.now() })

    // Parse body once for POST/PUT/PATCH
    let body = {}
    if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
      try { body = await parseBody(req) }
      catch (e) { return send(res, 400, { error: e.message }) }
    }

    // Match route
    for (const [method, pattern, handler] of ROUTES) {
      if (req.method !== method) continue
      const params = match(pattern, pathname)
      if (params !== null) {
        try { await handler(req, res, params, url.searchParams, body) }
        catch (err) {
          logger.error(`[LAN Server] Handler error for ${method} ${pathname}: ${err.message}`)
          const status = err.message.includes('Insufficient stock') ? 409
            : err.message.includes('not found') ? 404 : 500
          send(res, status, { error: err.message })
        }
        return
      }
    }

    logger.warn(`[LAN Server] No route for ${req.method} ${pathname} (request from ${req.socket.remoteAddress})`)
    send(res, 404, { error: `No route for ${req.method} ${pathname}` })
  }

  const server = http.createServer(router)

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      logger.error(`[LAN Server] Port ${port} is already in use — another program (or a previous Stocka instance still shutting down) is using it.`)
    } else {
      logger.error(`[LAN Server] Server error: ${err.code || err.message}`)
    }
  })

  return server
}

function getConnectedClients() {
  const cutoff = Date.now() - 15_000
  return [...clients.values()].filter(c => c.lastSeen > cutoff)
}

module.exports = { createServer, getConnectedClients, generatePairingCode, getPairingInfo, broadcastEodClosed, broadcastChange, broadcastResyncRequired, WRITE_CHANNELS_SERVER }
