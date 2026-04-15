import { useState, useEffect } from 'react'
import { getBranches, addBranch, updateBranch, deleteBranch } from '../database/db'
import './Branches.css'
import { FiPlus, FiX, FiEdit2, FiTrash2, FiUser, FiPhone, FiMapPin } from 'react-icons/fi'

function Branches() {
  const [branches, setBranches] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')
  const [formData, setFormData] = useState({
    name: '',
    address: '',
    phone: '',
    manager_name: ''
  })

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    try {
      setLoading(true)
      const data = await getBranches()
      setBranches(data)
    } catch (err) {
      setError('Failed to load branches')
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
      setError('Branch name is required')
      return
    }

    try {
      if (editingId) {
        await updateBranch(editingId, formData)
      } else {
        await addBranch(formData)
      }
      await loadData()
      setFormData({ name: '', address: '', phone: '', manager_name: '' })
      setEditingId(null)
      setShowForm(false)
    } catch (err) {
      setError('Failed to save branch')
    }
  }

  const handleEdit = (branch) => {
    setFormData(branch)
    setEditingId(branch.id)
    setShowForm(true)
  }

  const handleDelete = async (id) => {
    if (window.confirm('Delete this branch?')) {
      try {
        await deleteBranch(id)
        await loadData()
      } catch (err) {
        setError('Failed to delete branch')
      }
    }
  }

  const filteredBranches = branches.filter(b =>
    b.name.toLowerCase().includes(search.toLowerCase()) ||
    b.manager_name?.toLowerCase().includes(search.toLowerCase())
  )

  if (loading) return <div className="branches-page"><div className="loading">Loading...</div></div>

  return (
    <div className="branches-page">
      <div className="page-header">
        <h1>Branches</h1>
        <p>Manage multiple business locations</p>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="toolbar">
        <button className="btn btn-primary" onClick={() => {
          setShowForm(!showForm)
          if (showForm) {
            setEditingId(null)
            setFormData({ name: '', address: '', phone: '', manager_name: '' })
          }
        }}>
          {showForm ? <><FiX size={16} style={{ marginRight: '4px' }} /> Cancel</> : <><FiPlus size={16} style={{ marginRight: '4px' }} /> Add Branch</>}
        </button>
        <input type="text" placeholder="Search branches..." value={search}
          onChange={(e) => setSearch(e.target.value)} className="search-input" />
      </div>

      {showForm && (
        <div className="form-card">
          <h3>{editingId ? <><FiEdit2 size={16} style={{ marginRight: '4px', verticalAlign: 'middle' }} /> Edit</> : <><FiPlus size={16} style={{ marginRight: '4px', verticalAlign: 'middle' }} /> Add</>} Branch</h3>
          <form onSubmit={handleSubmit}>
            <div className="form-row">
              <div className="form-group">
                <label>Branch Name *</label>
                <input type="text" name="name" value={formData.name} onChange={handleChange} required />
              </div>
              <div className="form-group">
                <label>Manager Name</label>
                <input type="text" name="manager_name" value={formData.manager_name} onChange={handleChange} />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Phone</label>
                <input type="tel" name="phone" value={formData.phone} onChange={handleChange} />
              </div>
              <div className="form-group">
                <label>Address</label>
                <input type="text" name="address" value={formData.address} onChange={handleChange} />
              </div>
            </div>
            <button type="submit" className="btn btn-primary">
              {editingId ? 'Update' : 'Add'} Branch
            </button>
          </form>
        </div>
      )}

      <div className="branches-grid">
        {filteredBranches.length === 0 ? (
          <div className="empty-state">No branches found</div>
        ) : (
          filteredBranches.map(b => (
            <div key={b.id} className="branch-card">
              <div className="branch-header">
                <h4>{b.name}</h4>
                <div className="actions">
                  <button className="btn-icon" onClick={() => handleEdit(b)}><FiEdit2 size={16} /></button>
                  <button className="btn-icon delete" onClick={() => handleDelete(b.id)}><FiTrash2 size={16} /></button>
                </div>
              </div>
              <div className="branch-details">
                {b.manager_name && <div className="detail"><FiUser size={16} style={{ marginRight: '6px' }} />{b.manager_name}</div>}
                {b.phone && <div className="detail"><FiPhone size={16} style={{ marginRight: '6px' }} />{b.phone}</div>}
                {b.address && <div className="detail"><FiMapPin size={16} style={{ marginRight: '6px' }} />{b.address}</div>}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

export default Branches
