import { useState } from 'react'
import { LuTriangleAlert, LuCircleCheck, LuInfo, LuChevronDown, LuWifiOff } from 'react-icons/lu'
import './DataConfidenceBanner.css'

// Says how far the figures on screen can be trusted, and why.
//
// The alternative — printing a confident number over data the engine knows is
// incomplete — is the failure mode this whole project exists to avoid. A shop
// owner who is told "37% margin" when two thirds of the products have no cost
// recorded will act on it, discover it was wrong, and stop believing any of it.
//
// So: high confidence renders as a quiet single line, and anything less
// explains itself and can be expanded for the detail.

export default function DataConfidenceBanner({ quality, unreachable, onRetry }) {
  const [open, setOpen] = useState(false)

  if (unreachable) {
    return (
      <div className="dcb dcb-unreachable">
        <LuWifiOff className="dcb-icon" />
        <div className="dcb-body">
          <div className="dcb-title">Figures come from the Main Computer</div>
          <div className="dcb-text">
            This till holds only its own copy of the data, which is incomplete, so it will not
            calculate these figures itself rather than show you a number that looks right and is not.
          </div>
        </div>
        {onRetry && (
          <button type="button" className="dcb-action" onClick={onRetry}>
            Retry
          </button>
        )}
      </div>
    )
  }

  if (!quality) return null

  const { confidence, score, blockers = [], warnings = [], notes = [] } = quality
  const issues = [...blockers, ...warnings]
  const pct = Math.round((score ?? 1) * 100)

  if (confidence === 'high' && issues.length === 0) {
    return (
      <div className="dcb dcb-high">
        <LuCircleCheck className="dcb-icon" />
        <span className="dcb-text">
          Figures verified against {pct}% of today&apos;s data.
        </span>
      </div>
    )
  }

  const tone = confidence === 'low' ? 'dcb-low' : 'dcb-medium'
  const Icon = confidence === 'low' ? LuTriangleAlert : LuInfo

  return (
    <div className={`dcb ${tone}`}>
      <Icon className="dcb-icon" />
      <div className="dcb-body">
        <div className="dcb-title">
          {confidence === 'low'
            ? 'These figures are missing information'
            : 'These figures come with a caveat'}
          <span className="dcb-score">{pct}% confidence</span>
        </div>

        {/* The single most important issue is always visible, not hidden
            behind a toggle — the point is that it cannot be missed. */}
        {issues[0]?.message && <div className="dcb-text">{issues[0].message}</div>}

        {(issues.length > 1 || notes.length > 0) && (
          <>
            <button type="button" className="dcb-toggle" onClick={() => setOpen(!open)}>
              {open ? 'Hide detail' : `Show ${issues.length - 1 + notes.length} more`}
              <LuChevronDown className={`dcb-chevron ${open ? 'open' : ''}`} />
            </button>
            {open && (
              <ul className="dcb-list">
                {issues.slice(1).map((i) => (
                  <li key={i.id} className={`dcb-item dcb-${i.severity}`}>
                    {i.message}
                  </li>
                ))}
                {notes.map((n) => (
                  <li key={n.id} className="dcb-item dcb-info">
                    {n.message}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  )
}
