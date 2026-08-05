const { getDb } = require('../index')
const { costResolverFor } = require('../../analytics/sql/costResolver')

// Timestamps are stored in UTC (SQLite datetime('now')); every "day" comparison
// must convert with the 'localtime' modifier and count completed sales only, so
// all machines and all pages agree on the same daily figure.

// Inventory valued AT COST — what the stock on the shelves cost to buy.
//
// Note this is not the same quantity as the "stock value" the Dashboard shows,
// which values the same shelves at SELLING price. Both are legitimate; they are
// simply different questions, and the only bug was calling both of them "stock
// value". This one is the accounting figure.
//
// Products with no cost on record contribute 0 to the total but are counted
// separately, so a caller can tell "nothing in stock" from "we don't know what
// this cost".
function computeStockValueAtCost() {
  const db = getDb()
  const costs = costResolverFor(db).costMap()
  const rows = db.prepare('SELECT id, current_quantity FROM products').all()
  let total = 0
  let unknownCostProducts = 0
  for (const r of rows) {
    const rec = costs.get(r.id)
    if (!rec || rec.source !== 'receiving') {
      if ((r.current_quantity || 0) > 0) unknownCostProducts++
      continue
    }
    total += (r.current_quantity || 0) * rec.cost
  }
  return { total, unknownCostProducts }
}
function getDashboardStats() {
  try {
    const db = getDb()
    return {
      productCount:  db.prepare('SELECT COUNT(*) FROM products').pluck().get() || 0,
      lowStockCount: db.prepare('SELECT COUNT(*) FROM products WHERE current_quantity <= reorder_level').pluck().get() || 0,
      stockValue:    computeStockValueAtCost().total,
      todaySales:    db.prepare(`SELECT COALESCE(SUM(total), 0) FROM sales WHERE status = 'completed' AND date(created_at, 'localtime') = date('now', 'localtime')`).pluck().get() || 0,
      todayExpenses: db.prepare(`SELECT COALESCE(SUM(amount), 0) FROM expenses WHERE date(date) = date('now', 'localtime')`).pluck().get() || 0,
      customerCount: 0
    }
  } catch (_) {
    return { productCount: 0, lowStockCount: 0, stockValue: 0, todaySales: 0, todayExpenses: 0, customerCount: 0 }
  }
}

function getSalesForDay(date) {
  return getDb().prepare(`
    SELECT s.*, GROUP_CONCAT(si.product_name || ' x' || si.quantity) as items
    FROM sales s LEFT JOIN sale_items si ON s.id = si.sale_id
    WHERE date(s.created_at, 'localtime') = ?
    GROUP BY s.id ORDER BY s.created_at DESC
  `).all(date)
}

function getDailyRevenue(date) {
  return getDb().prepare(
    `SELECT COALESCE(SUM(total), 0) FROM sales WHERE status = 'completed' AND date(created_at, 'localtime') = ?`
  ).pluck().get(date) || 0
}

function getDailyCOGS(date) {
  return getDb().prepare(
    `SELECT COALESCE(SUM(quantity * cost_price), 0) FROM sale_items
     WHERE sale_id IN (SELECT id FROM sales WHERE status = 'completed' AND date(created_at, 'localtime') = ?)`
  ).pluck().get(date) || 0
}

function getMonthlyData(year, month) {
  const startDate = `${year}-${String(month).padStart(2, '0')}-01`
  const endDate = new Date(year, month, 0).toISOString().split('T')[0]
  return getDb().prepare(`
    SELECT DATE(created_at, 'localtime') as date, SUM(total) as revenue FROM sales
    WHERE status = 'completed' AND DATE(created_at, 'localtime') BETWEEN ? AND ?
    GROUP BY DATE(created_at, 'localtime') ORDER BY DATE(created_at, 'localtime')
  `).all(startDate, endDate)
}

function getRecentTransactions(limit = 10) {
  const db = getDb()
  const sales = db.prepare(`SELECT id, 'Sale' as type, total as amount, created_at, cashier as recorded_by FROM sales ORDER BY created_at DESC LIMIT ?`).all(limit)
  const receivings = db.prepare(`SELECT id, 'Stock Received' as type, total_value as amount, created_at, recorded_by FROM stock_receivings ORDER BY created_at DESC LIMIT ?`).all(limit)
  return [...sales, ...receivings].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, limit)
}

function getLowStockItems() {
  return getDb().prepare('SELECT * FROM products WHERE current_quantity <= reorder_level ORDER BY current_quantity ASC').all()
}

function getStockValue() {
  try {
    return computeStockValueAtCost().total
  } catch (_) { return 0 }
}

function getManagerAnalytics() {
  try {
    const db = getDb()
    return {
      totalRevenue:      db.prepare(`SELECT COALESCE(SUM(total), 0) FROM sales WHERE status = 'completed'`).pluck().get() || 0,
      inventoryValue:    computeStockValueAtCost().total,
      productCount:      db.prepare('SELECT COUNT(*) FROM products').pluck().get() || 0,
      deadStockCount:    db.prepare(`SELECT COUNT(*) FROM products WHERE current_quantity > 0 AND (last_sold_date IS NULL OR last_sold_date < datetime('now', '-30 days'))`).pluck().get() || 0,
      understockedCount: db.prepare('SELECT COUNT(*) FROM products WHERE current_quantity <= reorder_level').pluck().get() || 0
    }
  } catch (_) { return {} }
}

module.exports = {
  getDashboardStats, getSalesForDay, getDailyRevenue, getDailyCOGS,
  getMonthlyData, getRecentTransactions, getLowStockItems, getStockValue, getManagerAnalytics,
  computeStockValueAtCost
}
