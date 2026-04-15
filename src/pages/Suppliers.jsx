import { useState, useEffect } from 'react'
import { getSuppliers, addSupplier, updateSupplier, deleteSupplier, getStockReceivings } from '../database/db'
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
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')

    if (!formData.name.trim()) {
      setError('Supplier name is required')
      return
    }

    try {
      if (editingId) {
        await updateSupplier(editingId, formData)
      } else {
        await addSupplier(formData)
      }
      await loadData()
      setFormData({
        name: '',
        contact_person: '',
        phone: '',
        email: '',
        address: '',
        notes: ''
      })
      setEditingId(null)
      setShowForm(false)
    } catch (err) {
      setError('Failed to save supplier')
      console.error(err)
    }
  }

  const handleEdit = (supplier) => {
    setFormData(supplier)
    setEditingId(supplier.id)
    setShowForm(true)
  }

  const handleDelete = async (id) => {
    if (window.confirm('Delete this supplier?')) {
      try {
        await deleteSupplier(id)
        await loadData()
      } catch (err) {
        setError('Failed to delete supplier')
      }
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
      <div className="page-header">
        <h1>Suppliers</h1>
        <p>Manage your supplier contacts and information</p>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="toolbar">
        <button className="btn btn-primary" onClick={() => {
          setShowForm(!showForm)
          if (showForm) {
            setEditingId(null)
            setFormData({
              name: '',
              contact_person: '',
              phone: '',
              email: '',
              address: '',
              notes: ''
            })
          }
        }}>
          {showForm ? '✕ Cancel' : '✚ Add Supplier'}
        </button>
        <input
          type="text"
          placeholder="Search suppliers..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="search-input"
        />
      </div>

      {showForm && (
        <div className="form-card">
          <h3>{editingId ? '✎ Edit Supplier' : '✚ Add New Supplier'}</h3>
          <form onSubmit={handleSubmit}>
            <div className="form-row">
              <div className="form-group">
                <label>Supplier Name *</label>
                <input
                  type="text"
                  name="name"
                  value={formData.name}
                  onChange={handleChange}
                  placeholder="Enter supplier name"
                />
              </div>
              <div className="form-group">
                <label>Contact Person</label>
                <input
                  type="text"
                  name="contact_person"
                  value={formData.contact_person}
                  onChange={handleChange}
                  placeholder="Contact name"
                />
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>Phone</label>
                <input
                  type="tel"
                  name="phone"
                  value={formData.phone}
                  onChange={handleChange}
                  placeholder="Phone number"
                />
              </div>
              <div className="form-group">
                <label>Email</label>
                <input
                  type="email"
                  name="email"
                  value={formData.email}
                  onChange={handleChange}
                  placeholder="Email address"
                />
              </div>
            </div>

            <div className="form-group">
              <label>Address</label>
              <input
                type="text"
                name="address"
                value={formData.address}
                onChange={handleChange}
                placeholder="Full address"
              />
            </div>

            <div className="form-group">
              <label>Notes</label>
              <textarea
                name="notes"
                value={formData.notes}
                onChange={handleChange}
                placeholder="Additional notes"
                rows="3"
              />
            </div>

            <button type="submit" className="btn btn-primary">
              {editingId ? 'Update Supplier' : 'Add Supplier'}
            </button>
          </form>
        </div>
      )}

      <div className="suppliers-list">
        {filteredSuppliers.length === 0 ? (
          <div className="empty-state">
            <p>No suppliers found</p>
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
                      <button className="btn-icon" onClick={() => handleEdit(supplier)}>✎</button>
                      <button className="btn-icon delete" onClick={() => handleDelete(supplier.id)}>✘</button>
                    </div>
                  </div>

                  <div className="supplier-details">
                    {supplier.contact_person && (
                      <div className="detail">
                        <span className="label">Contact:</span>
                        <span className="value">{supplier.contact_person}</span>
                      </div>
                    )}
                    {supplier.phone && (
                      <div className="detail">
                        <span className="label">Phone:</span>
                        <span className="value">{supplier.phone}</span>
                      </div>
                    )}
                    {supplier.email && (
                      <div className="detail">
                        <span className="label">Email:</span>
                        <span className="value">{supplier.email}</span>
                      </div>
                    )}
                    {supplier.address && (
                      <div className="detail">
                        <span className="label">Address:</span>
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
    </div>
  )
}

export default Suppliers
