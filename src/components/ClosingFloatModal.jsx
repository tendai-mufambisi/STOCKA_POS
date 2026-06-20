import { useState } from 'react'
import { FiX, FiCheck, FiAlertCircle } from 'react-icons/fi'
import './Modal.css'

function ClosingFloatModal({ shift, onConfirm, onCancel, isLoading, varianceTolerance = 0.01 }) {
  const [closing_cash, setClosingCash] = useState('')
  const [closing_usd,  setClosingUsd]  = useState('')
  const [notes, setNotes] = useState('')
  const [step, setStep] = useState(1)
  const [error, setError] = useState('')

  const handleNumberInput = (setter) => (e) => {
    const v = e.target.value
    if (v === '' || !isNaN(v)) setter(v)
  }

  const cashFloat = parseFloat(closing_cash) || 0
  const usdFloat  = parseFloat(closing_usd)  || 0

  // Expected per payment method
  const cashSales    = shift.cash_sales    || 0
  const usdSales     = shift.usd_sales     || 0
  const cashExpenses = shift.cash_expenses || 0
  const usdExpenses  = shift.usd_expenses  || 0

  const expected_cash = (shift.opening_cash || 0) + cashSales - cashExpenses
  const expected_usd  = (shift.opening_usd  || 0) + usdSales  - usdExpenses

  const cashVariance = cashFloat - expected_cash
  const usdVariance  = usdFloat  - expected_usd
  const totalVariance = cashVariance + usdVariance

  const isBalanced = Math.abs(totalVariance) < varianceTolerance
  const isShort    = totalVariance < -varianceTolerance
  const isOver     = totalVariance > varianceTolerance

  const handleNext = () => { setError(''); setStep(2) }
  const handleBack = () => { setError(''); setStep(1) }
  const handleConfirm = () => onConfirm({ closing_cash: cashFloat, closing_usd: usdFloat }, notes)

  const VarianceRow = ({ label, expected, actual, variance }) => {
    const isZero = Math.abs(variance) < varianceTolerance
    return (
      <tr>
        <td style={{ padding: '12px', borderBottom: '1px solid #eee' }}>{label}</td>
        <td style={{ padding: '12px', borderBottom: '1px solid #eee', textAlign: 'right', fontFamily: 'monospace' }}>
          ${expected.toFixed(2)}
        </td>
        <td style={{ padding: '12px', borderBottom: '1px solid #eee', textAlign: 'right', fontFamily: 'monospace' }}>
          ${actual.toFixed(2)}
        </td>
        <td style={{
          padding: '12px', borderBottom: '1px solid #eee', textAlign: 'right',
          fontFamily: 'monospace',
          color: isZero ? '#666' : variance > 0 ? '#4CAF50' : '#f44336',
          fontWeight: '500'
        }}>
          {variance > 0 ? '+' : ''}${Math.abs(variance).toFixed(2)}
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
              Count your drawer and enter the amounts below
            </p>
          </div>

          <div className="modal-body">
            {error && (
              <div style={{ padding: '12px', marginBottom: '16px', backgroundColor: '#fee', color: '#c33', borderRadius: '4px', fontSize: '14px' }}>
                {error}
              </div>
            )}

            {/* Expected summary */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
              <div style={{ padding: '10px 14px', background: '#e3f2fd', borderRadius: 6, fontSize: 13, color: '#1565c0' }}>
                <strong>Expected Cash (ZWG):</strong><br />${expected_cash.toFixed(2)}
              </div>
              <div style={{ padding: '10px 14px', background: '#e8f5e9', borderRadius: 6, fontSize: 13, color: '#2e7d32' }}>
                <strong>Expected USD:</strong><br />${expected_usd.toFixed(2)}
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
              {/* Cash */}
              <div>
                <label style={{ display: 'block', marginBottom: '6px', fontWeight: '500', fontSize: '14px' }}>
                  Cash counted (ZWG) *
                </label>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <span style={{ marginRight: '8px', fontSize: '14px', fontWeight: '500' }}>$</span>
                  <input
                    type="text"
                    value={closing_cash}
                    onChange={handleNumberInput(setClosingCash)}
                    placeholder="0.00"
                    style={{ flex: 1, padding: '10px', border: '1px solid #ddd', borderRadius: '4px', fontSize: '14px' }}
                    disabled={isLoading}
                    autoFocus
                  />
                </div>
              </div>

              {/* USD */}
              <div>
                <label style={{ display: 'block', marginBottom: '6px', fontWeight: '500', fontSize: '14px' }}>
                  USD counted *
                </label>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <span style={{ marginRight: '8px', fontSize: '14px', fontWeight: '500' }}>$</span>
                  <input
                    type="text"
                    value={closing_usd}
                    onChange={handleNumberInput(setClosingUsd)}
                    placeholder="0.00"
                    style={{ flex: 1, padding: '10px', border: '1px solid #ddd', borderRadius: '4px', fontSize: '14px' }}
                    disabled={isLoading}
                  />
                </div>
              </div>
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: '6px', fontWeight: '500', fontSize: '14px' }}>
                Notes (optional)
              </label>
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="Any discrepancies or notes..."
                style={{ width: '100%', padding: '10px', border: '1px solid #ddd', borderRadius: '4px', fontSize: '14px', fontFamily: 'inherit', minHeight: '70px', resize: 'vertical' }}
                disabled={isLoading}
              />
            </div>

            <div style={{ display: 'flex', gap: '12px', marginTop: '24px' }}>
              <button
                onClick={onCancel}
                style={{ flex: 1, padding: '12px', backgroundColor: '#f5f5f5', border: '1px solid #ddd', borderRadius: '4px', cursor: 'pointer', fontSize: '14px', fontWeight: '500' }}
                disabled={isLoading}
              >
                Cancel
              </button>
              <button
                onClick={handleNext}
                style={{ flex: 1, padding: '12px', backgroundColor: '#1976d2', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '14px', fontWeight: '500' }}
                disabled={(!closing_cash && !closing_usd) || isLoading}
              >
                Next →
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Step 2: Confirm
  return (
    <div className="modal-overlay">
      <div className="modal modal-large">
        <div className="modal-header">
          <h2>Confirm Cash Reconciliation</h2>
          <p style={{ marginTop: '4px', fontSize: '14px', color: '#666' }}>
            Review the variance before submitting
          </p>
        </div>

        <div className="modal-body">
          {isBalanced && (
            <div style={{ padding: '16px', marginBottom: '16px', backgroundColor: '#e8f5e9', border: '1px solid #4CAF50', borderRadius: '4px', display: 'flex', alignItems: 'center', gap: '12px' }}>
              <FiCheck size={24} color="#4CAF50" style={{ flexShrink: 0 }} />
              <div>
                <strong style={{ color: '#2e7d32' }}>All balanced!</strong>
                <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: '#558b2f' }}>No discrepancy found.</p>
              </div>
            </div>
          )}
          {isShort && (
            <div style={{ padding: '16px', marginBottom: '16px', backgroundColor: '#ffebee', border: '1px solid #f44336', borderRadius: '4px', display: 'flex', alignItems: 'center', gap: '12px' }}>
              <FiAlertCircle size={24} color="#f44336" style={{ flexShrink: 0 }} />
              <div>
                <strong style={{ color: '#c62828' }}>Short!</strong>
                <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: '#b71c1c' }}>
                  Total short by ${Math.abs(totalVariance).toFixed(2)}
                </p>
              </div>
            </div>
          )}
          {isOver && (
            <div style={{ padding: '16px', marginBottom: '16px', backgroundColor: '#fff3e0', border: '1px solid #ff9800', borderRadius: '4px', display: 'flex', alignItems: 'center', gap: '12px' }}>
              <FiAlertCircle size={24} color="#ff9800" style={{ flexShrink: 0 }} />
              <div>
                <strong style={{ color: '#e65100' }}>Over!</strong>
                <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: '#bf360c' }}>
                  Total over by ${Math.abs(totalVariance).toFixed(2)}
                </p>
              </div>
            </div>
          )}

          <table style={{ width: '100%', marginBottom: '24px', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ backgroundColor: '#f5f5f5' }}>
                <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', fontSize: '13px' }}>Type</th>
                <th style={{ padding: '12px', textAlign: 'right', fontWeight: '600', fontSize: '13px' }}>Expected</th>
                <th style={{ padding: '12px', textAlign: 'right', fontWeight: '600', fontSize: '13px' }}>Counted</th>
                <th style={{ padding: '12px', textAlign: 'right', fontWeight: '600', fontSize: '13px' }}>Variance</th>
              </tr>
            </thead>
            <tbody>
              <VarianceRow label="Cash (ZWG)" expected={expected_cash} actual={cashFloat}  variance={cashVariance} />
              <VarianceRow label="USD"         expected={expected_usd}  actual={usdFloat}   variance={usdVariance}  />
            </tbody>
          </table>

          {notes && (
            <div style={{ marginBottom: '24px', padding: '12px', backgroundColor: '#f5f5f5', borderRadius: '4px' }}>
              <strong style={{ fontSize: '13px' }}>Notes:</strong>
              <p style={{ margin: '8px 0 0 0', fontSize: '13px', whiteSpace: 'pre-wrap' }}>{notes}</p>
            </div>
          )}

          <div style={{ display: 'flex', gap: '12px' }}>
            <button
              onClick={handleBack}
              style={{ flex: 1, padding: '12px', backgroundColor: '#f5f5f5', border: '1px solid #ddd', borderRadius: '4px', cursor: 'pointer', fontSize: '14px', fontWeight: '500' }}
              disabled={isLoading}
            >
              ← Back
            </button>
            <button
              onClick={handleConfirm}
              style={{ flex: 1, padding: '12px', backgroundColor: '#4CAF50', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '14px', fontWeight: '500' }}
              disabled={isLoading}
            >
              {isLoading ? 'Closing...' : 'Close Shift'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default ClosingFloatModal
