import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Architecture rules that fail the build beat architecture rules in a README.
//
// The engine's whole value is that a business number exists in exactly one
// place. That property is not self-maintaining: the natural thing to do when a
// metric needs a date filter is to type date(x,'localtime') inline, and once two
// files do that they can drift. These tests make the boundary mechanical.

const here = path.dirname(fileURLToPath(import.meta.url))
const ANALYTICS = path.join(here, '..', '..', 'electron', 'analytics')

function filesUnder(dir) {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) return filesUnder(full)
    return e.name.endsWith('.js') ? [full] : []
  })
}

/** Source with comments stripped — the rules govern code, not prose about code. */
function codeOf(file) {
  return fs
    .readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

const rel = (f) => path.relative(path.join(here, '..', '..'), f).replace(/\\/g, '/')

describe('analytics layering', () => {
  it('keeps the timezone contract in kernel/time.js alone', () => {
    // Every other file must go through saleDayExpr / salePeriodPredicate. An
    // inline date(...,'localtime') is both a second source of truth AND
    // unindexable, which is how every aggregate became a full table scan.
    const offenders = filesUnder(ANALYTICS)
      .filter((f) => !f.endsWith(path.join('kernel', 'time.js')))
      .filter((f) => /'localtime'/.test(codeOf(f)))
      .map(rel)

    // costResolver legitimately needs it for 'knowledge' mode as-of filtering.
    const allowed = ['electron/analytics/sql/costResolver.js']
    expect(offenders.filter((f) => !allowed.includes(f))).toEqual([])
  })

  it('keeps payment classification in paymentClassifier.js alone', () => {
    const offenders = filesUnder(ANALYTICS)
      .filter((f) => !f.endsWith(path.join('sql', 'paymentClassifier.js')))
      .filter((f) => /payment_method\s*(=|IN|!=)/.test(codeOf(f)))
      .map(rel)
    expect(offenders).toEqual([])
  })

  it('never sums stock_movements quantities across movement types', () => {
    // SUM(quantity) over mixed movement types is meaningless: SOLD is stored
    // positive though stock went down, EXPIRED_DISCARD is stored negative, and
    // ADJUSTMENT is genuinely signed. Summing them produces a plausible, wrong
    // number — the worst kind.
    //
    // Two forms are legitimate, and only two:
    //   - normalizedDeltaExpr(), which resolves the signs
    //   - a sum restricted to ONE movement_type, where the meaning is unambiguous
    //
    // Note this does NOT flag SUM(si.quantity) over sale_items, which has no
    // sign ambiguity at all.
    const offenders = filesUnder(ANALYTICS)
      .filter((f) => !f.endsWith(path.join('sql', 'movementSign.js')))
      .filter((f) => {
        const src = codeOf(f)
        if (!/stock_movements/.test(src)) return false
        if (!/SUM\(/i.test(src)) return false

        // Each SUM over a quantity column must be normalised or type-scoped.
        const sums = src.match(/SUM\(\s*(?:ABS\(\s*)?\w*\.?quantity\b[^)]*\)+/gi) || []
        if (sums.length === 0) return false
        const normalised = /normalizedDeltaExpr/.test(src)
        const typeScoped = /movement_type\s*(=|IN)/i.test(src)
        return !normalised && !typeScoped
      })
      .map(rel)
    expect(offenders).toEqual([])
  })

  it('does not let metrics reach for the database singleton', () => {
    // Metrics receive a connection through AnalyticsContext so they can be run
    // against a test database, a past period, or a different scope.
    const metricsDir = path.join(ANALYTICS, 'metrics')
    const offenders = filesUnder(metricsDir)
      .filter((f) => /getDb\s*\(/.test(codeOf(f)))
      .map(rel)
    expect(offenders).toEqual([])
  })

  it('never coerces a missing cost to zero', () => {
    // The silent-100%-margin bug. A product with no cost on record must report
    // source:'none', never a fabricated 0.
    const src = codeOf(path.join(ANALYTICS, 'sql', 'costResolver.js'))
    expect(src).not.toMatch(/cost_per_unit\s*\|\|\s*0/)
    expect(src).not.toMatch(/COALESCE\(\s*\w*\.?cost_per_unit\s*,\s*0\s*\)/i)
  })

  it('states the period predicate with both clauses', () => {
    // The raw comparison is what makes the index usable; the localtime
    // comparison is what makes the answer correct. Dropping either is a bug —
    // one silently slow, the other silently wrong.
    const src = codeOf(path.join(ANALYTICS, 'kernel', 'time.js'))
    expect(src).toMatch(/rawLo/)
    expect(src).toMatch(/dayLo/)
    expect(src).toMatch(/'localtime'/)
  })
})
