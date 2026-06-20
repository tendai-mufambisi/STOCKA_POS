const { getDb } = require('../index')

function addEndOfDay(eod) {
  const db = getDb()
  const existing = db.prepare('SELECT id FROM end_of_day WHERE date = ?').get(eod.date)
  if (existing) {
    db.prepare(
      `UPDATE end_of_day SET cashier = ?, total_sales = ?, total_expenses = ?, expected_cash = ?, actual_cash = ?, difference = ?, status = ?, notes = ? WHERE date = ?`
    ).run(eod.cashier, eod.total_sales, eod.total_expenses, eod.expected_cash, eod.actual_cash, eod.difference, eod.status || '', eod.notes || '', eod.date)
  } else {
    db.prepare(
      `INSERT INTO end_of_day (date, cashier, total_sales, total_expenses, expected_cash, actual_cash, difference, status, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(eod.date, eod.cashier, eod.total_sales, eod.total_expenses, eod.expected_cash, eod.actual_cash, eod.difference, eod.status || '', eod.notes || '')
  }
}

function getEndOfDayRecords() {
  return getDb().prepare('SELECT * FROM end_of_day ORDER BY date DESC').all()
}

function getEndOfDayByDate(date) {
  return getDb().prepare('SELECT * FROM end_of_day WHERE date = ?').get(date) || null
}

module.exports = { addEndOfDay, getEndOfDayRecords, getEndOfDayByDate }
