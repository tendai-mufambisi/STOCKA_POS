import { FiSunrise, FiAlertCircle, FiBriefcase, FiX } from 'react-icons/fi'
import './EodClosedModal.css'

export default function EodClosedModal({ date, closedBy, onDismiss, onCloseShift }) {
  const fmtDate = date
    ? new Date(date + 'T00:00:00').toLocaleDateString('en-ZA', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    : 'today'

  return (
    <div className="eod-modal-overlay">
      <div className="eod-modal-card">
        <div className="eod-modal-icon-wrap">
          <FiAlertCircle size={36} />
        </div>
        <h2 className="eod-modal-title">Day Closed</h2>
        <p className="eod-modal-msg">
          The business day for <strong>{fmtDate}</strong> has been closed
          {closedBy ? ` by ${closedBy}` : ''}.
        </p>
        <p className="eod-modal-sub">
          No more sales can be processed. Please count your cash drawer, hand over your float to the manager, and close your shift.
        </p>

        <div className="eod-modal-actions">
          {onCloseShift && (
            <button className="eod-modal-btn eod-modal-btn-primary" onClick={onCloseShift}>
              <FiBriefcase size={15} />
              Submit Cash &amp; Close Shift
            </button>
          )}
          <button className="eod-modal-btn eod-modal-btn-ghost" onClick={onDismiss}>
            <FiX size={14} />
            Dismiss
          </button>
        </div>
      </div>
    </div>
  )
}
