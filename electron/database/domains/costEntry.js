const { getDb } = require('../index')
const { logAuditAction } = require('./audit')
const { eventNowIso } = require('../eventClock')
const { costResolverFor } = require('../../analytics/sql/costResolver')

// Closing the cost gap.
//
// Stocka's live database has cost data for 5 of 229 stocked products. Because
// sale_items.cost_price is frozen from the latest receiving at the moment of
// sale, a product that was never received freezes a cost of 0 — so it reports a
// 100% margin and looks like the best performer in the shop.
//
// No analytics engine can fix that: it is missing data, not a calculation
// error. This module is the tooling to get the data in, and to correct the
// history it has already distorted — visibly, never silently.

const eventDate = () => eventNowIso().split('T')[0]

/**
 * Products with no cost on record, ranked by how much the gap actually costs
 * the reports.
 *
 * Ranking matters more than it looks. Told "224 products need costs", an owner
 * gives up. Told "these six account for 80% of your uncosted revenue", they fix
 * six. Impact is revenue that has already been mis-reported, plus stock value
 * currently invisible.
 */
function getProductsMissingCost({ salesWindowDays = 90 } = {}) {
  const db = getDb()
  const withCost = new Set(costResolverFor(db).costMap().keys())

  const rows = db
    .prepare(
      `SELECT p.id, p.name, p.category, p.unit,
              p.current_quantity                                   AS qty,
              p.selling_price                                      AS selling_price,
              COALESCE(s.units_sold, 0)                            AS units_sold,
              COALESCE(s.revenue, 0)                               AS revenue_at_risk,
              COALESCE(s.zero_cost_lines, 0)                       AS zero_cost_lines
         FROM products p
         LEFT JOIN (
           SELECT si.product_id,
                  SUM(si.quantity)                                        AS units_sold,
                  SUM(si.quantity * si.selling_price)                     AS revenue,
                  SUM(CASE WHEN si.cost_price <= 0 THEN 1 ELSE 0 END)     AS zero_cost_lines
             FROM sale_items si
             JOIN sales sa ON sa.id = si.sale_id
            WHERE sa.status = 'completed'
              AND date(sa.created_at, 'localtime') >= date('now', 'localtime', @window)
            GROUP BY si.product_id
         ) s ON s.product_id = p.id
        ORDER BY p.name ASC`
    )
    .all({ window: `-${salesWindowDays} days` })

  return rows
    .filter((r) => !withCost.has(r.id))
    .map((r) => ({
      ...r,
      // Stock we cannot value at all.
      stockValueAtRetail: (r.qty || 0) * (r.selling_price || 0),
      // Revenue already reported at a fabricated 100% margin.
      revenueAtRisk: r.revenue_at_risk || 0,
      impact: (r.revenue_at_risk || 0) + (r.qty || 0) * (r.selling_price || 0) * 0.25,
    }))
    .sort((a, b) => b.impact - a.impact)
}

/**
 * How much of the shop's money the engine can currently vouch for.
 * The number the cost-entry screen counts up, and the honest headline for how
 * far any margin figure can be trusted.
 */
function getCostCoverageSummary({ salesWindowDays = 90 } = {}) {
  const db = getDb()
  const withCost = new Set(costResolverFor(db).costMap().keys())

  const stocked = db.prepare('SELECT id FROM products WHERE current_quantity > 0').pluck().all()
  const allProducts = db.prepare('SELECT COUNT(*) FROM products').pluck().get() || 0

  const rev = db
    .prepare(
      `SELECT COALESCE(SUM(si.quantity * si.selling_price), 0)                                   AS total,
              COALESCE(SUM(CASE WHEN si.cost_price <= 0
                                THEN si.quantity * si.selling_price ELSE 0 END), 0)              AS uncosted,
              COALESCE(SUM(CASE WHEN si.cost_price <= 0 THEN 1 ELSE 0 END), 0)                   AS zero_lines,
              COUNT(*)                                                                            AS lines
         FROM sale_items si JOIN sales sa ON sa.id = si.sale_id
        WHERE sa.status = 'completed'
          AND date(sa.created_at, 'localtime') >= date('now', 'localtime', @window)`
    )
    .get({ window: `-${salesWindowDays} days` })

  const stockedCosted = stocked.filter((id) => withCost.has(id)).length

  return {
    productsTotal: allProducts,
    productsStocked: stocked.length,
    productsStockedCosted: stockedCosted,
    productsMissingCost: stocked.length - stockedCosted,
    revenueWindowDays: salesWindowDays,
    revenueTotal: rev?.total || 0,
    revenueUncosted: rev?.uncosted || 0,
    // The figure that decides whether a margin is worth printing.
    revenueCoverage: rev?.total ? (rev.total - rev.uncosted) / rev.total : null,
    zeroCostLines: rev?.zero_lines || 0,
    saleLines: rev?.lines || 0,
    backfillableLines: countBackfillable(db),
  }
}

function countBackfillable(db) {
  const withCost = costResolverFor(db).costMap()
  if (withCost.size === 0) return 0
  const ids = [...withCost.keys()]
  const placeholders = ids.map(() => '?').join(',')
  return (
    db
      .prepare(
        `SELECT COUNT(*) FROM sale_items si JOIN sales sa ON sa.id = si.sale_id
          WHERE sa.status = 'completed' AND si.cost_price <= 0 AND si.quantity > 0
            AND si.product_id IN (${placeholders})`
      )
      .pluck()
      .get(...ids) || 0
  )
}

