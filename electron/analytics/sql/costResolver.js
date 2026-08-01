// THE canonical unit-cost resolver.
//
// It replaces two implementations that disagreed:
//
//   products.getAllLatestCostPrices()  picked the receiving with MAX(id)
//   reports.getStockValue() and friends picked ORDER BY date_received DESC
//
// Those return different numbers whenever a receiving is backdated (entered
// today for stock that arrived last week) or corrected (a correction row always
// has a newer id but inherits the ORIGINAL date_received). So inventory value on
// the dashboard could differ from inventory value in a report, with no way to
// tell which was right.
//
// ── The batch model ──────────────────────────────────────────────────────────
//
// A *batch* is one root receiving (corrects_receiving_id IS NULL) plus every
// correction pointing at it. correctStockReceiving() writes corrections as
// append-only signed deltas:
//
//     total_units = newUnits − effectiveUnits
//     total_value = (newUnits × newCpu) − effectiveValue
//
// Summing over a batch therefore telescopes:
//
//     Σ total_units = newUnits          Σ total_value = newUnits × newCpu
//     ⇒ Σ total_value / Σ total_units = newCpu
//
// So the weighted average across a batch *is* the corrected cost per unit —
// provably, not approximately, and for any number of successive corrections.
// That is the definition adopted here, because it is derived from the write path
// already in production rather than invented alongside it.
//
// ── Choosing between batches ─────────────────────────────────────────────────
//
// ORDER BY date_received DESC, id DESC.
//
// Date first, because a backdated receiving really is older stock and an
// accountant restating the books cares when goods arrived, not when someone got
// round to typing them in. id is the tiebreaker within a day, which is what
// MAX(id) was doing. Both previous behaviours are preserved wherever they
// agreed; where they disagreed, date wins.
//
// ── Zero cost is not a cost ──────────────────────────────────────────────────
//
// A product that was never received has no cost. The old code returned 0, which
// flows into margin as "sold for $5, cost $0" — a silent 100% margin that looks
// like the best-performing product in the shop. This resolver returns
// { source: 'none' } instead, and callers decide whether to show a dash, exclude
// the row, or raise a data-quality warning. None of them may quietly print 0.

/**
 * Build a cost resolver bound to a database connection.
 *
 * @param db      better-sqlite3 connection
 * @param asOf    'YYYY-MM-DD' — resolve cost as it stood on this day (null = now)
 * @param mode    'business'  — batches received on/before asOf, fully corrected.
 *                              What a restated set of books should show.
 *                'knowledge' — only rows entered on/before asOf. What was known
 *                              on the day, for reprinting a historical document
 *                              exactly as it was originally produced.
 */
function costResolverFor(db, { asOf = null, mode = 'business' } = {}) {
  if (mode !== 'business' && mode !== 'knowledge') {
    throw new Error(`costResolverFor: unknown mode '${mode}'`)
  }

  let cache = null

  function loadAll() {
    if (cache) return cache

    const params = {}
    // Restrict which rows form a batch.
    //   business : corrections always apply (they restate the past), so only the
    //              root's arrival date is filtered.
    //   knowledge: nothing entered after asOf may influence the answer, so both
    //              the root and its corrections are filtered on created_at.
    let rootFilter = ''
    let memberFilter = ''
    if (asOf) {
      if (mode === 'business') {
        rootFilter = 'AND root.date_received <= @asOf'
      } else {
        rootFilter = 'AND date(root.created_at, \'localtime\') <= @asOf'
        memberFilter = 'AND date(b.created_at, \'localtime\') <= @asOf'
      }
      params.asOf = asOf
    }

    const rows = db
      .prepare(
        `SELECT
           root.product_id                       AS product_id,
           root.id                               AS root_id,
           root.date_received                    AS date_received,
           COALESCE(SUM(b.total_units), 0)       AS units,
           COALESCE(SUM(b.total_value), 0)       AS value,
           COUNT(*) - 1                          AS correction_count,
           (SELECT x.cost_per_unit
              FROM stock_receivings x
             WHERE (x.id = root.id OR x.corrects_receiving_id = root.id)
                   ${memberFilter.replace(/\bb\./g, 'x.')}
             ORDER BY x.id DESC LIMIT 1)         AS last_cost_per_unit
         FROM stock_receivings root
         JOIN stock_receivings b
           ON (b.id = root.id OR b.corrects_receiving_id = root.id)
              ${memberFilter}
         WHERE root.corrects_receiving_id IS NULL
               ${rootFilter}
         GROUP BY root.id
         ORDER BY root.product_id ASC, root.date_received DESC, root.id DESC`
      )
      .all(params)

    // Rows arrive newest-first per product, so the first batch seen for a
    // product is the winner and later ones are ignored.
    const map = new Map()
    for (const r of rows) {
      if (map.has(r.product_id)) continue

      // Weighted average across the batch. Falls back to the newest row's
      // cost_per_unit when the batch nets to zero units — which is a real case,
      // not a defensive guard: recordInitialCost() writes a zero-unit receiving
      // purely to seed a cost for a product that has never been delivered, and a
      // correction to zero quantity produces the same shape.
      const cost =
        r.units > 0 ? r.value / r.units : r.last_cost_per_unit != null ? r.last_cost_per_unit : null

      map.set(r.product_id, {
        cost: cost != null && Number.isFinite(cost) ? cost : null,
        source: cost != null && Number.isFinite(cost) ? 'receiving' : 'none',
        rootReceivingId: r.root_id,
        dateReceived: r.date_received,
        corrected: r.correction_count > 0,
      })
    }

    cache = map
    return cache
  }

  const NONE = Object.freeze({
    cost: null,
    source: 'none',
    rootReceivingId: null,
    dateReceived: null,
    corrected: false,
  })

  return {
    /** Cost record for one product. Never returns a fabricated 0. */
    costOf(productId) {
      return loadAll().get(productId) || NONE
    },

    /**
     * Map<productId, CostRecord> for every product with a cost.
     * One scan — use this for bulk valuation rather than calling costOf in a loop.
     */
    costMap() {
      return loadAll()
    },

    /**
     * Plain { productId: cost } for callers that only want the number.
     * Products with no cost are OMITTED rather than present as 0, so a caller
     * that forgets to check gets `undefined` and fails visibly instead of
     * silently valuing stock at nothing.
     */
    costLookup() {
      const out = {}
      for (const [id, rec] of loadAll()) {
        if (rec.source === 'receiving') out[id] = rec.cost
      }
      return out
    },

    /** Product ids that have been sold or stocked but have no cost on record. */
    productsWithoutCost() {
      const withCost = new Set(loadAll().keys())
      return db
        .prepare('SELECT id FROM products ORDER BY id')
        .pluck()
        .all()
        .filter((id) => {
          const rec = loadAll().get(id)
          return !withCost.has(id) || !rec || rec.source !== 'receiving'
        })
    },

    mode,
    asOf,
  }
}

module.exports = { costResolverFor }
