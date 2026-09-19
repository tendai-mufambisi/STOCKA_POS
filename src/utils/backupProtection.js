// Turns raw backup state into the one question a shopkeeper actually has:
// "if this computer died right now, what would I lose?"
//
// Every surface that talks about backup protection reads this — the dashboard
// strip, the Backups screen, and the sign-in warning. One function so they cannot
// drift into telling the owner three different stories about the same state.
//
// The levels are deliberately about WHERE the copies are, not about a score:
//
//   strong  copies here AND a copy recorded outside the building
//   good    copies on this computer AND on an external drive, both recent — but
//           both in the same room, so one fire is still one disaster
//   basic   copies on this computer only — survives a corrupt database, does not
//           survive the computer being stolen or dying
//   none    nothing verified anywhere
//
// The off-site tier is counted but never called verified. Stocka writes the file
// and the shop carries it out; after that it cannot see it, re-read it or notice it
// being deleted. So an off-site copy is RECORDED on the owner's word, and the
// wording everywhere downstream has to keep that distinction intact.

export const ATTENTION_DAYS = 3   // external copy older than this: say so on the dashboard
export const CRITICAL_DAYS  = 7   // older than this: it is the loudest thing on screen
// Taking a copy out of the building is a deliberate errand, not a daily habit, so
// this is measured in weeks. Nagging about it weekly would train people to ignore
// the strip that matters on the day the shop floods.
export const OFFSITE_STALE_DAYS = 30

const DAY_MS = 86400000

export function daysSince(iso, now = Date.now()) {
  if (!iso) return null
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return null
  return Math.max(0, Math.floor((now - then) / DAY_MS))
}

// "today" / "yesterday" / "6 days ago" — how a person says it, not a timestamp.
export function describeAge(iso, now = Date.now()) {
  const days = daysSince(iso, now)
  if (days === null) return 'never'
  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  return `${days} days ago`
}

function destination(key, label, at, staleDays, now, where) {
  const days = daysSince(at, now)
  let status = 'missing'
  if (days !== null) status = days >= staleDays ? 'stale' : 'protected'
  // `where` is the physical place the copy lives. Two copies in the same building
  // are one flood, one fire, one burglary — the interface has to be able to say so,
  // which means it has to know.
  return { key, label, at, status, days, where }
}

// How many places currently hold a recent, checked copy, out of how many Stocka
// can offer. Drives the shield: it is a count of real places, never an invented
// percentage, so "half full" always means something a person can point at.
const HOLDS_A_COPY = new Set(['protected', 'recorded'])

function score(destinations) {
  return {
    held: destinations.filter((d) => HOLDS_A_COPY.has(d.status)).length,
    total: destinations.length,
  }
}

/**
 * @param state the object from db:backup-state — { local, external, isSatellite }
 * @returns a description of how protected this shop's records are right now
 */