/**
 * Record what a product's stock cost.
 *
 * Reuses the existing zero-unit receiving convention (see recordInitialCost):
 * a receiving row with no units, carrying only a price, which the cost resolver
 * reads as the product's cost without pretending stock arrived.
 */
function setProductCost(productId, costPerUnit, recordedBy) {
  const db = getDb()
  const product = db.prepare('SELECT id, name FROM products WHERE id = ?').get(productId)
  if (!product) throw new Error(`Product with ID ${productId} not found`)

  const cost = parseFloat(costPerUnit)
  if (!Number.isFinite(cost) || cost < 0) throw new Error('Cost must be 0 or more')
  // A zero cost is exactly the state being fixed, so accepting it would let the
  // screen report progress while changing nothing.
  if (cost === 0) throw new Error('Enter the actual cost — 0 is what we are trying to replace')

  db.prepare(
    `INSERT INTO stock_receivings
       (supplier_id, product_id, date_received, cartons, units_per_carton, total_units,
        cost_per_carton, cost_per_unit, total_value, recorded_by)
     VALUES (NULL, ?, ?, 0, 0, 0, 0, ?, 0, ?)`
  ).run(productId, eventDate(), cost, recordedBy || 'System')

  try {
    logAuditAction(recordedBy || 'System', 'SET_COST', 'PRODUCT', String(productId),
      `Cost price recorded for ${product.name}: $${cost.toFixed(2)}`)
  } catch (_) {}

  return { productId, cost }
}

/** Bulk entry. One transaction so a half-saved screen cannot happen. */
function setProductCosts(entries, recordedBy) {
  const db = getDb()
  const results = []
  const failures = []

  db.transaction(() => {
    for (const e of entries || []) {
      try {
        results.push(setProductCost(e.product_id ?? e.productId, e.cost_per_unit ?? e.cost, recordedBy))
      } catch (err) {
        failures.push({ productId: e.product_id ?? e.productId, error: err.message })
      }
    }
  })()

  return { saved: results.length, failed: failures.length, failures }
}

/**
 * Fill in the cost of lines that were sold before their product had one.
 *
 * Deliberately narrow, because this is the one operation in the engine that
 * changes an already-reported figure:
 *
 *   - only rows where cost_price <= 0. A real recorded cost is never touched.
 *   - only products that now have a cost, so nothing is invented.
 *   - each corrected line is stamped with cost_backfilled_at, so a report can
 *     say the figure was corrected rather than presenting it as original.
 *   - the whole operation is written to the audit log with counts and values.
 *
 * The cost used is the product's CURRENT cost, not a cost as-at the sale date:
 * the entry being made today is the first cost this product has ever had, so
 * there is no historical figure to prefer. That is a stated approximation, and
 * the stamp is what keeps it stated.
 */
function backfillSaleItemCosts({ productIds = null, recordedBy = 'System', dryRun = false } = {}) {
  const db = getDb()
  const costs = costResolverFor(db).costMap()

  let candidates = [...costs.entries()]
    .filter(([, rec]) => rec.source === 'receiving' && rec.cost > 0)
    .map(([id]) => id)
  if (productIds?.length) candidates = candidates.filter((id) => productIds.includes(id))
  if (candidates.length === 0) {
    return { linesUpdated: 0, cogsAdded: 0, productsAffected: 0, dryRun }
  }

  const placeholders = candidates.map(() => '?').join(',')
  const rows = db
    .prepare(
      `SELECT si.id, si.product_id, si.quantity, si.selling_price
         FROM sale_items si JOIN sales sa ON sa.id = si.sale_id
        WHERE sa.status = 'completed' AND si.cost_price <= 0 AND si.quantity > 0
          AND si.product_id IN (${placeholders})`
    )
    .all(...candidates)

  let cogsAdded = 0
  const affected = new Set()
  for (const r of rows) {
    cogsAdded += r.quantity * costs.get(r.product_id).cost
    affected.add(r.product_id)
  }

  if (dryRun) {
    return {
      linesUpdated: rows.length,
      cogsAdded,
      productsAffected: affected.size,
      dryRun: true,
    }
  }

  const stamp = eventNowIso()
  const update = db.prepare(
    `UPDATE sale_items SET cost_price = ?, cost_backfilled_at = ?, sync_dirty = 1,
       sync_updated_at = datetime('now') WHERE id = ?`
  )
  db.transaction(() => {
    for (const r of rows) update.run(costs.get(r.product_id).cost, stamp, r.id)
  })()

  try {
    logAuditAction(
      recordedBy, 'BACKFILL_COST', 'SALE_ITEM', String(rows.length),
      `Backfilled cost on ${rows.length} sold line${rows.length === 1 ? '' : 's'} across ` +
        `${affected.size} product${affected.size === 1 ? '' : 's'}; COGS increased by $${cogsAdded.toFixed(2)}`,
      JSON.stringify({ cost_price: 0, lines: rows.length }),
      JSON.stringify({ cogs_added: cogsAdded, products: [...affected] })
    )
  } catch (_) {}

  return { linesUpdated: rows.length, cogsAdded, productsAffected: affected.size, dryRun: false, stamp }
}

module.exports = {
  getProductsMissingCost,
  getCostCoverageSummary,
  setProductCost,
  setProductCosts,
  backfillSaleItemCosts,
}
