import { describe, it, expect } from 'vitest'
import { electronModule } from '../helpers/db.js'

const { Period } = electronModule('analytics/kernel/period.js')

describe('Period', () => {
  it('builds an inclusive month', () => {
    const p = Period.month(2026, 7)
    expect(p.start).toBe('2026-07-01')
    expect(p.end).toBe('2026-07-31')
    expect(p.lengthDays()).toBe(31)
    expect(p.label()).toBe('July 2026')
  })

  it('handles month lengths — June has 30 days', () => {
    expect(Period.month(2026, 6).end).toBe('2026-06-30')
    expect(Period.month(2026, 2).end).toBe('2026-02-28')
    expect(Period.month(2028, 2).end).toBe('2028-02-29') // leap year
  })

  describe('previous()', () => {
    it('is calendar-aware, not a day-count subtraction', () => {
      // The bug this prevents: "last month" computed as "the 31 days before
      // July" starts on 30 June and double-counts a day of June's sales.
      const june = Period.month(2026, 7).previous()
      expect(june.start).toBe('2026-06-01')
      expect(june.end).toBe('2026-06-30')
      expect(june.lengthDays()).toBe(30)
    })

    it('crosses the year boundary', () => {
      const dec = Period.month(2026, 1).previous()
      expect(dec.start).toBe('2025-12-01')
      expect(dec.end).toBe('2025-12-31')
    })

    it('steps quarters and years', () => {
      expect(Period.quarter(2026, 1).previous().label()).toBe('Q4 2025')
      expect(Period.year(2026).previous().label()).toBe('2025')
    })

    it('steps a custom range back by its own length', () => {
      const prev = Period.range('2026-07-10', '2026-07-16').previous()
      expect(prev.start).toBe('2026-07-03')
      expect(prev.end).toBe('2026-07-09')
    })
  })

  describe('priorYear()', () => {
    it('compares like for like across differing month lengths', () => {
      const p = Period.month(2028, 2).priorYear() // Feb 2028 is 29 days
      expect(p.start).toBe('2027-02-01')
      expect(p.end).toBe('2027-02-28') // Feb 2027 is 28 — not a 29-day window
    })

    it('clamps 29 Feb rather than rolling into March', () => {
      expect(Period.day('2028-02-29').priorYear().start).toBe('2027-02-28')
    })
  })

  it('enumerates days inclusively at both ends', () => {
    const days = Period.range('2026-07-30', '2026-08-02').days()
    expect(days).toEqual(['2026-07-30', '2026-07-31', '2026-08-01', '2026-08-02'])
  })

  it('builds a Monday-based week', () => {
    const w = Period.week('2026-07-31') // a Friday
    expect(w.start).toBe('2026-07-27')
    expect(w.end).toBe('2026-08-02')
  })

  it('rejects a backwards or malformed range', () => {
    expect(() => Period.range('2026-07-31', '2026-07-01')).toThrow(/before start/)
    expect(() => Period.range('31/07/2026', '2026-07-31')).toThrow(/YYYY-MM-DD/)
  })

  it('gives equal periods an equal cache key', () => {
    expect(Period.month(2026, 7).key).toBe(Period.month(2026, 7).key)
    expect(Period.month(2026, 7).key).not.toBe(Period.month(2026, 6).key)
  })
})