export function assessProtection(state, now = Date.now()) {
  if (!state) {
    return {
      level: 'unknown', tone: 'neutral',
      headline: 'Checking your backups…',
      detail: null, action: null, destinations: [], externalAgeDays: null, score: { held: 0, total: 0 },
    }
  }

  // A satellite's database is a partial mirror of Main's, so it is not the thing
  // being protected and saying anything about its backups would be misleading.
  if (state.isSatellite) {
    return {
      level: 'satellite', tone: 'neutral',
      headline: 'Backups are handled on the Main computer',
      detail: 'This till keeps a copy of the Main computer\'s records for working offline. The backups are taken there.',
      action: null, destinations: [], externalAgeDays: null, score: { held: 0, total: 0 },
    }
  }

  const local = state.local || {}
  const external = state.external || {}

  const computer = destination('computer', 'This computer', local.lastVerifiedAt, ATTENTION_DAYS, now, 'here')
  const drive = external.configured
    ? destination('external', external.driveLabel || 'Backup drive', external.lastVerifiedAt, ATTENTION_DAYS, now, 'here')
    : { key: 'external', label: 'Backup drive', at: null, status: 'not-set-up', days: null, where: 'here' }

  const offsiteState = state.offsite || {}
  const offsiteDays = daysSince(offsiteState.recordedAt, now)
  const offsite = offsiteState.recorded
    ? {
        key: 'offsite',
        label: offsiteState.recordedWhere || 'Off-site copy',
        at: offsiteState.recordedAt,
        // 'recorded' is its own status, never 'protected' — the UI must be able to
        // word it differently, because we are repeating what we were told.
        status: offsiteDays >= OFFSITE_STALE_DAYS ? 'recorded-stale' : 'recorded',
        days: offsiteDays,
        where: 'away',
      }
    : { key: 'offsite', label: 'Off-site copy', at: null, status: 'not-set-up', days: null, where: 'away' }

  const destinations = [computer, drive, offsite]
  const externalAgeDays = drive.days
  const held = score(destinations)

  // Nothing verified anywhere. Either a brand new shop or something is badly
  // wrong; both deserve the loudest state.
  if (!local.lastVerifiedAt) {
    return {
      level: 'none', tone: 'critical',
      headline: 'No backup has been made yet',
      detail: local.lastError
        ? `Stocka could not complete a backup: ${local.lastError}`
        : 'Your records exist in only one place. Make a backup now.',
      action: { label: 'Back Up Now', kind: 'backup' },
      destinations, externalAgeDays, score: held,
    }
  }

  // The external drive is the whole point of the exercise — it is the copy that
  // survives losing the computer. Not having one is worth saying plainly, but it
  // is not an emergency, so it does not get the critical treatment.
  if (!external.configured) {
    return {
      level: 'basic', tone: 'warn',
      headline: 'Your records are only on this computer',
      detail: 'Backups are being made and checked, but they are on the same computer as the records themselves. Set up a USB stick or external drive so a copy survives if this computer is lost or stops working.',
      action: { label: 'Set Up Backup Drive', kind: 'setup' },
      destinations, externalAgeDays, score: held,
    }
  }

  const days = externalAgeDays

  if (days === null) {
    return {
      level: 'basic', tone: 'warn',
      headline: 'No copy has reached your backup drive yet',
      detail: external.connected
        ? 'The drive is connected. Make the first copy now.'
        : 'Connect the backup drive and Stocka will copy to it automatically.',
      action: external.connected
        ? { label: 'Copy Now', kind: 'copy' }
        : { label: 'Connect Backup Drive', kind: 'connect' },
      destinations, externalAgeDays, score: held,
    }
  }

  if (days >= CRITICAL_DAYS) {
    return {
      level: 'basic', tone: 'critical',
      headline: `Your backup drive is ${days} days out of date`,
      detail: `Everything recorded in the last ${days} days is only on this computer. If it were lost or stopped working, that trading would go with it.`,
      action: external.connected
        ? { label: 'Copy Now', kind: 'copy' }
        : { label: 'Connect Backup Drive', kind: 'connect' },
      destinations, externalAgeDays, score: held,
    }
  }

  if (days >= ATTENTION_DAYS) {
    return {
      level: 'basic', tone: 'warn',
      headline: `Your backup drive was last updated ${describeAge(external.lastVerifiedAt, now)}`,
      detail: external.connected
        ? 'The drive is connected — a copy can be made now.'
        : 'Connect the backup drive to bring it up to date.',
      action: external.connected
        ? { label: 'Copy Now', kind: 'copy' }
        : { label: 'Connect Backup Drive', kind: 'connect' },
      destinations, externalAgeDays, score: held,
    }
  }

  // Both destinations recent. A failed local attempt still gets said out loud,
  // because "protected" must never be printed over a known failure.
  if (local.lastError) {
    return {
      level: 'good', tone: 'warn',
      headline: 'Your last backup did not finish',
      detail: `${local.lastError} Your most recent checked backup is from ${describeAge(local.lastVerifiedAt, now)}.`,
      action: { label: 'Back Up Now', kind: 'backup' },
      destinations, externalAgeDays, score: held,
    }
  }

  // Both copies here are current. Whether that is the end of the story depends on
  // whether anything has left the building.
  if (offsite.status === 'recorded') {
    return {
      level: 'strong', tone: 'ok',
      headline: 'Your records are protected',
      detail: `Copies on this computer and on your backup drive, both checked, and a copy kept outside the shop ${describeAge(offsiteState.recordedAt, now)}.`,
      action: null,
      destinations, externalAgeDays, score: held,
    }
  }

  // Deliberately not a warning. Two current, checked copies is a good place to be,
  // and a shop that never takes a file off the premises should not be scolded daily
  // for it. But the sentence names the gap, because it is the one the owner cannot
  // see: both copies are in the same room.
  return {
    level: 'good', tone: 'ok',
    headline: 'Your records are protected',
    detail: offsite.status === 'recorded-stale'
      ? `Copies on this computer and on your backup drive, both checked. Your last copy outside the shop was ${describeAge(offsiteState.recordedAt, now)}.`
      : `Copies on this computer and on your backup drive, both checked. Both are here in the shop — keeping one somewhere else protects against fire and theft.`,
    action: { label: 'Save a Copy Off-site', kind: 'offsite' },
    destinations, externalAgeDays, score: held,
  }
}
