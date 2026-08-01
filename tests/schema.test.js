import { describe, it, expect, afterAll } from 'vitest'
import { freshDb, disposeDb, electronModule } from './helpers/db.js'

const { CURRENT_DB_VERSION, ensureIndexes } = electronModule('database/schema.js')

afterAll(disposeDb)

const cols = (db, t) => db.pragma(`table_info(${t})`).map((c) => c.name)

describe('schema v5', () => {
  it('is at version 5', () => {
    expect(CURRENT_DB_VERSION).toBe(5)
  })

  it('creates the analytics indexes', () => {
    const db = freshDb()
    const idx = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'")
      .pluck()
      .all()
    // The database shipped with zero indexes; every period aggregate was a scan.
    expect(idx.length).toBeGreaterThanOrEqual(20)
    expect(idx).toContain('idx_sales_status_created')
    expect(idx).toContain('idx_sale_items_sale')
    expect(idx).toContain('idx_recv_product_date')
  })

  it('is idempotent — a second ensureIndexes run is a no-op, not an error', () => {
    const db = freshDb()
    const before = db.prepare("SELECT COUNT(*) FROM sqlite_master WHERE type='index'").pluck().get()
    expect(() => ensureIndexes(db)).not.toThrow()
    const after = db.prepare("SELECT COUNT(*) FROM sqlite_master WHERE type='index'").pluck().get()
    expect(after).toBe(before)
  })

  it('creates the report + inventory snapshot tables', () => {
    const db = freshDb()
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .pluck()
      .all()
    expect(tables).toContain('report_snapshots')
    expect(tables).toContain('inventory_daily_snapshots')
  })

  it('adds the columns whose data cannot be recovered retroactively', () => {
    const db = freshDb()
    expect(cols(db, 'sales')).toEqual(
      expect.arrayContaining(['discount_total', 'discount_reason', 'tax_rate', 'tax_amount'])
    )
    expect(cols(db, 'sale_items')).toContain('discount_amount')
    expect(cols(db, 'stock_movements')).toContain('reason_code')
  })

  it('leaves the existing schema intact', () => {
    const db = freshDb()
    // sale_items.cost_price is the COGS anchor — frozen cost at time of sale.
    expect(cols(db, 'sale_items')).toContain('cost_price')
    expect(cols(db, 'sales')).toEqual(expect.arrayContaining(['status', 'payment_method', 'till_code']))
    expect(cols(db, 'end_of_day')).toContain('report_snapshot')
  })
})
