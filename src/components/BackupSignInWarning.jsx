import { useState, useEffect, useRef } from 'react'
import { LuTriangleAlert, LuUsb } from 'react-icons/lu'
import { getBackupState } from '../database/db'
import { assessProtection, ATTENTION_DAYS } from '../utils/backupProtection'
import BackupShield from './BackupShield'
import './BackupSignInWarning.css'

// The one place backup neglect cannot be scrolled past.
//
// A dashboard strip is honest but passive: the person who most needs to see it is
// often the one who never looks at the dashboard. This appears once per sign-in,
// and only when there is something to do about it — which is the whole design.
//
// THE RULE THIS MUST NEVER BREAK: there is always a way through. The shop's
// financial records stay reachable no matter how old the backup is. Software that
// holds a bursar's ledger hostage over a forgotten USB stick has stopped being a
// tool and started being an obstacle, and the first thing anyone learns is to
// click past it — which destroys the warning's value on the day it matters.
//
// So the escalation is in the words and the weight, never in the exit:
//
//   under 3 days   nothing here at all; the dashboard strip carries it
//   3 to 6 days    a warning, plainly worded, easy to dismiss
//   7 days or more the same dialog with the real consequence spelled out
//
// Shown to everyone, including cashiers, and on satellites it reports MAIN's
// health. The cashier cannot set a drive up, but they stand at the counter all day
// and they are the person who can plug one in.

const SEEN_KEY = 'stocka_backup_warned'

export default function BackupSignInWarning({ user, onOpenBackups }) {
  const [health, setHealth] = useState(null)
  const [visible, setVisible] = useState(false)
  const dismissRef = useRef(null)

  useEffect(() => {
    if (!user?.username) return
    let cancelled = false

    ;(async () => {
      // Once per sign-in per person: a second cashier taking over the till gets
      // their own look at it, the same person signing back in after lunch does not.
      const stamp = `${user.username}:${new Date().toDateString()}`
      let alreadySeen = false
      try { alreadySeen = sessionStorage.getItem(SEEN_KEY) === stamp } catch { /* private mode */ }
      if (alreadySeen) return

      let state = null
      try { state = await getBackupState() } catch { /* fall through */ }

      // On a satellite, its own backups are meaningless — ask Main. If Main cannot
      // be reached we say nothing at all, rather than guess in either direction.
      if (state?.isSatellite) {
        try { state = await window.stocka?.lan?.getMainBackupHealth?.() } catch { state = null }
        if (!state) return
      }
      if (cancelled || !state) return

      const assessed = assessProtection(state)
      const worthInterrupting =
        assessed.tone === 'critical' ||
        (assessed.tone === 'warn' && (assessed.externalAgeDays ?? 0) >= ATTENTION_DAYS) ||
        assessed.level === 'none'

      if (!worthInterrupting) return

      setHealth(assessed)
      setVisible(true)
      try { sessionStorage.setItem(SEEN_KEY, stamp) } catch { /* private mode */ }
    })()

    return () => { cancelled = true }
  }, [user?.username])

  // These tills are keyboard-and-mouse, with no touchscreen, so the dialog has to
  // be resolvable without reaching for the mouse at all.
  useEffect(() => {
    if (!visible) return
    dismissRef.current?.focus()
    const onKey = (e) => {
      if (e.key === 'Escape' || e.key === 'Enter') { e.preventDefault(); setVisible(false) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [visible])

  if (!visible || !health) return null

  const critical = health.tone === 'critical'
  const { held, total } = health.score

  return (
    <div className="bsw-backdrop" role="dialog" aria-modal="true" aria-labelledby="bsw-title">
      <div className={`bsw ${critical ? 'bsw-critical' : 'bsw-warn'}`}>
        <div className="bsw-head">
          <BackupShield held={held} total={total} tone={health.tone} size={46} />
          <div>
            <h2 className="bsw-title" id="bsw-title">
              {critical ? 'Your records are at risk' : 'Your backup needs attention'}
            </h2>
            <p className="bsw-headline">{health.headline}</p>
          </div>
        </div>

        <p className="bsw-detail">{health.detail}</p>

        {/* Says what to actually do, in the order a person would do it. */}
        <div className="bsw-what">
          <LuUsb className="bsw-what-icon" />
          <span>
            Plug the backup drive into this computer. Stocka copies to it on its own
            and checks the copy afterwards — there is nothing else to press.
          </span>
        </div>

        {critical && (
          <p className="bsw-consequence">
            <LuTriangleAlert className="bsw-consequence-icon" />
            Nothing is wrong with Stocka. This is about what would happen if this
            computer were stolen, dropped or stopped working today.
          </p>
        )}

        <div className="bsw-actions">
          {/* Always present, always reachable by keyboard, never hidden behind a
              delay or a countdown. The records belong to the shop. */}
          <button
            type="button"
            className="bsw-continue"
            ref={dismissRef}
            onClick={() => setVisible(false)}
          >
            Continue to Stocka
          </button>
          {onOpenBackups && (
            <button
              type="button"
              className="bsw-settings"
              onClick={() => { setVisible(false); onOpenBackups() }}
            >
              Open backup settings
            </button>
          )}
        </div>

        <p className="bsw-hint">Press Enter or Esc to continue.</p>
      </div>
    </div>
  )
}
