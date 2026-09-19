import { useState, useEffect, useCallback, useRef } from 'react'
import {
  FiHardDrive, FiSave, FiUpload, FiDownload, FiRefreshCw, FiCheck, FiCheckCircle,
  FiAlertTriangle, FiShield, FiChevronDown, FiMapPin, FiX,
} from 'react-icons/fi'
import {
  getBackupHistory, getBackupState, createDatabaseBackup, restoreFromBackup,
  listBackupDrives, setBackupDrive, forgetBackupDrive, backupToDriveNow, onBackupDriveChange,
  exportOffsiteBackup, recordOffsiteCopy, forgetOffsiteRecord, restoreFromBackupFile,
} from '../database/db'
import { assessProtection } from '../utils/backupProtection'
import { toast } from '../store/useToastStore'
import BackupShield from './BackupShield'
import Modal from './Modal'
import ConfirmModal from './ConfirmModal'
import './BackupsPanel.css'

// The Backups screen.
//
// It used to open on a card of local backups with the drive and the off-site copy
// below it, which meant the two things that actually decide whether a shop survives
// losing its computer were underneath a scrolling list of filenames. An owner
// looking at this page could reasonably conclude Stocka had no such features.
//
// So the order now follows the question rather than the implementation: where do my
// copies live, which one needs attention, and what do I press. The history is
// reference material and sits at the bottom, folded away.
//
// The three places are shown as tiles, grouped by whether they are in the building,
// because that grouping is the one thing a shopkeeper cannot work out for
// themselves: a stick in the drawer next to the till is not protection against the
// shop burning down.

const TILE_ICON = {
  computer: FiHardDrive,
  external: FiSave,
  offsite:  FiMapPin,
}

// Plain words for each state. No jargon, and never colour on its own.
function tileStatus(d) {
  switch (d.status) {
    case 'protected':       return { text: d.days === 0 ? 'Copied today' : d.days === 1 ? 'Copied yesterday' : `Copied ${d.days} days ago`, tone: 'ok' }
    case 'recorded':        return { text: d.days === 0 ? 'You saved one today' : `You saved one ${d.days} days ago`, tone: 'ok' }
    case 'recorded-stale':  return { text: `Last saved ${d.days} days ago`, tone: 'warn' }
    case 'stale':           return { text: `${d.days} days out of date`, tone: 'warn' }
    case 'missing':         return { text: 'No copy yet', tone: 'warn' }
    default:                return { text: d.key === 'offsite' ? 'Nothing kept outside' : 'Not set up', tone: 'warn' }
  }
}

