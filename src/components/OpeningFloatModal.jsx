import { useState } from 'react'
import { FiCheck, FiDollarSign } from 'react-icons/fi'
import './Modal.css'

function OpeningFloatModal({ user, onConfirm, isLoading }) {
  const [openingCash, setOpeningCash] = useState('')
  const [error, setError] = useState('')

  const handleSubmit = () => {
    setError('')
    const cash = parseFloat(openingCash) || 0
    if (cash < 0) {
      setError('Opening float cannot be negative')
      return
    }
    onConfirm({ opening_cash: cash })
  }

  return (
    <div className="modal-overlay">
      <div className="modal">
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <div style={{ width: 40, height: 40, borderRadius: '50%', background: '#f0fdf4', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <FiDollarSign size={20} color="#16a34a" />
            </div>
            <h2 style={{ margin: 0 }}>Start Your Shift</h2>
          </div>
          <p style={{ marginTop: '4px', fontSize: '14px', color: '#666' }}>
            Count your drawer and enter your opening float to begin selling.
          </p>
        </div>

        <div className="modal-body">
          {error && (
            <div style={{ padding: '12px', marginBottom: '16px', backgroundColor: '#fee', color: '#c33', borderRadius: '4px', fontSize: '14px' }}>
              {error}
            </div>
          )}

          <label style={{ display: 'block', marginBottom: '8px', fontWeight: '600', fontSize: '14px' }}>
            Opening Float
          </label>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '20px', fontWeight: '700', color: '#16a34a' }}>$</span>
            <input
              type="number"
              value={openingCash}
              onChange={e => setOpeningCash(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSubmit()}
              onClick={e => e.target.select()}
              placeholder="0.00"
              step="0.01"
              min="0"
              style={{ flex: 1, padding: '14px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '22px', fontWeight: '700', outline: 'none' }}
              disabled={isLoading}
              autoFocus
            />
          </div>
          <p style={{ fontSize: '12px', color: '#94a3b8', marginTop: 8 }}>Enter 0 if the drawer starts empty</p>
        </div>

        <div className="modal-footer" style={{ justifyContent: 'flex-end' }}>
          <button
            onClick={handleSubmit}
            style={{ padding: '12px 32px', border: 'none', borderRadius: '6px', backgroundColor: '#2e7d32', color: '#fff', cursor: isLoading ? 'not-allowed' : 'pointer', fontSize: '15px', fontWeight: '600', opacity: isLoading ? 0.7 : 1, display: 'flex', alignItems: 'center', gap: 8 }}
            disabled={isLoading}
          >
            <FiCheck size={16} />
            {isLoading ? 'Starting Shift…' : 'Start Shift'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default OpeningFloatModal
