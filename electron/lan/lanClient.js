const http = require('http')

// Channels whose writes must be proxied to the server (reads use local DB cache).
// login/validatePassword are intentionally LOCAL so auth works offline.
const WRITE_CHANNELS = new Set([
  'domain:shop:init', 'domain:shop:update', 'domain:shop:resetPin',
  'domain:products:add', 'domain:products:update', 'domain:products:delete',
  'domain:products:updateQty', 'domain:products:updateImage', 'domain:products:updateLastSold',
  'domain:suppliers:add', 'domain:suppliers:update', 'domain:suppliers:delete',
  'domain:stock:addReceiving', 'domain:stock:recordDirect',
  'domain:sales:add', 'domain:sales:void', 'domain:sales:hold', 'domain:sales:recall',
  'domain:sales:discard', 'domain:sales:complete', 'domain:sales:updateReceipt',
  'domain:expenses:add', 'domain:expenses:update', 'domain:expenses:delete',
  'domain:users:add', 'domain:users:update', 'domain:users:deactivate',
  'domain:shifts:start', 'domain:shifts:close', 'domain:shifts:updateSales',
  'domain:notifications:create', 'domain:notifications:clearForProduct', 'domain:notifications:markRead',
  'domain:eod:add',
  'domain:audit:log', 'domain:audit:cleanup',
  'domain:branches:add', 'domain:branches:update', 'domain:branches:delete',
  'domain:holds:create', 'domain:holds:deleteOnLogout', 'domain:holds:release',
])

const PING_INTERVAL_MS = 3000
const SYNC_INTERVAL_MS = 30_000

let _cfg = null          // { serverIp, serverPort, secret }
let _online = false
let _lastSync = '1970-01-01T00:00:00.000Z'
let _pingTimer = null
let _syncTimer = null
let _queue = null
let _notify = null       // (channel, data) => void

// ── HTTP helpers ──────────────────────────────────────────────────────────────

function httpRequest(method, path, body = null, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: _cfg.serverIp,
      port: _cfg.serverPort,
      path,
      method,
      headers: { 'X-Stocka-Token': _cfg.secret, 'Content-Type': 'application/json' },
      timeout: timeoutMs,
    }
    const req = http.request(opts, (res) => {
      let raw = ''
      res.on('data', c => raw += c)
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }) }
        catch { reject(new Error('Invalid JSON from server')) }
      })
    })
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')) })
    req.on('error', reject)
    if (body) req.write(JSON.stringify(body))
    req.end()
  })
}

// Proxy a domain:* IPC call to the server via the unified /lan/invoke endpoint.
async function lanRequest(channel, args) {
  const { status, body } = await httpRequest('POST', '/lan/invoke', { channel, args })
  if (body.error) {
    const err = new Error(body.error)
    err.httpStatus = status
    throw err
  }
  return body.result
}

async function ping() {
  return new Promise((resolve) => {
    const opts = {
      hostname: _cfg.serverIp, port: _cfg.serverPort,
      path: '/lan/ping', method: 'GET', timeout: 1500,
    }
    const req = http.request(opts, (res) => {
      res.resume() // drain
      resolve(res.statusCode === 200)
    })
    req.on('timeout', () => { req.destroy(); resolve(false) })
    req.on('error', () => resolve(false))
    req.end()
  })
}

// ── Sync: pull changes from server and apply to local DB ──────────────────────