export default function BackupsPanel({ flash, refreshToken = 0 }) {
  const [state, setState]     = useState(null)
  const [backups, setBackups] = useState([])
  // `open` is now only the inline disclosure. Anything the user needs to ACT on
  // is a modal — expanding a card below the fold looked, from the chair, exactly
  // like the button having done nothing at all.
  const [open, setOpen]       = useState(null)   // 'history' | null
  const [driveOpen, setDriveOpen]         = useState(false)
  const [offsitePrompt, setOffsitePrompt] = useState(null)   // null | { filename }
  const [confirm, setConfirm]             = useState(null)   // null | { ...ConfirmModal props }

  const [drives, setDrives]               = useState([])
  const [loadingDrives, setLoadingDrives] = useState(false)
  const [busy, setBusy]                   = useState(null)   // which action is running
  const [offsiteWhere, setOffsiteWhere]   = useState('')
  const [lastExport, setLastExport]       = useState(null)
  const whereInputRef = useRef(null)

  const load = useCallback(async () => {
    try { setState(await getBackupState()) } catch { /* keep last known */ }
    try { setBackups(await getBackupHistory()) } catch { /* keep last known */ }
  }, [])

  useEffect(() => { load() }, [load, refreshToken])

  // The drive being plugged in is the event that changes this page, and it comes
  // from the main process rather than from anything the user pressed here.
  // Refreshing the list while the modal is open is the nice bit: the drive is
  // plugged in while the person is looking straight at the picker. Read through a
  // ref so the subscription is not torn down and rebuilt every time it opens.
  const driveOpenRef = useRef(false)
  driveOpenRef.current = driveOpen

  useEffect(() => onBackupDriveChange(() => {
    load()
    if (driveOpenRef.current) loadDrives()
  }), [load])

  const health = assessProtection(state)
  const ext     = state?.external
  const offsite = state?.offsite

  const run = async (key, fn, okMessage) => {
    setBusy(key)
    try {
      const res = await fn()
      if (res?.canceled) return res
      // No message means the caller says it better itself — an export, a restore
      // and a drive setup all follow up with something specific. Flashing a
      // generic "Done." as well produced two toasts for one action.
      if (res?.success) { if (okMessage) flash('success', okMessage) }
      else if (res?.skipped) flash('error', 'The backup drive is not connected.')
      else flash('error', res?.error || 'That did not work.')
      await load()
      return res
    } catch (err) {
      flash('error', err.message)
      return null
    } finally { setBusy(null) }
  }

  const loadDrives = async () => {
    setLoadingDrives(true)
    try { setDrives(await listBackupDrives()) }
    catch (err) { flash('error', 'Could not list drives: ' + err.message) }
    finally { setLoadingDrives(false) }
  }

  const openDrivePicker = () => { setDriveOpen(true); loadDrives() }

  const handleUseDrive = async (drive) => {
    const res = await run('setDrive', () => setBackupDrive(drive.letter, `${drive.label} (${drive.letter})`), null)
    if (res?.success) {
      if (res.backup?.success) flash('success', 'Backup drive set up. A copy is on the drive now and has been checked.')
      else flash('error', 'Drive set up, but the first copy failed: ' + (res.backup?.error || 'unknown error'))
      setDriveOpen(false)
    }
  }

  const handleExport = async () => {
    const res = await run('export', exportOffsiteBackup, null)
    if (res?.success) {
      setLastExport(res.filename)
      // Short toast; the modal carries the instructions. Writing the file is only
      // half of it — the half Stocka can do.
      toast.success('Copy saved and checked.')
      setOffsitePrompt({ filename: res.filename })
    }
  }

  const handleRecord = async () => {
    await run('record', () => recordOffsiteCopy({ where: offsiteWhere.trim() || null, filename: lastExport }), 'Noted — Stocka has recorded that you kept a copy outside the shop.')
    setOffsiteWhere('')
    setOffsitePrompt(null)
  }

  // Restores go through the app's own confirm dialog rather than the browser's.
  // window.confirm in Electron is an OS-native box that looks nothing like Stocka
  // and blocks the renderer while it is up.
  const doRestore = async (filename) => {
    setConfirm(null)
    const res = await run('restore', () => restoreFromBackup(filename), null)
    if (res?.success) {
      flash('success', 'Records restored. Your previous records were saved as ' + res.safetyCopy + '. Reloading...')
      setTimeout(() => window.location.reload(), 3000)
    }
  }

  const handleRestore = (filename) => setConfirm({
    message: 'Restore this backup?',
    detail: 'Your current records will be replaced by the state saved in this backup. Anything recorded since then will no longer be in Stocka. A copy of your current records is saved first, so this can be undone.',
    confirmLabel: 'Restore',
    danger: true,
    onConfirm: () => doRestore(filename),
  })

  const doRestoreFile = async () => {
    setConfirm(null)
    const res = await run('restoreFile', restoreFromBackupFile, null)
    if (res?.success) {
      flash('success', 'Records restored from ' + res.restored + '. Your previous records were saved as ' + res.safetyCopy + '. Reloading...')
      setTimeout(() => window.location.reload(), 3000)
    }
  }

  const handleRestoreFile = () => setConfirm({
    message: 'Restore from a backup file?',
    detail: 'Your current records will be replaced by whatever is in the file you choose. A copy of your current records is saved first, so this can be undone.',
    confirmLabel: 'Choose a File...',
    danger: true,
    onConfirm: doRestoreFile,
  })

  if (state?.isSatellite) {
    return (
      <div className="s-card">
        <div className="s-card-head">
          <div>
            <h2 className="s-card-title"><FiShield size={17} /> Backups</h2>
            <p className="s-card-desc">
              This till keeps a copy of the Main computer&apos;s records so it can keep selling when
              the network is down. The backups for the shop are taken on the Main computer — set the
              backup drive up there.
            </p>
          </div>
        </div>
      </div>
    )
  }

  if (!state) {
    return <div className="s-card"><p className="s-card-desc">Checking your backups…</p></div>
  }

  const here = health.destinations.filter((d) => d.where === 'here')
  const away = health.destinations.filter((d) => d.where === 'away')

  // Per-tile action, so every tile answers "what do I press" on its own.
  const tileAction = (d) => {
    if (d.key === 'computer') {
      return { label: 'Back Up Now', busyKey: 'local', onClick: () => run('local', createDatabaseBackup, 'Backup created and checked.') }
    }
    if (d.key === 'external') {
      if (!ext?.configured) return { label: 'Set Up Drive', onClick: openDrivePicker }
      if (ext.connected) return { label: 'Copy Now', busyKey: 'external', onClick: () => run('external', backupToDriveNow, 'Copy made to the drive and checked.') }
      return { label: 'Change Drive', onClick: openDrivePicker, quiet: true }
    }
    return { label: 'Save a Copy', busyKey: 'export', onClick: handleExport }
  }

  const Tile = ({ d }) => {
    const Icon = TILE_ICON[d.key]
    const status = tileStatus(d)
    const action = tileAction(d)
    return (
      <div className={`bp-tile bp-tile-${status.tone}`}>
        <div className="bp-tile-top">
          <span className="bp-tile-icon"><Icon size={15} /></span>
          <span className="bp-tile-name">{d.label}</span>
        </div>
        <div className="bp-tile-status">
          {status.tone === 'ok'
            ? <FiCheckCircle size={12} className="bp-tile-status-icon" />
            : <FiAlertTriangle size={12} className="bp-tile-status-icon" />}
          {status.text}
        </div>
        <div className="bp-tile-note">
          {d.key === 'computer'   && 'Survives a damaged database. Lost with the computer.'}
          {d.key === 'external'   && (ext?.connected ? 'Plugged in — copies happen on their own.' : 'Plug it in and Stocka copies to it automatically.')}
          {d.key === 'offsite'    && 'The only copy that survives losing the shop.'}
        </div>
        <button
          className={action.quiet ? 'bp-tile-btn bp-tile-btn-quiet' : 'bp-tile-btn'}
          onClick={action.onClick}
          disabled={action.busyKey ? busy === action.busyKey : false}
        >
          {action.busyKey && busy === action.busyKey ? 'Working…' : action.label}
        </button>
      </div>
    )
  }

  return (
    <>
      {/* ── What is happening, before anything else ── */}
      <div className={`s-card bp-summary bp-summary-${health.tone}`}>
        <div className="bp-summary-head">
          <div className="bp-summary-shield">
            <BackupShield held={health.score.held} total={health.score.total} tone={health.tone} size={52} />
            <span className="bp-summary-count">{health.score.held} of {health.score.total}</span>
            <span className="bp-summary-caption">places</span>
          </div>
          <div className="bp-summary-words">
            <h2 className="bp-summary-title">{health.headline}</h2>
            <p className="bp-summary-detail">{health.detail}</p>
            {health.local?.lastError}
          </div>
        </div>

        <div className="bp-group-label">In this shop</div>
        <div className="bp-tiles">{here.map((d) => <Tile key={d.key} d={d} />)}</div>
        {here.filter((d) => d.status === 'protected').length >= 2 && (
          <p className="bp-lesson">
            <FiAlertTriangle size={12} /> Both of these are in the same building. One fire, flood or
            break-in takes them together.
          </p>
        )}

        <div className="bp-group-label bp-group-label-away">Outside the shop</div>
        <div className="bp-tiles">{away.map((d) => <Tile key={d.key} d={d} />)}</div>

        {/* Recorded on your word, so it stays editable without having to export
            another file first. */}
        {offsite?.recorded && (
          <p className="bp-recorded">
            <span>
              Recorded {new Date(offsite.recordedAt).toLocaleDateString()}
              {offsite.recordedWhere ? ` — ${offsite.recordedWhere}` : ''}
            </span>
            <button className="bp-recorded-link" onClick={() => {
              setOffsiteWhere(offsite.recordedWhere || '')
              setOffsitePrompt({ filename: null })
            }}>Change</button>
            <button className="bp-recorded-link" onClick={() =>
              run('forgetOffsite', forgetOffsiteRecord, 'Cleared.')}>Clear</button>
          </p>
        )}
      </div>

      {/* ── Choosing a drive — a modal, because the old inline card opened
             below the fold and looked exactly like nothing happening ── */}
      <Modal
        open={driveOpen}
        size="medium"
        title="Choose a Backup Drive"
        subtitle="Plug in a USB stick or an external drive and pick it below. Stocka will copy to it every time you plug it in from then on."
        onClose={() => setDriveOpen(false)}
        footer={
          <>
            {ext?.configured && (
              <button className="smodal-btn-away"
                onClick={() => run('forgetDrive', forgetBackupDrive, 'Stocka will no longer copy to that drive.')}>
                Stop Using Current Drive
              </button>
            )}
            <button onClick={loadDrives} disabled={loadingDrives}>
              <FiRefreshCw size={13} /> {loadingDrives ? 'Looking...' : 'Look Again'}
            </button>
            <button onClick={() => setDriveOpen(false)}>Close</button>
          </>
        }
      >
        {drives.length === 0 ? (
          <div className="s-empty">
            <div className="s-empty-icon"><FiSave size={30} /></div>
            <p>No drives found. Plug one in and Stocka will spot it — or press Look Again.</p>
          </div>
        ) : drives.map((drive) => (
          <div key={drive.letter} className="s-backup-row">
            <div className="s-backup-icon"><FiSave size={15} /></div>
            <div className="s-backup-info">
              <div className="s-backup-date">
                {drive.label} ({drive.letter})
                {drive.isBackupDrive && <span className="s-backup-tag">Already set up</span>}
              </div>
              <div className="s-backup-size">{(drive.freeBytes / 1073741824).toFixed(1)} GB free</div>
            </div>
            <div className="s-btn-row">
              <button className="smodal-btn smodal-btn-primary" onClick={() => handleUseDrive(drive)} disabled={busy === 'setDrive'}>
                {busy === 'setDrive' ? 'Setting up...' : 'Use This Drive'}
              </button>
            </div>
          </div>
        ))}
      </Modal>

      {/* ── After the file is written: what to actually do with it ──
             Writing the file is the half Stocka can do. This modal is the half it
             cannot, so it says so plainly and carries the field for recording it,
             instead of leaving that buried at the bottom of the page. ── */}
      <Modal
        open={!!offsitePrompt}
        size="medium"
        title={offsitePrompt?.filename ? 'Now put this copy outside the shop' : 'Where is your copy kept?'}
        subtitle="Stocka never uploads anything itself — this last step is yours."
        onClose={() => setOffsitePrompt(null)}
        initialFocusRef={whereInputRef}
        footer={
          <>
            <button className="smodal-btn-away" onClick={() => setOffsitePrompt(null)}>
              I&apos;ll do this later
            </button>
            <button className="smodal-btn-primary" onClick={handleRecord} disabled={busy === 'record'}>
              <FiCheck size={14} /> {busy === 'record' ? 'Saving...' : "I've Saved It"}
            </button>
          </>
        }
      >
        {offsitePrompt?.filename && (
          <>
            <p className="bp-offsite-file">
              Saved as <code className="s-code">{offsitePrompt.filename}</code>
            </p>
            <ol className="bp-offsite-steps">
              <li>Open the folder you just saved it to.</li>
              <li>
                Put the file somewhere that is <strong>not this building</strong> — upload it to your
                own Google Drive, email it to yourself, or copy it onto a stick you keep at home.
              </li>
              <li>Come back here and note where you put it.</li>
            </ol>
          </>
        )}

        <label className="s-offsite-label" htmlFor="bp-offsite-where">Where did you put it?</label>
        <input
          ref={whereInputRef}
          id="bp-offsite-where"
          className="s-input"
          type="text"
          value={offsiteWhere}
          onChange={(e) => setOffsiteWhere(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleRecord() }}
          placeholder="e.g. My Google Drive"
          maxLength={60}
        />
        <p className="s-offsite-note">
          This only records what you tell it. Stocka cannot open your Google Drive and has no way to
          check the copy is still there.
        </p>
      </Modal>


      {/* ── History: reference material, folded away ── */}
      <div className="s-card">
        <button className="bp-history-toggle" onClick={() => setOpen(open === 'history' ? null : 'history')}>
          <FiHardDrive size={15} />
          <span className="bp-history-label">
            Backup history
            <span className="bp-history-count">{backups.length} {backups.length === 1 ? 'copy' : 'copies'} on this computer</span>
          </span>
          <FiChevronDown size={15} className={`bp-history-chevron ${open === 'history' ? 'open' : ''}`} />
        </button>

        {open === 'history' && (
          <>
            <div className="s-btn-row" style={{ margin: '4px 0 14px' }}>
              <button className="s-btn-secondary s-btn-sm" onClick={handleRestoreFile} disabled={busy === 'restoreFile'}>
                <FiUpload size={11} /> Restore from a File…
              </button>
            </div>

            {backups.length === 0 ? (
              <div className="s-empty">
                <div className="s-empty-icon"><FiHardDrive size={30} /></div>
                <p>No backups yet.</p>
              </div>
            ) : backups.map((backup) => (
              <div key={backup.filename} className="s-backup-row">
                <div className="s-backup-icon"><FiHardDrive size={15} /></div>
                <div className="s-backup-info">
                  <div className="s-backup-date">
                    {new Date(backup.createdAt).toLocaleDateString()} · {new Date(backup.createdAt).toLocaleTimeString()}
                    {backup.kind === 'safety' && <span className="s-backup-tag">Safety copy</span>}
                  </div>
                  <div className="s-backup-size">
                    {(backup.sizeBytes / 1024).toFixed(1)} KB
                    {backup.verified
                      ? <span className="s-backup-verified"><FiCheckCircle size={11} /> Checked</span>
                      : <span className="s-backup-unverified">Not checked</span>}
                  </div>
                </div>
                <div className="s-btn-row">
                  <button className="s-btn-danger s-btn-sm" onClick={() => handleRestore(backup.filename)} disabled={busy === 'restore'}>
                    <FiUpload size={11} /> Restore
                  </button>
                </div>
              </div>
            ))}
          </>
        )}
      </div>

      {confirm && (
        <ConfirmModal
          {...confirm}
          onCancel={() => setConfirm(null)}
          busy={busy === 'restore' || busy === 'restoreFile'}
        />
      )}

      {/* Said once, at the bottom, where it reassures rather than interrupts. */}
      <p className="bp-footnote">
        <FiShield size={12} /> Stocka backs itself up on its own — after sales, at the end of the day,
        and when it closes. Every copy is opened and checked before it counts. Nothing is ever
        uploaded anywhere.
      </p>
    </>
  )
}
