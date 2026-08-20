const { getDb } = require('../index')
const { getProductById, updateProductQuantity } = require('./products')
const { logAuditAction } = require('./audit')
const { createNotification } = require('./notifications')
// Aliased: addSale already has a local `isReplay` const for its own flag.
const { eventNowIso, eventNowSql, eventNowMs, isReplay: isReplayEvent } = require('../eventClock')

// Decides which shift a sale belongs to. The SERVER decides — a shift_id from a
// renderer is a hint, never authority.
//
// This is the fix for the bug where whole days of sales were filed under the
// previous day. A till keeps its open shift in memory; when that shift is closed
// underneath it (the overnight sweep, or an admin's End of Day) the renderer kept
// sending the now-closed id, and it was written through unchecked. The next
// morning's takings landed on yesterday's drawer, and the new day got no shift row
// at all.
//
// `replayed` is the satellite offline-queue path and is treated as history: the
// money was taken while that drawer was genuinely open, so a shift that has since
// closed is the CORRECT home for it. Crucially a replay is never refused — see the
// comment on the throw below.
function resolveSaleShift(db, cashier, claimedShiftId, nowSql, replayed) {
  if (claimedShiftId) {
    const s = db.prepare('SELECT id, status, cashier_username FROM shifts WHERE id = ?').get(claimedShiftId)
    // Ownership matters as much as status: a stale id belonging to another cashier
    // must not pull this sale onto their drawer.
    if (s && s.cashier_username === cashier) {
      if (s.status === 'open') return s.id
      if (replayed) {
        const inWindow = db.prepare(
          `SELECT 1 FROM shifts WHERE id = ?
             AND datetime(?) >= datetime(started_at)
             AND datetime(?) <= datetime(COALESCE(closed_at, '9999-12-31'))`
        ).get(s.id, nowSql, nowSql)
        if (inWindow) return s.id
      }
    }
  }

  // Time-window fallback — the original behaviour for a sale that arrives with no
  // shift at all. For a live sale only an OPEN shift counts; for a replay a shift
  // that has since closed is still the right answer.
  const match = db.prepare(
    `SELECT id FROM shifts
       WHERE cashier_username = ?
         ${replayed ? '' : "AND status = 'open'"}
         AND datetime(?) >= datetime(started_at)
         AND datetime(?) <= datetime(COALESCE(closed_at, '9999-12-31'))
     ORDER BY started_at DESC LIMIT 1`
  ).get(cashier, nowSql, nowSql)
  if (match) return match.id

  // Two cases land unlinked (shift_id NULL) rather than being refused, and both
  // are then adopted by findOrphanedSalesForShift/reconcileOrphanedSales:
  //
  // - A replay. lanClient treats any 4xx from Main as permanent and archives the
  //   write into failed_writes.json, so refusing here would silently destroy a sale
  //   the cashier already took money for.
  // - A sale that claimed no shift at all. That is a satellite's provisional sale,
  //   rung up while its own shift-start was still sitting in the offline queue —
  //   the __provisional path depends on it being accepted.
  //
  // Only a claim that resolved to a dead shift is refused. That is the actual bug:
  // a till holding an id for a drawer that closed hours ago.
  if (replayed || !claimedShiftId) return null

  const err = new Error(
    'This shift has already been closed, so the sale cannot be recorded against it. ' +
    'Enter an opening float to start a new shift, then ring the sale up again — nothing has been charged.'
  )
  err.code = 'SHIFT_NOT_OPEN'
  throw err
}