async function syncFromServer() {
  try {
    const { status, body } = await httpRequest('GET', `/lan/changes?since=${encodeURIComponent(_lastSync)}`, null, 10000)
    if (status !== 200 || !body.tables) return

    const { getDb } = require('../database/index')
    const db = getDb()

    const upsert = (table, rows) => {
      if (!Array.isArray(rows) || !rows.length) return
      const cols = Object.keys(rows[0])
      const stmt = db.prepare(
        `INSERT OR REPLACE INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`
      )
      db.transaction((r) => { for (const row of r) stmt.run(cols.map(c => row[c])) })(rows)
    }

    // body from /lan/changes is { products, sales, sale_items, expenses, shifts, stock, fetched_at }
    if (body.products)   upsert('products', body.products)
    if (body.sales)      upsert('sales', body.sales)
    if (body.sale_items) upsert('sale_items', body.sale_items)
    if (body.expenses)   upsert('expenses', body.expenses)
    if (body.shifts)     upsert('shifts', body.shifts)
    if (body.stock)      upsert('stock_receivings', body.stock)

    _lastSync = body.fetched_at || new Date().toISOString()
    if (_notify) _notify('lan:synced', { lastSync: _lastSync })
  } catch (_) {}
}

// ── Offline queue flush ───────────────────────────────────────────────────────

async function flushQueue() {
  if (!_queue || _queue.size() === 0) return
  const failures = await _queue.flush(async (channel, args) => {
    const result = await lanRequest(channel, args)
    // lanRequest throws on error, so reaching here means success
    return result
  })
  if (failures.length > 0 && _notify) {
    _notify('lan:sync-failures', failures.map(f => ({
      channel: f.item.channel,
      error: f.error,
      queuedAt: f.item.timestamp,
    })))
  }
  if (_notify) _notify('lan:status-changed', getClientStatus())
}

// ── Online/offline transition ────────────────────────────────────────────────

function setOnline(nowOnline) {
  if (_online === nowOnline) return
  _online = nowOnline
  if (_notify) _notify('lan:status-changed', getClientStatus())
  if (nowOnline) {
    flushQueue()
    syncFromServer()
  }
}

// ── IPC handler factory (called by ipc.js) ───────────────────────────────────

function makeHandler(channel, fn) {
  if (!WRITE_CHANNELS.has(channel)) {
    // READ: use local DB (kept in sync via periodic /lan/changes pull)
    return (event, ...args) => {
      try { return fn(...args) }
      catch (err) { return { __error: err.message } }
    }
  }

  // WRITE: proxy to server; queue if offline
  return async (event, ...args) => {
    if (!_online) {
      if (_queue) _queue.enqueue(channel, args)
      if (_notify) _notify('lan:status-changed', getClientStatus())
      // Return a queued signal so the renderer can show feedback
      return { __queued: true, __queuedNote: `Offline — write queued (${_queue?.size()} pending)` }
    }
    try {
      const result = await lanRequest(channel, args)
      // Trigger an immediate sync so local DB reflects the change
      syncFromServer()
      return result
    } catch (err) {
      // Network died mid-request — queue it
      if (_queue) _queue.enqueue(channel, args)
      setOnline(false)
      return { __queued: true, __queuedNote: err.message }
    }
  }
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

function startClient(cfg, queue, notifyFn) {
  _cfg = cfg
  _queue = queue
  _notify = notifyFn
  _online = false
  _lastSync = '1970-01-01T00:00:00.000Z'

  // Kick off first ping immediately
  ping().then(setOnline)

  _pingTimer = setInterval(async () => {
    const up = await ping()
    setOnline(up)
  }, PING_INTERVAL_MS)

  _syncTimer = setInterval(() => {
    if (_online) syncFromServer()
  }, SYNC_INTERVAL_MS)
}

function stopClient() {
  if (_pingTimer) { clearInterval(_pingTimer); _pingTimer = null }
  if (_syncTimer) { clearInterval(_syncTimer); _syncTimer = null }
  _online = false
  _cfg = null
}

function getClientStatus() {
  return {
    online: _online,
    lastSync: _lastSync,
    queueSize: _queue ? _queue.size() : 0,
    serverIp: _cfg?.serverIp || null,
    serverPort: _cfg?.serverPort || null,
  }
}

module.exports = { startClient, stopClient, makeHandler, getClientStatus, lanRequest, syncFromServer }
