import { useState, useEffect } from 'react'
import { addExpense, getExpenses, updateExpense, deleteExpense } from '../database/db'
import { validateRequired, validateCurrency, validateDate } from '../utils/validation'
import { useAuthStore } from '../store/useAuthStore'
import { useShiftStore } from '../store/useShiftStore'
import './Expenses.css'

function Expenses() {
  const { user } = useAuthStore()
  const { currentShift } = useShiftStore()
  const [expenses, setExpenses] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('All')
  const [error, setError] = useState('')
  const [formData, setFormData] = useState({
    description: '',
    amount: '',
    category: 'Other',
    date: new Date().toISOString().split('T')[0],
    notes: ''
  })

  const categories = ['Rent', 'Salaries', 'Utilities', 'Transport', 'Supplies', 'Other']

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    try {
      setLoading(true)
      const data = await getExpenses()
      setExpenses(data)
    } catch (err) {
      setError('Failed to load expenses')
    } finally {
      setLoading(false)
    }
  }

  const handleChange = (e) => {
    const { name, value } = e.target
    setFormData(prev => ({ ...prev, [name]: value }))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')

    // Validate required fields
    const descriptionValidation = validateRequired(formData.description, 'Description')
    if (!descriptionValidation.valid) {
      setError(descriptionValidation.error)
      return
    }

    const amountValidation = validateCurrency(formData.amount, 'Amount')
    if (!amountValidation.valid) {
      setError(amountValidation.error)
      return
    }

    // Validate date
    const dateValidation = validateDate(formData.date)
    if (!dateValidation.valid) {
      setError(dateValidation.error)
      return
    }

    try {
      if (editingId) {
        await updateExpense(editingId, {
          ...formData,
          amount: parseFloat(formData.amount)
        })
      } else {
        await addExpense({
          ...formData,
          amount: parseFloat(formData.amount),
          recorded_by: user?.username || 'System',
          shift_id: currentShift?.id || null
        })
      }
      await loadData()
      setFormData({
        description: '',
        amount: '',
        category: 'Other',
        date: new Date().toISOString().split('T')[0],
        notes: ''
      })
      setEditingId(null)
      setShowForm(false)
    } catch (err) {
      setError('Failed to save expense')
    }
  }

  const handleEdit = (expense) => {
    setFormData(expense)
    setEditingId(expense.id)
    setShowForm(true)
  }

  const handleDelete = async (id) => {
    if (window.confirm('Delete this expense?')) {
      try {
        await deleteExpense(id)
        await loadData()
      } catch (err) {
        setError('Failed to delete expense')
      }
    }
  }

  const today = new Date().toISOString().split('T')[0]
  const getStats = (timeframe) => {
    let start, end = new Date()
    switch (timeframe) {
      case 'today':
        start = new Date()
        break
      case 'week':
        start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000)
        break
      case 'month':
        start = new Date(end.getFullYear(), end.getMonth(), 1)
        break
      default:
        return 0
    }
    return expenses
      .filter(e => new Date(e.date) >= start && new Date(e.date) <= end)
      .reduce((sum, e) => sum + (e.amount || 0), 0)
  }

  const filteredExpenses = expenses.filter(e => {
    const matchesSearch = e.description.toLowerCase().includes(search.toLowerCase())
    const matchesCategory = categoryFilter === 'All' || e.category === categoryFilter
    return matchesSearch && matchesCategory
  })

  if (loading) return <div className="expenses-page"><div className="loading">Loading...</div></div>

  return (
    <div className="expenses-page">
      <div className="page-header">
        <h1>Expenses</h1>
        <p>Track business expenses</p>
      </div>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-label">Today</div>
          <div className="stat-value">${getStats('today').toFixed(2)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">This Week</div>
          <div className="stat-value">${getStats('week').toFixed(2)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">This Month</div>
          <div className="stat-value">${getStats('month').toFixed(2)}</div>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="toolbar">
        <button className="btn btn-primary" onClick={() => {
          setShowForm(!showForm)
          if (showForm) {
            setEditingId(null)
            setFormData({
              description: '',
              amount: '',
              category: 'Other',
              date: new Date().toISOString().split('T')[0],
              notes: ''
            })
          }
        }}>
          {showForm ? '✕ Cancel' : '✚ Add Expense'}
        </button>
        <input type="text" placeholder="Search..." value={search} 
          onChange={(e) => setSearch(e.target.value)} className="search-input" />
        <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="category-select">
          <option>All</option>
          {categories.map(c => <option key={c}>{c}</option>)}
        </select>
      </div>

      {showForm && (
        <div className="form-card">
          <h3>{editingId ? '✎ Edit' : '✚ Add'} Expense</h3>
          <form onSubmit={handleSubmit}>
            <div className="form-row">
              <div className="form-group">
                <label>Description *</label>
                <input type="text" name="description" value={formData.description} 
                  onChange={handleChange} required />
              </div>
              <div className="form-group">
                <label>Amount (USD) *</label>
                <input type="number" name="amount" step="any" value={formData.amount} 
                  onChange={handleChange} required />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Category</label>
                <select name="category" value={formData.category} onChange={handleChange}>
                  {categories.map(c => <option key={c}>{c}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Date</label>
                <input type="date" name="date" value={formData.date} onChange={handleChange} />
              </div>
            </div>
            <div className="form-group">
              <label>Notes</label>
              <textarea name="notes" value={formData.notes} onChange={handleChange} rows="2" />
            </div>
            <button type="submit" className="btn btn-primary">
              {editingId ? 'Update' : 'Add'} Expense
            </button>
          </form>
        </div>
      )}

      <div className="expenses-table">
        {filteredExpenses.length === 0 ? (
          <div className="empty-state">No expenses found</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Description</th>
                <th>Category</th>
                <th>Amount</th>
                <th>Notes</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredExpenses.map(e => (
                <tr key={e.id}>
                  <td>{new Date(e.date).toLocaleDateString('en-ZW')}</td>
                  <td>{e.description}</td>
                  <td><span className="category-badge">{e.category}</span></td>
                  <td className="amount">${e.amount?.toFixed(2)}</td>
                  <td className="notes">{e.notes}</td>
                  <td>
                    <button className="btn-icon" onClick={() => handleEdit(e)}>✎</button>
                    <button className="btn-icon delete" onClick={() => handleDelete(e.id)}>✘</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

export default Expenses
