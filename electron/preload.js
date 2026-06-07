const { contextBridge, ipcRenderer } = require('electron')

// Helper: invoke an IPC channel and unwrap errors thrown by the wrap() helper in ipc.js
const invoke = (channel, ...args) =>
  ipcRenderer.invoke(channel, ...args).then(result => {
    if (result && typeof result === 'object' && '__error' in result) throw new Error(result.__error)
    return result
  })

contextBridge.exposeInMainWorld('stocka', {
  version: '1.0.0',
  platform: process.platform,

  // ── PRINTER ──────────────────────────────────────────────
  printer: {
    printByName:  (name, data, shop, dup = false) => ipcRenderer.invoke('printer:print-by-name', name, data, shop, dup),
    testByName:   (name)                          => ipcRenderer.invoke('printer:test-by-name', name),
    scan:         ()                              => ipcRenderer.invoke('printer:scan'),
    printBluetooth: (port, data)                  => ipcRenderer.invoke('printer:print-bluetooth', port, data),
    scanComPorts: ()                              => ipcRenderer.invoke('printer:scan-com'),
    scanCom:      ()                              => ipcRenderer.invoke('printer:scan-com'),
    test:         (port)                          => ipcRenderer.invoke('printer:test', port),
    printLegacy:  (port, data, shop, dup = false) => ipcRenderer.invoke('printer:print-receipt', port, data, shop, dup),
    getSettings:  ()                              => ipcRenderer.invoke('printer:get-settings')
  },

  // ── LICENSE ───────────────────────────────────────────────
  license: {
    check:    ()    => ipcRenderer.invoke('license:check'),
    activate: (key) => ipcRenderer.invoke('license:activate', key),
    getInfo:  ()    => ipcRenderer.invoke('license:get-info'),
  },

  // ── UPDATER ───────────────────────────────────────────────
  updater: {
    onUpdateAvailable:  (cb) => ipcRenderer.on('updater:update-available',  (_, info) => cb(info)),
    onDownloadProgress: (cb) => ipcRenderer.on('updater:download-progress', (_, info) => cb(info)),
    onUpdateDownloaded: (cb) => ipcRenderer.on('updater:update-downloaded', ()        => cb()),
    download:  () => ipcRenderer.invoke('updater:download'),
    install:   () => ipcRenderer.invoke('updater:install'),
    checkNow:  () => ipcRenderer.invoke('updater:check'),
  },

  // ── DB FILE OPERATIONS (backup/restore/paths) ─────────────
  db: {
    backup:      ()         => ipcRenderer.invoke('db:backup'),
    listBackups: ()         => ipcRenderer.invoke('db:list-backups'),
    restore:     (filename) => ipcRenderer.invoke('db:restore', filename),
    getPaths:    ()         => ipcRenderer.invoke('db:get-paths'),
    exportFile:  (dest)     => ipcRenderer.invoke('db:export-file', dest),
    getMeta:     ()         => ipcRenderer.invoke('db:get-meta'),
    setMeta:     (meta)     => ipcRenderer.invoke('db:set-meta', meta),
  },

  // ── SHOP ─────────────────────────────────────────────────
  shop: {
    get:      ()             => invoke('domain:shop:get'),
    init:     (data)         => invoke('domain:shop:init', data),
    update:   (id, data)     => invoke('domain:shop:update', id, data),
    resetPin: (user, pin)    => invoke('domain:shop:resetPin', user, pin),
  },

  // ── PRODUCTS ──────────────────────────────────────────────
  products: {
    getAll:          ()              => invoke('domain:products:getAll'),
    getById:         (id)            => invoke('domain:products:getById', id),
    add:             (product)       => invoke('domain:products:add', product),
    update:          (id, product)   => invoke('domain:products:update', id, product),
    delete:          (id)            => invoke('domain:products:delete', id),
    updateQty:       (id, qty)       => invoke('domain:products:updateQty', id, qty),
    updateImage:     (id, data)      => invoke('domain:products:updateImage', id, data),
    updateLastSold:  (id)            => invoke('domain:products:updateLastSold', id),
    getLatestPrice:  (id)            => invoke('domain:products:getLatestPrice', id),
    getAllCostPrices: ()              => invoke('domain:products:getAllCostPrices'),
    getMostSold:     (limit)         => invoke('domain:products:getMostSold', limit),
  },

  // ── SUPPLIERS ─────────────────────────────────────────────
  suppliers: {
    getAll:          ()        => invoke('domain:suppliers:getAll'),
    getById:         (id)      => invoke('domain:suppliers:getById', id),
    add:             (s)       => invoke('domain:suppliers:add', s),
    update:          (id, s)   => invoke('domain:suppliers:update', id, s),
    delete:          (id)      => invoke('domain:suppliers:delete', id),
    getPurchaseHistory: (id)   => invoke('domain:suppliers:getPurchaseHistory', id),
    getProductHistory:  (id)   => invoke('domain:suppliers:getProductHistory', id),
  },

  // ── STOCK ─────────────────────────────────────────────────
  stock: {
    addReceiving:    (r)       => invoke('domain:stock:addReceiving', r),
    getAll:          ()        => invoke('domain:stock:getAll'),
    getById:         (id)      => invoke('domain:stock:getById', id),
    getAllPurchases:  ()        => invoke('domain:stock:getAllPurchases'),
    recordDirect:    (p)       => invoke('domain:stock:recordDirect', p),
    getDeadStock:    (days)    => invoke('domain:stock:getDeadStock', days),
    getRestock:      ()        => invoke('domain:stock:getRestock'),
    getVelocity:     (days)    => invoke('domain:stock:getVelocity', days),
    getExpiring:     (days)    => invoke('domain:stock:getExpiring', days),
    getExpired:      ()        => invoke('domain:stock:getExpired'),
    getExpiryReport: ()        => invoke('domain:stock:getExpiryReport'),
  },

  // ── SALES ─────────────────────────────────────────────────
  sales: {
    add:           (sale, items) => invoke('domain:sales:add', sale, items),
    getAll:        ()            => invoke('domain:sales:getAll'),
    getById:       (id)          => invoke('domain:sales:getById', id),
    getItems:      (saleId)      => invoke('domain:sales:getItems', saleId),
    hold:          (id, name)    => invoke('domain:sales:hold', id, name),
    getHeld:       ()            => invoke('domain:sales:getHeld'),
    recall:        (id)          => invoke('domain:sales:recall', id),
    discard:       (id)          => invoke('domain:sales:discard', id),
    void:          (id, r, by)   => invoke('domain:sales:void', id, r, by),
    complete:      (id, t, c, s) => invoke('domain:sales:complete', id, t, c, s),
    getVoided:     ()            => invoke('domain:sales:getVoided'),
    getLastReceipt:()            => invoke('domain:sales:getLastReceipt'),
    getReceipt:    (id)          => invoke('domain:sales:getReceipt', id),
    updateReceipt: (id, num)     => invoke('domain:sales:updateReceipt', id, num),
  },

  // ── EXPENSES ──────────────────────────────────────────────
  expenses: {
    add:    (e)      => invoke('domain:expenses:add', e),
    getAll: ()       => invoke('domain:expenses:getAll'),
    getById:(id)     => invoke('domain:expenses:getById', id),
    update: (id, e)  => invoke('domain:expenses:update', id, e),
    delete: (id)     => invoke('domain:expenses:delete', id),
  },

  // ── USERS ─────────────────────────────────────────────────
  users: {
    getAll:        ()          => invoke('domain:users:getAll'),
    getByUsername: (u)         => invoke('domain:users:getByUsername', u),
    login:         (u, p)      => invoke('domain:users:login', u, p),
    add:           (user)      => invoke('domain:users:add', user),
    update:        (id, user)  => invoke('domain:users:update', id, user),
    deactivate:       (id)        => invoke('domain:users:deactivate', id),
    getAdminCount:    ()          => invoke('domain:users:getAdminCount'),
    validatePassword: (user, p)   => invoke('domain:users:validatePassword', user, p),
  },

  // ── SHIFTS ────────────────────────────────────────────────
  shifts: {
    start:          (user, float, branch) => invoke('domain:shifts:start', user, float, branch),
    updateSales:    (id, method, amt)     => invoke('domain:shifts:updateSales', id, method, amt),
    close:          (id, float, notes)    => invoke('domain:shifts:close', id, float, notes),
    getById:        (id)                  => invoke('domain:shifts:getById', id),
    getCurrent:     (username)            => invoke('domain:shifts:getCurrent', username),
    getExistingOpen:(username)            => invoke('domain:shifts:getExistingOpen', username),
    getByCashier:   (u, status)           => invoke('domain:shifts:getByCashier', u, status),
    getAll:         (status, from, to)    => invoke('domain:shifts:getAll', status, from, to),
    getActive:      ()                    => invoke('domain:shifts:getActive'),
    getSummary:     (id)                  => invoke('domain:shifts:getSummary', id),
  },

  // ── NOTIFICATIONS ─────────────────────────────────────────
  notifications: {
    create:          (n)   => invoke('domain:notifications:create', n),
    getActive:       ()    => invoke('domain:notifications:getActive'),
    getAll:          ()    => invoke('domain:notifications:getAll'),
    clearForProduct: (id)  => invoke('domain:notifications:clearForProduct', id),
    markRead:        (id)  => invoke('domain:notifications:markRead', id),
  },

  // ── REPORTS ───────────────────────────────────────────────
  reports: {
    getDashboard:        ()           => invoke('domain:reports:getDashboard'),
    getSalesForDay:      (date)       => invoke('domain:reports:getSalesDay', date),
    getDailyRevenue:     (date)       => invoke('domain:reports:getDailyRev', date),
    getDailyCOGS:        (date)       => invoke('domain:reports:getDailyCOGS', date),
    getMonthlyData:      (y, m)       => invoke('domain:reports:getMonthly', y, m),
    getRecentTransactions:(limit)     => invoke('domain:reports:getRecent', limit),
    getLowStockItems:    ()           => invoke('domain:reports:getLowStock'),
    getStockValue:       ()           => invoke('domain:reports:getStockValue'),
    getManagerAnalytics: ()           => invoke('domain:reports:getManagerAnalytics'),
  },

  // ── AUDIT ─────────────────────────────────────────────────
  audit: {
    log:     (u, t, e, id, d, ov, nv) => invoke('domain:audit:log', u, t, e, id, d, ov, nv),
    getLog:  (start, end)             => invoke('domain:audit:getLog', start, end),
    getEntity:(type, id)              => invoke('domain:audit:getEntity', type, id),
    getRecent:()                      => invoke('domain:audit:getRecent'),
    cleanup: ()                       => invoke('domain:audit:cleanup'),
  },

  // ── EOD ───────────────────────────────────────────────────
  eod: {
    add:       (e)    => invoke('domain:eod:add', e),
    getAll:    ()     => invoke('domain:eod:getAll'),
    getByDate: (date) => invoke('domain:eod:getByDate', date),
  },

  // ── BRANCHES ──────────────────────────────────────────────
  branches: {
    getAll: ()       => invoke('domain:branches:getAll'),
    getById:(id)     => invoke('domain:branches:getById', id),
    add:    (b)      => invoke('domain:branches:add', b),
    update: (id, b)  => invoke('domain:branches:update', id, b),
    delete: (id)     => invoke('domain:branches:delete', id),
  },

  // ── HOLDS ─────────────────────────────────────────────────
  holds: {
    create:         (shiftId, productId, qty) => invoke('domain:holds:create', shiftId, productId, qty),
    getByShift:     (shiftId)                 => invoke('domain:holds:getByShift', shiftId),
    deleteOnLogout: (shiftId)                 => invoke('domain:holds:deleteOnLogout', shiftId),
    release:        (holdId)                  => invoke('domain:holds:release', holdId),
  },

  // ── BACKUP (JSON export/import) ───────────────────────────
  backup: {
    exportAsFile:   (filename)   => invoke('domain:backup:exportAsFile', filename),
    importFromFile: (jsonString) => invoke('domain:backup:importFromFile', jsonString),
  },

  // ── BLUETOOTH SERIAL PRINTER ──────────────────────────────
  btPrinter: {
    scan:      ()                              => ipcRenderer.invoke('bt:scan'),
    testPrint: (portPath, shopName)            => ipcRenderer.invoke('bt:print-test', portPath, shopName),
    print:     (portPath, receipt, shop, dup)  => ipcRenderer.invoke('bt:print-receipt', portPath, receipt, shop, dup),
  },

  // ── CLOUD AUTH & TOKEN STORAGE ────────────────────────────
  cloud: {
    saveToken:       (payload)  => ipcRenderer.invoke('cloud:save-token', payload),
    loadToken:       ()         => ipcRenderer.invoke('cloud:load-token'),
    clearToken:      ()         => ipcRenderer.invoke('cloud:clear-token'),
    openGoogleAuth:  ()         => ipcRenderer.invoke('cloud:open-google-auth'),
    onAuthComplete:  (cb)       => ipcRenderer.on('cloud:auth-complete', (_, data) => cb(data)),
    onAuthCancelled: (cb)       => ipcRenderer.on('cloud:auth-cancelled', () => cb()),
    onAuthError:     (cb)       => ipcRenderer.on('cloud:auth-error', (_, err) => cb(err)),
  },
})
