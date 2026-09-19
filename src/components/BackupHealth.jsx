import { useState, useEffect, useCallback } from 'react'
import {
  LuHardDrive, LuUsb, LuChevronDown, LuCheck, LuTriangleAlert, LuCircleOff, LuBuilding,
  LuMapPin, LuFileCheck,
} from 'react-icons/lu'
import { getBackupState, onBackupDriveChange, backupToDriveNow, createDatabaseBackup } from '../database/db'
import { assessProtection } from '../utils/backupProtection'
import BackupShield from './BackupShield'
import './BackupHealth.css'

// Whether the shop's records would survive losing this computer, said on the
// dashboard rather than buried in Settings.
//
// Two things this deliberately is not:
//
//   Not a permanent green badge. Those become furniture within a week and stop
//   being read, so a protected shop gets the quiet version and the display grows
//   only as far as the real risk justifies.
//
//   Not a paragraph of text. The state is "how many places hold a copy, and where
//   are they" — which is a shape, not a sentence. The shield carries the answer at
//   a glance and the words are there for anyone who wants them.
//
// Cashiers see it only when something needs doing. They cannot set up a drive, but
// they are the ones standing at the counter who can plug one in.

const STATUS_ICON = {
  protected:        LuCheck,
  // A different mark for a copy we were told about but have never read. Same row,
  // different claim — and the icon should not pretend otherwise.
  recorded:         LuFileCheck,
  'recorded-stale': LuTriangleAlert,
  stale:            LuTriangleAlert,
  missing:          LuTriangleAlert,
  'not-set-up':     LuCircleOff,
}

const DEST_ICON = {
  computer: LuHardDrive,
  external: LuUsb,
  offsite:  LuMapPin,
}

function statusWords(d) {
  if (d.status === 'not-set-up') return d.key === 'offsite' ? 'None kept' : 'Not set up'
  if (d.status === 'missing') return 'No checked copy'
  if (d.status === 'stale') return `${d.days} days ago`
  // "Recorded" rather than "checked": the owner told us, and Stocka cannot look.
  if (d.status === 'recorded' || d.status === 'recorded-stale') {
    const when = d.days === 0 ? 'today' : d.days === 1 ? 'yesterday' : `${d.days} days ago`
    return `Recorded ${when}`
  }
  return d.days === 0 ? 'Today' : d.days === 1 ? 'Yesterday' : `${d.days} days ago`
}

function Destination({ d }) {
  const Icon = DEST_ICON[d.key] || LuHardDrive
  const Status = STATUS_ICON[d.status] || LuCircleOff
  return (
    <li className={`bkh-dest bkh-dest-${d.status}`}>
      <span className="bkh-dest-glyph"><Icon /></span>
      <span className="bkh-dest-label">{d.label}</span>
      {/* Status carries an icon and a word, never colour alone. */}
      <span className="bkh-dest-status">
        <Status className="bkh-dest-status-icon" />
        {statusWords(d)}
      </span>
    </li>
  )
}

