import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { freshDb, disposeDb, electronModule } from '../helpers/db.js'
import { stockedProduct, sell, addExpense, todayStr } from '../helpers/seed.js'

const analytics = electronModule('analytics/index.js')
const { toWorkbook } = electronModule('analytics/render/xlsx/toWorkbook.js')

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

function seedMonth() {
  const coke = stockedProduct({ name: 'Coke', category: 'Drinks', cost: 2, price: 5, units: 500 })
  for (let i = 0; i < 4; i++) {
    sell({ lines: [{ productId: coke, name: 'Coke', qty: 3, cost: 2, price: 5 }] })
  }
  addExpense({ amount: 20, date: day, category: 'Rent' })
}

describe('workbook export', () => {
  it('produces a summary sheet plus one per table', () => {
    seedMonth()
    const doc = analytics.runReport('monthly-business-review', monthOfToday())
    const wb = toWorkbook(doc)

    expect(wb.sheets[0].name).toBe('Summary')
    expect(wb.sheets.length).toBeGreaterThan(2)
    expect(wb.filename).toMatch(/\.xlsx$/)
  })

  it('keeps numbers as numbers so the owner can sum them', () => {
    seedMonth()
    const doc = analytics.runReport('monthly-business-review', monthOfToday())
    const wb = toWorkbook(doc)

    const numeric = wb.sheets
      .flatMap((s) => s.rows.slice(1))
      .flat()
      .filter((v) => typeof v === 'number')
    expect(numeric.length).toBeGreaterThan(0)
    // A spreadsheet full of "$1,234.50" strings is a screenshot with extra steps.
    const currencyStrings = wb.sheets.flatMap((s) => s.rows.flat()).filter((v) => typeof v === 'string' && /^\$[\d,]/.test(v))
    expect(currencyStrings).toEqual([])
  })

  it('carries the confidence caveats into the workbook', () => {
    seedMonth()
    const doc = analytics.runReport('monthly-business-review', monthOfToday())
    const wb = toWorkbook(doc)
    const flat = wb.sheets[0].rows.flat().filter(Boolean).join(' | ')

    // A workbook that has been emailed onward has lost the report's banner.
    // The caveat must not be the thing left behind.
    expect(flat).toMatch(/Data confidence/)
    expect(flat).toMatch(doc.quality.confidence)
  })

  it('never turns an unknown figure into a zero', () => {
    // The one place a fabricated zero does most damage, because the next thing
    // that happens to it is SUM().
    const doc = {
      id: 'x', title: 'X', shop: { name: 'S' },
      period: { start: day, end: day, label: 'Today' },
      sections: [{
        type: 'table',
        title: 'T',
        columns: [{ key: 'a', label: 'A' }, { key: 'b', label: 'B', unit: 'currency' }],
        rows: [{ a: 'row', b: null }],
      }],
      insights: [],
    }
    const wb = toWorkbook(doc)
    const sheet = wb.sheets.find((s) => s.name === 'T')
    expect(sheet.rows[1]).toEqual(['row', null])
  })

  it('makes sheet names legal and unique', () => {
    const doc = {
      id: 'x', title: 'X', shop: { name: 'S' },
      period: { start: day, end: day, label: 'Today' },
      sections: [
        { type: 'table', title: 'Sales/Profit: by [Category]', columns: [{ key: 'a', label: 'A' }], rows: [{ a: 1 }] },
        { type: 'table', title: 'Sales/Profit: by [Category]', columns: [{ key: 'a', label: 'A' }], rows: [{ a: 2 }] },
      ],
      insights: [],
    }
    const wb = toWorkbook(doc)
    const names = wb.sheets.map((s) => s.name)
    expect(new Set(names).size).toBe(names.length)
    for (const n of names) {
      expect(n.length).toBeLessThanOrEqual(31)
      expect(n).not.toMatch(/[:\\/?*[\]]/)
    }
  })

  it('includes the insights so the actions travel with the data', () => {
    seedMonth()
    const doc = analytics.runReport('monthly-business-review', monthOfToday())
    const wb = toWorkbook(doc)
    if (doc.insights.length) {
      const sheet = wb.sheets.find((s) => s.name === 'Insights')
      expect(sheet).toBeTruthy()
      expect(sheet.rows[0]).toEqual(['Severity', 'Finding', 'Detail', 'Recommended action'])
      expect(sheet.rows.length).toBe(doc.insights.length + 1)
    }
  })
})
