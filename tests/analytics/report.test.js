import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { freshDb, disposeDb, electronModule, getDb } from '../helpers/db.js'
import { stockedProduct, sell, addExpense, todayStr } from '../helpers/seed.js'

const analytics = electronModule('analytics/index.js')
const { toHtml, fmt } = electronModule('analytics/render/html/toHtml.js')
const { createDocument, validate, contentHash } = electronModule('analytics/render/document.js')
const chart = electronModule('analytics/render/svg/chart.js')
const { businessHealth } = electronModule('analytics/insights/scoring/businessHealth.js')

let day
beforeEach(() => {
  freshDb()
  day = todayStr()
})
afterAll(disposeDb)

const monthOfToday = () => {
  const [y, m] = day.split('-').map(Number)
  return { type: 'month', year: y, month: m }
}

function seedTradingMonth() {
  const coke = stockedProduct({ name: 'Coke', category: 'Drinks', cost: 2, price: 5, units: 500 })
  const bread = stockedProduct({ name: 'Bread', category: 'Food', cost: 1, price: 3, units: 500 })
  for (let i = 0; i < 6; i++) {
    sell({ lines: [{ productId: coke, name: 'Coke', qty: 3, cost: 2, price: 5 }] })
    sell({ lines: [{ productId: bread, name: 'Bread', qty: 4, cost: 1, price: 3 }], paymentMethod: 'EcoCash' })
  }
  addExpense({ amount: 25, date: day, category: 'Rent' })
  return { coke, bread }
}

describe('ReportDocument', () => {
  const base = () => ({
    id: 'x', title: 'X', period: { start: day, end: day, label: 'Today' }, sections: [],
  })

  it('hashes content but not the timestamp', () => {
    const a = createDocument(base())
    const b = { ...a, generatedAt: '1999-01-01T00:00:00.000Z' }
    // Two runs over unchanged data must be provably identical, which is what
    // makes determinism testable instead of merely asserted.
    expect(contentHash(b)).toBe(a.contentHash)
  })

  it('hashes independently of key order', () => {
    const a = createDocument({ ...base(), shop: { name: 'S', currency: 'USD' } })
    const b = createDocument({ ...base(), shop: { currency: 'USD', name: 'S' } })
    expect(a.contentHash).toBe(b.contentHash)
  })

  it('changes hash when a figure changes', () => {
    const a = createDocument({ ...base(), sections: [{ type: 'keyValue', items: [{ label: 'x', value: 1 }] }] })
    const b = createDocument({ ...base(), sections: [{ type: 'keyValue', items: [{ label: 'x', value: 2 }] }] })
    expect(a.contentHash).not.toBe(b.contentHash)
  })

  it('reports every structural problem at once', () => {
    const problems = validate({
      id: 'x', title: 'X', period: { start: day, end: day },
      sections: [{ type: 'nonsense' }, { type: 'table' }, { type: 'chart', chart: 'bar' }],
    })
    expect(problems.some((p) => /unknown type/.test(p))).toBe(true)
    expect(problems.some((p) => /table needs columns/.test(p))).toBe(true)
    expect(problems.some((p) => /chart needs series/.test(p))).toBe(true)
  })
})

