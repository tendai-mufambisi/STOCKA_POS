// The shield fills with the places that actually hold a checked copy.
//
// The temptation with something like this is a percentage — "73% protected" — and
// it is worth saying why that is refused here. A number like that is unfalsifiable:
// the owner cannot tell you what the missing 27% is, cannot act on it, and cannot
// tell whether it moved because their data got safer or because we changed a
// constant. This fills in whole bands, one per real destination, so half a shield
// always means exactly "one of your two copies is current" and the owner can point
// at which one is missing.
//
// Bands fill from the bottom, because the bottom one is the copy on this computer:
// the foundation that everything else sits on, and the one that protects least.

import './BackupShield.css'

const SHIELD = 'M12 1.6 L21.4 5.4 V13 C21.4 19.4 17 24.3 12 26.4 C7 24.3 2.6 19.4 2.6 13 V5.4 Z'

// The drawable interior of the shield in viewBox units — where the fill starts and
// stops, so a band boundary lands where the eye expects it rather than inside the
// point at the bottom.
const TOP = 1.6
const BOTTOM = 26.4

export default function BackupShield({ held = 0, total = 2, tone = 'neutral', size = 42 }) {
  const safeTotal = Math.max(1, total)
  const fraction = Math.min(1, Math.max(0, held / safeTotal))

  const height = BOTTOM - TOP
  const fillTop = BOTTOM - height * fraction

  // One separator per band boundary, so the bands read as discrete places rather
  // than as a continuous gauge.
  const dividers = []
  for (let i = 1; i < safeTotal; i++) {
    dividers.push(BOTTOM - (height * i) / safeTotal)
  }

  const label = total === 0
    ? 'Backup protection'
    : `${held} of ${safeTotal} places hold a current checked copy`

  return (
    <svg
      className={`bsh bsh-${tone}`}
      width={size}
      height={size * (28 / 24)}
      viewBox="0 0 24 28"
      role="img"
      aria-label={label}
    >
      <defs>
        {/* Clip the fill to the shield so it can never bleed past the outline. */}
        <clipPath id="bsh-clip">
          <path d={SHIELD} />
        </clipPath>
      </defs>

      {/* The empty shield — what protection could be. */}
      <path d={SHIELD} className="bsh-well" />

      {/* What it actually is. */}
      <g clipPath="url(#bsh-clip)">
        <rect
          className="bsh-fill"
          x="0"
          y={fillTop}
          width="24"
          height={BOTTOM - fillTop}
        />
        {dividers.map((y) => (
          <line key={y} className="bsh-divider" x1="0" x2="24" y1={y} y2={y} />
        ))}
      </g>

      <path d={SHIELD} className="bsh-outline" />
    </svg>
  )
}
