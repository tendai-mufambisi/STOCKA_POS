import { useState, useEffect } from 'react'
import { getSuppliers, addSupplier, updateSupplier, deleteSupplier, getStockReceivings } from '../database/db'
import ConfirmModal from '../components/ConfirmModal'
import Modal from '../components/Modal'
import Field from '../components/Field'
import { toast } from '../store/useToastStore'
import { validateRequired, validateEmail, validatePhone } from '../utils/validation'
import { FiPlus, FiX, FiEdit2, FiTrash2, FiPhone, FiMail, FiMapPin, FiUser, FiUsers } from 'react-icons/fi'
import './Suppliers.css'

function Suppliers() {
  const [suppliers, setSuppliers] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [search, setSearch] = useState('')
  const [formData, setFormData] = useState({
    name: '',
    contact_person: '',
    phone: '',
    email: '',
    address: '',
    notes: ''
  })
  const [receivings, setReceivings] = useState([])
  const [error, setError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null) // { id, name }
  const [fieldErrors, setFieldErrors] = useState({})
  const [attempt, setAttempt] = useState(0)
  const [saving, setSaving] = useState(false)

  const EMPTY = { name: '', contact_person: '', phone: '', email: '', address: '', notes: '' }

  // A dialog over the list. The form used to open above the supplier grid and push
  // every card down to make room.
  const openAdd = () => { setEditingId(null); setFormData(EMPTY); setFieldErrors({}); setShowForm(true) }
  const closeForm = () => { setShowForm(false); setEditingId(null); setFieldErrors({}) }

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    try {
      setLoading(true)
      const [suppliersData, receivingsData] = await Promise.all([
        getSuppliers(),
        getStockReceivings()
      ])
      setSuppliers(suppliersData)
      setReceivings(receivingsData)
    } catch (err) {
      setError('Failed to load suppliers')
      console.error(err)
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
    const nameCheck = validateRequired(formData.name, 'Supplier name')
    if (!nameCheck.valid) errs.name = nameCheck.error
    if (formData.email) {
      const emailCheck = validateEmail(formData.email)
      if (!emailCheck.valid) errs.email = emailCheck.error
    }
    if (formData.phone) {
      const phoneCheck = validatePhone(formData.phone)
      if (!phoneCheck.valid) errs.phone = phoneCheck.error
    }
    if (Object.keys(errs).length) {
      setFieldErrors(errs)
      setAttempt(n => n + 1)
      requestAnimationFrame(() => document.querySelector('#supplier-form [aria-invalid="true"]')?.focus())
      return
    }

    const name = formData.name.trim()
    setSaving(true)
    try {
      if (editingId) await updateSupplier(editingId, { ...formData, name })
      else await addSupplier({ ...formData, name })
      const wasEditing = Boolean(editingId)
      await loadData()
      closeForm()
      setFormData(EMPTY)
      toast.success(wasEditing ? `${name} updated` : `${name} added to your suppliers`)
    } catch (err) {
      toast.error('Could not save that supplier: ' + (err.message || 'unknown error'))
      console.error(err)
    } finally {
      setSaving(false)
    }
  }

  const handleEdit = (supplier) => {
    setFormData({ ...EMPTY, ...supplier })
    setEditingId(supplier.id)
    setFieldErrors({})
    setShowForm(true)
  }

  const handleDelete = (id, name) => {
    setConfirmDelete({ id, name })
  }

  const handleConfirmDelete = async () => {
    const { id } = confirmDelete
    setConfirmDelete(null)
    try {
      await deleteSupplier(id)
      await loadData()
      toast.success(`${confirmDelete.name} removed`)
    } catch (err) {
      toast.error('Could not remove that supplier')
    }
  }

  const getSupplierStats = (supplierId) => {
    const supplierReceivings = receivings.filter(r => r.supplier_id === supplierId)
    const totalValue = supplierReceivings.reduce((sum, r) => sum + (r.total_value || 0), 0)
    const productCount = new Set(supplierReceivings.map(r => r.product_id)).size

    return { productCount, totalValue, receivingCount: supplierReceivings.length }
  }

  const filteredSuppliers = suppliers.filter(s =>
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    s.contact_person?.toLowerCase().includes(search.toLowerCase()) ||
    s.phone?.includes(search)
  )

  if (loading) {
    return <div className="suppliers-page"><div className="loading">Loading...</div></div>
  }

  return (
    <div className="suppliers-page">
      {error && <div className="error-banner">{error}</div>}

      <div className="toolbar">
        <button className="btn btn-primary" onClick={openAdd}>
          <FiPlus size={14} /> Add Supplier
        </button>
        <input
          type="text"
          placeholder="Search suppliers..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="search-input"
        />
      </div>

      <Modal
        open={showForm}
        size="medium"
        title={editingId ? `Edit ${formData.name || 'supplier'}` : 'Add a Supplier'}
        subtitle="Someone you buy stock from. Only the name is needed — the rest helps when you need to call them."
        onClose={closeForm}
        footer={
          <>
            <button type="button" className="smodal-btn-away" onClick={closeForm}>Cancel</button>
            <button type="submit" form="supplier-form" className="smodal-btn-primary" disabled={saving}>
              {saving ? 'Saving...' : editingId ? 'Save Changes' : 'Add Supplier'}
            </button>
          </>
        }
      >
        <form id="supplier-form" className="fl-stack" onSubmit={handleSubmit} noValidate>
          <Field
            label="Supplier name" required name="name" autoFocus
            value={formData.name} onChange={handleChange}
            error={fieldErrors.name} shakeKey={attempt}
            placeholder="e.g. Delta Beverages"
          />
          <div className="fl-row">
            <Field label="Contact person" name="contact_person"
              value={formData.contact_person || ''} onChange={handleChange}
              placeholder="Who you usually speak to" />
            <Field label="Phone" name="phone" type="tel"
              value={formData.phone || ''} onChange={handleChange}
              error={fieldErrors.phone} shakeKey={attempt}
              placeholder="e.g. 0771 234 567" />
          </div>
          <div className="fl-row">
            <Field label="Email" name="email" type="email"
              value={formData.email || ''} onChange={handleChange}
              error={fieldErrors.email} shakeKey={attempt} />
            <Field label="Address" name="address"
              value={formData.address || ''} onChange={handleChange} />
          </div>
          <Field as="textarea" label="Notes" name="notes" rows={2}
            value={formData.notes || ''} onChange={handleChange}
            placeholder="Delivery days, account number, anything worth remembering" />
        </form>
      </Modal>

      <div className="suppliers-list">
        {filteredSuppliers.length === 0 ? (
          <div className="empty-state">
            <FiUsers size={40} />
            <h3>No suppliers yet</h3>
            <p>Add your first supplier to start tracking stock sources</p>
          </div>
        ) : (
          <div className="suppliers-grid">
            {filteredSuppliers.map(supplier => {
              const stats = getSupplierStats(supplier.id)
              return (
                <div key={supplier.id} className="supplier-card">
                  <div className="supplier-header">
                    <h4>{supplier.name}</h4>
                    <div className="actions">
                      <button className="btn-icon" onClick={() => handleEdit(supplier)} title="Edit"><FiEdit2 size={14} /></button>
                      <button className="btn-icon delete" onClick={() => handleDelete(supplier.id, supplier.name)} title="Delete"><FiTrash2 size={14} /></button>
                    </div>
                  </div>

                  <div className="supplier-details">
                    {supplier.contact_person && (
                      <div className="detail">
                        <span className="label"><FiUser size={13} /></span>
                        <span className="value">{supplier.contact_person}</span>
                      </div>
                    )}
                    {supplier.phone && (
                      <div className="detail">
                        <span className="label"><FiPhone size={13} /></span>
                        <span className="value">{supplier.phone}</span>
                      </div>
                    )}
                    {supplier.email && (
                      <div className="detail">
                        <span className="label"><FiMail size={13} /></span>
                        <span className="value">{supplier.email}</span>
                      </div>
                    )}
                    {supplier.address && (
                      <div className="detail">
                        <span className="label"><FiMapPin size={13} /></span>
                        <span className="value">{supplier.address}</span>
                      </div>
                    )}
                  </div>

                  <div className="supplier-stats">
                    <div className="stat">
                      <span className="stat-label">Products Supplied</span>
                      <span className="stat-value">{stats.productCount}</span>
                    </div>
                    <div className="stat">
                      <span className="stat-label">Total Stock Value</span>
                      <span className="stat-value">${stats.totalValue.toFixed(2)}</span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {confirmDelete && (
        <ConfirmModal
          message={`Delete "${confirmDelete.name}"?`}
          detail="This supplier will be permanently removed."
          confirmLabel="Delete"
          danger
          onConfirm={handleConfirmDelete}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  )
}

export default Suppliers
