import './Stepper.css'

// Progress through a multi-step form.
//
// Grows out of the step dots on the shop-setup screen, which were the only stepper
// in the app: those showed where you were, but not what the steps were or how far
// along you had come. Here the connecting line fills as you advance and each
// finished step draws its own tick, so moving forward feels like progress rather
// than like the form changing under you.

export default function Stepper({ steps, current, onStepClick }) {
  const pct = steps.length > 1 ? (current / (steps.length - 1)) * 100 : 0

  return (
    // --stp-n lets the track start and end at the centres of the first and last dot.
    <nav className="stp" aria-label="Progress" style={{ '--stp-n': steps.length }}>
      <div className="stp-track" aria-hidden="true">
        <div className="stp-fill" style={{ width: `${pct}%` }} />
      </div>

      <ol className="stp-list">
        {steps.map((label, i) => {
          const state = i < current ? 'done' : i === current ? 'now' : 'next'
          // Going back to a finished step is allowed; jumping ahead past validation is not.
          const clickable = onStepClick && i < current
          return (
            <li key={label} className={`stp-step stp-${state}`}>
              <button
                type="button"
                className="stp-dot"
                onClick={clickable ? () => onStepClick(i) : undefined}
                disabled={!clickable}
                aria-current={state === 'now' ? 'step' : undefined}
                aria-label={`Step ${i + 1}: ${label}${state === 'done' ? ' (done)' : ''}`}
              >
                {state === 'done' ? (
                  <svg viewBox="0 0 24 24" className="stp-tick" aria-hidden="true">
                    <polyline points="5 12.5 10 17.5 19 7" />
                  </svg>
                ) : (
                  <span>{i + 1}</span>
                )}
              </button>
              <span className="stp-label">{label}</span>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
