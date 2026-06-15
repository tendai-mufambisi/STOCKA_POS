const { getDb } = require('../index')
const { logAuditAction } = require('./audit')

function addExpense(expense) {
  const db = getDb()
  const { lastInsertRowid: expenseId } = db.prepare(
    `INSERT INTO expenses (description, amount, category, date, recorded_by, shift_id) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(expense.description, expense.amount, expense.category, expense.date, expense.recorded_by, expense.shift_id || null)
  try {
    logAuditAction(expense.recorded_by, 'CREATE_EXPENSE', 'EXPENSE', String(expenseId),
      `${expense.category} expense: ${expense.description} | Amount: $${expense.amount}`)
  } catch (_) {}
}

function getExpenses() {
  return getDb().prepare('SELECT * FROM expenses ORDER BY date DESC').all()
}

function getExpenseById(id) {
  return getDb().prepare('SELECT * FROM expenses WHERE id = ?').get(id) || null
}

function updateExpense(id, expense) {
  getDb().prepare(
    `UPDATE expenses SET description = ?, amount = ?, category = ?, date = ? WHERE id = ?`
  ).run(expense.description, expense.amount, expense.category, expense.date, id)
}

function deleteExpense(id) {
  getDb().prepare('DELETE FROM expenses WHERE id = ?').run(id)
}

module.exports = { addExpense, getExpenses, getExpenseById, updateExpense, deleteExpense }
