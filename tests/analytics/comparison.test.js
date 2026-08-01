import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { freshDb, disposeDb, electronModule, getDb } from '../helpers/db.js'
import { stockedProduct, sell, todayStr } from '../helpers/seed.js'

const analytics = electronModule('analytics/index.js')
const trendFns = electronModule('analytics/metrics/trend.js')
const { addDays } = electronModule('analytics/kernel/time.js')

let day
beforeEach(() => {
  freshDb()
  day = todayStr()
})
afterAll(disposeDb)

/** Backdate a sale so multi-period comparisons have history to work with. */
function backdateLastSaleTo(dayStr) {
  const id = getDb().prepare('SELECT MAX(id) FROM sales').pluck().get()
  // Stored UTC; midday keeps it on the same local day in any plausible timezone.
  getDb().prepare(`UPDATE sales SET created_at = ? WHERE id = ?`).run(`${dayStr} 12:00:00`, id)
  getDb()
    .prepare(`UPDATE stock_movements SET created_at = ? WHERE id = (SELECT MAX(id) FROM stock_movements)`)
    .run(`${dayStr} 12:00:00`)
}

describe('comparison', () => {
  it('compares a metric against the previous period using the same definition', () => {
    const coke = stockedProduct({ name: 'Coke', cost: 2, price: 5, units: 1000 })
    sell({ lines: [{ productId: coke, name: 'Coke', qty: 10, cost: 2, price: 5 }] })
    backdateLastSaleTo(addDays(day, -1))
    sell({ lines: [{ productId: coke, name: 'Coke', qty: 20, cost: 2, price: 5 }] })

    const res = analytics.compareMetrics(['sales.gross'], { type: 'day', date: day })
    const m = res.metrics['sales.gross']

    expect(m.value).toBeCloseTo(100, 6)
    expect(m.previous).toBeCloseTo(50, 6)
    expect(m.changeVsPrevious).toBeCloseTo(1.0, 6) // +100%
    expect(m.comparable).toBe(true)
  })

  it('refuses to express growth from a zero baseline as a percentage', () => {
    // A first day of trading has not grown infinitely — the comparison simply
    // does not exist. Printing +100% or ∞ would be an invention.
    const coke = stockedProduct({ name: 'Coke', cost: 2, price: 5 })
    sell({ lines: [{ productId: coke, name: 'Coke', qty: 4, cost: 2, price: 5 }] })

    const res = analytics.compareMetrics(['sales.gross'], { type: 'day', date: day })
    expect(res.metrics['sales.gross'].previous).toBe(0)
    expect(res.metrics['sales.gross'].changeVsPrevious).toBeNull()
  })

  it('uses calendar-aware previous periods for months', () => {
    const res = analytics.compareMetrics(['sales.gross'], { type: 'month', year: 2026, month: 7 })
    expect(res.period.start).toBe('2026-07-01')
    // June, whole — not "the 31 days before July", which would double-count a day.
    expect(res.comparisonPeriod.start).toBe('2026-06-01')
    expect(res.comparisonPeriod.end).toBe('2026-06-30')
    expect(res.priorYearPeriod.start).toBe('2025-07-01')
  })

  it('builds a history series oldest-first', () => {
    const coke = stockedProduct({ name: 'Coke', cost: 2, price: 5, units: 1000 })
    sell({ lines: [{ productId: coke, name: 'Coke', qty: 2, cost: 2, price: 5 }] })
    backdateLastSaleTo(addDays(day, -2))
    sell({ lines: [{ productId: coke, name: 'Coke', qty: 6, cost: 2, price: 5 }] })

    const res = analytics.trend('sales.gross', { type: 'day', date: day }, null, { periods: 3 })
    expect(res.series).toHaveLength(3)
    expect(res.series[0].value).toBeCloseTo(10, 6) // two days ago
    expect(res.series[2].value).toBeCloseTo(30, 6) // today
  })
})

