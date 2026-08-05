const { normalizedDeltaExpr } = require('./movementSign')
const { movementDayExpr } = require('../kernel/time')

// Historical inventory: what was on the shelves, and what it was worth, on a
// given day in the past.
//
// This is the hardest accuracy problem in the engine, because Stocka stores no
// history of stock levels — `products.current_quantity` is a single live number
// that is overwritten on every sale and receipt. There is no "stock as at 30
// June" row anywhere.
//
// What DOES exist is `stock_movements`, an append-only log of every change. So
// the quantity on any past day can be reconstructed by rolling today's quantity
// backwards through every movement that happened since:
//
//     qty(product, D) = current_quantity − Σ delta(movements after D)
//
// Two things make that trustworthy rather than hopeful:
//
//   1. The movement signs are normalised first (see movementSign.js). The table
//      has no consistent convention — SOLD is stored positive while stock went
//      down — so a naive SUM(quantity) produces a plausible, wrong number.
//
//   2. The reconstruction is CHECKED against reality. Rolling back to today
//      must reproduce current_quantity exactly. If it does not, some code path
//      is mutating stock without logging a movement, and every historical
//      figure derived from the ledger is suspect. That check is cheap, and
//      without it the whole valuation is faith-based.

/**
 * Quantity on hand for every product as at the end of local day `asOf`.
 *
 * Products that existed then but not now cannot be recovered — a deleted
 * product takes its movements' FK target with it — so this covers products that
 * still exist. Deletions are rare and destructive by nature; the alternative
 * would be inventing rows.
 *
 * @returns Map<productId, { productId, name, qty, currentQty, movedSince }>
 */
function quantitiesAsOf(db, asOf) {
  const rows = db
    .prepare(
      `SELECT p.id                              AS product_id,
              p.name                            AS name,
              p.category                        AS category,
              p.current_quantity                AS current_qty,
              COALESCE(m.delta_since, 0)        AS delta_since
         FROM products p
         LEFT JOIN (
           SELECT sm.product_id,
                  SUM(${normalizedDeltaExpr('sm')}) AS delta_since
             FROM stock_movements sm
            WHERE ${movementDayExpr('sm')} > @asOf
            GROUP BY sm.product_id
         ) m ON m.product_id = p.id`
    )
    .all({ asOf })

  const out = new Map()
  for (const r of rows) {
    out.set(r.product_id, {
      productId: r.product_id,
      name: r.name,
      category: r.category,
      qty: (r.current_qty || 0) - (r.delta_since || 0),
      currentQty: r.current_qty || 0,
      movedSince: r.delta_since || 0,
    })
  }
  return out
}

/**
 * Value the shelves as at `asOf`, at the cost that applied then.
 *
 * Products with no cost on record contribute 0 to the total but are counted and
 * named separately — "we hold 40 units worth nothing" and "we hold 40 units and
 * don't know what they cost" are different statements, and only one of them is
 * a valuation.
 */
function valuationAsOf(db, asOf, costResolver) {
  const quantities = quantitiesAsOf(db, asOf)
  let total = 0
  let unitsValued = 0
  let unitsUnvalued = 0
  const withoutCost = []

  for (const rec of quantities.values()) {
    if (rec.qty <= 0) continue
    const cost = costResolver.costOf(rec.productId)
    if (cost.source !== 'receiving') {
      unitsUnvalued += rec.qty
      withoutCost.push({ productId: rec.productId, name: rec.name, qty: rec.qty })
      continue
    }
    total += rec.qty * cost.cost
    unitsValued += rec.qty
  }

  return {
    asOf,
    total,
    unitsValued,
    unitsUnvalued,
    productsWithoutCost: withoutCost,
    quantities,
  }
}

/**
 * Integrity check: reconstruct today and compare to the live quantity.
 *
 * A mismatch is proof that stock is being changed somewhere that does not write
 * a stock_movements row. It costs one scan and it is what turns the historical
 * valuation from an assumption into a checked claim.
 */
