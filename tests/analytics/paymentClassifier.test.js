import { describe, it, expect } from 'vitest'
import { electronModule } from '../helpers/db.js'
import {
  classifyTender,
  tenderBreakdown,
  NON_DRAWER_METHODS as RENDERER_NON_DRAWER,
} from '../../src/utils/paymentTender.js'

const pc = electronModule('analytics/sql/paymentClassifier.js')

describe('paymentClassifier', () => {
  it('classifies the canonical values', () => {
    expect(pc.classify('Cash')).toBe('cash')
    expect(pc.classify('Split')).toBe('split')
    for (const m of pc.NON_DRAWER_METHODS) expect(pc.classify(m)).toBe('electronic')
  })

  it('treats a blank method as cash, matching the column default', () => {
    expect(pc.classify(null)).toBe('cash')
    expect(pc.classify('')).toBe('cash')
    expect(pc.classify(undefined)).toBe('cash')
  })

  it('maps legacy pre-normalisation values without dropping them', () => {
    // The migration rewrites unrecognised values to 'Cash'; an un-migrated row
    // must land in the same bucket rather than silently vanishing.
    expect(pc.classify('USD Cash')).toBe('cash')
    expect(pc.classify('ZWG Cash')).toBe('cash')
    expect(pc.isLegacyValue('ZWG Cash')).toBe(true)
    expect(pc.isLegacyValue('Cash')).toBe(false)
  })

  it("keeps 'USD' on the non-drawer side, as the drawer reconciliation does", () => {
    // This is the contradiction the module exists to settle: Reports.jsx counted
    // USD as cash while shifts.js counted it as non-drawer, so the same day had
    // two different cash figures. The drawer wins — that money is physically
    // counted and signed off.
    expect(pc.classify('USD')).toBe('electronic')
    expect(classifyTender('USD')).toBe('electronic')
  })

  describe('split sales', () => {
    const split = { payment_method: 'Split', total: 100, cash_amount: 60, usd_amount: 40 }

    it('routes only cash_amount into the drawer', () => {
      expect(pc.drawerAmountOf(split)).toBe(60)
      expect(pc.nonDrawerAmountOf(split)).toBe(40)
    })

    it('does not put the full total on either side', () => {
      expect(pc.drawerAmountOf(split)).not.toBe(100)
      expect(pc.nonDrawerAmountOf(split)).not.toBe(100)
    })
  })

  it('breaks tenders down so the parts reconcile to the whole', () => {
    const sales = [
      { payment_method: 'Cash', total: 50 },
      { payment_method: 'EcoCash', total: 30 },
      { payment_method: 'Split', total: 100, cash_amount: 60, usd_amount: 40 },
    ]
    const t = tenderBreakdown(sales)
    expect(t.cash).toBe(110) // 50 + 60
    expect(t.electronic).toBe(70) // 30 + 40
    expect(t.split).toBe(100) // reported, not double-counted
    expect(t.cash + t.electronic).toBe(180) // == total revenue
  })

  describe('renderer/engine parity', () => {
    // src/utils/paymentTender.js restates this logic for the renderer because
    // the engine copy is CommonJS. If one is edited without the other, the
    // Cash figure on a report silently drifts from the Cash figure in the
    // drawer again. These assertions are what stop that.
    it('agrees on the non-drawer method list', () => {
      expect([...RENDERER_NON_DRAWER].sort()).toEqual([...pc.NON_DRAWER_METHODS].sort())
    })

    it('agrees on classification for every value either side knows', () => {
      const values = [
        'Cash', 'Split', 'USD', 'Transfer', 'Swipe', 'EcoCash',
        'USD Cash', 'ZWG Cash', '', null, undefined, 'Nonsense',
      ]
      for (const v of values) {
        expect(classifyTender(v), `disagreement on '${v}'`).toBe(pc.classify(v))
      }
    })

    it('agrees on split amounts', () => {
      const s = { payment_method: 'Split', total: 90, cash_amount: 25, usd_amount: 65 }
      const { drawerAmountOf } = pc
      expect(drawerAmountOf(s)).toBe(25)
    })
  })
})