describe('HTML rendering', () => {
  it('escapes user-supplied text', () => {
    // Product and expense names are user input and reach the report directly.
    const doc = createDocument({
      id: 'x', title: 'X', period: { start: day, end: day, label: 'Today' },
      shop: { name: '<script>alert(1)</script>' },
      sections: [
        {
          type: 'table',
          columns: [{ key: 'label', label: 'Product' }],
          rows: [{ label: '<img src=x onerror=alert(1)>' }],
        },
      ],
    })
    const html = toHtml(doc)
    // What matters is that no live TAG survives. The escaped text still
    // contains the characters "onerror=alert" and that is harmless — the
    // angle brackets are what would make it execute.
    expect(html).not.toMatch(/<script>alert/)
    expect(html).not.toMatch(/<img\s/)
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')

    // Only the engine's own <style> and <svg> tags may appear; nothing from
    // the data reaches the output as markup.
    const tags = [...html.matchAll(/<([a-zA-Z][a-zA-Z0-9]*)/g)].map((m) => m[1].toLowerCase())
    expect(tags).not.toContain('script')
    expect(tags).not.toContain('img')
  })

  describe('formatting', () => {
    it('renders an unknown figure as a dash, never as zero', () => {
      // The distinction the entire engine exists to preserve has to survive all
      // the way to the paper.
      expect(fmt(null, 'currency')).toBe('—')
      expect(fmt(0, 'currency')).toBe('$0.00')
      expect(fmt(null, 'ratio')).toBe('—')
      expect(fmt(null, 'count')).toBe('—')
    })

    it('formats each unit in its own idiom', () => {
      expect(fmt(1234.5, 'currency')).toBe('$1,234.50')
      expect(fmt(-42, 'currency')).toBe('-$42.00')
      expect(fmt(0.372, 'ratio')).toBe('37.2%')
      expect(fmt(3, 'days')).toBe('3 days')
      expect(fmt(1, 'days')).toBe('1 day')
    })
  })

  it('explains an unavailable KPI rather than leaving a bare dash', () => {
    const doc = createDocument({
      id: 'x', title: 'X', period: { start: day, end: day, label: 'Today' },
      sections: [{
        type: 'kpiGrid',
        items: [{ label: 'Opening Stock', value: null, unit: 'currency',
                  unavailable: { code: 'DATA_INSUFFICIENT', reason: 'ledger starts later' } }],
      }],
    })
    expect(toHtml(doc)).toContain('ledger starts later')
  })

  it('prints the confidence banner with its reasons', () => {
    const doc = createDocument({
      id: 'x', title: 'X', period: { start: day, end: day, label: 'Today' },
      quality: { confidence: 'low', score: 0.4, blockers: [], warnings: [{ id: 'w', message: 'costs are missing' }], notes: [] },
      sections: [],
    })
    const html = toHtml(doc)
    expect(html).toContain('costs are missing')
    expect(html).toMatch(/40% confidence/)
  })

  it('is self-contained — no external references', () => {
    const doc = createDocument({ id: 'x', title: 'X', period: { start: day, end: day, label: 'T' }, sections: [] })
    const html = toHtml(doc)
    // A PDF window and a scheduled email have no dev server to fetch from.
    expect(html).not.toMatch(/<link[^>]+href/)
    expect(html).not.toMatch(/<script[^>]+src/)
    expect(html).toContain('<style>')
  })
})

describe('SVG charts', () => {
  const points = [10, 25, 5, 40].map((y, i) => ({ x: `d${i}`, y }))

  it('produce valid standalone SVG', () => {
    for (const svg of [
      chart.barChart([{ name: 's', points }]),
      chart.lineChart([{ name: 's', points }]),
      chart.donutChart([{ label: 'a', value: 3 }, { label: 'b', value: 7 }]),
    ]) {
      expect(svg.startsWith('<svg')).toBe(true)
      expect(svg.endsWith('</svg>')).toBe(true)
      expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"')
    }
  })

  it('say so when there is no data instead of drawing an empty frame', () => {
    expect(chart.barChart([{ name: 's', points: [] }])).toContain('No data')
    expect(chart.donutChart([])).toContain('No data')
  })

  it('escape labels', () => {
    const svg = chart.barChart([{ name: 's', points: [{ x: '<script>', y: 5 }] }])
    expect(svg).not.toContain('<script>')
    expect(svg).toContain('&lt;script&gt;')
  })

  it('draws a single 100% slice without collapsing the path', () => {
    // A full circle's start and end points coincide, so a naive single arc
    // renders as nothing at all.
    const svg = chart.donutChart([{ label: 'Cash', value: 100 }])
    expect(svg).toContain('<path')
    expect(svg).toContain('100%')
  })

  it('is deterministic', () => {
    expect(chart.barChart([{ name: 's', points }])).toBe(chart.barChart([{ name: 's', points }]))
  })
})

