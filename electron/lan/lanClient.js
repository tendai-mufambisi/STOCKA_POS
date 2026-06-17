const http = require('http')
const logger = require('../logger')

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
const SYNC_INTERVAL_MS = 5_000

let _cfg = null          // { serverIp, serverPort, secret }
let _online = false
let _lastSync = '1970-01-01T00:00:00.000Z'
let _pingTimer = null
let _syncTimer = null
let _queue = null
let _notify = null       // (channel, data) => void
let _lastPingError = null // last network error code/message from a failed ping, for diagnostics
let _eventStream = null  // active SSE request (held open for push notifications)

// ── HTTP helpers ──────────────────────────────────────────────────────────────

function httpRequestTo(hostname, port, secret, method, path, body = null, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname,
      port,
      path,
      method,
      headers: { 'X-Stocka-Token': secret, 'Content-Type': 'application/json' },
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

function httpRequest(method, path, body = null, timeoutMs = 8000) {
  return httpRequestTo(_cfg.serverIp, _cfg.serverPort, _cfg.secret, method, path, body, timeoutMs)
}

// Exchange a one-time pairing PIN (shown on the Main computer) for its secret.
// No secret is needed for this call — that's the whole point of pairing.
function pair(serverIp, serverPort, code) {
  logger.info(`[LAN Client] Attempting to pair with ${serverIp}:${serverPort}`)
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ code })
    const opts = {
      hostname: serverIp, port: serverPort, path: '/lan/pair', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: 8000,
    }
    const req = http.request(opts, (res) => {
      let raw = ''
      res.on('data', c => raw += c)
      res.on('end', () => {
        try {
          const parsed = JSON.parse(raw)
          if (res.statusCode !== 200) {
            logger.warn(`[LAN Client] Pairing rejected by ${serverIp}:${serverPort} (HTTP ${res.statusCode}): ${parsed.error}`)
            return reject(new Error(parsed.error || `Pairing failed (HTTP ${res.statusCode})`))
          }
          logger.info(`[LAN Client] Paired successfully with "${parsed.shopName}" at ${serverIp}:${serverPort}`)
          resolve(parsed) // { secret, shopName }
        } catch { reject(new Error('Invalid response from server')) }
      })
    })
    req.on('timeout', () => {
      req.destroy()
      logger.error(`[LAN Client] Pairing request to ${serverIp}:${serverPort} timed out after 8s. The connection attempt got no response at all — likely causes: (1) a firewall on the Main computer is silently dropping the connection, (2) the IP address is wrong, (3) both computers are on a network that blocks device-to-device traffic (e.g. a phone hotspot with AP/client isolation enabled).`)
      reject(new Error('Pairing request timed out — check the IP address and that the Main computer is running.'))
    })
    req.on('error', (e) => {
      logger.error(`[LAN Client] Pairing connection error to ${serverIp}:${serverPort}: ${e.code || e.message}` +
        (e.code === 'ECONNREFUSED' ? ' (port closed or Stocka not running in Server mode there)' :
         e.code === 'EHOSTUNREACH' || e.code === 'ENETUNREACH' ? ' (no network route — confirm both computers are on the same WiFi/subnet)' :
         e.code === 'ENOTFOUND' ? ' (IP address could not be resolved — check it was typed correctly)' : ''))
      reject(new Error(e.message))
    })
    req.write(body)
    req.end()
  })
}

// Wipe local business tables and reseed verbatim from the server's full snapshot.
// Used on first pairing (so a satellite that already had its own data doesn't end up
// with a merge of two unrelated shops) and as a manual "Force full resync" recovery tool.
const SNAPSHOT_WIPE_TABLES = [
  'sale_holds', 'sale_items', 'sales', 'stock_receivings', 'notifications',
  'end_of_day', 'expenses', 'shifts', 'products', 'suppliers', 'branches', 'users', 'shops',
]

async function applyFullSnapshot(serverIp, serverPort, secret) {
  const { status, body } = await httpRequestTo(serverIp, serverPort, secret, 'GET', '/lan/snapshot', null, 20000)
  if (status !== 200) throw new Error(body?.error || `Snapshot fetch failed (HTTP ${status})`)

  const { getDb } = require('../database/index')
  const db = getDb()

  const upsert = (table, rows) => {
    if (!Array.isArray(rows) || !rows.length) return
    const cols = Object.keys(rows[0])
    const stmt = db.prepare(
      `INSERT OR REPLACE INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`
    )
    for (const row of rows) stmt.run(cols.map(c => row[c]))
  }

  db.transaction(() => {
    for (const t of SNAPSHOT_WIPE_TABLES) db.prepare(`DELETE FROM ${t}`).run()
    if (body.shop) {
      // Preserve any pre-existing local printer configuration (e.g. if re-pairing)
      const localShop = db.prepare('SELECT * FROM shops LIMIT 1').get()
      const merged = { ...body.shop }
      if (localShop) {
        for (const col of PRINTER_COLS) {
          if (localShop[col] !== undefined) merged[col] = localShop[col]
        }
      }
      upsert('shops', [merged])
    }
    upsert('users', body.users)
    upsert('suppliers', body.suppliers)
    upsert('branches', body.branches)
    upsert('products', body.products)
    upsert('stock_receivings', body.stock_receivings)
    upsert('shifts', body.shifts)
    upsert('sales', body.sales)
    upsert('sale_items', body.sale_items)
    upsert('expenses', body.expenses)
    upsert('sale_holds', body.sale_holds)
    upsert('notifications', body.notifications)
    upsert('end_of_day', body.end_of_day)
  })()

  _lastSync = body.fetched_at || new Date().toISOString()
  if (_notify) _notify('lan:synced', { lastSync: _lastSync, fullResync: true })
  return { lastSync: _lastSync }
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
      _lastPingError = null
      resolve(res.statusCode === 200)
    })
    req.on('timeout', () => { req.destroy(); _lastPingError = 'ETIMEDOUT'; resolve(false) })
    req.on('error', (e) => { _lastPingError = e.code || e.message; resolve(false) })
    req.end()
  })
}

