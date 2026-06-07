const w = window.stocka.expenses

export const addExpense = (e) => w.add(e)
export const getExpenses = () => w.getAll()
export const getExpenseById = (id) => w.getById(id)
export const updateExpense = (id, e) => w.update(id, e)
export const deleteExpense = (id) => w.delete(id)
