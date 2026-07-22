const { getDb } = require('../index')
const { getProductById } = require('./products')
const { logAuditAction } = require('./audit')
const { eventNowIso, eventNowSql } = require('../eventClock')

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
  return getDb().prepare(`
    SELECT p.*,
      COALESCE((SELECT cost_per_unit FROM stock_receivings WHERE product_id = p.id ORDER BY date_received DESC LIMIT 1), 0) as latest_cost_per_unit
    FROM products p
    WHERE p.current_quantity > 0 AND (p.last_sold_date IS NULL OR p.last_sold_date < ?)
    ORDER BY p.last_sold_date ASC
  `).all(cutoff)
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
  const today = new Date().toISOString().split('T')[0]
  const cutoff = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
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
  const today = new Date().toISOString().split('T')[0]
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
  const today = new Date().toISOString().split('T')[0]
  const week = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  const month = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
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
  reconcileProduct, reconcileProducts
}