function addSale(sale, saleItems) {
  const db = getDb()

  // Idempotency: if this exact sale was already committed (e.g. satellite retry after a
  // dropped response), return the existing ID instead of inserting a duplicate.
  if (sale.external_id) {
    const existing = db.prepare('SELECT id FROM sales WHERE external_id = ?').get(sale.external_id)
    if (existing) return existing.id
  }

  // A replayed sale comes from a satellite's offline queue: the cashier already took
  // the money, so it must be recorded even when our stock math disagrees — stock is
  // clamped at 0 and a discrepancy is flagged instead of rejecting real revenue.
  const isReplay = !!sale.replayed

  // Validate all products and stock levels before any write
  for (const item of saleItems) {
    const product = getProductById(item.product_id)
    if (!product) throw new Error(`Product with ID ${item.product_id} not found`)
    if (!isReplay && product.current_quantity < item.quantity)
      throw new Error(`Insufficient stock for "${product.name}": ${product.current_quantity} available, ${item.quantity} requested`)
  }

  // receipt_number is part of the insert so offline/queued sales keep their printed
  // receipt number — a separate update can't target a sale that has no id yet.
  // till_code records which machine rang this up (its own receipt-number namespace).
  // created_at is stamped explicitly (not left to the datetime('now') default) so a
  // sale replayed from a satellite's offline queue keeps the time it was actually
  // rung up, not the time Main happened to receive it. eventNowSql() = that true
  // time for replays, Main's own clock otherwise.
  const insertSale = db.prepare(
    `INSERT INTO sales (cashier, branch_id, total, cash_tendered, change_given, payment_method, cash_amount, usd_amount, currency, note, status, shift_id, external_id, receipt_number, till_code, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?, ?, ?, ?)`
  )
  const insertItem = db.prepare(
    `INSERT INTO sale_items (sale_id, product_id, product_name, quantity, cost_price, selling_price, subtotal) VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
  const updateQty = db.prepare(`UPDATE products SET current_quantity = ?, last_sold_date = ?, sync_updated_at = datetime('now') WHERE id = ?`)
  const insertMovement = db.prepare(
    `INSERT INTO stock_movements (product_id, product_name, movement_type, quantity, recorded_by, created_at) VALUES (?, ?, 'SOLD', ?, ?, ?)`
  )
  const updateShift = db.prepare(
    `UPDATE shifts SET total_sales_count = total_sales_count + 1, total_sales_value = total_sales_value + ? WHERE id = ?`
  )

  // Resolved BEFORE the transaction opens, so a refusal writes no sale row, moves
  // no stock and logs nothing — the cashier can open a fresh shift and ring the
  // same cart up again with no cleanup.
  const nowSqlOuter = eventNowSql()
  const resolvedShiftId = resolveSaleShift(db, sale.cashier, sale.shift_id || null, nowSqlOuter, isReplay)

  const doSale = db.transaction(() => {
    const cashAmt = parseFloat(sale.cash_amount) || 0
    const usdAmt  = parseFloat(sale.usd_amount)  || 0
    let method = sale.payment_method
    if (!method) {
      if (cashAmt > 0 && usdAmt > 0) method = 'Split'
      else if (usdAmt > 0) method = 'USD'
      else method = 'Cash'
    }
    const now = eventNowIso()
    const nowSql = eventNowSql()

    // Decided above by resolveSaleShift, which validates the renderer's claim and
    // falls back to the shift whose window covers when the sale actually happened
    // (nowSql = its true time, so a replayed offline sale lands on the right drawer
    // no matter what order the queued writes arrive in).
    const shiftId = resolvedShiftId

    const saleId = insertSale.run(
      sale.cashier, sale.branch_id || null, sale.total, sale.cash_tendered, sale.change_given,
      method, cashAmt, usdAmt, sale.currency || 'USD', sale.note || '', shiftId,
      sale.external_id || null, sale.receipt_number || null, sale.till_code || null, nowSql
    ).lastInsertRowid

    const clamped = []
    for (const item of saleItems) {
      insertItem.run(saleId, item.product_id, item.product_name, item.quantity, item.cost_price, item.selling_price, item.subtotal)
      const product = getProductById(item.product_id)
      let newQty = (product.current_quantity || 0) - item.quantity
      if (isReplay && newQty < 0) {
        clamped.push({ name: item.product_name, shortfall: -newQty })
        newQty = 0
      }
      updateQty.run(newQty, now, item.product_id)
      insertMovement.run(item.product_id, item.product_name, item.quantity, sale.cashier, nowSql)
    }

    if (shiftId) updateShift.run(sale.total, shiftId)
    return { saleId, clamped }
  })

  const { saleId, clamped } = doSale()

  try {
    const summary = saleItems.map(i => `${i.product_name} x${i.quantity}`).join(', ')
    logAuditAction(sale.cashier, 'CREATE_SALE', 'SALE', String(saleId), `Sale ${saleId}: ${summary} | Total: $${sale.total}`)
  } catch (_) {}

  // Stock said less than what was physically sold — the sale is recorded; tell the
  // admin to recount those products.
  if (clamped.length > 0) {
    try {
      for (const c of clamped) {
        createNotification({
          type: 'STOCK_DISCREPANCY',
          message: `⚠️ Stock count for "${c.name}" was ${c.shortfall} unit${c.shortfall !== 1 ? 's' : ''} lower than what was actually sold (offline sale #${saleId} by ${sale.cashier}). Quantity set to 0 — please recount this product.`,
        })
      }
      logAuditAction('system', 'STOCK_DISCREPANCY', 'SALE', String(saleId),
        `Offline sale replay clamped stock to 0 for: ${clamped.map(c => `${c.name} (short ${c.shortfall})`).join(', ')}`)
    } catch (_) {}
  }

  return saleId
}

// Discarded holds are excluded here on purpose. They used to be DELETEd, so no
// caller has ever seen one; keeping them in the table for audit must not make
// them appear in transaction lists that never showed them before. They remain
// queryable via getDiscardedHolds().
function getSales() {
  return getDb().prepare(
    `SELECT s.*, (SELECT COUNT(*) FROM sale_items si WHERE si.sale_id = s.id) AS items_count
     FROM sales s WHERE s.status != 'discarded' ORDER BY s.created_at DESC`
  ).all()
}

