import { useState } from 'react'
import { FiX, FiCheck } from 'react-icons/fi'
import './Modal.css'

function OpeningFloatModal({ user, onConfirm, onCancel, isLoading }) {
  const [openingCash, setOpeningCash] = useState('')
  const [error, setError] = useState('')

  const handleSubmit = () => {
    setError('')
    const amount = parseFloat(openingCash) || 0
    if (amount < 0) {
      setError('Opening float cannot be negative')
      return
    }
    onConfirm({ opening_cash: amount })
  }

  return (
    <div className="modal-overlay">
      <div className="modal">
        <div className="modal-header">
          <h2>Start Your Shift</h2>
          <p style={{ marginTop: '4px', fontSize: '14px', color: '#666' }}>
            Count the cash in your drawer and enter the opening float below
          </p>
        </div>

        <div className="modal-body">
          {error && (
            <div style={{
              padding: '12px',
              marginBottom: '16px',
              backgroundColor: '#fee',
              color: '#c33',
              borderRadius: '4px',
              fontSize: '14px'
            }}>
              {error}
            </div>
          )}

          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', marginBottom: '6px', fontWeight: '600', fontSize: '14px' }}>
              USD Cash in Drawer
            </label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '18px', fontWeight: '600', color: '#2e7d32' }}>$</span>
              <input
                type="number"
                value={openingCash}
                onChange={e => setOpeningCash(e.target.value)}
                onClick={e => e.target.select()}
                placeholder="0.00"
                step="0.01"
                min="0"
                style={{
                  flex: 1,
                  padding: '12px',
                  border: '1px solid #ddd',
                  borderRadius: '4px',
                  fontSize: '18px',
                  fontWeight: '600'
                }}
                disabled={isLoading}
                autoFocus
              />
            </div>
            <p style={{ marginTop: '6px', fontSize: '12px', color: '#888' }}>
              Enter 0 if the drawer is empty at shift start
            </p>
          </div>
        </div>

        <div className="modal-footer">
          <button
            onClick={() => onCancel()}
            style={{
              padding: '10px 20px',
              border: '1px solid #ddd',
              borderRadius: '4px',
              backgroundColor: '#fff',
              color: '#333',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: '500'
            }}
            disabled={isLoading}
          >
            <FiX style={{ marginRight: '6px', display: 'inline' }} />
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            style={{
              padding: '10px 20px',
              border: 'none',
              borderRadius: '4px',
              backgroundColor: '#2e7d32',
              color: '#fff',
              cursor: isLoading ? 'not-allowed' : 'pointer',
              fontSize: '14px',
              fontWeight: '500',
              opacity: isLoading ? 0.7 : 1
            }}
            disabled={isLoading}
          >
            <FiCheck style={{ marginRight: '6px', display: 'inline' }} />
            {isLoading ? 'Starting Shift...' : 'Start Shift'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default OpeningFloatModal
