const { getDb, saveDb } = require('../index')
const { extractResults } = require('../utils')

function addEndOfDay(eod) {
  getDb().run(
    `INSERT INTO end_of_day (date, cashier, total_sales, total_expenses, expected_cash, actual_cash, difference, status, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [eod.date, eod.cashier, eod.total_sales, eod.total_expenses, eod.expected_cash, eod.actual_cash, eod.difference, eod.status || '', eod.notes || '']
  )
  saveDb()
}

function getEndOfDayRecords() {
  return extractResults(getDb().exec('SELECT * FROM end_of_day ORDER BY date DESC'))
}

function getEndOfDayByDate(date) {
  const rows = extractResults(getDb().exec('SELECT * FROM end_of_day WHERE date = ?', [date]))
  return rows[0] || null
}

module.exports = { addEndOfDay, getEndOfDayRecords, getEndOfDayByDate }
