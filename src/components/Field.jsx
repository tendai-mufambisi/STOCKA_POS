import { useEffect, useId, useRef, useState } from 'react'
import './Field.css'

// The one input.
//
// Before this there was no shared field anywhere: around forty separate input
// rule-sets across twenty-five stylesheets, seven different ideas of what focus
// looks like, and — apart from the licence-key boxes — no way at all for a single
// field to say "this one is wrong". Every validation failure became a banner at the
// top of the page, often scrolled out of sight.
//
// What it does:
//   • Floating label — the label sits inside the box like a placeholder, and slides
//     up to become a caption when you focus or type. Saves height, and you never
//     lose track of which box you are in.
//   • A focus edge that draws itself round the field, starting from where you
//     clicked, then settles into a soft glow.
//   • On a bad value: red edge, the reason underneath, and a quick shake — the same
//     head-shake the PIN pad on the sign-in screen already does.
//
// Deliberately CSS for the motion rather than an SVG per input: there are well over
// a hundred of these, and a stylesheet animation costs nothing when idle.

// Controls that always show something, so a label sitting "inside" them would
// overlap what they display.
const ALWAYS_FLOATED = new Set(['date', 'time', 'month', 'datetime-local', 'file', 'color'])

export default function Field({
  label,
  required = false,
  hint,
  error,
  shakeKey,          // change this to replay the shake for the same error (resubmits)
  as = 'input',      // 'input' | 'select' | 'textarea'
  prefix,            // e.g. "$"
  suffix,
  className = '',
  children,          // <option>s for a select
  placeholder,
  id: givenId,
  ...controlProps
}) {
  const autoId = useId()
  const id = givenId || `f-${autoId}`
  const wrapRef = useRef(null)
  const [shaking, setShaking] = useState(false)

  // Replay the shake whenever a new error appears, or the same one is re-submitted.
  useEffect(() => {
    if (!error) return
    setShaking(false)
    const start = requestAnimationFrame(() => setShaking(true))
    const stop = setTimeout(() => setShaking(false), 450)
    return () => { cancelAnimationFrame(start); clearTimeout(stop) }
  }, [error, shakeKey])

  // Start the drawn edge from wherever the pointer went down. The angle is measured
  // from the centre of the field, so a click on the right-hand end draws from there.
  const onPointerDown = (e) => {
    const box = wrapRef.current?.getBoundingClientRect()
    if (!box) return
    const dx = e.clientX - (box.left + box.width / 2)
    const dy = e.clientY - (box.top + box.height / 2)
    const deg = (Math.atan2(dy, dx) * 180) / Math.PI + 90
    wrapRef.current.style.setProperty('--fl-from', `${deg}deg`)
  }

  const floated =
    as === 'select' ||
    Boolean(prefix) ||
    ALWAYS_FLOATED.has(controlProps.type)

  const Control = as
  const describedBy = error ? `${id}-err` : hint ? `${id}-hint` : undefined

  return (
    <div className={`fl ${className}`}>
      <div
        ref={wrapRef}
        className={[
          'fl-box',
          floated && 'fl-floated',
          error && 'fl-invalid',
          shaking && 'fl-shake',
          as === 'textarea' && 'fl-area',
          prefix && 'fl-has-prefix',
        ].filter(Boolean).join(' ')}
        onPointerDown={onPointerDown}
      >
        {prefix && <span className="fl-prefix">{prefix}</span>}

        <Control
          id={id}
          className="fl-control"
          // A placeholder must exist for :placeholder-shown to work, which is what
          // lets the label know the box is empty. It stays invisible until focus.
          placeholder={placeholder ?? ' '}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={describedBy}
          aria-required={required || undefined}
          required={required}
          {...controlProps}
        >
          {children}
        </Control>

        {label && (
          <label className="fl-label" htmlFor={id}>
            {label}{required && <span className="fl-req" aria-hidden="true"> *</span>}
          </label>
        )}

        {suffix && <span className="fl-suffix">{suffix}</span>}
      </div>

      {error
        ? <p className="fl-msg fl-msg-err" id={`${id}-err`} role="alert">{error}</p>
        : hint && <p className="fl-msg" id={`${id}-hint`}>{hint}</p>}
    </div>
  )
}
