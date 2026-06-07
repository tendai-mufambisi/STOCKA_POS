const { getDb } = require('../index')
const { extractResults, getScalar } = require('../utils')

function getDashboardStats() {
  try {
    const db = getDb()
    const today = new Date().toISOString().split('T')[0]
    return {
      productCount:  getScalar(db.exec('SELECT COUNT(*) FROM products'), 0),
      lowStockCount: getScalar(db.exec('SELECT COUNT(*) FROM products WHERE current_quantity <= reorder_level'), 0),
      stockValue:    getScalar(db.exec(`SELECT COALESCE(SUM(p.current_quantity * COALESCE((SELECT cost_per_unit FROM stock_receivings WHERE product_id = p.id ORDER BY date_received DESC LIMIT 1), 0)), 0) FROM products p`), 0),
      todaySales:    getScalar(db.exec(`SELECT COALESCE(SUM(total), 0) FROM sales WHERE date(created_at) = ?`, [today]), 0),
      todayExpenses: getScalar(db.exec(`SELECT COALESCE(SUM(amount), 0) FROM expenses WHERE date(date) = ?`, [today]), 0),
      customerCount: 0
    }
  } catch (_) {
    return { productCount: 0, lowStockCount: 0, stockValue: 0, todaySales: 0, todayExpenses: 0, customerCount: 0 }
  }
}

function getSalesForDay(date) {
  return extractResults(getDb().exec(`
    SELECT s.*, GROUP_CONCAT(si.product_name || ' x' || si.quantity) as items
    FROM sales s LEFT JOIN sale_items si ON s.id = si.sale_id
    WHERE date(s.created_at) = ?
    GROUP BY s.id ORDER BY s.created_at DESC
  `, [date]))
}

function getDailyRevenue(date) {
  return getScalar(getDb().exec(`SELECT COALESCE(SUM(total), 0) FROM sales WHERE date(created_at) = ?`, [date]), 0)
}

function getDailyCOGS(date) {
  return getScalar(getDb().exec(
    `SELECT COALESCE(SUM(quantity * cost_price), 0) FROM sale_items WHERE sale_id IN (SELECT id FROM sales WHERE date(created_at) = ?)`,
    [date]
  ), 0)
}

function getMonthlyData(year, month) {
  const startDate = `${year}-${String(month).padStart(2, '0')}-01`
  const endDate = new Date(year, month, 0).toISOString().split('T')[0]
  return extractResults(getDb().exec(`
    SELECT DATE(created_at) as date, SUM(total) as revenue FROM sales
    WHERE DATE(created_at) BETWEEN ? AND ?
    GROUP BY DATE(created_at) ORDER BY DATE(created_at)
  `, [startDate, endDate]))
}

function getRecentTransactions(limit = 10) {
  const db = getDb()
  const sales = extractResults(db.exec(`SELECT id, 'Sale' as type, total as amount, created_at, cashier as recorded_by FROM sales ORDER BY created_at DESC LIMIT ?`, [limit]))
  const receivings = extractResults(db.exec(`SELECT id, 'Stock Received' as type, total_value as amount, created_at, recorded_by FROM stock_receivings ORDER BY created_at DESC LIMIT ?`, [limit]))
  return [...sales, ...receivings].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, limit)
}

function getLowStockItems() {
  return extractResults(getDb().exec('SELECT * FROM products WHERE current_quantity <= reorder_level ORDER BY current_quantity ASC'))
}

function getStockValue() {
  try {
    return getScalar(getDb().exec(`SELECT COALESCE(SUM(p.current_quantity * COALESCE((SELECT cost_per_unit FROM stock_receivings WHERE product_id = p.id ORDER BY date_received DESC LIMIT 1), 0)), 0) FROM products p`), 0)
  } catch (_) { return 0 }
}

function getManagerAnalytics() {
  try {
    const db = getDb()
    return {
      totalRevenue:     extractResults(db.exec(`SELECT SUM(total) as total FROM sales WHERE status = 'completed'`))[0]?.total || 0,
      inventoryValue:   extractResults(db.exec(`SELECT COALESCE(SUM(p.current_quantity * COALESCE((SELECT cost_per_unit FROM stock_receivings WHERE product_id = p.id ORDER BY date_received DESC LIMIT 1), 0)), 0) as value FROM products p`))[0]?.value || 0,
      productCount:     extractResults(db.exec('SELECT COUNT(*) as count FROM products'))[0]?.count || 0,
      deadStockCount:   extractResults(db.exec(`SELECT COUNT(*) as count FROM products WHERE current_quantity > 0 AND (last_sold_date IS NULL OR last_sold_date < datetime('now', '-30 days'))`))[0]?.count || 0,
      understockedCount: extractResults(db.exec('SELECT COUNT(*) as count FROM products WHERE current_quantity <= reorder_level'))[0]?.count || 0
    }
  } catch (_) { return {} }
}

module.exports = {
  getDashboardStats, getSalesForDay, getDailyRevenue, getDailyCOGS,
  getMonthlyData, getRecentTransactions, getLowStockItems, getStockValue, getManagerAnalytics
}