describe('trend and forecast', () => {
  it('refuses to fit a trend to too few points', () => {
    const t = trendFns.linearTrend([{ x: 'a', y: 1 }, { x: 'b', y: 2 }])
    expect(t.available).toBe(false)
    expect(t.reason).toMatch(/at least/)
  })

  it('detects direction and reports how well the line fits', () => {
    const rising = [10, 20, 30, 40, 50].map((y, i) => ({ x: i, y }))
    const t = trendFns.linearTrend(rising)
    expect(t.available).toBe(true)
    expect(t.direction).toBe('up')
    expect(t.slope).toBeCloseTo(10, 6)
    expect(t.r2).toBeCloseTo(1, 6)
    expect(t.strength).toBe('strong')
  })

  it('calls a noisy series weak rather than presenting it as a trend', () => {
    const noisy = [10, 90, 15, 85, 20, 80, 25, 75].map((y, i) => ({ x: i, y }))
    const t = trendFns.linearTrend(noisy)
    expect(t.available).toBe(true)
    expect(t.strength).toBe('weak')
  })

  describe('forecast', () => {
    it('refuses to forecast without enough history', () => {
      const f = trendFns.forecastNext([10, 20, 30].map((y, i) => ({ x: i, y })))
      expect(f.available).toBe(false)
      expect(f.reason).toMatch(/Not enough history/)
      expect(f.pointsNeeded).toBe(trendFns.MIN_POINTS_FOR_FORECAST)
    })

    it('always returns an interval, never a bare point estimate', () => {
      // A point forecast with no interval is a guess wearing a suit.
      const series = [100, 110, 120, 130, 140, 150, 160, 170].map((y, i) => ({ x: i, y }))
      const f = trendFns.forecastNext(series)
      expect(f.available).toBe(true)
      expect(f.value).toBeCloseTo(180, 0)
      expect(f.low).toBeLessThanOrEqual(f.value)
      expect(f.high).toBeGreaterThanOrEqual(f.value)
      expect(f.basedOnPeriods).toBe(8)
    })

    it('widens the interval and downgrades reliability on noisy data', () => {
      const steady = [100, 102, 104, 106, 108, 110, 112, 114].map((y, i) => ({ x: i, y }))
      const erratic = [100, 20, 180, 30, 170, 25, 190, 15].map((y, i) => ({ x: i, y }))

      const a = trendFns.forecastNext(steady)
      const b = trendFns.forecastNext(erratic)

      expect(b.high - b.low).toBeGreaterThan(a.high - a.low)
      expect(a.reliability).toBe('usable')
      expect(b.reliability).toBe('indicative')
    })

    it('never forecasts negative sales', () => {
      const falling = [80, 70, 60, 50, 40, 30, 20, 10].map((y, i) => ({ x: i, y }))
      const f = trendFns.forecastNext(falling)
      expect(f.value).toBeGreaterThanOrEqual(0)
      expect(f.low).toBeGreaterThanOrEqual(0)
    })
  })

  it('projects days until stockout, or nothing when nothing is selling', () => {
    expect(trendFns.daysUntilStockout(20, 4)).toBeCloseTo(5, 6)
    // Not "infinity days of stock" — a product that never sells has no
    // meaningful stockout date, and saying so is the honest answer.
    expect(trendFns.daysUntilStockout(20, 0)).toBeNull()
  })
})

describe('backdated receiving', () => {
  it('keeps the reconciliation identity intact', () => {
    // The bug this pins: purchases used to be measured on
    // stock_receivings.date_received while opening/closing come from the
    // movement log. A receiving entered today for goods booked to last week
    // then showed up as phantom shrinkage.
    const p = stockedProduct({ name: 'Backdated', cost: 2, price: 5, units: 100 })
    getDb()
      .prepare(`UPDATE stock_receivings SET date_received = ? WHERE product_id = ?`)
      .run(addDays(day, -30), p)
    sell({ lines: [{ productId: p, name: 'Backdated', qty: 10, cost: 2, price: 5 }] })

    const m = analytics.computeMetrics(
      ['inventory.purchases', 'inventory.purchasesInvoiced', 'inventory.reconciles'],
      { type: 'day', date: day }
    ).metrics

    // Stock physically arrived today...
    expect(m['inventory.purchases'].value).toBeCloseTo(200, 6)
    // ...but was invoiced to a date outside this period.
    expect(m['inventory.purchasesInvoiced'].value).toBeCloseTo(0, 6)
    // The identity uses the movement axis, so it still balances.
    expect(m['inventory.reconciles'].value.reconciles).toBe(true)
  })
})