function rollbackResidual(db, today) {
  const rows = db
    .prepare(
      `SELECT p.id, p.name, p.current_quantity AS current_qty,
              COALESCE(m.delta_since, 0)       AS delta_since
         FROM products p
         LEFT JOIN (
           SELECT sm.product_id, SUM(${normalizedDeltaExpr('sm')}) AS delta_since
             FROM stock_movements sm
            WHERE ${movementDayExpr('sm')} > @today
            GROUP BY sm.product_id
         ) m ON m.product_id = p.id`
    )
    .all({ today })

  // Rolling back to the END of today means nothing should have moved since, so
  // the reconstruction must equal the live figure exactly.
  const mismatches = rows
    .filter((r) => (r.delta_since || 0) !== 0)
    .map((r) => ({
      productId: r.id,
      name: r.name,
      currentQty: r.current_qty,
      unexplained: r.delta_since,
    }))

  return { passed: mismatches.length === 0, mismatches }
}

/**
 * Goods that arrived on the shelves during a period, valued at cost.
 *
 * Measured from the MOVEMENT ledger, not from stock_receivings.date_received,
 * and that distinction is load-bearing.
 *
 * The two dates are different things: `date_received` is the business date an
 * operator typed in, while the movement is stamped when stock actually moved.
 * A receiving entered today for goods that arrived last week has one of each.
 * Since opening and closing stock are both reconstructed from the movement log,
 * measuring purchases on the other axis makes the reconciliation identity fail
 * for a backdated receiving — reporting phantom shrinkage that never happened.
 *
 * So every term of the identity comes from the same axis. Use
 * purchasesInvoicedIn() when the question is about money spent rather than
 * stock that moved.
 */
function purchasesIn(db, period, costResolver) {
  const rows = db
    .prepare(
      `SELECT sm.product_id, SUM(${normalizedDeltaExpr('sm')}) AS units
         FROM stock_movements sm
        WHERE sm.movement_type IN ('RECEIVED', 'DIRECT_PURCHASE', 'RECEIVING_CORRECTION')
          AND ${movementDayExpr('sm')} BETWEEN @start AND @end
        GROUP BY sm.product_id`
    )
    .all({ start: period.start, end: period.end })

  let value = 0
  let units = 0
  for (const r of rows) {
    units += r.units
    const cost = costResolver.costOf(r.product_id)
    if (cost.source === 'receiving') value += r.units * cost.cost
  }
  return { value, units }
}

/**
 * Money committed to stock during a period, by the business date on the
 * receiving. This is the purchasing figure — what was bought and when it was
 * booked — as distinct from purchasesIn(), which is what physically arrived.
 */
function purchasesInvoicedIn(db, period) {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(sr.total_value), 0) AS value,
              COALESCE(SUM(sr.total_units), 0) AS units
         FROM stock_receivings sr
        WHERE date(sr.date_received) BETWEEN @start AND @end`
    )
    .get({ start: period.start, end: period.end })
  return { value: row?.value || 0, units: row?.units || 0 }
}

/** Units written off as expired during a period, valued at cost. */
function expiryDiscardsIn(db, period, costResolver) {
  const rows = db
    .prepare(
      `SELECT sm.product_id, SUM(ABS(sm.quantity)) AS units
         FROM stock_movements sm
        WHERE sm.movement_type = 'EXPIRED_DISCARD'
          AND ${movementDayExpr('sm')} BETWEEN @start AND @end
        GROUP BY sm.product_id`
    )
    .all({ start: period.start, end: period.end })

  let value = 0
  let units = 0
  for (const r of rows) {
    units += r.units
    const cost = costResolver.costOf(r.product_id)
    if (cost.source === 'receiving') value += r.units * cost.cost
  }
  return { value, units }
}

/**
 * Net effect of stock-count adjustments during a period, valued at cost.
 * This is the measurable part of shrinkage: what a physical count found that
 * the books did not.
 */
function adjustmentsIn(db, period, costResolver) {
  const rows = db
    .prepare(
      `SELECT sm.product_id, SUM(sm.quantity) AS units
         FROM stock_movements sm
        WHERE sm.movement_type = 'ADJUSTMENT'
          AND ${movementDayExpr('sm')} BETWEEN @start AND @end
        GROUP BY sm.product_id`
    )
    .all({ start: period.start, end: period.end })

  let value = 0
  let units = 0
  for (const r of rows) {
    units += r.units
    const cost = costResolver.costOf(r.product_id)
    if (cost.source === 'receiving') value += r.units * cost.cost
  }
  return { value, units }
}

module.exports = {
  quantitiesAsOf,
  valuationAsOf,
  rollbackResidual,
  purchasesIn,
  purchasesInvoicedIn,
  expiryDiscardsIn,
  adjustmentsIn,
}
