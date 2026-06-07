const { getDb, saveDb } = require('../index')
const { extractResults } = require('../utils')
const { logAuditAction } = require('./audit')

function addExpense(expense) {
  const db = getDb()
  db.run(
    `INSERT INTO expenses (description, amount, category, date, recorded_by, shift_id) VALUES (?, ?, ?, ?, ?, ?)`,
    [expense.description, expense.amount, expense.category, expense.date, expense.recorded_by, expense.shift_id || null]
  )
  const rows = extractResults(db.exec('SELECT last_insert_rowid() as id'))
  const expenseId = rows[0].id
  saveDb()
  try {
    logAuditAction(expense.recorded_by, 'CREATE_EXPENSE', 'EXPENSE', String(expenseId),
      `${expense.category} expense: ${expense.description} | Amount: $${expense.amount}`)
  } catch (_) {}
}

function getExpenses() {
  return extractResults(getDb().exec('SELECT * FROM expenses ORDER BY date DESC'))
}

function getExpenseById(id) {
  const rows = extractResults(getDb().exec('SELECT * FROM expenses WHERE id = ?', [id]))
  return rows[0] || null
}

function updateExpense(id, expense) {
  getDb().run(
    `UPDATE expenses SET description = ?, amount = ?, category = ?, date = ? WHERE id = ?`,
    [expense.description, expense.amount, expense.category, expense.date, id]
  )
  saveDb()
}

function deleteExpense(id) {
  getDb().run('DELETE FROM expenses WHERE id = ?', [id])
  saveDb()
}

module.exports = { addExpense, getExpenses, getExpenseById, updateExpense, deleteExpense }
