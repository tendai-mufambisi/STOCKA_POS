import { apiFetch, getValidToken } from './cloudAuth'
import { isCloudMode } from './runtime'

const SYNC_INTERVAL_MS  = 30_000  // push/pull every 30 seconds
const DEVICE_ID_KEY     = 'stocka_device_id'
const LAST_PULL_KEY     = 'stocka_last_pull'

let syncTimer = null
let isSyncing = false

// ── Device ID ─────────────────────────────────────────────────────────────────
// A stable UUID for this installation stored in localStorage.
// On first run it is registered with the API and the returned id is stored.

function getLocalDeviceId() {
  return localStorage.getItem(DEVICE_ID_KEY)
}

async function ensureDeviceRegistered() {
  const existing = getLocalDeviceId()
  if (existing) return existing

  const res = await apiFetch('/devices/register', {
    method: 'POST',
    body: JSON.stringify({
      device_name: `Desktop — ${navigator.platform}`,
      platform: 'desktop',
    }),
  })

  if (!res.ok) throw new Error('Device registration failed')
  const { device } = await res.json()
  localStorage.setItem(DEVICE_ID_KEY, device.id)
  return device.id
}

// ── Collecting dirty rows from SQLite ─────────────────────────────────────────

async function getDirtyRows() {
  // Each domain returns rows where sync_dirty = 1.
  // We use the existing window.stocka IPC to read them.
  const [products, sales, shifts, expenses, suppliers] = await Promise.all([
    window.stocka.products.getAll().then(rows => rows.filter(r => r.sync_dirty)),
    window.stocka.sales.getAll().then(rows => rows.filter(r => r.sync_dirty)),
    window.stocka.shifts.getAll('all').then(rows => rows.filter(r => r.sync_dirty)),
    window.stocka.expenses.getAll().then(rows => rows.filter(r => r.sync_dirty)),
    window.stocka.suppliers.getAll().then(rows => rows.filter(r => r.sync_dirty)),
  ])

  return { products, sales, shifts, expenses, suppliers }
}

// ── Push ──────────────────────────────────────────────────────────────────────

async function push(deviceId) {
  const changes = await getDirtyRows()

  const totalDirty = Object.values(changes).reduce((s, arr) => s + arr.length, 0)
  if (totalDirty === 0) return 0

  const res = await apiFetch('/sync/push', {
    method: 'POST',
    body: JSON.stringify({ device_id: deviceId, changes }),
  })

  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || 'Push failed')
  }

  const { accepted_count } = await res.json()

  // Mark pushed rows as clean in local SQLite.
  // We call a generic markSynced IPC that sets sync_dirty = 0 by external_id.
  if (window.stocka.sync?.markClean) {
    for (const [table, rows] of Object.entries(changes)) {
      if (rows.length) {
        await window.stocka.sync.markClean(table, rows.map(r => r.external_id))
      }
    }
  }

  return accepted_count
}

// ── Pull ──────────────────────────────────────────────────────────────────────

async function pull(deviceId) {
  const since = localStorage.getItem(LAST_PULL_KEY) || '1970-01-01T00:00:00.000Z'

  const res = await apiFetch(`/sync/pull?since=${encodeURIComponent(since)}&device_id=${deviceId}`)

  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || 'Pull failed')
  }

  const { data, server_time } = await res.json()

  // Upsert pulled rows into local SQLite via IPC
  if (window.stocka.sync?.upsert) {
    for (const [table, rows] of Object.entries(data)) {
      if (rows && rows.length) {
        await window.stocka.sync.upsert(table, rows)
      }
    }
  }

  localStorage.setItem(LAST_PULL_KEY, server_time)

  const total = Object.values(data).reduce((s, arr) => s + (arr?.length || 0), 0)
  return total
}

// ── Main sync tick ─────────────────────────────────────────────────────────────

async function syncTick() {
  if (isSyncing) return
  if (!navigator.onLine) return
  if (!(await isCloudMode())) return
  if (!(await getValidToken())) return

  isSyncing = true
  try {
    const deviceId = await ensureDeviceRegistered()
    const [pushed, pulled] = await Promise.all([push(deviceId), pull(deviceId)])

    if (pushed > 0 || pulled > 0) {
      console.log(`[Sync] ↑ ${pushed} pushed  ↓ ${pulled} pulled`)
      // Notify the UI that new data arrived so components can re-fetch
      window.dispatchEvent(new CustomEvent('stocka:sync-complete', { detail: { pushed, pulled } }))
    }
  } catch (err) {
    console.warn('[Sync] tick failed:', err.message)
  } finally {
    isSyncing = false
  }
}

// ── Public API ─────────────────────────────────────────────────────────────────

export function startSyncWorker() {
  if (syncTimer) return  // already running
  syncTick()             // run immediately on start
  syncTimer = setInterval(syncTick, SYNC_INTERVAL_MS)

  // Also sync when the device comes back online
  window.addEventListener('online', syncTick)

  console.log('[Sync] worker started — interval', SYNC_INTERVAL_MS / 1000, 's')
}

export function stopSyncWorker() {
  if (syncTimer) {
    clearInterval(syncTimer)
    syncTimer = null
  }
  window.removeEventListener('online', syncTick)
  console.log('[Sync] worker stopped')
}

// Force an immediate sync (e.g. after a sale completes)
export function syncNow() {
  syncTick()
}
