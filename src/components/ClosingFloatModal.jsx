import { useState } from 'react'
import { FiCheck, FiAlertCircle } from 'react-icons/fi'
import './Modal.css'

function ClosingFloatModal({ shift, onConfirm, onCancel, isLoading, varianceTolerance = 0.01 }) {
  const [closing_cash, setClosingCash] = useState('')
  const [notes, setNotes] = useState('')
  const [step, setStep] = useState(1)
  const [error, setError] = useState('')

  const cashFloat = parseFloat(closing_cash) || 0

  const openingFloat     = shift.opening_cash      ?? 0
  const cashSales        = shift.cash_sales         ?? (shift.total_sales ?? shift.total_sales_value ?? 0)
  const transferSales    = shift.transfer_sales     ?? 0
  const totalExpenses    = shift.total_expenses     ?? 0
  // Expected cash = what should physically be in the drawer
  const expectedCash     = shift.expected_cash      ?? (openingFloat + cashSales - totalExpenses)
  // Expected transfer = electronic receipts (informational only)
  const expectedTransfer = shift.expected_transfer  ?? transferSales

  const variance   = cashFloat - expectedCash
  const isBalanced = Math.abs(variance) < varianceTolerance
  const isShort    = variance < -varianceTolerance
  const isOver     = variance > varianceTolerance

  const handleNext    = () => { setError(''); setStep(2) }
  const handleBack    = () => { setError(''); setStep(1) }
  const handleConfirm = () => onConfirm({ closing_cash: cashFloat }, notes)

  if (step === 1) {
    return (
      <div className="modal-overlay">
        <div className="modal modal-large">
          <div className="modal-header">
            <h2>Close Your Shift</h2>
            <p style={{ marginTop: '4px', fontSize: '14px', color: '#666' }}>
              Count your drawer and enter the total cash on hand
            </p>
          </div>

          <div className="modal-body">
            {error && (
              <div style={{ padding: '12px', marginBottom: '16px', backgroundColor: '#fee', color: '#c33', borderRadius: '4px', fontSize: '14px' }}>
                {error}
              </div>
            )}

            {/* Expected summary */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 20 }}>
              <div style={{ padding: '10px 14px', background: '#f0fdf4', borderRadius: 8, fontSize: 13 }}>
                <div style={{ color: '#64748b', marginBottom: 2 }}>Opening Float</div>
                <div style={{ fontWeight: 700, color: '#166534', fontSize: 16 }}>${openingFloat.toFixed(2)}</div>
              </div>
              <div style={{ padding: '10px 14px', background: '#f0fdf4', borderRadius: 8, fontSize: 13 }}>
                <div style={{ color: '#64748b', marginBottom: 2 }}>Cash Sales</div>
                <div style={{ fontWeight: 700, color: '#166534', fontSize: 16 }}>+${cashSales.toFixed(2)}</div>
              </div>
              <div style={{ padding: '10px 14px', background: '#eff6ff', borderRadius: 8, fontSize: 13 }}>
                <div style={{ color: '#64748b', marginBottom: 2 }}>Transfer Sales</div>
                <div style={{ fontWeight: 700, color: '#1d4ed8', fontSize: 16 }}>${expectedTransfer.toFixed(2)}</div>
              </div>
              <div style={{ padding: '10px 14px', background: '#fef3c7', borderRadius: 8, fontSize: 13 }}>
                <div style={{ color: '#64748b', marginBottom: 2 }}>Expected Cash</div>
                <div style={{ fontWeight: 800, color: '#1e293b', fontSize: 17 }}>${expectedCash.toFixed(2)}</div>
              </div>
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', marginBottom: '6px', fontWeight: '600', fontSize: '14px' }}>
                Cash counted *
              </label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: '20px', fontWeight: '700' }}>$</span>
                <input
                  type="number"
                  value={closing_cash}
                  onChange={e => { if (e.target.value === '' || !isNaN(e.target.value)) setClosingCash(e.target.value) }}
                  onKeyDown={e => e.key === 'Enter' && closing_cash && handleNext()}
                  placeholder="0.00"
                  step="0.01"
                  style={{ flex: 1, padding: '12px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '20px', fontWeight: '700' }}
                  disabled={isLoading}
                  autoFocus
                />
              </div>
              {closing_cash !== '' && !isNaN(cashFloat) && (
                <div style={{ marginTop: 8, fontSize: 13, fontWeight: 600,
                  color: isBalanced ? '#16a34a' : isShort ? '#dc2626' : '#d97706' }}>
                  {isBalanced ? '✓ Balanced'
                    : isShort ? `Short by $${Math.abs(variance).toFixed(2)}`
                    : `Over by $${Math.abs(variance).toFixed(2)}`}
                </div>
              )}
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: '6px', fontWeight: '500', fontSize: '14px' }}>
                Notes (optional)
              </label>
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="Any discrepancies or handover notes…"
                style={{ width: '100%', padding: '10px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '14px', fontFamily: 'inherit', minHeight: '70px', resize: 'vertical', boxSizing: 'border-box' }}
                disabled={isLoading}
              />
            </div>

            <div style={{ display: 'flex', gap: '12px', marginTop: '24px' }}>
              <button
                onClick={onCancel}
                style={{ flex: 1, padding: '12px', backgroundColor: '#f5f5f5', border: '1px solid #ddd', borderRadius: '6px', cursor: 'pointer', fontSize: '14px', fontWeight: '500' }}
                disabled={isLoading}
              >
                Cancel
              </button>
              <button
                onClick={handleNext}
                style={{ flex: 1, padding: '12px', backgroundColor: '#1976d2', color: 'white', border: 'none', borderRadius: '6px', cursor: closing_cash ? 'pointer' : 'not-allowed', fontSize: '14px', fontWeight: '600', opacity: closing_cash ? 1 : 0.5 }}
                disabled={!closing_cash || isLoading}
              >
                Review →
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Step 2 — Confirm
  return (
    <div className="modal-overlay">
      <div className="modal modal-large">
        <div className="modal-header">
          <h2>Confirm Shift Closing</h2>
          <p style={{ marginTop: '4px', fontSize: '14px', color: '#666' }}>
            Review before submitting
          </p>
        </div>

        <div className="modal-body">
          {isBalanced && (
            <div style={{ padding: '16px', marginBottom: '16px', backgroundColor: '#e8f5e9', border: '1px solid #4CAF50', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '12px' }}>
              <FiCheck size={24} color="#4CAF50" style={{ flexShrink: 0 }} />
              <div>
                <strong style={{ color: '#2e7d32' }}>All balanced!</strong>
                <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: '#558b2f' }}>No discrepancy found.</p>
              </div>
            </div>
          )}
          {isShort && (
            <div style={{ padding: '16px', marginBottom: '16px', backgroundColor: '#ffebee', border: '1px solid #f44336', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '12px' }}>
              <FiAlertCircle size={24} color="#f44336" style={{ flexShrink: 0 }} />
              <div>
                <strong style={{ color: '#c62828' }}>Short!</strong>
                <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: '#b71c1c' }}>
                  Short by ${Math.abs(variance).toFixed(2)}
                </p>
              </div>
            </div>
          )}
          {isOver && (
            <div style={{ padding: '16px', marginBottom: '16px', backgroundColor: '#fff3e0', border: '1px solid #ff9800', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '12px' }}>
              <FiAlertCircle size={24} color="#ff9800" style={{ flexShrink: 0 }} />
              <div>
                <strong style={{ color: '#e65100' }}>Over!</strong>
                <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: '#bf360c' }}>
                  Over by ${Math.abs(variance).toFixed(2)}
                </p>
              </div>
            </div>
          )}

          <table style={{ width: '100%', marginBottom: '24px', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ backgroundColor: '#f5f5f5' }}>
                <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', fontSize: '13px' }}></th>
                <th style={{ padding: '12px', textAlign: 'right', fontWeight: '600', fontSize: '13px' }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={{ padding: '12px', borderBottom: '1px solid #eee' }}>Opening Float</td>
                <td style={{ padding: '12px', borderBottom: '1px solid #eee', textAlign: 'right', fontFamily: 'monospace' }}>${openingFloat.toFixed(2)}</td>
              </tr>
              <tr>
                <td style={{ padding: '12px', borderBottom: '1px solid #eee' }}>+ Cash Sales</td>
                <td style={{ padding: '12px', borderBottom: '1px solid #eee', textAlign: 'right', fontFamily: 'monospace', color: '#16a34a' }}>+${cashSales.toFixed(2)}</td>
              </tr>
              {expectedTransfer > 0 && (
                <tr>
                  <td style={{ padding: '12px', borderBottom: '1px solid #eee', color: '#1d4ed8' }}>Transfer Sales <span style={{ fontSize: 11, color: '#94a3b8' }}>(electronic)</span></td>
                  <td style={{ padding: '12px', borderBottom: '1px solid #eee', textAlign: 'right', fontFamily: 'monospace', color: '#1d4ed8' }}>${expectedTransfer.toFixed(2)}</td>
                </tr>
              )}
              {totalExpenses > 0 && (
                <tr>
                  <td style={{ padding: '12px', borderBottom: '1px solid #eee' }}>− Expenses</td>
                  <td style={{ padding: '12px', borderBottom: '1px solid #eee', textAlign: 'right', fontFamily: 'monospace', color: '#dc2626' }}>−${totalExpenses.toFixed(2)}</td>
                </tr>
              )}
              <tr style={{ backgroundColor: '#f8fafc' }}>
                <td style={{ padding: '12px', borderBottom: '1px solid #eee', fontWeight: 700 }}>Expected Cash</td>
                <td style={{ padding: '12px', borderBottom: '1px solid #eee', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700 }}>${expectedCash.toFixed(2)}</td>
              </tr>
              <tr style={{ backgroundColor: '#f8fafc' }}>
                <td style={{ padding: '12px', borderBottom: '1px solid #eee', fontWeight: 700 }}>Cash Counted</td>
                <td style={{ padding: '12px', borderBottom: '1px solid #eee', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700 }}>${cashFloat.toFixed(2)}</td>
              </tr>
              <tr>
                <td style={{ padding: '12px', fontWeight: 700 }}>Variance</td>
                <td style={{ padding: '12px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700,
                  color: isBalanced ? '#666' : variance > 0 ? '#4CAF50' : '#f44336' }}>
                  {variance > 0 ? '+' : ''}${variance.toFixed(2)}
                </td>
              </tr>
            </tbody>
          </table>

          {notes && (
            <div style={{ marginBottom: '24px', padding: '12px', backgroundColor: '#f5f5f5', borderRadius: '6px' }}>
              <strong style={{ fontSize: '13px' }}>Notes:</strong>
              <p style={{ margin: '8px 0 0 0', fontSize: '13px', whiteSpace: 'pre-wrap' }}>{notes}</p>
            </div>
          )}

          <div style={{ display: 'flex', gap: '12px' }}>
            <button
              onClick={handleBack}
              style={{ flex: 1, padding: '12px', backgroundColor: '#f5f5f5', border: '1px solid #ddd', borderRadius: '6px', cursor: 'pointer', fontSize: '14px', fontWeight: '500' }}
              disabled={isLoading}
            >
              ← Back
            </button>
            <button
              onClick={handleConfirm}
              style={{ flex: 1, padding: '12px', backgroundColor: '#4CAF50', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '14px', fontWeight: '600' }}
              disabled={isLoading}
            >
              {isLoading ? 'Closing…' : 'Close Shift'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default ClosingFloatModal
