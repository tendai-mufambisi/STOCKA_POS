import { useState } from 'react'
import { FiX, FiCheck, FiAlertCircle } from 'react-icons/fi'
import './Modal.css'

function ClosingFloatModal({ shift, onConfirm, onCancel, isLoading }) {
  const [closing_usd_cash, setClosingUsdCash] = useState('')
  const [closing_zwg_cash, setClosingZwgCash] = useState('')
  const [closing_swipe_usd, setClosingSwipeUsd] = useState('')
  const [closing_swipe_zwg, setClosingSwipeZwg] = useState('')
  const [closing_ecocash_usd, setClosingEcocashUsd] = useState('')
  const [closing_ecocash_zwg, setClosingEcocashZwg] = useState('')
  const [notes, setNotes] = useState('')
  const [step, setStep] = useState(1) // 1: input, 2: confirm
  const [error, setError] = useState('')

  const handleChange = (e, setter) => {
    const value = e.target.value
    if (value === '' || !isNaN(value)) {
      setter(value)
    }
  }

  const handleNext = () => {
    setError('')
    setStep(2)
  }

  const handleBack = () => {
    setError('')
    setStep(1)
  }

  const closingFloat = {
    closing_usd_cash: parseFloat(closing_usd_cash) || 0,
    closing_zwg_cash: parseFloat(closing_zwg_cash) || 0,
    closing_swipe_usd: parseFloat(closing_swipe_usd) || 0,
    closing_swipe_zwg: parseFloat(closing_swipe_zwg) || 0,
    closing_ecocash_usd: parseFloat(closing_ecocash_usd) || 0,
    closing_ecocash_zwg: parseFloat(closing_ecocash_zwg) || 0
  }

  // Calculate expected vs actual
  const expected_usd_cash = (shift.opening_usd_cash || 0) + (shift.sales_usd_cash || 0)
  const expected_zwg_cash = (shift.opening_zwg_cash || 0) + (shift.sales_zwg_cash || 0)
  const expected_swipe_usd = (shift.opening_swipe_usd || 0) + (shift.sales_swipe_usd || 0)
  const expected_swipe_zwg = (shift.opening_swipe_zwg || 0) + (shift.sales_swipe_zwg || 0)
  const expected_ecocash_usd = (shift.opening_ecocash_usd || 0) + (shift.sales_ecocash_usd || 0)
  const expected_ecocash_zwg = (shift.opening_ecocash_zwg || 0) + (shift.sales_ecocash_zwg || 0)

  const variance_usd_cash = closingFloat.closing_usd_cash - expected_usd_cash
  const variance_zwg_cash = closingFloat.closing_zwg_cash - expected_zwg_cash
  const variance_swipe_usd = closingFloat.closing_swipe_usd - expected_swipe_usd
  const variance_swipe_zwg = closingFloat.closing_swipe_zwg - expected_swipe_zwg
  const variance_ecocash_usd = closingFloat.closing_ecocash_usd - expected_ecocash_usd
  const variance_ecocash_zwg = closingFloat.closing_ecocash_zwg - expected_ecocash_zwg

  const overall_variance = variance_usd_cash + variance_zwg_cash + variance_swipe_usd + variance_swipe_zwg + variance_ecocash_usd + variance_ecocash_zwg

  const isBalanced = Math.abs(overall_variance) < 0.01
  const isShort = overall_variance < -0.01
  const isOver = overall_variance > 0.01

  const handleConfirm = () => {
    onConfirm(closingFloat, notes)
  }

  const VarianceRow = ({ label, expected, actual, variance, isUSD = false }) => {
    const isZero = Math.abs(variance) < 0.01
    return (
      <tr>
        <td style={{ padding: '12px', borderBottom: '1px solid #eee' }}>{label}</td>
        <td style={{ padding: '12px', borderBottom: '1px solid #eee', textAlign: 'right', fontFamily: 'monospace' }}>
          {isUSD ? '$' : 'ZWG'}{expected.toFixed(isUSD ? 2 : 0)}
        </td>
        <td style={{ padding: '12px', borderBottom: '1px solid #eee', textAlign: 'right', fontFamily: 'monospace' }}>
          {isUSD ? '$' : 'ZWG'}{actual.toFixed(isUSD ? 2 : 0)}
        </td>
        <td style={{
          padding: '12px',
          borderBottom: '1px solid #eee',
          textAlign: 'right',
          fontFamily: 'monospace',
          color: isZero ? '#666' : (variance > 0 ? '#4CAF50' : '#f44336'),
          fontWeight: '500'
        }}>
          {variance > 0 ? '+' : ''}{isUSD ? '$' : 'ZWG'}{Math.abs(variance).toFixed(isUSD ? 2 : 0)}
        </td>
      </tr>
    )
  }

  if (step === 1) {
    return (
      <div className="modal-overlay">
        <div className="modal modal-large">
          <div className="modal-header">
            <h2>Close Your Shift</h2>
            <p style={{ marginTop: '4px', fontSize: '14px', color: '#666' }}>
              Physically count all money and enter what you have
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

            <div style={{
              padding: '12px',
              marginBottom: '16px',
              backgroundColor: '#e3f2fd',
              borderRadius: '4px',
              fontSize: '13px',
              color: '#1976d2'
            }}>
              <strong>Expected per payment method:</strong><br />
              USD Cash: ${expected_usd_cash.toFixed(2)} | ZWG Cash: ZWG{expected_zwg_cash.toFixed(0)} | 
              Swipe USD: ${expected_swipe_usd.toFixed(2)} | Swipe ZWG: ZWG{expected_swipe_zwg.toFixed(0)} |
              EcoCash USD: ${expected_ecocash_usd.toFixed(2)} | EcoCash ZWG: ZWG{expected_ecocash_zwg.toFixed(0)}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
              {/* USD Cash */}
              <div>
                <label style={{ display: 'block', marginBottom: '6px', fontWeight: '500', fontSize: '14px' }}>
                  USD Cash counted
                </label>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <span style={{ marginRight: '8px', fontSize: '14px', fontWeight: '500' }}>$</span>
                  <input
                    type="text"
                    value={closing_usd_cash}
                    onChange={(e) => handleChange(e, setClosingUsdCash)}
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
                  ZWG Cash counted
                </label>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <span style={{ marginRight: '8px', fontSize: '14px', fontWeight: '500' }}>ZWG</span>
                  <input
                    type="text"
                    value={closing_zwg_cash}
                    onChange={(e) => handleChange(e, setClosingZwgCash)}
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
                  Swipe USD received
                </label>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <span style={{ marginRight: '8px', fontSize: '14px', fontWeight: '500' }}>$</span>
                  <input
                    type="text"
                    value={closing_swipe_usd}
                    onChange={(e) => handleChange(e, setClosingSwipeUsd)}
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
                  Swipe ZWG received
                </label>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <span style={{ marginRight: '8px', fontSize: '14px', fontWeight: '500' }}>ZWG</span>
                  <input
                    type="text"
                    value={closing_swipe_zwg}
                    onChange={(e) => handleChange(e, setClosingSwipeZwg)}
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
                    value={closing_ecocash_usd}
                    onChange={(e) => handleChange(e, setClosingEcocashUsd)}
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
                    value={closing_ecocash_zwg}
                    onChange={(e) => handleChange(e, setClosingEcocashZwg)}
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

            {/* Notes */}
            <div>
              <label style={{ display: 'block', marginBottom: '6px', fontWeight: '500', fontSize: '14px' }}>
                Notes (optional)
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Any notes about the closing (e.g., found $5 under the till..."
                style={{
                  width: '100%',
                  padding: '10px',
                  border: '1px solid #ddd',
                  borderRadius: '4px',
                  fontSize: '14px',
                  fontFamily: 'inherit',
                  resize: 'vertical',
                  minHeight: '80px'
                }}
                disabled={isLoading}
              />
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
              onClick={handleNext}
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
              Review & Submit
            </button>
          </div>
        </div>
      </div>
    )
  }

  // Step 2: Review and confirm
  return (
    <div className="modal-overlay">
      <div className="modal modal-large">
        <div className="modal-header">
          <h2>Reconciliation Summary</h2>
        </div>

        <div className="modal-body">
          {/* Status Alert */}
          <div style={{
            padding: '16px',
            marginBottom: '16px',
            backgroundColor: isBalanced ? '#f1f8f4' : (isShort ? '#fff3e0' : '#f3e5f5'),
            borderLeft: `4px solid ${isBalanced ? '#4CAF50' : (isShort ? '#ff9800' : '#9c27b0')}`,
            borderRadius: '4px'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: '8px' }}>
              {isBalanced ? (
                <span style={{ fontSize: '20px', marginRight: '8px' }}>✅</span>
              ) : isShort ? (
                <FiAlertCircle style={{ fontSize: '20px', marginRight: '8px', color: '#ff9800' }} />
              ) : (
                <span style={{ fontSize: '20px', marginRight: '8px' }}>ℹ️</span>
              )}
              <span style={{ fontSize: '16px', fontWeight: '600', color: isBalanced ? '#2e7d32' : (isShort ? '#e65100' : '#7b1fa2') }}>
                {isBalanced ? 'BALANCED ✅' : (isShort ? `SHORT $${Math.abs(overall_variance).toFixed(2)} ⚠️` : `OVER $${overall_variance.toFixed(2)} ℹ️`)}
              </span>
            </div>
            {!isBalanced && (
              <p style={{ margin: '0', fontSize: '13px', color: isShort ? '#bf360c' : '#6a1b9a' }}>
                {isShort ? `You are short by $${Math.abs(overall_variance).toFixed(2)}` : `You are over by $${overall_variance.toFixed(2)}`}
              </p>
            )}
          </div>

          {/* Summary Table */}
          <div style={{ marginBottom: '16px', overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ backgroundColor: '#f5f5f5' }}>
                  <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', fontSize: '13px' }}>Payment Method</th>
                  <th style={{ padding: '12px', textAlign: 'right', fontWeight: '600', fontSize: '13px' }}>Expected</th>
                  <th style={{ padding: '12px', textAlign: 'right', fontWeight: '600', fontSize: '13px' }}>Actual</th>
                  <th style={{ padding: '12px', textAlign: 'right', fontWeight: '600', fontSize: '13px' }}>Variance</th>
                </tr>
              </thead>
              <tbody>
                <VarianceRow label="USD Cash" expected={expected_usd_cash} actual={closingFloat.closing_usd_cash} variance={variance_usd_cash} isUSD={true} />
                <VarianceRow label="ZWG Cash" expected={expected_zwg_cash} actual={closingFloat.closing_zwg_cash} variance={variance_zwg_cash} isUSD={false} />
                <VarianceRow label="Swipe USD" expected={expected_swipe_usd} actual={closingFloat.closing_swipe_usd} variance={variance_swipe_usd} isUSD={true} />
                <VarianceRow label="Swipe ZWG" expected={expected_swipe_zwg} actual={closingFloat.closing_swipe_zwg} variance={variance_swipe_zwg} isUSD={false} />
                <VarianceRow label="EcoCash USD" expected={expected_ecocash_usd} actual={closingFloat.closing_ecocash_usd} variance={variance_ecocash_usd} isUSD={true} />
                <VarianceRow label="EcoCash ZWG" expected={expected_ecocash_zwg} actual={closingFloat.closing_ecocash_zwg} variance={variance_ecocash_zwg} isUSD={false} />
              </tbody>
            </table>
          </div>

          {notes && (
            <div style={{
              padding: '12px',
              backgroundColor: '#f5f5f5',
              borderRadius: '4px',
              marginBottom: '16px'
            }}>
              <strong style={{ fontSize: '13px' }}>Notes:</strong><br />
              <span style={{ fontSize: '13px', color: '#666' }}>{notes}</span>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button
            onClick={handleBack}
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
            Back
          </button>
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
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            style={{
              padding: '10px 20px',
              border: 'none',
              borderRadius: '4px',
              backgroundColor: '#4CAF50',
              color: '#fff',
              cursor: isLoading ? 'not-allowed' : 'pointer',
              fontSize: '14px',
              fontWeight: '500',
              opacity: isLoading ? 0.7 : 1
            }}
            disabled={isLoading}
          >
            <FiCheck style={{ marginRight: '6px', display: 'inline' }} />
            {isLoading ? 'Submitting...' : 'Confirm & Lock Shift'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default ClosingFloatModal
