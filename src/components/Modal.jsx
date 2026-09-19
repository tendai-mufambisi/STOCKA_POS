import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import './Modal.css'

// The modal the app never had.
//
// Eight components each hand-rolled a fixed overlay, none of them portalled, none
// of them trapping focus, and most of them ignoring Escape. Worse, several things
// that should have been modals were not — the backup drive picker expanded a card
// below the fold, so pressing "Change Drive" appeared to do nothing at all.
//
// `overlayClassName` and `className` REPLACE the defaults rather than appending to
// them. That is what lets ConfirmModal keep its own pixel-identical styling while
// gaining the portal, the focus trap and Escape handling from here.
//
// The classes are namespaced `smodal-*` rather than reusing the older generic
// `.modal-header` / `.modal-footer`. Those are redefined as global rules by
// RestockNeeded.css and Dashboard.css, and in a single bundle they win — which is
// how this dialog ended up rendering its title and subtitle side by side and its
// buttons with no border at all. A portalled dialog has to carry its own styling.

let lockCount = 0 // ref-counted, so nested modals do not unlock the body early

// Open dialogs, innermost last. Every dialog listens for keys on window, so without
// this a nested one (Record Stock → "New product") would hand Escape to BOTH — and
// the outer, having registered first, would close the whole flow. Only the top of
// the stack answers.
const stack = []
let nextId = 0

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([type=hidden]):not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

export default function Modal({
  open = true,
  title,
  subtitle,
  size = 'medium',        // 'small' | 'medium' | 'large'
  level = 1000,           // z-index; 1000 keeps the existing Modal.css stacking
  onClose,
  closeOnBackdrop = true,
  closeOnEsc = true,
  showClose = true,
  overlayClassName,
  className,
  footer,
  initialFocusRef,
  children,
}) {
  const boxRef = useRef(null)
  const restoreRef = useRef(null)
  const idRef = useRef(null)
  if (idRef.current === null) idRef.current = ++nextId

  // The latest handlers, read through refs. Callers pass a fresh onClose on every
  // render, and when it was a dependency of the effect below, every keystroke in a
  // form tore the dialog down and set it up again — the teardown handed focus back
  // to the button that opened it and the set-up grabbed it again, so the cursor
  // jumped out of whatever box you were typing in. The effect now runs once per
  // opening and reads whatever handler is current at the moment a key is pressed.
  const onCloseRef = useRef(onClose)
  const closeOnEscRef = useRef(closeOnEsc)
  onCloseRef.current = onClose
  closeOnEscRef.current = closeOnEsc

  useEffect(() => {
    if (!open) return

    const myId = idRef.current
    stack.push(myId)
    restoreRef.current = document.activeElement
    if (lockCount++ === 0) document.body.style.overflow = 'hidden'

    const onKey = (e) => {
      if (stack[stack.length - 1] !== myId) return
      if (e.key === 'Escape' && closeOnEscRef.current && onCloseRef.current) {
        e.preventDefault()
        // Sales and StockControl both listen for Escape on window. Without this
        // the same keypress would close this dialog AND clear the cart behind it.
        e.stopPropagation()
        onCloseRef.current()
        return
      }

      if (e.key !== 'Tab' || !boxRef.current) return
      const nodes = [...boxRef.current.querySelectorAll(FOCUSABLE)]
        .filter((n) => n.offsetParent !== null)
      if (!nodes.length) return

      const first = nodes[0]
      const last = nodes[nodes.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }

    // Capture phase, so the dialog sees the key before any page-level listener.
    window.addEventListener('keydown', onKey, true)

    // Focus the dialog itself rather than its first control. Auto-focusing the
    // close button put a focus ring on the × the moment anything opened, which
    // reads as "this is the thing you want" when it is the opposite. Tab still
    // walks into the content, and the trap below keeps it there.
    // …unless something inside already asked for focus (an `autoFocus` field), in
    // which case taking it away would leave the person clicking into the box.
    if (!boxRef.current?.contains(document.activeElement)) {
      const target = initialFocusRef?.current ?? boxRef.current
      target?.focus?.()
    }

    return () => {
      window.removeEventListener('keydown', onKey, true)
      const at = stack.lastIndexOf(myId)
      if (at !== -1) stack.splice(at, 1)
      if (--lockCount === 0) document.body.style.overflow = ''
      restoreRef.current?.focus?.()
    }
    // Deliberately only `open`: see the note on the refs above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  if (!open) return null

  return createPortal(
    <div
      className={overlayClassName ?? 'smodal-overlay'}
      style={{ zIndex: level }}
      // mousedown, not click: a drag that starts inside a text input and releases
      // over the backdrop would otherwise close the dialog and lose what was typed.
      onMouseDown={(e) => { if (closeOnBackdrop && e.target === e.currentTarget) onClose?.() }}
    >
      <div
        ref={boxRef}
        className={className ?? `smodal smodal-${size}`}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        tabIndex={-1}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {(title || subtitle) && (
          <div className="smodal-head">
            {title && <h2 className="smodal-title">{title}</h2>}
            {subtitle && <p className="smodal-sub">{subtitle}</p>}
          </div>
        )}

        {/* Outside the head so it stays put whether or not there is a title. */}
        {showClose && onClose && (
          <button type="button" className="smodal-close" onClick={onClose} aria-label="Close">
            &times;
          </button>
        )}

        <div className="smodal-body">{children}</div>

        {footer && <div className="smodal-foot">{footer}</div>}
      </div>
    </div>,
    document.body
  )
}
