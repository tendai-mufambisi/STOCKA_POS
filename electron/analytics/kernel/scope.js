const { unsupportedDimension } = require('./errors')

// What slice of the business a metric is computed over.
//
// A Scope produces SQL fragments and named parameters; it never runs a query.
// Threading one object through every metric is what keeps "the same number,
// filtered" from becoming a second implementation of that number.
//
// On branches vs tills — this matters and is easy to get wrong:
//
// The schema has a `branches` table and both sales.branch_id and
// shifts.branch_id. It looks like branch reporting is supported. It is not.
// addSale writes `sale.branch_id || null` (electron/database/domains/sales.js)
// and nothing in the app ever supplies a value, so the column is NULL on every
// sale ever recorded. A branch filter would return zeros — and zeros that look
// like a quiet branch rather than like missing data.
//
// The real axis is till_code ('M' for Main, 'S1'/'S2'… for satellites), which
// IS populated. So Scope exposes tills and refuses branches outright. Refusing
// is the honest answer; returning zero is not.

class Scope {
  constructor(filters = {}) {
    this.tillCodes = filters.tillCodes || null
    this.cashiers = filters.cashiers || null
    this.categories = filters.categories || null
    this.productIds = filters.productIds || null
    this.supplierIds = filters.supplierIds || null
    this.shiftIds = filters.shiftIds || null
    this.label = filters.label || defaultLabel(filters)
    Object.freeze(this)
  }

  static all() {
    return new Scope({ label: 'All tills' })
  }

  static till(code) {
    return new Scope({ tillCodes: [code], label: `Till ${code}` })
  }

  static cashier(username) {
    return new Scope({ cashiers: [username], label: username })
  }

  static category(name) {
    return new Scope({ categories: [name], label: name })
  }

  /**
   * Always throws. See the note above — sales.branch_id is NULL on every row,
   * so this can only ever produce a confidently wrong report.
   */
  static branch() {
    throw unsupportedDimension(
      'branch',
      'sales.branch_id is empty on every existing sale, so a branch filter would ' +
        'report zero rather than report nothing. Use Scope.till() — till_code is populated.'
    )
  }

  get key() {
    // Stable across key ordering so two equivalent scopes share a cache entry.
    return JSON.stringify({
      tillCodes: sorted(this.tillCodes),
      cashiers: sorted(this.cashiers),
      categories: sorted(this.categories),
      productIds: sorted(this.productIds),
      supplierIds: sorted(this.supplierIds),
      shiftIds: sorted(this.shiftIds),
    })
  }

  get isUnfiltered() {
    return (
      !this.tillCodes && !this.cashiers && !this.categories &&
      !this.productIds && !this.supplierIds && !this.shiftIds
    )
  }

  /**
   * Filters applicable to the `sales` table.
   * Returns { sql, params }; sql is '' when nothing applies, so callers can
   * concatenate unconditionally.
   */
  saleWhere(alias = 's', prefix = 'scope') {
    const clauses = []
    const params = {}
    addIn(clauses, params, `${alias}.till_code`, this.tillCodes, `${prefix}_till`)
    addIn(clauses, params, `${alias}.cashier`, this.cashiers, `${prefix}_cashier`)
    addIn(clauses, params, `${alias}.shift_id`, this.shiftIds, `${prefix}_shift`)
    return { sql: clauses.join(' AND '), params }
  }

  /**
   * Filters applicable to `sale_items`, joined to `products` for category.
   * `productAlias` must be a joined products row when categories are in play.
   */
  itemWhere(itemAlias = 'si', productAlias = 'p', prefix = 'scope') {
    const clauses = []
    const params = {}
    addIn(clauses, params, `${itemAlias}.product_id`, this.productIds, `${prefix}_product`)
    addIn(clauses, params, `${productAlias}.category`, this.categories, `${prefix}_cat`)
    addIn(clauses, params, `${productAlias}.supplier_id`, this.supplierIds, `${prefix}_supplier`)
    return { sql: clauses.join(' AND '), params }
  }

  /** Filters applicable to `products` directly. */
  productWhere(alias = 'p', prefix = 'scope') {
    const clauses = []
    const params = {}
    addIn(clauses, params, `${alias}.id`, this.productIds, `${prefix}_product`)
    addIn(clauses, params, `${alias}.category`, this.categories, `${prefix}_cat`)
    addIn(clauses, params, `${alias}.supplier_id`, this.supplierIds, `${prefix}_supplier`)
    return { sql: clauses.join(' AND '), params }
  }

  toJSON() {
    return {
      tillCodes: this.tillCodes,
      cashiers: this.cashiers,
      categories: this.categories,
      productIds: this.productIds,
      supplierIds: this.supplierIds,
      shiftIds: this.shiftIds,
      label: this.label,
    }
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

// Values are bound as named parameters, never interpolated — product names and
// cashier usernames are user-supplied and reach these filters directly.
function addIn(clauses, params, column, values, prefix) {
  if (!values || values.length === 0) return
  const names = values.map((v, i) => {
    params[`${prefix}${i}`] = v
    return `@${prefix}${i}`
  })
  clauses.push(names.length === 1 ? `${column} = ${names[0]}` : `${column} IN (${names.join(', ')})`)
}

function sorted(arr) {
  return arr ? [...arr].sort() : null
}

function defaultLabel(f) {
  if (f.tillCodes?.length) return `Till ${f.tillCodes.join(', ')}`
  if (f.cashiers?.length) return f.cashiers.join(', ')
  if (f.categories?.length) return f.categories.join(', ')
  return 'All tills'
}

module.exports = { Scope }