export default function BackupHealth({ compact = false, onOpenBackups, state: given, startOpen = false }) {
  const [fetched, setFetched] = useState(null)
  const [open, setOpen] = useState(startOpen)
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState(null)

  // `given` lets a caller that already holds the backup state render this without
  // a second round trip — the Backups screen, and the preview harness used to look
  // at every state at once without having to reproduce each one for real.
  const state = given ?? fetched

  const load = useCallback(async () => {
    if (given) return
    try { setFetched(await getBackupState()) } catch { /* keep the last known state */ }
  }, [given])

  useEffect(() => {
    load()
    // The drive being plugged in is the event that changes this answer, and it
    // comes from the main process rather than from anything the user clicked.
    const off = onBackupDriveChange(() => load())
    // Backups also happen on a timer. Slow on purpose: a status line, not a meter.
    const poll = setInterval(load, 60000)
    return () => { try { off() } catch { /* already gone */ } clearInterval(poll) }
  }, [load])

  const health = assessProtection(state)

  const runAction = async () => {
    if (!health.action) return
    // Choosing a drive is a real decision with drives to compare, so it belongs on
    // the Backups screen rather than behind a one-click shortcut here.
    if ((health.action.kind === 'setup' || health.action.kind === 'offsite') && onOpenBackups) {
      onOpenBackups(); return
    }

    setBusy(true)
    setFlash(null)
    try {
      const result = health.action.kind === 'backup'
        ? await createDatabaseBackup()
        : await backupToDriveNow()

      if (result?.success) setFlash({ tone: 'ok', text: 'Done — copy made and checked.' })
      else if (result?.skipped) setFlash({ tone: 'warn', text: 'The backup drive is not connected.' })
      else setFlash({ tone: 'warn', text: result?.error || 'That did not work.' })
      await load()
    } catch (err) {
      setFlash({ tone: 'warn', text: err.message })
    } finally {
      setBusy(false)
    }
  }

  // Nothing useful to say yet, or this till is a satellite and its backups are
  // Main's business rather than its own.
  if (!state || health.level === 'unknown' || health.level === 'satellite') return null

  // A cashier's screen stays clean unless there is something to do about it.
  if (compact && health.tone === 'ok') return null

  const { held, total } = health.score
  // The "one fire takes both" warning only makes sense once there really ARE two
  // copies sitting in the same building. Shown to a shop that has no drive yet it
  // would be describing copies they do not have, on top of a panel already telling
  // them to go and get one.
  const twoCopiesOneRoom = held >= 2 &&
    health.destinations.filter((d) => d.status === 'protected').every((d) => d.where === 'here')

  // The grouping IS the lesson. Copies inside the building share one fate; the
  // whole point of the off-site copy is that it sits outside that bracket, and
  // seeing it drawn that way says more than a paragraph would.
  const here = health.destinations.filter((d) => d.where === 'here')
  const away = health.destinations.filter((d) => d.where === 'away')

  const detailPanel = (
    <div className="bkh-detail">
      <div className="bkh-group">
        <div className="bkh-group-head">
          <LuBuilding className="bkh-group-icon" />
          <span>In this shop</span>
        </div>
        <ul className="bkh-dest-list">
          {here.map((d) => <Destination key={d.key} d={d} />)}
        </ul>
        {twoCopiesOneRoom && (
          <p className="bkh-lesson">
            One fire, flood or break-in takes both of these together.
          </p>
        )}
      </div>

      {away.length > 0 && (
        <div className="bkh-group bkh-group-away">
          <div className="bkh-group-head">
            <LuMapPin className="bkh-group-icon" />
            <span>Outside the shop</span>
          </div>
          <ul className="bkh-dest-list">
            {away.map((d) => <Destination key={d.key} d={d} />)}
          </ul>
          <p className="bkh-lesson">
            {away[0].status === 'not-set-up'
              ? 'Save a copy somewhere else — your own Drive, your phone, a stick kept at home. It is the only copy that survives losing the shop.'
              : 'Recorded from what you told Stocka. Stocka cannot open this copy or check it is still there.'}
          </p>
        </div>
      )}
    </div>
  )

  // ── Protected: understated, but still shows the shape of the answer ──────────
  if (health.tone === 'ok') {
    return (
      <div className="bkh bkh-ok">
        <BackupShield held={held} total={total} tone="ok" size={26} />
        <button
          type="button"
          className="bkh-quiet"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
        >
          <span className="bkh-quiet-text">{health.detail}</span>
          <LuChevronDown className={`bkh-chevron ${open ? 'open' : ''}`} />
        </button>
        {/* Protected, but with a gap worth naming — offered, never nagged. */}
        {health.action && onOpenBackups && (
          <button type="button" className="bkh-link bkh-quiet-action" onClick={onOpenBackups}>
            {health.action.label}
          </button>
        )}
        {open && detailPanel}
      </div>
    )
  }

  return (
    <div className={`bkh bkh-${health.tone} bkh-loud`}>
      <div className="bkh-shield">
        <BackupShield held={held} total={total} tone={health.tone} size={44} />
        <span className="bkh-shield-count">{held} of {total}</span>
        <span className="bkh-shield-caption">places</span>
      </div>

      <div className="bkh-body">
        <div className="bkh-title">{health.headline}</div>
        {health.detail && <div className="bkh-text">{health.detail}</div>}

        {flash && <div className={`bkh-flash bkh-flash-${flash.tone}`}>{flash.text}</div>}

        <div className="bkh-actions">
          {health.action && (
            <button type="button" className="bkh-action" onClick={runAction} disabled={busy}>
              {busy ? 'Working…' : health.action.label}
            </button>
          )}
          {onOpenBackups && !['setup', 'offsite'].includes(health.action?.kind) && (
            <button type="button" className="bkh-link" onClick={onOpenBackups}>
              Backup settings
            </button>
          )}
          <button
            type="button"
            className="bkh-toggle"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
          >
            {open ? 'Hide detail' : 'Where are my copies?'}
            <LuChevronDown className={`bkh-chevron ${open ? 'open' : ''}`} />
          </button>
        </div>

        {open && detailPanel}
      </div>
    </div>
  )
}
