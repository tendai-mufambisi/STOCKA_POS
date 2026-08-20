const { getDb } = require('../index')
const { getProductById } = require('./products')
const { logAuditAction } = require('./audit')
const { eventNowIso, eventNowSql } = require('../eventClock')
const { localDayStr } = require('../../analytics/kernel/time')
const { costResolverFor } = require('../../analytics/sql/costResolver')

// Date portion (YYYY-MM-DD) of the true action time — the real receiving date for a
// write replayed from a satellite's offline queue, today otherwise.
function eventDate() { return eventNowIso().split('T')[0] }

function addStockReceiving(receiving) {
  const db = getDb()

  // Idempotency: if this exact receiving was already committed (e.g. a satellite retry
  // after a dropped response), return the existing ID instead of inserting a duplicate.
  // Without this the replay adds a second receiving AND a second stock increase.
  if (receiving.external_id) {
    const existing = db.prepare('SELECT id FROM stock_receivings WHERE external_id = ?').get(receiving.external_id)
    if (existing) return existing.id
  }

  const product = getProductById(receiving.product_id)
  if (!product) throw new Error(`Product with ID ${receiving.product_id} not found`)

  let newId = null
  db.transaction(() => {
    newId = db.prepare(
      `INSERT INTO stock_receivings (supplier_id, product_id, date_received, cartons, units_per_carton, total_units, cost_per_carton, cost_per_unit, total_value, recorded_by, expiry_date, external_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(receiving.supplier_id, receiving.product_id, receiving.date_received, receiving.cartons,
      receiving.units_per_carton, receiving.total_units, receiving.cost_per_carton,
      receiving.cost_per_unit, receiving.total_value, receiving.recorded_by, receiving.expiry_date || null,
      receiving.external_id || null).lastInsertRowid
    // sync_updated_at bump is what carries the new quantity to satellite tills —
    // the products delta only ships rows whose created/last_sold/sync stamp moved.
    db.prepare(`UPDATE products SET current_quantity = ?, sync_updated_at = datetime('now') WHERE id = ?`)
      .run((product.current_quantity || 0) + receiving.total_units, receiving.product_id)
    db.prepare(
      `INSERT INTO stock_movements (product_id, product_name, movement_type, quantity, recorded_by, created_at) VALUES (?, ?, 'RECEIVED', ?, ?, ?)`
    ).run(receiving.product_id, product.name, receiving.total_units, receiving.recorded_by, eventNowSql())
  })()
  return newId
}

function getStockReceivings() {
  return getDb().prepare(`
    SELECT sr.*, p.name as product_name, s.name as supplier_name
    FROM stock_receivings sr
    LEFT JOIN products p ON sr.product_id = p.id
    LEFT JOIN suppliers s ON sr.supplier_id = s.id
    ORDER BY sr.date_received DESC
  `).all()
}

function getStockReceivingById(id) {
  return getDb().prepare(`
    SELECT sr.*, p.name as product_name, s.name as supplier_name
    FROM stock_receivings sr
    LEFT JOIN products p ON sr.product_id = p.id
    LEFT JOIN suppliers s ON sr.supplier_id = s.id
    WHERE sr.id = ?
  `).get(id) || null
}

function getAllPurchaseHistory() {
  return getDb().prepare(`
    SELECT sr.id, sr.date_received, p.name as product_name,
           COALESCE(s.name, 'Direct Purchase') as supplier_name,
           sr.cartons, sr.units_per_carton, sr.total_units,
           sr.cost_per_unit, sr.cost_per_carton, sr.total_value,
           sr.recorded_by, sr.corrects_receiving_id, sr.correction_reason, sr.expiry_date,
           (SELECT COUNT(*) FROM stock_receivings c WHERE c.corrects_receiving_id = sr.id) as correction_count,
           CASE WHEN sr.supplier_id IS NULL THEN 'direct' ELSE 'supplier' END as purchase_type
    FROM stock_receivings sr
    LEFT JOIN products p ON sr.product_id = p.id
    LEFT JOIN suppliers s ON sr.supplier_id = s.id
    WHERE sr.total_units > 0 OR sr.corrects_receiving_id IS NOT NULL
    ORDER BY sr.created_at DESC, sr.date_received DESC
  `).all()
}

// Correct a receiving without touching the original row: appends a new
// stock_receivings row holding the signed unit/value delta, pointing at the
// original via corrects_receiving_id. The correction row stores the corrected
// ABSOLUTE cost_per_unit so latest-cost lookups keep reading the right price.
// `corrected` = { total_units, cost_per_unit, reason } — what SHOULD have been recorded.
function correctStockReceiving(receivingId, corrected, recordedBy) {
  const db = getDb()
  const original = db.prepare(`SELECT * FROM stock_receivings WHERE id = ?`).get(receivingId)
  if (!original) throw new Error(`Receiving #${receivingId} not found`)
  if (original.corrects_receiving_id) throw new Error('This entry is itself a correction — correct the original record instead')

  const product = getProductById(original.product_id)
  if (!product) throw new Error(`Product with ID ${original.product_id} not found`)

  const reason = String(corrected?.reason || '').trim()
  if (!reason) throw new Error('A reason for the correction is required')

  const newUnits = parseInt(corrected.total_units)
  const newCpu = parseFloat(corrected.cost_per_unit)
  if (!Number.isFinite(newUnits) || newUnits < 0) throw new Error('Corrected quantity must be 0 or more')
  if (!Number.isFinite(newCpu) || newCpu < 0) throw new Error('Corrected cost per unit must be 0 or more')

  // Effective state = original + all prior corrections, so a record can be
  // corrected more than once and the math still nets out to the truth.
  const prior = db.prepare(
    `SELECT COALESCE(SUM(total_units), 0) as units, COALESCE(SUM(total_value), 0) as value
     FROM stock_receivings WHERE corrects_receiving_id = ?`
  ).get(receivingId)
  const effectiveUnits = (original.total_units || 0) + prior.units
  const effectiveValue = (original.total_value || 0) + prior.value
  const effectiveCpu = effectiveUnits > 0 ? effectiveValue / effectiveUnits : (original.cost_per_unit || 0)

  const qtyDelta = newUnits - effectiveUnits
  const valueDelta = (newUnits * newCpu) - effectiveValue
  if (qtyDelta === 0 && Math.abs(valueDelta) < 0.005) {
    throw new Error('Corrected values match the current record — nothing to change')
  }

  const stockAfter = (product.current_quantity || 0) + qtyDelta
  if (stockAfter < 0) {
    throw new Error(`Correction would take "${product.name}" stock below zero: removing ${Math.abs(qtyDelta)} units but only ${product.current_quantity || 0} in stock`)
  }

  let correctionId = null
  db.transaction(() => {
    // Correction rows inherit the original's expiry batch identity so grouped
    // batch sums in the expiry queries net out correctly.
    const info = db.prepare(
      `INSERT INTO stock_receivings (supplier_id, product_id, date_received, cartons, units_per_carton, total_units, cost_per_carton, cost_per_unit, total_value, recorded_by, corrects_receiving_id, correction_reason, expiry_date, expiry_discarded_at)
       VALUES (?, ?, ?, 0, 0, ?, 0, ?, ?, ?, ?, ?, ?, ?)`
    ).run(original.supplier_id, original.product_id, original.date_received, qtyDelta, newCpu, valueDelta, recordedBy || 'System', receivingId, reason, original.expiry_date || null, original.expiry_discarded_at || null)
    correctionId = info.lastInsertRowid

    if (qtyDelta !== 0) {
      db.prepare(`UPDATE products SET current_quantity = ?, sync_updated_at = datetime('now') WHERE id = ?`)
        .run(stockAfter, original.product_id)
    }
    db.prepare(
      `INSERT INTO stock_movements (product_id, product_name, movement_type, quantity, note, recorded_by, created_at) VALUES (?, ?, 'RECEIVING_CORRECTION', ?, ?, ?, ?)`
    ).run(original.product_id, product.name, qtyDelta,
      `Correction of receiving #${receivingId}: qty ${effectiveUnits} → ${newUnits}, cost/unit $${effectiveCpu.toFixed(2)} → $${newCpu.toFixed(2)}. Reason: ${reason}`,
      recordedBy || 'System', eventNowSql())
  })()

  logAuditAction(
    recordedBy || 'System', 'CORRECTION', 'stock_receiving', String(receivingId),
    `Corrected receiving #${receivingId} (${product.name}): qty ${effectiveUnits} → ${newUnits} (${qtyDelta >= 0 ? '+' : ''}${qtyDelta} units)`,
    JSON.stringify({ total_units: effectiveUnits, cost_per_unit: effectiveCpu, total_value: effectiveValue }),
    JSON.stringify({ total_units: newUnits, cost_per_unit: newCpu, total_value: newUnits * newCpu, correction_id: correctionId })
  )

  return {
    original_id: receivingId, correction_id: correctionId,
    product_name: product.name, qty_delta: qtyDelta, value_delta: valueDelta,
    previous_units: effectiveUnits, corrected_units: newUnits, new_stock_qty: stockAfter
  }
}

function recordInitialCost(productId, costPerUnit, recordedBy) {
  const db = getDb()
  const product = getProductById(productId)
  if (!product) throw new Error(`Product with ID ${productId} not found`)
  db.prepare(
    `INSERT INTO stock_receivings (supplier_id, product_id, date_received, cartons, units_per_carton, total_units, cost_per_carton, cost_per_unit, total_value, recorded_by)
     VALUES (NULL, ?, ?, 0, 0, 0, 0, ?, 0, ?)`
  ).run(productId, eventDate(), parseFloat(costPerUnit) || 0, recordedBy || 'System')
}

function recordDirectPurchase(purchase) {
  const db = getDb()

  // Same idempotency guard as addStockReceiving — a queued replay must not buy twice.
  if (purchase.external_id) {
    const existing = db.prepare('SELECT id FROM stock_receivings WHERE external_id = ?').get(purchase.external_id)
    if (existing) return existing.id
  }

  const product = getProductById(purchase.product_id)
  if (!product) throw new Error(`Product with ID ${purchase.product_id} not found`)

  const qty = purchase.quantity || 0
  const cpu = parseFloat(purchase.cost_per_unit) || 0
  const totalCost = qty * cpu
  const dateReceived = purchase.date_received || eventDate()

  let newId = null
  db.transaction(() => {
    newId = db.prepare(
      `INSERT INTO stock_receivings (supplier_id, product_id, date_received, cartons, units_per_carton, total_units, cost_per_carton, cost_per_unit, total_value, recorded_by, expiry_date, external_id)
       VALUES (NULL, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(purchase.product_id, dateReceived, qty, qty, totalCost, cpu, totalCost, purchase.recorded_by || 'System',
      purchase.expiry_date || null, purchase.external_id || null).lastInsertRowid
    db.prepare(`UPDATE products SET current_quantity = ?, sync_updated_at = datetime('now') WHERE id = ?`)
      .run((product.current_quantity || 0) + qty, purchase.product_id)
    db.prepare(
      `INSERT INTO stock_movements (product_id, product_name, movement_type, quantity, note, recorded_by, created_at) VALUES (?, ?, 'DIRECT_PURCHASE', ?, ?, ?, ?)`
    ).run(purchase.product_id, product.name, qty, purchase.notes || '', purchase.recorded_by || 'System', eventNowSql())
  })()
  return newId
}

function getDeadStockProducts(days = 30) {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
  const db = getDb()
  const rows = db.prepare(`
    SELECT p.*
    FROM products p
    WHERE p.current_quantity > 0 AND (p.last_sold_date IS NULL OR p.last_sold_date < ?)
    ORDER BY p.last_sold_date ASC
  `).all(cutoff)

  // Valued through the canonical resolver rather than an inline
  // ORDER BY date_received subquery, so the capital reported as tied up in dead
  // stock matches the inventory value reported everywhere else.
  // has_known_cost distinguishes "worth nothing" from "cost unknown" — the two
  // look identical once a missing cost is coerced to 0.
  const costs = costResolverFor(db).costMap()
  return rows.map(p => {
    const rec = costs.get(p.id)
    return {
      ...p,
      latest_cost_per_unit: rec && rec.source === 'receiving' ? rec.cost : 0,
      has_known_cost: !!(rec && rec.source === 'receiving')
    }
  })
}

function getRestockNeeded() {
  return getDb().prepare(`
    SELECT p.*, (p.reorder_level - p.current_quantity) as shortfall,
           COALESCE(s.name, 'No Supplier') as supplier_name
    FROM products p
    LEFT JOIN suppliers s ON p.supplier_id = s.id
    WHERE p.current_quantity <= p.reorder_level
    ORDER BY shortfall DESC
  `).all()
}

function getProductSalesVelocity(days = 30) {
  const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
  return getDb().prepare(`
    SELECT p.id, p.name, p.current_quantity, p.reorder_level,
           COALESCE(SUM(si.quantity), 0) as total_quantity_sold,
           ROUND(CAST(COALESCE(SUM(si.quantity), 0) AS FLOAT) / ?, 2) as velocity_per_day
    FROM products p
    LEFT JOIN (
      SELECT si.product_id, si.quantity FROM sale_items si
      JOIN sales s ON si.sale_id = s.id
      WHERE s.status = 'completed' AND s.created_at >= ?
    ) si ON p.id = si.product_id
    GROUP BY p.id
    HAVING total_quantity_sold > 0
    ORDER BY velocity_per_day DESC
  `).all(days, startDate)
}

// Expiry is tracked per receiving batch = (product, expiry_date). Corrections
// carry the original batch's expiry_date, so SUM(total_units) nets to the true
// batch size. A batch drops out of tracking when it is discarded, when its
// summed units hit 0, or when the product has no stock left on hand.
function getExpiringProducts(days = 7) {
  // expiry_date is a local calendar day, so "today" must be one too.
  const today = localDayStr()
  const cutoff = localDayStr(new Date(Date.now() + days * 24 * 60 * 60 * 1000))
  return getDb().prepare(`
    SELECT p.*, sr.expiry_date,
           SUM(sr.total_units) as batch_units,
           CAST(julianday(sr.expiry_date) - julianday(?) AS INTEGER) as days_until_expiry
    FROM stock_receivings sr
    JOIN products p ON p.id = sr.product_id
    WHERE sr.expiry_date IS NOT NULL AND sr.expiry_discarded_at IS NULL
      AND sr.expiry_date >= ? AND sr.expiry_date <= ?
      AND p.current_quantity > 0
    GROUP BY sr.product_id, sr.expiry_date
    HAVING SUM(sr.total_units) > 0
    ORDER BY sr.expiry_date ASC
  `).all(today, today, cutoff)
}

function getExpiredProducts() {
  const today = localDayStr()
  return getDb().prepare(`
    SELECT p.*, sr.expiry_date,
           SUM(sr.total_units) as batch_units,
           CAST(julianday(?) - julianday(sr.expiry_date) AS INTEGER) as days_expired
    FROM stock_receivings sr
    JOIN products p ON p.id = sr.product_id
    WHERE sr.expiry_date IS NOT NULL AND sr.expiry_discarded_at IS NULL
      AND sr.expiry_date < ?
      AND p.current_quantity > 0
    GROUP BY sr.product_id, sr.expiry_date
    HAVING SUM(sr.total_units) > 0
    ORDER BY sr.expiry_date DESC
  `).all(today, today)
}

function getExpiryReport() {
  const db = getDb()
  const today = localDayStr()
  const week = localDayStr(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000))
  const month = localDayStr(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000))
  // Same batch definition as the two list queries, so the summary cards always
  // agree with the tabs below them.
  const row = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN expiry_date < ? THEN 1 ELSE 0 END), 0) as expired,
      COALESCE(SUM(CASE WHEN expiry_date >= ? AND expiry_date <= ? THEN 1 ELSE 0 END), 0) as expiringWeek,
      COALESCE(SUM(CASE WHEN expiry_date > ? AND expiry_date <= ? THEN 1 ELSE 0 END), 0) as expiringMonth
    FROM (
      SELECT sr.expiry_date
      FROM stock_receivings sr
      JOIN products p ON p.id = sr.product_id
      WHERE sr.expiry_date IS NOT NULL AND sr.expiry_discarded_at IS NULL
        AND p.current_quantity > 0
      GROUP BY sr.product_id, sr.expiry_date
      HAVING SUM(sr.total_units) > 0
    )
  `).get(today, today, week, week, month)
  return { expired: row.expired, expiringThisWeek: row.expiringWeek, expiringThisMonth: row.expiringMonth }
}

// Discard an expiring/expired batch: writes off up to `units` from stock (capped
// at what's on hand — batch units may already be partly sold) and stamps every
// receiving row in the (product, expiry_date) group so the batch stops appearing
// in expiry tracking. `units` may be 0 to just clear the batch from the tracker.
function discardExpiredBatch(productId, expiryDate, units, recordedBy) {
  const db = getDb()
  const product = getProductById(productId)
  if (!product) throw new Error(`Product with ID ${productId} not found`)
  if (!expiryDate) throw new Error('Expiry date is required')
  const qty = parseInt(units)
  if (!Number.isFinite(qty) || qty < 0) throw new Error('Units to discard must be 0 or more')
  const writeOff = Math.min(qty, product.current_quantity || 0)
  const stockAfter = (product.current_quantity || 0) - writeOff

  db.transaction(() => {
    if (writeOff > 0) {
      db.prepare(`UPDATE products SET current_quantity = ?, sync_updated_at = datetime('now') WHERE id = ?`)
        .run(stockAfter, productId)
      db.prepare(
        `INSERT INTO stock_movements (product_id, product_name, movement_type, quantity, note, recorded_by, created_at) VALUES (?, ?, 'EXPIRED_DISCARD', ?, ?, ?, ?)`
      ).run(productId, product.name, -writeOff, `Discarded expired batch (expiry ${expiryDate})`, recordedBy || 'System', eventNowSql())
    }
    db.prepare(`UPDATE stock_receivings SET expiry_discarded_at = datetime('now') WHERE product_id = ? AND expiry_date = ?`)
      .run(productId, expiryDate)
  })()

  logAuditAction(
    recordedBy || 'System', 'DISCARD', 'stock_receiving', String(productId),
    `Discarded expired batch of "${product.name}" (expiry ${expiryDate}): wrote off ${writeOff} units, stock now ${stockAfter}`,
    JSON.stringify({ current_quantity: product.current_quantity || 0 }),
    JSON.stringify({ current_quantity: stockAfter, written_off: writeOff })
  )

  return { product_id: productId, product_name: product.name, expiry_date: expiryDate, written_off: writeOff, new_stock_qty: stockAfter }
}

// ── Stock losses: breakages, damage, theft ──────────────────────────────────
//
// Recorded as STOCK_LOSS rows on the existing movement ledger, not in a table of
// their own. products.current_quantity is a single live number; the analytics
// engine rebuilds history by rolling it backwards through stock_movements and
// then CHECKS that reconstruction against the live figure (inventoryLedger.js →
// rollbackResidual). Any path that moves stock without logging a movement makes
// that check fail and every historical figure suspect. A loss is a movement.
//
// The codes are mirrored in src/utils/stockLossReasons.js, which holds the UI
// labels — keep the two in step. EXPIRED is deliberately absent: expired stock
// is written off by discardExpiredBatch(), the only path that also clears the
// batch from expiry tracking. Two write paths for one event double-count.
const STOCK_LOSS_REASON_CODES = [
  'BROKEN', 'DAMAGED', 'SPILLED', 'SPOILED', 'LOST', 'THEFT', 'INTERNAL_USE', 'OTHER'
]

// created_at is stored UTC but every period query buckets it by local day
// (kernel/time.js → movementDayExpr). Writing a backdated loss at local NOON
// keeps it on the intended day under either DST offset; midnight would land on
// the neighbouring day for half the year.
function localNoonUtcSql(ymd) {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(y, m - 1, d, 12, 0, 0).toISOString().replace('T', ' ').slice(0, 19)
}

// Resolves the timestamp for a loss. Absent/blank date = now (the normal case).
// A date is accepted only if it is a real past-or-today date whose books are
// still open: End of Day snapshots inventory for the day it closes, so a loss
// backdated into a closed day would contradict a figure already reported.
function stockLossTimestamp(lossDate) {
  const ymd = String(lossDate || '').trim()
  if (!ymd) return eventNowSql()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) throw new Error('Date must be in YYYY-MM-DD format')

  // LOCAL day, not eventNowIso().split('T')[0]. The date being validated comes
  // from a date picker seeded with the user's local day, so a UTC "today" rejected
  // the unmodified default as a future date every evening after 22:00 in Zimbabwe.
  const today = localDayStr(new Date(eventNowMs()))
  if (ymd > today) throw new Error('A loss cannot be recorded for a future date')
  if (ymd === today) return eventNowSql()

  const { getEndOfDayByDate } = require('./eod')
  if (getEndOfDayByDate(ymd)) {
    throw new Error(`${ymd} has already been closed off by End of Day — record the loss against today instead`)
  }
  return localNoonUtcSql(ymd)
}

// One loss row, with the reversal that cancels it (if any) already resolved, so
// callers never have to work out whether a write-off still stands.
function getStockLossById(id) {
  return getDb().prepare(`
    SELECT sm.id, sm.product_id, sm.product_name, sm.quantity, sm.note, sm.reason_code,
           sm.unit_cost_at_loss, sm.recorded_by, sm.created_at, sm.reverses_movement_id,
           rev.id            AS reversed_by_id,
           rev.recorded_by   AS reversed_by,
           rev.created_at    AS reversed_at,
           rev.note          AS reversal_reason
      FROM stock_movements sm
      LEFT JOIN stock_movements rev
             ON rev.reverses_movement_id = sm.id
      WHERE sm.id = ? AND sm.movement_type = 'STOCK_LOSS'
  `).get(id) || null
}

function recordStockLoss(loss) {
  const db = getDb()

  // Same idempotency guard as addStockReceiving: a satellite retry after a
  // dropped response must not write the stock off a second time.
  if (loss.external_id) {
    const existing = db.prepare(`SELECT id FROM stock_movements WHERE external_id = ?`).get(loss.external_id)
    if (existing) return getStockLossById(existing.id)
  }

  const product = getProductById(loss.product_id)
  if (!product) throw new Error(`Product with ID ${loss.product_id} not found`)

  const qty = parseInt(loss.quantity)
  if (!Number.isFinite(qty) || qty <= 0) throw new Error('Quantity lost must be 1 or more')

  const reason = String(loss.reason_code || '').trim().toUpperCase()
  if (!STOCK_LOSS_REASON_CODES.includes(reason)) {
    throw new Error(`"${loss.reason_code || ''}" is not a valid loss reason`)
  }

  const note = String(loss.note || '').trim()
  if (reason === 'OTHER' && !note) throw new Error('Describe what happened when the reason is "Other"')

  // Refuse rather than cap. discardExpiredBatch caps because its input is a
  // batch size that may legitimately exceed what is still on the shelf; here the
  // number is what someone says broke, and writing off fewer units than they
  // reported without telling them would quietly falsify the count.
  const onHand = product.current_quantity || 0
  if (qty > onHand) {
    throw new Error(`Cannot write off ${qty} units of "${product.name}" — only ${onHand} in stock`)
  }
  const stockAfter = onHand - qty
  const timestamp = stockLossTimestamp(loss.loss_date)

  // Cost is frozen onto the row now. costResolver returns the LATEST cost for a
  // product, so leaving it to be resolved at report time would let every future
  // receiving silently revalue a write-off that already happened. null when no
  // cost is on record — never 0, which would report the loss as free.
  const cost = costResolverFor(db).costOf(loss.product_id)
  const unitCost = cost.source === 'receiving' ? cost.cost : null

  let newId = null
  db.transaction(() => {
    // sync_updated_at bump is what carries the new quantity to satellite tills.
    db.prepare(`UPDATE products SET current_quantity = ?, sync_updated_at = datetime('now') WHERE id = ?`)
      .run(stockAfter, loss.product_id)
    newId = db.prepare(
      `INSERT INTO stock_movements (product_id, product_name, movement_type, quantity, note, reason_code, unit_cost_at_loss, recorded_by, created_at, external_id)
       VALUES (?, ?, 'STOCK_LOSS', ?, ?, ?, ?, ?, ?, ?)`
    ).run(loss.product_id, product.name, -qty, note, reason, unitCost,
      loss.recorded_by || 'System', timestamp, loss.external_id || null).lastInsertRowid
  })()

  logAuditAction(
    loss.recorded_by || 'System', 'STOCK_LOSS', 'product', String(loss.product_id),
    `Wrote off ${qty} units of "${product.name}" (${reason}): stock ${onHand} → ${stockAfter}${note ? ` — ${note}` : ''}`,
    JSON.stringify({ current_quantity: onHand }),
    JSON.stringify({ current_quantity: stockAfter, quantity_lost: qty, reason_code: reason, movement_id: newId })
  )

  return getStockLossById(newId)
}

// Undo a mis-keyed write-off by appending the opposite movement, never by
// deleting the original. The ledger is append-only and historical figures are
// rebuilt from it, so deleting a row would rewrite months that have already been
// reported. The original stays visible and marked as reversed — a shop owner
// needs to see that 5 units were written off and put back, not a tidy history in
// which it never happened.
function reverseStockLoss(movementId, reason, recordedBy) {
  const db = getDb()
  const original = db.prepare(
    `SELECT * FROM stock_movements WHERE id = ? AND movement_type = 'STOCK_LOSS'`
  ).get(movementId)
  if (!original) throw new Error(`Stock loss #${movementId} not found`)
  if (original.reverses_movement_id) throw new Error('This entry is itself a reversal — reverse the original record instead')

  const already = db.prepare(`SELECT id FROM stock_movements WHERE reverses_movement_id = ?`).get(movementId)
  if (already) throw new Error('This loss has already been reversed')

  const why = String(reason || '').trim()
  if (!why) throw new Error('A reason for reversing the loss is required')

  const product = getProductById(original.product_id)
  if (!product) throw new Error(`Product with ID ${original.product_id} not found`)

  const units = Math.abs(original.quantity)
  const onHand = product.current_quantity || 0
  const stockAfter = onHand + units

  let reversalId = null
  db.transaction(() => {
    db.prepare(`UPDATE products SET current_quantity = ?, sync_updated_at = datetime('now') WHERE id = ?`)
      .run(stockAfter, original.product_id)
    // Positive quantity, same type — which is why STOCK_LOSS is registered as a
    // SIGNED type in analytics/sql/movementSign.js rather than a known decrease.
    reversalId = db.prepare(
      `INSERT INTO stock_movements (product_id, product_name, movement_type, quantity, note, reason_code, unit_cost_at_loss, recorded_by, created_at, reverses_movement_id)
       VALUES (?, ?, 'STOCK_LOSS', ?, ?, ?, ?, ?, ?, ?)`
    ).run(original.product_id, product.name, units, why, original.reason_code,
      original.unit_cost_at_loss, recordedBy || 'System', eventNowSql(), movementId).lastInsertRowid
  })()

  logAuditAction(
    recordedBy || 'System', 'REVERSAL', 'stock_loss', String(movementId),
    `Reversed loss #${movementId} of "${product.name}": ${units} units returned to stock, ${onHand} → ${stockAfter}. Reason: ${why}`,
    JSON.stringify({ current_quantity: onHand }),
    JSON.stringify({ current_quantity: stockAfter, reversal_movement_id: reversalId })
  )

  return { original_id: movementId, reversal_id: reversalId, product_name: product.name, units_returned: units, new_stock_qty: stockAfter }
}

// Everything the shop lost, from both write-off paths in one list.
//
// STOCK_LOSS carries the recorded breakages; EXPIRED_DISCARD carries write-offs
// made from Expiry Tracking. They stay separate movement types with separate
// write paths, but an owner asking "what did we lose this month?" needs one
// answer, not two screens that each show part of it.
//
// Reversals are folded into the row they cancel rather than listed as entries of
// their own — a reversed loss is one event with an outcome, not two events.
function getStockLosses({ start = null, end = null, reason = null, productId = null, limit = 500 } = {}) {
  const rows = getDb().prepare(`
    SELECT sm.id, sm.product_id, sm.product_name, sm.movement_type,
           ABS(sm.quantity)  AS quantity,
           sm.note, sm.recorded_by, sm.created_at,
           CASE WHEN sm.movement_type = 'EXPIRED_DISCARD' THEN 'EXPIRED'
                ELSE COALESCE(sm.reason_code, 'OTHER') END        AS reason_code,
           CASE WHEN sm.movement_type = 'EXPIRED_DISCARD' THEN 'expiry'
                ELSE 'loss' END                                   AS source,
           sm.unit_cost_at_loss,
           rev.id          AS reversed_by_id,
           rev.recorded_by AS reversed_by,
           rev.created_at  AS reversed_at,
           rev.note        AS reversal_reason
      FROM stock_movements sm
      LEFT JOIN stock_movements rev
             ON rev.reverses_movement_id = sm.id
     WHERE sm.movement_type IN ('STOCK_LOSS', 'EXPIRED_DISCARD')
       -- Reversal rows are the positive counterpart of a loss; they are shown
       -- as the state of the row they cancel, never as losses in their own right.
       AND sm.reverses_movement_id IS NULL
       AND (@start     IS NULL OR date(sm.created_at, 'localtime') >= @start)
       AND (@end       IS NULL OR date(sm.created_at, 'localtime') <= @end)
       AND (@productId IS NULL OR sm.product_id = @productId)
     ORDER BY sm.created_at DESC, sm.id DESC
     LIMIT @limit
  `).all({ start, end, productId, limit })

  // Reason filtering happens here rather than in SQL because the EXPIRED label
  // is derived from movement_type, not stored in reason_code.
  const wanted = reason ? String(reason).toUpperCase() : null
  return rows
    .filter(r => !wanted || r.reason_code === wanted)
    .map(r => ({
      ...r,
      reversed: !!r.reversed_by_id,
      // Cost is only known for STOCK_LOSS rows written since this feature
      // shipped. Expiry discards and older rows report null, and null must stay
      // null all the way to the UI so "no cost recorded" is never rendered as $0.
      total_cost: r.unit_cost_at_loss != null ? r.unit_cost_at_loss * r.quantity : null,
      cost_known: r.unit_cost_at_loss != null,
    }))
}

// Headline figures for the losses page.
//
// Units are the primary measure and value is secondary, because cost is missing
// for most of this catalogue: a total that silently treats unknown costs as zero
// looks authoritative and understates the loss. valued_units / total_units is
// what lets the UI say how much of the figure is actually backed by cost data.
function getStockLossSummary({ start = null, end = null } = {}) {
  const rows = getStockLosses({ start, end, limit: 100000 }).filter(r => !r.reversed)

  const byReason = new Map()
  const byProduct = new Map()
  let units = 0, value = 0, valuedUnits = 0

  for (const r of rows) {
    units += r.quantity
    if (r.cost_known) { value += r.total_cost; valuedUnits += r.quantity }

    const reason = byReason.get(r.reason_code) || { reason_code: r.reason_code, units: 0, value: 0 }
    reason.units += r.quantity
    if (r.cost_known) reason.value += r.total_cost
    byReason.set(r.reason_code, reason)

    const prod = byProduct.get(r.product_id) || { product_id: r.product_id, product_name: r.product_name, units: 0, value: 0 }
    prod.units += r.quantity
    if (r.cost_known) prod.value += r.total_cost
    byProduct.set(r.product_id, prod)
  }

  const desc = (a, b) => b.units - a.units
  return {
    incidents: rows.length,
    units,
    value,
    valued_units: valuedUnits,
    unvalued_units: units - valuedUnits,
    products_affected: byProduct.size,
    by_reason: [...byReason.values()].sort(desc),
    by_product: [...byProduct.values()].sort(desc),
  }
}

function importStockReceivings(rows, recordedBy) {
  const db = getDb()
  const findProduct    = db.prepare(`SELECT id, name FROM products WHERE LOWER(name) = LOWER(?) LIMIT 1`)
  const insertProduct  = db.prepare(`INSERT INTO products (name, unit, selling_price, reorder_level, current_quantity) VALUES (?, 'each', 0, 5, 0)`)
  const findSupplier   = db.prepare(`SELECT id FROM suppliers WHERE LOWER(name) = LOWER(?) LIMIT 1`)
  const insertSupplier = db.prepare(`INSERT INTO suppliers (name) VALUES (?)`)
  const insertReceiving = db.prepare(
    `INSERT INTO stock_receivings (supplier_id, product_id, date_received, cartons, units_per_carton, total_units, cost_per_carton, cost_per_unit, total_value, recorded_by, expiry_date)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  const updateQty      = db.prepare(`UPDATE products SET current_quantity = current_quantity + ?, sync_updated_at = datetime('now') WHERE id = ?`)
  const insertMovementReceived = db.prepare(
    `INSERT INTO stock_movements (product_id, product_name, movement_type, quantity, recorded_by, created_at) VALUES (?, ?, 'RECEIVED', ?, ?, ?)`
  )
  const insertMovementDirect = db.prepare(
    `INSERT INTO stock_movements (product_id, product_name, movement_type, quantity, note, recorded_by, created_at) VALUES (?, ?, 'DIRECT_PURCHASE', ?, ?, ?, ?)`
  )

  let inserted = 0, created_products = 0, created_suppliers = 0
  const errors = []

  const run = db.transaction(() => {
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      try {
        const productName = String(row.product_name || '').trim()
        if (!productName) { errors.push(`Row ${i + 2}: product name is required`); continue }
        const qty = parseInt(row.quantity) || 0
        if (qty <= 0) { errors.push(`Row ${i + 2}: quantity must be > 0`); continue }

        const cpu  = parseFloat(row.cost_per_unit) || 0
        const date = eventDate()
        const type = String(row.purchase_type || 'supplier').toLowerCase().trim() === 'direct' ? 'direct' : 'supplier'
        const by   = recordedBy || 'Import'
        // Only accept well-formed dates — anything else imports as "no expiry"
        const expiryRaw = String(row.expiry_date || '').trim()
        const expiry = /^\d{4}-\d{2}-\d{2}$/.test(expiryRaw) ? expiryRaw : null

        let product = findProduct.get(productName)
        if (!product) {
          insertProduct.run(productName)
          product = findProduct.get(productName)
          created_products++
        }

        let supplierId = null
        if (type === 'supplier') {
          const sName = String(row.supplier_name || '').trim()
          if (sName) {
            let supplier = findSupplier.get(sName)
            if (!supplier) { insertSupplier.run(sName); supplier = findSupplier.get(sName); created_suppliers++ }
            supplierId = supplier.id
          }
        }

        const totalValue = qty * cpu
        if (type === 'supplier') {
          insertReceiving.run(supplierId, product.id, date, 0, 0, qty, 0, cpu, totalValue, by, expiry)
          updateQty.run(qty, product.id)
          insertMovementReceived.run(product.id, product.name, qty, by, eventNowSql())
        } else {
          insertReceiving.run(null, product.id, date, 1, qty, qty, totalValue, cpu, totalValue, by, expiry)
          updateQty.run(qty, product.id)
          insertMovementDirect.run(product.id, product.name, qty, row.notes || '', by, eventNowSql())
        }
        inserted++
      } catch (err) {
        errors.push(`Row ${i + 2}: ${err.message}`)
      }
    }
  })

  run()
  return { inserted, created_products, created_suppliers, errors }
}

// ── Reconciliation ──────────────────────────────────────────────────────────

// Everything a stock count needs to be argued with rather than merely entered:
// each product's expected quantity AND the movements that produced it.
//
// The expected figure is products.current_quantity, which was always available.
// What was missing is the derivation — and without it the only possible action
// on a variance is to overwrite the system figure, which is how a shop loses the
// distinction between "5 broke and we know" and "8 are missing and nobody knows".
function getReconciliationSnapshot({ start, end } = {}) {
  const db = getDb()
  const today = eventNowIso().split('T')[0]
  const period = { start: start || today, end: end || today }

  const breakdown = ledgerFor().movementBreakdownIn(db, period)
  const products = db.prepare(
    `SELECT id, name, category, unit, current_quantity, reorder_level FROM products ORDER BY name COLLATE NOCASE`
  ).all()

  return {
    period,
    products: products.map(p => {
      const b = breakdown.get(p.id)
      return {
        ...p,
        expected: p.current_quantity || 0,
        movements: {
          opening: b?.opening ?? (p.current_quantity || 0),
          received: b?.received || 0,
          sold: b?.sold || 0,
          voided: b?.voided || 0,
          expired: b?.expired || 0,
          lost: b?.lost || 0,
          adjusted: b?.adjusted || 0,
          corrections: b?.corrections || 0,
        },
      }
    }),
  }
}

// Lazy require: the analytics engine pulls in the metric registry, and loading
// that at module scope would make this domain file part of the engine's own
// dependency cycle.
function ledgerFor() {
  return require('../../analytics/sql/inventoryLedger')
}

// Apply a counted quantity together with the reason it differs.
//
// Both outcomes land stock on the counted figure — the difference is which
// report term absorbs the variance, and that is the entire point:
//
//   explained   → a STOCK_LOSS with a reason. Leaves the reconciliation
//                 identity balanced, because the units are accounted for.
//   unexplained → an ADJUSTMENT. Shows up as shrinkage, which is the honest
//                 answer when nobody knows where the stock went.
//
// Exactly one movement is written, so the two can never double-count. A surplus
// is always an ADJUSTMENT: stock cannot be un-broken, and "found 3 extra" is a
// counting or receiving error, not a loss.
function reconcileProductExplained(productId, countedQty, explanation, recordedBy) {
  const product = getProductById(productId)
  if (!product) throw new Error(`Product with ID ${productId} not found`)

  const counted = parseInt(countedQty)
  if (!Number.isFinite(counted) || counted < 0) throw new Error('Counted quantity must be 0 or more')

  const before = product.current_quantity || 0
  const variance = counted - before
  const kind = explanation?.type === 'loss' ? 'loss' : 'adjustment'

  if (variance === 0) {
    // Nothing moved, so nothing is written. A movement of 0 would be a lie in
    // the ledger and would show up in every "what happened this month" list.
    return {
      product_id: productId, product_name: product.name,
      previous_qty: before, new_qty: counted, variance: 0, outcome: 'matched',
    }
  }

  if (kind === 'loss') {
    if (variance > 0) throw new Error('A surplus cannot be recorded as a loss — record it as an unexplained adjustment')
    const loss = recordStockLoss({
      product_id: productId,
      quantity: Math.abs(variance),
      reason_code: explanation.reason_code,
      note: explanation.note || `Found short at stock count on ${eventNowIso().split('T')[0]}`,
      recorded_by: recordedBy,
    })
    return {
      product_id: productId, product_name: product.name,
      previous_qty: before, new_qty: counted, variance,
      outcome: 'explained', reason_code: loss.reason_code, movement_id: loss.id,
    }
  }

  const result = reconcileProduct(productId, counted, explanation?.note || '', recordedBy)
  return { ...result, variance, outcome: 'unexplained' }
}

function reconcileProductsExplained(entries, recordedBy) {
  const results = []
  const errors = []
  for (const e of entries) {
    try {
      results.push(reconcileProductExplained(e.product_id, e.counted_qty, e.explanation, recordedBy))
    } catch (err) {
      // One bad row must not abandon the rest of a count that took an hour to
      // do. Each product is already its own transaction.
      errors.push({ product_id: e.product_id, message: err.message })
    }
  }
  return { results, errors }
}

function reconcileProduct(productId, countedQty, notes, recordedBy) {
  const db = getDb()
  const product = getProductById(productId)
  if (!product) throw new Error(`Product not found`)
  const adjustment = countedQty - (product.current_quantity || 0)
  db.transaction(() => {
    db.prepare(`UPDATE products SET current_quantity = ?, sync_updated_at = datetime('now') WHERE id = ?`).run(countedQty, productId)
    db.prepare(
      `INSERT INTO stock_movements (product_id, product_name, movement_type, quantity, note, recorded_by, created_at) VALUES (?, ?, 'ADJUSTMENT', ?, ?, ?, ?)`
    ).run(productId, product.name, adjustment, notes || '', recordedBy || 'System', eventNowSql())
  })()
  return { product_id: productId, product_name: product.name, previous_qty: product.current_quantity || 0, new_qty: countedQty, adjustment }
}

function reconcileProducts(adjustments, recordedBy) {
  const db = getDb()
  const updateQty = db.prepare(`UPDATE products SET current_quantity = ?, sync_updated_at = datetime('now') WHERE id = ?`)
  const insertMovement = db.prepare(
    `INSERT INTO stock_movements (product_id, product_name, movement_type, quantity, note, recorded_by, created_at) VALUES (?, ?, 'ADJUSTMENT', ?, ?, ?, ?)`
  )
  const getProduct = db.prepare(`SELECT id, name, current_quantity FROM products WHERE id = ?`)
  const results = []
  db.transaction(() => {
    for (const adj of adjustments) {
      const product = getProduct.get(adj.product_id)
      if (!product) continue
      const adjustment = adj.counted_qty - (product.current_quantity || 0)
      updateQty.run(adj.counted_qty, adj.product_id)
      insertMovement.run(adj.product_id, product.name, adjustment, adj.notes || '', recordedBy || 'System', eventNowSql())
      results.push({ product_id: adj.product_id, product_name: product.name, previous_qty: product.current_quantity || 0, new_qty: adj.counted_qty, adjustment })
    }
  })()
  return results
}

module.exports = {
  addStockReceiving, getStockReceivings, getStockReceivingById, getAllPurchaseHistory, correctStockReceiving,
  recordDirectPurchase, recordInitialCost, getDeadStockProducts, getRestockNeeded, getProductSalesVelocity,
  getExpiringProducts, getExpiredProducts, getExpiryReport, discardExpiredBatch, importStockReceivings,
  reconcileProduct, reconcileProducts,
  recordStockLoss, reverseStockLoss, getStockLosses, getStockLossById, getStockLossSummary,
  getReconciliationSnapshot, reconcileProductExplained, reconcileProductsExplained,
  STOCK_LOSS_REASON_CODES
}