describe('business health', () => {
  it('excludes a pillar it cannot measure rather than scoring it zero', () => {
    seedTradingMonth()
    const ctx = analytics.makeContext(monthOfToday())
    const { makeBundle } = electronModule('analytics/insights/index.js')
    const health = businessHealth(makeBundle(ctx), ctx)

    const unmeasured = health.pillars.filter((p) => p.score == null)
    expect(unmeasured.length).toBeGreaterThan(0)
    for (const p of unmeasured) expect(p.unavailable).toBeTruthy()
    // A shop with no cost data is not "0% profitable" — its profitability is
    // unknown, and the score must say how much of itself it could compute.
    expect(health.coverage).toBeLessThan(1)
    expect(health.coverage).toBeGreaterThan(0)
  })

  it('never scores an unmeasurable business as zero', () => {
    const ctx = analytics.makeContext(monthOfToday())
    const { makeBundle } = electronModule('analytics/insights/index.js')
    const health = businessHealth(makeBundle(ctx), ctx)
    // Empty period: nothing to score. null, not 0 — 0 reads as "failing".
    if (!health.computable) expect(health.score).toBeNull()
  })
})

describe('runReport', () => {
  it('builds a valid document end to end', () => {
    seedTradingMonth()
    const doc = analytics.runReport('monthly-business-review', monthOfToday())

    expect(doc.id).toBe('monthly-business-review')
    expect(validate(doc)).toEqual([])
    expect(doc.sections.length).toBeGreaterThan(10)
    expect(doc.narrative.executiveSummary).toBeTruthy()
    expect(doc.narrative.source).toBe('template')
    expect(doc.quality).toBeTruthy()
    expect(doc.footnotes.length).toBeGreaterThan(0)
  })

  it('is deterministic over unchanged data', () => {
    seedTradingMonth()
    const a = analytics.runReport('monthly-business-review', monthOfToday())
    const b = analytics.runReport('monthly-business-review', monthOfToday())
    expect(a.contentHash).toBe(b.contentHash)
  })

  it('states the cost gap as a critical insight, not a footnote', () => {
    const orphan = stockedProduct({ name: 'Orphan', cost: 3, price: 10, units: 100 })
    getDb().prepare('DELETE FROM stock_receivings WHERE product_id = ?').run(orphan)
    sell({ lines: [{ productId: orphan, name: 'Orphan', qty: 5, cost: 0, price: 10 }] })

    const doc = analytics.runReport('monthly-business-review', monthOfToday())
    const insight = doc.insights.find((i) => i.ruleId === 'quality.costCoverage')
    expect(insight).toBeTruthy()
    expect(insight.severity).toBe('critical')
    expect(insight.recommendedAction.text).toMatch(/Cost Prices/)
  })

  it('renders to self-contained HTML with charts inline', () => {
    seedTradingMonth()
    const html = analytics.renderReportHtml('monthly-business-review', monthOfToday())
    expect(html).toContain('<svg')
    expect(html).toContain('Monthly Business Intelligence Report')
    expect(html.length).toBeGreaterThan(5000)
  })

  it('freezes a snapshot that reprints identically', () => {
    seedTradingMonth()
    const doc = analytics.runReport('monthly-business-review', monthOfToday())
    const saved = analytics.saveReportSnapshot(doc, 'tester')
    const back = analytics.getReportSnapshot(saved.id)

    // The whole point of freezing: a void entered next week must not rewrite
    // last month's report.
    expect(back.document.contentHash).toBe(doc.contentHash)
    expect(back.document.sections.length).toBe(doc.sections.length)
    expect(analytics.listReportSnapshots().length).toBe(1)
  })

  it('produces a report even for a period with no trading', () => {
    // An empty month must not throw; it must say there was no trading.
    const doc = analytics.runReport('monthly-business-review', monthOfToday())
    expect(validate(doc)).toEqual([])
    expect(doc.narrative.executiveSummary).toMatch(/No sales were recorded/)
  })

  it('lists its available templates', () => {
    const list = analytics.listReports()
    expect(list.map((t) => t.id)).toContain('monthly-business-review')
  })
})