// Holds that were rung up and abandoned. Previously unknowable — the rows were
// deleted — so this only has data from the release that stopped deleting them.
function getDiscardedHolds() {
  return getDb().prepare(
    `SELECT s.*, (SELECT COUNT(*) FROM sale_items si WHERE si.sale_id = s.id) AS items_count
     FROM sales s WHERE s.status = 'discarded' ORDER BY s.voided_at DESC`
  ).all()
}

function getSaleById(id) {
  return getDb().prepare('SELECT * FROM sales WHERE id = ?').get(id) || null
}

// Every sale rung up on ONE specific till, read from this machine's own local
// mirror — always available even offline, since a till's own confirmed sales
// are always part of its local database.
function getSalesByTillCode(tillCode) {
  return getDb().prepare(
    `SELECT s.*, (SELECT COUNT(*) FROM sale_items si WHERE si.sale_id = s.id) AS items_count
     FROM sales s WHERE s.till_code = ? ORDER BY s.created_at DESC`
  ).all(tillCode)
}

function getSaleItems(saleId) {
  if (saleId) return getDb().prepare('SELECT * FROM sale_items WHERE sale_id = ?').all(saleId)
  return getDb().prepare('SELECT * FROM sale_items ORDER BY id DESC').all()
}

function holdSale(saleId, heldName) {
  getDb().prepare(
    `UPDATE sales SET status = 'held', held_name = ?, held_at = ?, sync_updated_at = datetime('now') WHERE id = ?`
  ).run(heldName || `Hold-${saleId}`, eventNowIso(), saleId)
}

function getHeldSales() {
  return getDb().prepare(`SELECT * FROM sales WHERE status = 'held' ORDER BY held_at DESC`).all()
}

function recallHeldSale(saleId) {
  getDb().prepare(
    `UPDATE sales SET status = 'pending', released_from_hold_at = ?, sync_updated_at = datetime('now') WHERE id = ?`
  ).run(eventNowIso(), saleId)
  const sale = getSaleById(saleId)
  const items = getSaleItems(saleId)
  return { ...sale, items }
}

// Discarding a hold marks it 'discarded' rather than deleting it.
//
// It used to DELETE both the sale and its items. That returned the stock
// correctly, but erased the fact that the transaction had ever existed: the
// receipt number vanished from the sequence, the audit log had no counterpart
// row to point at, and a cashier repeatedly ringing up and discarding large
// holds left no trace at all. Deletion is also the one operation LAN sync
// cannot carry — satellites replicate by upsert, so a row deleted on Main
// simply stays behind on every till that already had it.
//
// The stock return is unchanged. Only the evidence is kept.
function discardHeldSale(saleId, discardedBy) {
  const db = getDb()
  const sale = getSaleById(saleId)
  if (!sale) throw new Error('Sale not found')
  if (sale.status !== 'held') throw new Error(`Only held sales can be discarded (this one is '${sale.status}')`)

  const items = getSaleItems(saleId)
  db.transaction(() => {
    for (const item of items) {
      const product = getProductById(item.product_id)
      if (product) updateProductQuantity(item.product_id, (product.current_quantity || 0) + item.quantity)
    }
    db.prepare(
      `UPDATE sales SET status = 'discarded', void_reason = 'Held sale discarded',
         voided_by = ?, voided_at = ?, sync_dirty = 1, sync_updated_at = datetime('now')
       WHERE id = ?`
    ).run(discardedBy || 'System', eventNowIso(), saleId)
  })()

  try {
    logAuditAction(
      discardedBy || 'System', 'DISCARD_HOLD', 'SALE', String(saleId),
      `Discarded held sale #${saleId} (${items.length} item${items.length === 1 ? '' : 's'}, $${(sale.total || 0).toFixed(2)}) — stock returned`
    )
  } catch (_) {}
}

