import './ConfirmModal.css'

export default function ConfirmModal({ message, detail, onConfirm, onCancel, confirmLabel = 'Confirm', danger = false }) {
  return (
    <div className="confirm-modal-overlay" onClick={onCancel}>
      <div className="confirm-modal" onClick={e => e.stopPropagation()}>
        <p className="confirm-modal-message">{message}</p>
        {detail && <p className="confirm-modal-detail">{detail}</p>}
        <div className="confirm-modal-actions">
          <button className="confirm-btn-cancel" onClick={onCancel}>Cancel</button>
          <button className={`confirm-btn-ok${danger ? ' danger' : ''}`} onClick={onConfirm} autoFocus>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
