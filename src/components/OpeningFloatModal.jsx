import { useState } from 'react'
import { FiX, FiCheck } from 'react-icons/fi'
import './Modal.css'

function OpeningFloatModal({ user, onConfirm, onCancel, isLoading }) {
  const [opening_usd_cash, setOpeningUsdCash] = useState('')
  const [opening_zwg_cash, setOpeningZwgCash] = useState('')
  const [opening_swipe_usd, setOpeningSwipeUsd] = useState('')
  const [opening_swipe_zwg, setOpeningSwipeZwg] = useState('')
  const [opening_ecocash_usd, setOpeningEcocashUsd] = useState('')
  const [opening_ecocash_zwg, setOpeningEcocashZwg] = useState('')
  const [error, setError] = useState('')

  const handleChange = (e, setter) => {
    const value = e.target.value
    // Only allow numbers and decimal point
    if (value === '' || !isNaN(value)) {
      setter(value)
    }
  }

  const handleSubmit = () => {
    setError('')
    
    // Convert to numbers, default to 0
    const openingFloat = {
      opening_usd_cash: parseFloat(opening_usd_cash) || 0,
      opening_zwg_cash: parseFloat(opening_zwg_cash) || 0,
      opening_swipe_usd: parseFloat(opening_swipe_usd) || 0,
      opening_swipe_zwg: parseFloat(opening_swipe_zwg) || 0,
      opening_ecocash_usd: parseFloat(opening_ecocash_usd) || 0,
      opening_ecocash_zwg: parseFloat(opening_ecocash_zwg) || 0
    }
    
    onConfirm(openingFloat)
  }

  return (
    <div className="modal-overlay">
      <div className="modal modal-large">
        <div className="modal-header">
          <h2>Start Your Shift</h2>
          <p style={{ marginTop: '4px', fontSize: '14px', color: '#666' }}>
            Count your opening cash and declare your starting float
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

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            {/* USD Cash */}
            <div>
              <label style={{ display: 'block', marginBottom: '6px', fontWeight: '500', fontSize: '14px' }}>
                USD Cash in drawer
              </label>
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <span style={{ marginRight: '8px', fontSize: '14px', fontWeight: '500' }}>$</span>
                <input
                  type="text"
                  value={opening_usd_cash}
                  onChange={(e) => handleChange(e, setOpeningUsdCash)}
                  placeholder="0.00"
                  style={{
                    flex: 1,
                    padding: '10px',
                    border: '1px solid #ddd',
                    borderRadius: '4px',
                    fontSize: '14px'
                  }}
                  disabled={isLoading}
                />
              </div>
            </div>

            {/* ZWG Cash */}
            <div>
              <label style={{ display: 'block', marginBottom: '6px', fontWeight: '500', fontSize: '14px' }}>
                ZWG Cash in drawer
              </label>
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <span style={{ marginRight: '8px', fontSize: '14px', fontWeight: '500' }}>ZWG</span>
                <input
                  type="text"
                  value={opening_zwg_cash}
                  onChange={(e) => handleChange(e, setOpeningZwgCash)}
                  placeholder="0"
                  style={{
                    flex: 1,
                    padding: '10px',
                    border: '1px solid #ddd',
                    borderRadius: '4px',
                    fontSize: '14px'
                  }}
                  disabled={isLoading}
                />
              </div>
            </div>

            {/* Swipe USD */}
            <div>
              <label style={{ display: 'block', marginBottom: '6px', fontWeight: '500', fontSize: '14px' }}>
                Swipe USD balance
              </label>
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <span style={{ marginRight: '8px', fontSize: '14px', fontWeight: '500' }}>$</span>
                <input
                  type="text"
                  value={opening_swipe_usd}
                  onChange={(e) => handleChange(e, setOpeningSwipeUsd)}
                  placeholder="0.00"
                  style={{
                    flex: 1,
                    padding: '10px',
                    border: '1px solid #ddd',
                    borderRadius: '4px',
                    fontSize: '14px'
                  }}
                  disabled={isLoading}
                />
              </div>
            </div>

            {/* Swipe ZWG */}
            <div>
              <label style={{ display: 'block', marginBottom: '6px', fontWeight: '500', fontSize: '14px' }}>
                Swipe ZWG balance
              </label>
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <span style={{ marginRight: '8px', fontSize: '14px', fontWeight: '500' }}>ZWG</span>
                <input
                  type="text"
                  value={opening_swipe_zwg}
                  onChange={(e) => handleChange(e, setOpeningSwipeZwg)}
                  placeholder="0"
                  style={{
                    flex: 1,
                    padding: '10px',
                    border: '1px solid #ddd',
                    borderRadius: '4px',
                    fontSize: '14px'
                  }}
                  disabled={isLoading}
                />
              </div>
            </div>

            {/* EcoCash USD */}
            <div>
              <label style={{ display: 'block', marginBottom: '6px', fontWeight: '500', fontSize: '14px' }}>
                EcoCash USD
              </label>
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <span style={{ marginRight: '8px', fontSize: '14px', fontWeight: '500' }}>$</span>
                <input
                  type="text"
                  value={opening_ecocash_usd}
                  onChange={(e) => handleChange(e, setOpeningEcocashUsd)}
                  placeholder="0.00"
                  style={{
                    flex: 1,
                    padding: '10px',
                    border: '1px solid #ddd',
                    borderRadius: '4px',
                    fontSize: '14px'
                  }}
                  disabled={isLoading}
                />
              </div>
            </div>

            {/* EcoCash ZWG */}
            <div>
              <label style={{ display: 'block', marginBottom: '6px', fontWeight: '500', fontSize: '14px' }}>
                EcoCash ZWG
              </label>
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <span style={{ marginRight: '8px', fontSize: '14px', fontWeight: '500' }}>ZWG</span>
                <input
                  type="text"
                  value={opening_ecocash_zwg}
                  onChange={(e) => handleChange(e, setOpeningEcocashZwg)}
                  placeholder="0"
                  style={{
                    flex: 1,
                    padding: '10px',
                    border: '1px solid #ddd',
                    borderRadius: '4px',
                    fontSize: '14px'
                  }}
                  disabled={isLoading}
                />
              </div>
            </div>
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
              backgroundColor: '#2196F3',
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
