import { useState, useEffect } from 'react'
import { addExpense, getExpenses, updateExpense, deleteExpense } from '../database/db'
import ConfirmModal from '../components/ConfirmModal'
import Modal from '../components/Modal'
import Field from '../components/Field'
import { toast } from '../store/useToastStore'
import { validateRequired, validateCurrency, validateDate } from '../utils/validation'
import { formatDbDate, localDateStr } from '../utils/salesDay'
import { useAuthStore } from '../store/useAuthStore'
import { useShiftStore } from '../store/useShiftStore'
import { FiPlus, FiX, FiEdit2, FiTrash2, FiDollarSign, FiCalendar, FiTag, FiBriefcase } from 'react-icons/fi'
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
  const [confirmDelete, setConfirmDelete] = useState(null) // { id, description }
  const [formData, setFormData] = useState({
    description: '',
    amount: '',
    category: 'Other',
    date: localDateStr(),
    payment_method: 'Cash',
    notes: ''
  })

  const categories = ['Rent', 'Salaries', 'Utilities', 'Transport', 'Supplies', 'Other']

  const [fieldErrors, setFieldErrors] = useState({})
  const [attempt, setAttempt] = useState(0)
  const [saving, setSaving] = useState(false)

  const emptyExpense = () => ({
    description: '', amount: '', category: 'Other', date: localDateStr(), payment_method: 'Cash', notes: '',
  })

  // A dialog over the table. It used to open above the expenses table and push it down.
  const openAdd = () => { setEditingId(null); setFormData(emptyExpense()); setFieldErrors({}); setShowForm(true) }
  const closeForm = () => { setShowForm(false); setEditingId(null); setFieldErrors({}) }

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
    if (fieldErrors[name]) setFieldErrors(fe => ({ ...fe, [name]: null }))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()

    const errs = {}
    const descCheck = validateRequired(formData.description, 'Description')
    if (!descCheck.valid) errs.description = descCheck.error
    const amountCheck = validateCurrency(formData.amount, 'Amount')
    if (!amountCheck.valid) errs.amount = amountCheck.error
    else if (parseFloat(formData.amount) <= 0) errs.amount = 'Amount must be more than 0'
    const dateCheck = validateDate(formData.date)
    if (!dateCheck.valid) errs.date = dateCheck.error
    if (Object.keys(errs).length) {
      setFieldErrors(errs)
      setAttempt(n => n + 1)
      requestAnimationFrame(() => document.querySelector('#expense-form [aria-invalid="true"]')?.focus())
      return
    }

    const amount = parseFloat(formData.amount)
    const label = formData.description.trim()
    setSaving(true)
    try {
      if (editingId) {
        await updateExpense(editingId, { ...formData, description: label, amount })
      } else {
        await addExpense({
          ...formData,
          description: label,
          amount,
          recorded_by: user?.username || 'System',
          shift_id: currentShift?.id || null
        })
      }
      const wasEditing = Boolean(editingId)
      await loadData()
      closeForm()
      setFormData(emptyExpense())
      toast.success(wasEditing ? `${label} updated` : `Expense recorded: ${label}`, { detail: `$${amount.toFixed(2)} · ${formData.category}` })
    } catch (err) {
      toast.error('Could not save that expense: ' + (err.message || 'unknown error'))
    } finally {
      setSaving(false)
    }
  }

  const handleEdit = (expense) => {
    setFormData({ ...emptyExpense(), ...expense, notes: expense.notes || '' })
    setEditingId(expense.id)
    setFieldErrors({})
    setShowForm(true)
  }

  const handleDelete = (id, description) => {
    setConfirmDelete({ id, description })
  }

  const handleConfirmDelete = async () => {
    const { id } = confirmDelete
    setConfirmDelete(null)
    try {
      await deleteExpense(id)
      await loadData()
      toast.success(`${confirmDelete.description} removed`)
    } catch (err) {
      toast.error('Could not remove that expense')
    }
  }

  const today = localDateStr()
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
        <button className="btn btn-primary" onClick={openAdd}>
          <FiPlus size={14} /> Add Expense
        </button>
        <input type="text" placeholder="Search..." value={search} 
          onChange={(e) => setSearch(e.target.value)} className="search-input" />
        <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="category-select">
          <option>All</option>
          {categories.map(c => <option key={c}>{c}</option>)}
        </select>
      </div>

      <Modal
        open={showForm}
        size="medium"
        title={editingId ? 'Edit Expense' : 'Record an Expense'}
        subtitle="Money that left the business — rent, wages, transport, supplies."
        onClose={closeForm}
        footer={
          <>
            <button type="button" className="smodal-btn-away" onClick={closeForm}>Cancel</button>
            <button type="submit" form="expense-form" className="smodal-btn-primary" disabled={saving}>
              {saving ? 'Saving...' : editingId ? 'Save Changes' : 'Record Expense'}
            </button>
          </>
        }
      >
        <form id="expense-form" className="fl-stack" onSubmit={handleSubmit} noValidate>
          <Field
            label="What was it for?" required name="description" autoFocus
            value={formData.description} onChange={handleChange}
            error={fieldErrors.description} shakeKey={attempt}
            placeholder="e.g. Electricity tokens"
          />
          <div className="fl-row">
            <Field
              label="Amount" required prefix="$" name="amount" type="number" step="any" min="0" inputMode="decimal"
              value={formData.amount} onChange={handleChange}
              error={fieldErrors.amount} shakeKey={attempt}
            />
            <Field
              label="Date" required name="date" type="date"
              value={formData.date} onChange={handleChange}
              error={fieldErrors.date} shakeKey={attempt}
            />
          </div>
          <div className="fl-row">
            <Field as="select" label="Category" name="category" value={formData.category} onChange={handleChange}>
              {categories.map(c => <option key={c}>{c}</option>)}
            </Field>
            <Field as="select" label="Paid with" name="payment_method" value={formData.payment_method} onChange={handleChange}>
              <option value="Cash">Cash</option>
            </Field>
          </div>
          <Field as="textarea" label="Notes" name="notes" rows={2}
            value={formData.notes} onChange={handleChange}
            placeholder="Receipt number, who was paid, anything worth keeping" />
        </form>
      </Modal>

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
                <th>Paid Via</th>
                <th>Amount</th>
                <th>Notes</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredExpenses.map(e => (
                <tr key={e.id}>
                  <td>{formatDbDate(e.date)}</td>
                  <td>{e.description}</td>
                  <td><span className="category-badge">{e.category}</span></td>
                  <td>
                    <span style={{
                      display: 'inline-block', padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600,
                      background: '#dcfce7', color: '#15803d'
                    }}>
                      <FiBriefcase size={10} style={{ verticalAlign: 'middle' }} /> Cash
                    </span>
                  </td>
                  <td className="amount">${e.amount?.toFixed(2)}</td>
                  <td className="notes">{e.notes}</td>
                  <td>
                    <button className="btn-icon" onClick={() => handleEdit(e)} title="Edit"><FiEdit2 size={14} /></button>
                    <button className="btn-icon delete" onClick={() => handleDelete(e.id, e.description)} title="Delete"><FiTrash2 size={14} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {confirmDelete && (
        <ConfirmModal
          message={`Delete expense?`}
          detail={`"${confirmDelete.description}" will be permanently removed.`}
          confirmLabel="Delete"
          danger
          onConfirm={handleConfirmDelete}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  )
}

export default Expenses
