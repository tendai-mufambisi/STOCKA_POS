const http = require('http')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const logger = require('../logger')
const { NON_BUSINESS_CHANNELS } = require('./offlineQueue')

// Channels whose writes must be proxied to the server (reads use local DB cache).
// login/validatePassword are intentionally LOCAL so auth works offline.
const WRITE_CHANNELS = new Set([
  'domain:shop:init', 'domain:shop:update', 'domain:shop:resetPin',
  'domain:products:add', 'domain:products:update', 'domain:products:delete',
  'domain:products:updateQty', 'domain:products:updateImage', 'domain:products:updateLastSold',
  'domain:suppliers:add', 'domain:suppliers:update', 'domain:suppliers:delete',
  'domain:stock:addReceiving', 'domain:stock:recordDirect', 'domain:stock:importReceivings',
  'domain:stock:recordInitialCost', 'domain:stock:reconcileProduct', 'domain:stock:reconcileProducts',
  'domain:stock:correctReceiving', 'domain:stock:discardExpiredBatch',
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

// Writes that carry an idempotency key in args[0].external_id. The key is minted once,
// before the write is either sent or queued, so the original attempt and every later
// replay share it and Main can recognise the repeat.
//
// This defends against ONE failure: the network dies after Main commits but before the
// response arrives, so the write is queued and replayed. It does NOT deduplicate two
// separate user actions — each click mints its own key, by design (an operator really
// may receive the same product twice). Preventing double-clicks is the renderer's job.
const IDEMPOTENT_CHANNELS = new Set([
  'domain:sales:add',
  'domain:stock:addReceiving',
  'domain:stock:recordDirect',
])

// Writes that are proxied to Main when online but DROPPED (never queued) when offline.
// Stock alerts are derived state: Notifications.jsx recomputes them from the products
// table every 30 s, so there is nothing here worth replaying. They must not be queued,
// because the dedup check reads the LOCAL db — offline, a queued create never lands
// locally, so every poll re-queues the same alert forever. One shop till reached 5,296
// queued writes in 36 h, of which only 36 were real business writes (34 sales + 2 shift
// events); the rest were 73 distinct stock alerts requeued ~60 times each.
const NEVER_QUEUE = NON_BUSINESS_CHANNELS

const PING_INTERVAL_MS = 8000   // was 3000 — less aggressive on WiFi, avoids false disconnects from single dropped packets
const SYNC_INTERVAL_MS = 8_000  // was 5000 — matches ping cadence; SSE handles instant push anyway
// How long a write will wait for its own pull-back before returning to the renderer.
// Deliberately short: the renderer must never sit on a slow delta. NOT a timeout —
// the sync keeps running and the page refreshes via lan:synced when it lands.
const POST_WRITE_SYNC_WAIT_MS = 1500

let _cfg = null          // { serverIp, serverPort, secret }
let _online = false
let _connecting = false  // true from startClient() until the first ping result arrives
let _lastSync = '1970-01-01T00:00:00.000Z'
let _pingTimer = null
let _syncTimer = null
let _queue = null
let _notify = null       // (channel, data) => void
let _lastPingError = null // last network error code/message from a failed ping, for diagnostics
let _eventStream = null  // active SSE request (held open for push notifications)
// Sync health, kept on THIS machine's clock (the cursor `_lastSync` is Main's clock
// and lies to the user whenever Main's clock/timezone is wrong):
let _lastSyncSuccessAt = null // Date.now() of the last successfully applied delta
let _lastSyncError = null     // message of the most recent delta failure, null when healthy
let _clockSkewMs = 0          // |this machine − Main| from the last ping

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
          logger.info(`[LAN Client] Paired successfully with "${parsed.shopName}" at ${serverIp}:${serverPort}` +
            (parsed.tillCode ? ` — assigned till code ${parsed.tillCode}` : ''))
          resolve(parsed) // { secret, shopName, tillCode }
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
  // 60s: the snapshot carries the whole catalog including base64 product images
  const { status, body } = await httpRequestTo(serverIp, serverPort, secret, 'GET', '/lan/snapshot', null, 60000)
  if (status !== 200) throw new Error(body?.error || `Snapshot fetch failed (HTTP ${status})`)

  const { getDb } = require('../database/index')
  const db = getDb()

  const upsert = (table, rows) => {
    if (!Array.isArray(rows) || !rows.length) return
    // Skip columns this machine's schema doesn't have (mixed-version safety)
    const tableCols = new Set(db.pragma(`table_info(${table})`).map(c => c.name))
    const cols = Object.keys(rows[0]).filter(c => tableCols.has(c))
    if (!cols.length) return
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
// `occurredAt` (ISO string) is the real time the action happened — sent only for
// replayed offline-queue writes so Main can stamp the true event time instead of
// the replay time. Omitted for live writes, where Main's own clock is authoritative.
async function lanRequest(channel, args, occurredAt = null) {
  const { status, body } = await httpRequest('POST', '/lan/invoke', { channel, args, occurred_at: occurredAt })
  if (body.error) {
    const err = new Error(body.error)
    err.httpStatus = status
    throw err
  }
  return body.result
}

async function ping() {
  if (!_cfg) return false
  return new Promise((resolve) => {
    const opts = {
      hostname: _cfg.serverIp, port: _cfg.serverPort,
      path: '/lan/ping', method: 'GET', timeout: 3000,
    }
    const req = http.request(opts, (res) => {
      let raw = ''
      res.on('data', c => raw += c)
      res.on('end', () => {
        _lastPingError = null
        try {
          const body = JSON.parse(raw)
          if (body.serverTime) {
            const skewMs = Math.abs(Date.now() - new Date(body.serverTime).getTime())
            _clockSkewMs = skewMs
            if (skewMs > 60000 && _notify) {
              _notify('lan:clock-skew', { skewMs, serverTime: body.serverTime })
            }
          }
        } catch (_) {}
        resolve(res.statusCode === 200)
      })
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
  if (!_cfg) return
  try {
    // 30s: product deltas can carry base64 images and must survive slow shop WiFi —
    // a timeout here doesn't advance the cursor, so a too-tight limit can wedge sync.
    const { status, body } = await httpRequest('GET', `/lan/changes?since=${encodeURIComponent(_lastSync)}`, null, 30000)
    if (status !== 200) {
      _lastSyncError = `Main answered HTTP ${status}`
      return
    }

    const { getDb } = require('../database/index')
    const db = getDb()

    const upsert = (table, rows) => {
      if (!Array.isArray(rows) || !rows.length) return
      // Only insert columns this satellite's table actually has — a newer Main can
      // ship columns an older satellite lacks, and that must not wedge sync forever.
      const tableCols = new Set(db.pragma(`table_info(${table})`).map(c => c.name))
      const cols = Object.keys(rows[0]).filter(c => tableCols.has(c))
      if (!cols.length) return
      const stmt = db.prepare(
        `INSERT OR REPLACE INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`
      )
      try {
        db.transaction((r) => { for (const row of r) stmt.run(cols.map(c => row[c])) })(rows)
      } catch (err) {
        // One poison row must not freeze the cursor forever: apply what we can,
        // log what we can't, and let the sync advance.
        logger.error(`[LAN Client] Delta apply failed for ${table} (${err.message}) — retrying row-by-row`)
        for (const row of rows) {
          try { stmt.run(cols.map(c => row[c])) }
          catch (rowErr) { logger.error(`[LAN Client] Skipped ${table} row id=${row.id}: ${rowErr.message}`) }
        }
      }
    }

    // Snapshot row counts for always-full tables BEFORE upserting so we can
    // detect additions/removals (upsert can't delete, but counts help for adds).
    const prevUsers     = db.prepare('SELECT COUNT(*) FROM users').pluck().get()
    const prevSuppliers = db.prepare('SELECT COUNT(*) FROM suppliers').pluck().get()
    const prevBranches  = db.prepare('SELECT COUNT(*) FROM branches').pluck().get()
    const prevShopHash  = JSON.stringify(db.prepare('SELECT * FROM shops LIMIT 1').get() || {})

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
      const shopCols = new Set(db.pragma('table_info(shops)').map(c => c.name))
      const cols = Object.keys(merged).filter(c => shopCols.has(c))
      db.prepare(
        `INSERT OR REPLACE INTO shops (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`
      ).run(cols.map(c => merged[c]))
    }

    // Only notify the renderer when something actually changed.
    // Firing on every timer tick (even with empty deltas) caused constant
    // UI reloads / flicker on all pages subscribed to lan:synced.
    const hasChanges =
      body.products?.length   > 0 ||
      body.sales?.length       > 0 ||
      body.sale_items?.length  > 0 ||
      body.expenses?.length    > 0 ||
      body.shifts?.length      > 0 ||
      body.stock?.length       > 0 ||
      db.prepare('SELECT COUNT(*) FROM users').pluck().get()     !== prevUsers     ||
      db.prepare('SELECT COUNT(*) FROM suppliers').pluck().get() !== prevSuppliers ||
      db.prepare('SELECT COUNT(*) FROM branches').pluck().get()  !== prevBranches  ||
      JSON.stringify(db.prepare('SELECT * FROM shops LIMIT 1').get() || {}) !== prevShopHash

    _lastSync = body.fetched_at || new Date().toISOString()
    _lastSyncSuccessAt = Date.now()
    _lastSyncError = null
    if (hasChanges && _notify) _notify('lan:synced', { lastSync: _lastSync })
  } catch (err) {
    _lastSyncError = err.code || err.message
    logger.warn(`[LAN Client] Sync from server failed: ${err.code || err.message}`)
  }
}

// ── Offline queue flush ───────────────────────────────────────────────────────

let _flushing = false
let _lastFailureSig = null

// Writes the server permanently rejected are archived here (next to the queue file)
// so they are never lost even after being taken off the retry queue.
function archiveDeadLetters(deadLettered) {
  try {
    const file = path.join(path.dirname(_queue.path), 'failed_writes.json')
    let existing = []
    try { existing = JSON.parse(fs.readFileSync(file, 'utf8')) } catch (_) {}
    existing.push(...deadLettered.map(f => ({ ...f.item, error: f.error, failedAt: new Date().toISOString() })))
    fs.writeFileSync(file, JSON.stringify(existing, null, 2), 'utf8')
  } catch (err) {
    logger.error('[LAN Client] Could not archive rejected writes: ' + err.message)
  }
}

async function flushQueue() {
  if (!_queue || _queue.size() === 0 || _flushing) return
  _flushing = true
  try {
    const { failed, deadLettered } = await _queue.flush(async (channel, args, queuedAtMs) => {
      // Replayed sales must always be recorded on Main — the cashier already took
      // the money. The server clamps stock at 0 and raises a discrepancy
      // notification instead of rejecting (sales.addSale `replayed` flag).
      if (channel === 'domain:sales:add' && args[0]) {
        args = [{ ...args[0], replayed: true }, ...args.slice(1)]
      }
      // The write really happened when it was queued (queuedAtMs), not now — send
      // that so Main stamps created_at/started_at/etc. with the true action time.
      const occurredAt = new Date(queuedAtMs || Date.now()).toISOString()
      try {
        return await lanRequest(channel, args, occurredAt)
      } catch (err) {
        // 4xx = the server examined and refused this write; retrying is pointless.
        // Mark permanent so the queue dead-letters it (same rule as the inline path).
        if (err.httpStatus && err.httpStatus >= 400 && err.httpStatus < 500) err.permanent = true
        throw err
      }
    })

    if (deadLettered.length > 0) {
      archiveDeadLetters(deadLettered)
      logger.error(`[LAN Client] ${deadLettered.length} queued write(s) permanently rejected by Main — archived to failed_writes.json: ` +
        deadLettered.map(f => `${f.item.channel} (${f.error})`).join('; '))
    }

    // Surface EVERY failure — including items queued before this app launch.
    // (Silently dropping pre-launch items is how a whole day of sales once
    // vanished without anyone being told.) Dedup so the periodic retry doesn't
    // re-notify the same unchanged failure set every few seconds.
    const all = [
      ...deadLettered.map(f => ({ channel: f.item.channel, error: f.error, queuedAt: f.item.timestamp, permanent: true })),
      ...failed.map(f => ({ channel: f.item.channel, error: f.error, queuedAt: f.item.timestamp, permanent: false })),
    ]
    if (all.length > 0 && _notify) {
      const sig = [...deadLettered, ...failed].map(f => `${f.item.id}:${f.error}`).join('|')
      if (sig !== _lastFailureSig) {
        _lastFailureSig = sig
        _notify('lan:sync-failures', all)
      }
    } else if (all.length === 0) {
      _lastFailureSig = null
    }
    if (_notify) _notify('lan:status-changed', getClientStatus())
  } finally {
    _flushing = false
  }
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
    // Stamp the idempotency key before the write is sent OR queued, so that if the
    // network drops after the server commits but before the response arrives, the
    // queued retry carries the same key and Main returns the existing row.
    if (IDEMPOTENT_CHANNELS.has(channel) && args[0] && !args[0].external_id) {
      args = [{ ...args[0], external_id: crypto.randomUUID() }, ...args.slice(1)]
    }

    if (!_online) {
      // Derived state (stock alerts): drop it. Recomputed locally on the next poll.
      if (NEVER_QUEUE.has(channel)) return { __queued: true, __queuedNote: 'Offline — alert skipped' }
      if (_queue) _queue.enqueue(channel, args)
      if (_notify) _notify('lan:status-changed', getClientStatus())
      // Return a queued signal so the renderer can show feedback
      return { __queued: true, __queuedNote: `Offline — write queued (${_queue?.businessSize() ?? 0} pending)` }
    }
    try {
      const result = await lanRequest(channel, args)
      // Wait for the pull-back so the local DB is consistent before the renderer
      // re-reads it — but only briefly. A delta can carry base64 product images and
      // is allowed 30 s; blocking a Save button on that makes the UI look dead, and
      // an operator who thinks nothing happened clicks Save again. Whatever arrives
      // after the cap still lands, and useLanSync refreshes the open page then.
      await Promise.race([
        syncFromServer(),
        new Promise(resolve => setTimeout(resolve, POST_WRITE_SYNC_WAIT_MS)),
      ])
      return result
    } catch (err) {
      // Server rejected the write (validation, constraint, auth) — return the error
      // directly to the renderer. These failures are permanent; retrying won't help.
      if (err.httpStatus && err.httpStatus >= 400 && err.httpStatus < 500) {
        logger.warn(`[LAN Client] Write "${channel}" rejected by server (HTTP ${err.httpStatus}): ${err.message}`)
        return { __error: err.message }
      }
      // Network died mid-request — queue it for retry when connection comes back
      // (except derived state, which the next local poll regenerates anyway)
      if (NEVER_QUEUE.has(channel)) {
        setOnline(false)
        return { __queued: true, __queuedNote: 'Offline — alert skipped' }
      }
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
            if (ev.type === 'eod_closed' && _notify) _notify('lan:eod-closed', { date: ev.date, closedBy: ev.closedBy })
            // Main wiped/reset its data — a delta pull can't remove rows, so re-mirror from scratch
            if (ev.type === 'resync_required' && _cfg) {
              applyFullSnapshot(_cfg.serverIp, _cfg.serverPort, _cfg.secret)
                .catch(err => logger.error(`[LAN Client] Resync after server reset failed: ${err.message}`))
            }
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
  _connecting = true
  _lastSync = '1970-01-01T00:00:00.000Z'

  // Kick off first ping immediately; clear connecting flag once we have a result
  ping().then(ok => { _connecting = false; setOnline(ok) })

  _pingTimer = setInterval(async () => {
    const up = await ping()
    setOnline(up)
  }, PING_INTERVAL_MS)

  _syncTimer = setInterval(() => {
    if (_online) {
      syncFromServer()
      // Retry queued writes continuously, not just on the offline→online edge —
      // a queue carried across an app restart previously never retried.
      if (_queue && _queue.size() > 0) flushQueue()
    }
  }, SYNC_INTERVAL_MS)

  // Open SSE channel for instant push notifications from the server
  connectEventStream()
}

function stopClient() {
  if (_pingTimer) { clearInterval(_pingTimer); _pingTimer = null }
  if (_syncTimer) { clearInterval(_syncTimer); _syncTimer = null }
  if (_eventStream) { try { _eventStream.destroy() } catch (_) {} ; _eventStream = null }
  _online = false
  _connecting = false
  _cfg = null
}

function getClientStatus() {
  return {
    online: _online,
    connecting: _connecting,
    lastSync: _lastSync,               // sync cursor — Main's clock, for sync logic only
    lastSyncAt: _lastSyncSuccessAt,    // local Date.now() of last applied delta — use for display
    lastSyncError: _lastSyncError,     // most recent delta failure, null when healthy
    clockSkewMs: _clockSkewMs,         // |this machine − Main| from the last ping
    queueSize: _queue ? _queue.size() : 0,
    serverIp: _cfg?.serverIp || null,
    serverPort: _cfg?.serverPort || null,
  }
}

module.exports = { startClient, stopClient, makeHandler, getClientStatus, lanRequest, syncFromServer, pair, applyFullSnapshot }
