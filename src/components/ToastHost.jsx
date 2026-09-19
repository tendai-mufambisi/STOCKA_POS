import { createPortal } from 'react-dom'
import { FiCheckCircle, FiAlertTriangle, FiInfo, FiX } from 'react-icons/fi'
import { useToastStore } from '../store/useToastStore'
import './Toast.css'

// Renders the toast layer straight into document.body.
//
// The portal is the point. Every other overlay in this app is a plain
// `position: fixed` div sitting wherever it happened to be written, which works
// only for as long as no ancestor gains a transform, a filter or an
// `overflow: hidden` — and `.settings-body` already has the last one. Portalling
// to the body takes the layer out of that argument permanently.

const ICON = { success: FiCheckCircle, error: FiAlertTriangle, info: FiInfo }

export default function ToastHost() {
  const toasts = useToastStore((s) => s.toasts)
  const dismiss = useToastStore((s) => s.dismiss)

  if (!toasts.length) return null

  return createPortal(
    <div className="toast-layer" role="region" aria-label="Notifications">
      {toasts.map((t) => {
        const Icon = ICON[t.type] || FiInfo
        return (
          <div
            key={t.id}
            className={`toast toast-${t.type}`}
            // Errors interrupt a screen reader; a success confirmation waits its turn.
            role={t.type === 'error' ? 'alert' : 'status'}
            aria-live={t.type === 'error' ? 'assertive' : 'polite'}
          >
            <span className="toast-icon"><Icon size={16} /></span>

            <div className="toast-words">
              <span className="toast-message">{t.message}</span>
              {t.detail && <span className="toast-detail">{t.detail}</span>}
            </div>

            {t.action && (
              <button
                type="button"
                className="toast-action"
                onClick={() => { t.action.onClick(); dismiss(t.id) }}
              >
                {t.action.label}
              </button>
            )}

            <button
              type="button"
              className="toast-close"
              onClick={() => dismiss(t.id)}
              aria-label="Dismiss"
            >
              <FiX size={13} />
            </button>
          </div>
        )
      })}
    </div>,
    document.body
  )
}
