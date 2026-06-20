import { FiSun, FiAlertCircle } from 'react-icons/fi'
import './EodClosedModal.css'

export default function EodClosedModal({ date, closedBy, onDismiss }) {
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
          No more sales can be processed. Please finish any active sale and log out.
        </p>
        <button className="eod-modal-btn" onClick={onDismiss}>
          <FiSun size={15} />
          Understood
        </button>
      </div>
    </div>
  )
}
