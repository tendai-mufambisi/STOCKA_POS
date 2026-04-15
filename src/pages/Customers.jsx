import { useState, useEffect } from 'react'
import { getCustomers, addCustomer, updateCustomer, deleteCustomer, getSaleItems, getSales } from '../database/db'
import './Customers.css'
import { FiPlus, FiX, FiEdit2, FiTrash2, FiPhone, FiMail, FiMapPin } from 'react-icons/fi'

function Customers() {
  const [customers, setCustomers] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [search, setSearch] = useState('')
  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    email: '',
    address: '',
    notes: ''
  })
  const [sales, setSales] = useState([])
  const [error, setError] = useState('')

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    try {
      setLoading(true)
      const [customersData, salesData] = await Promise.all([
        getCustomers(),
        getSales()
      ])
      setCustomers(customersData)
      setSales(salesData)
    } catch (err) {
      setError('Failed to load customers')
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
      setError('Customer name is required')
      return
    }

    try {
      if (editingId) {
        await updateCustomer(editingId, formData)
      } else {
        await addCustomer(formData)
      }
      await loadData()
      setFormData({ name: '', phone: '', email: '', address: '', notes: '' })
      setEditingId(null)
      setShowForm(false)
    } catch (err) {
      setError('Failed to save customer')
    }
  }

  const handleEdit = (customer) => {
    setFormData(customer)
    setEditingId(customer.id)
    setShowForm(true)
  }

  const handleDelete = async (id) => {
    if (window.confirm('Delete this customer?')) {
      try {
        await deleteCustomer(id)
        await loadData()
      } catch (err) {
        setError('Failed to delete customer')
      }
    }
  }

  const getCustomerHistory = (customerId) => {
    return sales.filter(s => s.customer_id === customerId).length
  }

  const filteredCustomers = customers.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.phone?.includes(search)
  )

  if (loading) return <div className="customers-page"><div className="loading">Loading...</div></div>

  return (
    <div className="customers-page">
      <div className="page-header">
        <h1>Customers</h1>
        <p>Manage your customer database</p>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="toolbar">
        <button className="btn btn-primary" onClick={() => {
          setShowForm(!showForm)
          if (showForm) {
            setEditingId(null)
            setFormData({ name: '', phone: '', email: '', address: '', notes: '' })
          }
        }}>
          {showForm ? <><FiX size={16} style={{ marginRight: '4px' }} /> Cancel</> : <><FiPlus size={16} style={{ marginRight: '4px' }} /> Add Customer</>}
        </button>
        <input
          type="text"
          placeholder="Search..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="search-input"
        />
      </div>

      {showForm && (
        <div className="form-card">
          <h3>{editingId ? <><FiEdit2 size={16} style={{ marginRight: '4px', verticalAlign: 'middle' }} /> Edit</> : <><FiPlus size={16} style={{ marginRight: '4px', verticalAlign: 'middle' }} /> Add New</>} Customer</h3>
          <form onSubmit={handleSubmit}>
            <div className="form-row">
              <div className="form-group">
                <label>Name *</label>
                <input type="text" name="name" value={formData.name} onChange={handleChange} required />
              </div>
              <div className="form-group">
                <label>Phone</label>
                <input type="tel" name="phone" value={formData.phone} onChange={handleChange} />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Email</label>
                <input type="email" name="email" value={formData.email} onChange={handleChange} />
              </div>
              <div className="form-group">
                <label>Address</label>
                <input type="text" name="address" value={formData.address} onChange={handleChange} />
              </div>
            </div>
            <div className="form-group">
              <label>Notes</label>
              <textarea name="notes" value={formData.notes} onChange={handleChange} rows="2" />
            </div>
            <button type="submit" className="btn btn-primary">
              {editingId ? 'Update' : 'Add'} Customer
            </button>
          </form>
        </div>
      )}

      <div className="customers-list">
        {filteredCustomers.length === 0 ? (
          <div className="empty-state"><p>No customers found</p></div>
        ) : (
          <div className="customers-grid">
            {filteredCustomers.map(c => (
              <div key={c.id} className="customer-card">
                <div className="customer-header">
                  <h4>{c.name}</h4>
                  <div className="actions">
                    <button className="btn-icon" onClick={() => handleEdit(c)}><FiEdit2 size={16} /></button>
                    <button className="btn-icon delete" onClick={() => handleDelete(c.id)}><FiTrash2 size={16} /></button>
                  </div>
                </div>
                <div className="customer-details">
                  {c.phone && <div className="detail"><FiPhone size={16} style={{ marginRight: '6px' }} />{c.phone}</div>}
                  {c.email && <div className="detail"><FiMail size={16} style={{ marginRight: '6px' }} />{c.email}</div>}
                  {c.address && <div className="detail"><FiMapPin size={16} style={{ marginRight: '6px' }} />{c.address}</div>}
                </div>
                <div className="customer-stats">
                  <span>Purchases: {getCustomerHistory(c.id)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default Customers
