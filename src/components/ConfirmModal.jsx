import Modal from './Modal'
import './ConfirmModal.css'

// Same six props, same six call sites, same pixels — but now portalled to the
// body, closable with Escape, and trapping focus, because it sits on Modal.
// `overlayClassName` and `className` replace Modal's defaults, which is what
// preserves the existing look exactly.

export default function ConfirmModal({
  message,
  detail,
  onConfirm,
  onCancel,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
  busy = false,
  children,
}) {
  return (
    <Modal
      level={2000}                       /* matches ConfirmModal.css's own z-index */
      overlayClassName="confirm-modal-overlay"
      className="confirm-modal"
      onClose={onCancel}
      showClose={false}
    >
      <p className="confirm-modal-message">{message}</p>
      {detail && <p className="confirm-modal-detail">{detail}</p>}
      {children}
      <div className="confirm-modal-actions">
        {/* Where the keyboard starts decides what Enter does. For something that
            destroys work — discard, restore, delete — that must be the safe choice,
            so a reflexive Enter never throws anything away. */}
        <button type="button" className="confirm-btn-cancel" onClick={onCancel} disabled={busy} autoFocus={danger}>
          {cancelLabel}
        </button>
        <button
          type="button"
          className={`confirm-btn-ok${danger ? ' danger' : ''}`}
          onClick={onConfirm}
          disabled={busy}
          autoFocus={!danger}
        >
          {busy ? 'Working…' : confirmLabel}
        </button>
      </div>
    </Modal>
  )
}