function voidSale(saleId, voidReason, voidedBy) {
  const db = getDb()
  const sale = getSaleById(saleId)
  if (!sale) throw new Error('Sale not found')

  // Measured against the true void time (eventNowMs) so a void done offline within
  // the 24h window isn't wrongly rejected just because Main replayed it a day later.
  const hoursDiff = (eventNowMs() - new Date(sale.created_at)) / (1000 * 60 * 60)
  if (hoursDiff > 24) throw new Error('Cannot void sales older than 24 hours')

  const items = getSaleItems(saleId)
  for (const item of items) {
    if (!getProductById(item.product_id)) throw new Error(`Product with ID ${item.product_id} not found`)
  }

  const updateQty = db.prepare(`UPDATE products SET current_quantity = ? WHERE id = ?`)
  const insertMovement = db.prepare(
    `INSERT INTO stock_movements (product_id, product_name, movement_type, quantity, note, recorded_by, created_at) VALUES (?, ?, 'VOIDED', ?, ?, ?, ?)`
  )

  db.transaction(() => {
    const now = eventNowIso()
    const nowSql = eventNowSql()
    for (const item of items) {
      const product = getProductById(item.product_id)
      updateQty.run((product.current_quantity || 0) + item.quantity, item.product_id)
      insertMovement.run(item.product_id, item.product_name, item.quantity, `Void sale #${saleId}: ${voidReason}`, voidedBy, nowSql)
    }
    db.prepare(`UPDATE sales SET status = 'voided', void_reason = ?, voided_by = ?, voided_at = ?, sync_updated_at = datetime('now') WHERE id = ?`)
      .run(voidReason, voidedBy, now, saleId)
    if (sale.shift_id) {
      db.prepare(`UPDATE shifts SET total_sales_count = MAX(0, total_sales_count - 1), total_sales_value = MAX(0, total_sales_value - ?) WHERE id = ?`)
        .run(sale.total, sale.shift_id)
    }
  })()

  try { logAuditAction(voidedBy, 'VOID_SALE', 'SALE', String(saleId), `Sale ${saleId} voided: ${voidReason}`) } catch (_) {}
  return true
}

function completeHeldSale(saleId, paymentData, shiftId) {
  const db = getDb()
  const cashAmt = parseFloat(paymentData?.cash_amount) || 0
  const usdAmt  = parseFloat(paymentData?.usd_amount)  || 0
  let method = paymentData?.payment_method
  if (!method) {
    if (cashAmt > 0 && usdAmt > 0) method = 'Split'
    else if (usdAmt > 0) method = 'USD'
    else method = 'Cash'
  }
  // Same rule as addSale: the drawer this lands on is the server's decision, not
  // the till's. Resolved BEFORE the UPDATE so a refusal leaves the sale held and
  // the cashier can re-tender the same recalled hold once they open a new shift.
  const existing = getSaleById(saleId)
  const resolvedShiftId = resolveSaleShift(
    db, existing?.cashier, shiftId || existing?.shift_id || null, eventNowSql(), isReplayEvent()
  )

  db.prepare(
    `UPDATE sales SET status = 'completed', cash_tendered = ?, change_given = ?, payment_method = ?, cash_amount = ?, usd_amount = ?, shift_id = COALESCE(?, shift_id), sync_updated_at = datetime('now')
     WHERE id = ? AND (status = 'pending' OR status = 'held')`
  ).run(paymentData?.cash_tendered || 0, paymentData?.change_given || 0, method, cashAmt, usdAmt, resolvedShiftId, saleId)
  if (resolvedShiftId) {
    const sale = getSaleById(saleId)
    if (sale) db.prepare(`UPDATE shifts SET total_sales_count = total_sales_count + 1, total_sales_value = total_sales_value + ? WHERE id = ?`)
      .run(sale.total, resolvedShiftId)
  }
  try { logAuditAction('system', 'COMPLETE_HELD_SALE', 'SALE', String(saleId), `Held sale ${saleId} completed`) } catch (_) {}
  return saleId
}

function getVoidedSales() {
  return getDb().prepare(`SELECT * FROM sales WHERE status = 'voided' ORDER BY voided_at DESC`).all()
}

function getLastReceiptNumber() {
  return getDb().prepare(`SELECT receipt_number FROM sales WHERE receipt_number IS NOT NULL ORDER BY created_at DESC LIMIT 1`).pluck().get() || null
}

function getSalesByShift(shiftId) {
  const sales = getDb().prepare(
    `SELECT * FROM sales WHERE shift_id = ? AND status = 'completed' ORDER BY created_at DESC`
  ).all(shiftId)
  return sales.map(sale => ({ ...sale, items: getSaleItems(sale.id) }))
}

function getReceiptBySaleId(saleId) {
  const sale = getSaleById(saleId)
  if (!sale) return null
  return { ...sale, items: getSaleItems(saleId) }
}

function updateSaleReceiptNumber(saleId, receiptNumber) {
  getDb().prepare(`UPDATE sales SET receipt_number = ?, sync_updated_at = datetime('now') WHERE id = ?`).run(receiptNumber, saleId)
}

module.exports = {
  addSale, getSales, getSaleById, getSaleItems, holdSale, getHeldSales,
  recallHeldSale, discardHeldSale, getDiscardedHolds, voidSale, completeHeldSale, getVoidedSales,
  getLastReceiptNumber, getReceiptBySaleId, updateSaleReceiptNumber, getSalesByShift,
  getSalesByTillCode,
}