// Printer-specific columns that must never be overwritten from server data —
// each machine configures its own printer independently.
const PRINTER_COLS = ['printer_name', 'printer_port', 'auto_print', 'print_duplicate', 'receipt_width_mm']

// ── Sync: pull changes from server and apply to local DB ──────────────────────

async function syncFromServer() {
  try {
    const { status, body } = await httpRequest('GET', `/lan/changes?since=${encodeURIComponent(_lastSync)}`, null, 10000)
    if (status !== 200) return

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

    if (body.products)   upsert('products', body.products)
    if (body.sales)      upsert('sales', body.sales)
    if (body.sale_items) upsert('sale_items', body.sale_items)
    if (body.expenses)   upsert('expenses', body.expenses)
    if (body.shifts)     upsert('shifts', body.shifts)
    if (body.stock)      upsert('stock_receivings', body.stock)
    if (body.users)      upsert('users', body.users)
    if (body.suppliers)  upsert('suppliers', body.suppliers)
    if (body.branches)   upsert('branches', body.branches)

    // Shop: sync shared settings but keep local printer configuration.
    if (body.shop) {
      const localShop = db.prepare('SELECT * FROM shops LIMIT 1').get()
      const merged = { ...body.shop }
      if (localShop) {
        for (const col of PRINTER_COLS) {
          if (localShop[col] !== undefined) merged[col] = localShop[col]
        }
      }
      const cols = Object.keys(merged)
      db.prepare(
        `INSERT OR REPLACE INTO shops (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`
      ).run(cols.map(c => merged[c]))
    }

    _lastSync = body.fetched_at || new Date().toISOString()
    if (_notify) _notify('lan:synced', { lastSync: _lastSync })
  } catch (err) {
    logger.warn(`[LAN Client] Sync from server failed: ${err.code || err.message}`)
  }
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
  const target = `${_cfg?.serverIp}:${_cfg?.serverPort}`
  if (nowOnline) {
    logger.info(`[LAN Client] Connected to Main computer at ${target}`)
  } else {
    logger.warn(`[LAN Client] Lost connection to Main computer at ${target} — reason: ${_lastPingError || 'unknown'}`)
  }
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
      // Await sync so local DB is consistent before the renderer re-reads it.
      await syncFromServer()
      return result
    } catch (err) {
      // Network died mid-request — queue it
      logger.warn(`[LAN Client] Write "${channel}" failed (${err.code || err.message}) — queued for retry`)
      if (_queue) _queue.enqueue(channel, args)
      setOnline(false)
      return { __queued: true, __queuedNote: err.message }
    }
  }
}

// ── SSE event stream — server pushes a tiny event on every write ─────────────

function connectEventStream() {
  if (!_cfg) return
  if (_eventStream) { try { _eventStream.destroy() } catch (_) {} ; _eventStream = null }

  const opts = {
    hostname: _cfg.serverIp,
    port:     _cfg.serverPort,
    path:     '/lan/events',
    method:   'GET',
    headers:  { 'X-Stocka-Token': _cfg.secret, 'Accept': 'text/event-stream' },
  }

  const req = http.request(opts, (res) => {
    if (res.statusCode !== 200) {
      res.resume()
      setTimeout(() => { if (_cfg) connectEventStream() }, 5000)
      return
    }

    let buffer = ''
    res.on('data', (chunk) => {
      buffer += chunk.toString()
      const lines = buffer.split('\n')
      buffer = lines.pop() // keep any incomplete line
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const ev = JSON.parse(line.slice(6))
            if (ev.type === 'change') syncFromServer()
          } catch (_) {}
        }
      }
    })

    res.on('end',   () => { setTimeout(() => { if (_cfg) connectEventStream() }, 3000) })
    res.on('error', () => { setTimeout(() => { if (_cfg) connectEventStream() }, 3000) })
  })

  req.on('error',   () => { setTimeout(() => { if (_cfg) connectEventStream() }, 5000) })
  req.on('timeout', () => { req.destroy(); setTimeout(() => { if (_cfg) connectEventStream() }, 5000) })
  req.setTimeout(10000)

  _eventStream = req
  req.end()
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

function startClient(cfg, queue, notifyFn) {
  logger.info(`[LAN Client] Starting Satellite mode → target ${cfg.serverIp}:${cfg.serverPort}`)
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

  // Open SSE channel for instant push notifications from the server
  connectEventStream()
}

function stopClient() {
  if (_pingTimer) { clearInterval(_pingTimer); _pingTimer = null }
  if (_syncTimer) { clearInterval(_syncTimer); _syncTimer = null }
  if (_eventStream) { try { _eventStream.destroy() } catch (_) {} ; _eventStream = null }
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

module.exports = { startClient, stopClient, makeHandler, getClientStatus, lanRequest, syncFromServer, pair, applyFullSnapshot }
