import { describe, it, expect } from 'vitest'
import {
  assessProtection, describeAge, daysSince,
  ATTENTION_DAYS, CRITICAL_DAYS, OFFSITE_STALE_DAYS,
} from '../../src/utils/backupProtection.js'

const NOW = new Date('2026-09-19T12:00:00Z').getTime()
const daysAgo = (n) => new Date(NOW - n * 86400000).toISOString()

// A shop in the healthy case, which each test then breaks in one specific way.
const healthy = () => ({
  isSatellite: false,
  local: { lastVerifiedAt: daysAgo(0), lastError: null },
  external: { configured: true, connected: false, driveLabel: 'KINGSTON (E:)', lastVerifiedAt: daysAgo(0) },
})

describe('age wording', () => {
  it('counts whole days', () => {
    expect(daysSince(daysAgo(0), NOW)).toBe(0)
    expect(daysSince(daysAgo(5), NOW)).toBe(5)
  })

  it('never reports a negative age when a clock runs backwards', () => {
    // Shop computers have their clocks corrected, and "-2 days ago" would make
    // the whole panel look broken.
    expect(daysSince(new Date(NOW + 86400000).toISOString(), NOW)).toBe(0)
  })

  it('says it the way a person would', () => {
    expect(describeAge(daysAgo(0), NOW)).toBe('today')
    expect(describeAge(daysAgo(1), NOW)).toBe('yesterday')
    expect(describeAge(daysAgo(6), NOW)).toBe('6 days ago')
    expect(describeAge(null, NOW)).toBe('never')
  })

  it('survives a corrupt timestamp', () => {
    expect(daysSince('not-a-date', NOW)).toBeNull()
  })
})

describe('protected', () => {
  it('reports good when both copies here are recent', () => {
    const result = assessProtection(healthy(), NOW)
    expect(result.level).toBe('good')
    expect(result.tone).toBe('ok')
  })

  it('offers an off-site copy without treating its absence as a problem', () => {
    // Two current checked copies is a good place to be. A shop that has never
    // carried a file out of the building should be told what the gap is, once,
    // not scolded for it every morning.
    const result = assessProtection(healthy(), NOW)
    expect(result.tone).toBe('ok')
    expect(result.action.kind).toBe('offsite')
    expect(result.detail).toMatch(/both are here in the shop/i)
  })

  it('never prints "protected" over a known failure', () => {
    // The whole point of verification is undone if a failed attempt still shows
    // green because an older backup happens to exist.
    const state = healthy()
    state.local.lastError = 'Disk full.'
    const result = assessProtection(state, NOW)

    expect(result.tone).toBe('warn')
    expect(result.headline).toMatch(/did not finish/i)
    expect(result.detail).toContain('Disk full.')
  })
})

describe('no drive set up', () => {
  it('says the records are only on this computer', () => {
    const state = healthy()
    state.external = { configured: false }
    const result = assessProtection(state, NOW)

    expect(result.level).toBe('basic')
    expect(result.tone).toBe('warn')
    expect(result.action.kind).toBe('setup')
  })

  it('does not treat a missing drive as an emergency', () => {
    // A shop that has never set one up is not in crisis; shouting at them every
    // day teaches them to ignore the strip that will matter later.
    const state = healthy()
    state.external = { configured: false }
    expect(assessProtection(state, NOW).tone).not.toBe('critical')
  })
})

describe('escalation as the external copy ages', () => {
  const atAge = (days) => {
    const state = healthy()
    state.external.lastVerifiedAt = daysAgo(days)
    return assessProtection(state, NOW)
  }

  it('stays quiet for the first couple of days', () => {
    expect(atAge(0).tone).toBe('ok')
    expect(atAge(ATTENTION_DAYS - 1).tone).toBe('ok')
  })

  it('asks for attention from day three', () => {
    expect(atAge(ATTENTION_DAYS).tone).toBe('warn')
    expect(atAge(CRITICAL_DAYS - 1).tone).toBe('warn')
  })

  it('becomes critical at a week', () => {
    expect(atAge(CRITICAL_DAYS).tone).toBe('critical')
    expect(atAge(30).tone).toBe('critical')
  })

  it('says what is actually at stake rather than scolding', () => {
    const result = atAge(9)
    expect(result.headline).toContain('9 days')
    expect(result.detail).toMatch(/only on this computer/i)
  })

  it('offers to copy when the drive is plugged in, and to connect it when not', () => {
    const connected = healthy()
    connected.external.lastVerifiedAt = daysAgo(5)
    connected.external.connected = true
    expect(assessProtection(connected, NOW).action.kind).toBe('copy')

    const away = healthy()
    away.external.lastVerifiedAt = daysAgo(5)
    away.external.connected = false
    expect(assessProtection(away, NOW).action.kind).toBe('connect')
  })
})

describe('nothing backed up at all', () => {
  it('is the loudest state', () => {
    const result = assessProtection({ local: {}, external: { configured: false } }, NOW)
    expect(result.level).toBe('none')
    expect(result.tone).toBe('critical')
    expect(result.action.kind).toBe('backup')
  })

  it('surfaces the reason when backups are failing', () => {
    const result = assessProtection(
      { local: { lastError: 'Access is denied.' }, external: { configured: false } },
      NOW
    )
    expect(result.detail).toContain('Access is denied.')
  })
})

describe('a drive set up but never used', () => {
  it('asks for the first copy', () => {
    const state = healthy()
    state.external = { configured: true, connected: true, lastVerifiedAt: null }
    const result = assessProtection(state, NOW)

    expect(result.tone).toBe('warn')
    expect(result.action.kind).toBe('copy')
  })
})

describe('satellites', () => {
  it('says backups are Main\'s business, and offers no action', () => {
    // A satellite's database is a partial mirror, so reporting on its backups
    // would be describing the wrong thing.
    const result = assessProtection({ isSatellite: true }, NOW)
    expect(result.level).toBe('satellite')
    expect(result.action).toBeNull()
  })
})

describe('destinations', () => {
  it('names every place a copy could be', () => {
    const result = assessProtection(healthy(), NOW)
    expect(result.destinations.map((d) => d.key)).toEqual(['computer', 'external', 'offsite'])
  })

  it('uses the drive label the shop recognises', () => {
    const result = assessProtection(healthy(), NOW)
    expect(result.destinations[1].label).toBe('KINGSTON (E:)')
  })

  it('marks a drive that was never set up as such, not as stale', () => {
    const state = healthy()
    state.external = { configured: false }
    const drive = assessProtection(state, NOW).destinations[1]

    expect(drive.status).toBe('not-set-up')
  })
})

describe('the shield score', () => {
  // The shield fills by whole places, never by an invented percentage — so every
  // value it can show has to be something the owner could point at.
  it('counts both places when both are current', () => {
    expect(assessProtection(healthy(), NOW).score).toEqual({ held: 2, total: 3 })
  })

  it('counts one place when the drive has gone stale', () => {
    const state = healthy()
    state.external.lastVerifiedAt = daysAgo(10)
    expect(assessProtection(state, NOW).score).toEqual({ held: 1, total: 3 })
  })

  it('counts one place when no drive has been set up', () => {
    const state = healthy()
    state.external = { configured: false }
    expect(assessProtection(state, NOW).score).toEqual({ held: 1, total: 3 })
  })

  it('counts nothing when nothing has been verified', () => {
    const result = assessProtection({ local: {}, external: { configured: false } }, NOW)
    expect(result.score).toEqual({ held: 0, total: 3 })
  })

  it('never claims more places than exist', () => {
    const result = assessProtection(healthy(), NOW)
    expect(result.score.held).toBeLessThanOrEqual(result.score.total)
  })
})

describe('where the copies physically are', () => {
  it('puts the computer and the drive in the shop, and the off-site copy outside it', () => {
    // This is what lets the panel group them and warn that one fire takes both —
    // it cannot say so unless it knows which copies share a room.
    const result = assessProtection(healthy(), NOW)
    const where = Object.fromEntries(result.destinations.map((d) => [d.key, d.where]))

    expect(where).toEqual({ computer: 'here', external: 'here', offsite: 'away' })
  })
})

describe('the off-site copy', () => {
  const withOffsite = (daysAgoRecorded, where = 'Google Drive') => {
    const state = healthy()
    state.offsite = { recorded: true, recordedAt: daysAgo(daysAgoRecorded), recordedWhere: where }
    return assessProtection(state, NOW)
  }

  it('reaches the strongest level once a copy is kept outside', () => {
    const result = withOffsite(1)
    expect(result.level).toBe('strong')
    expect(result.tone).toBe('ok')
    expect(result.action).toBeNull()
  })

  it('counts toward the shield', () => {
    expect(withOffsite(1).score).toEqual({ held: 3, total: 3 })
  })

  it('is never described as verified, only recorded', () => {
    // Stocka writes the file and the shop carries it away. After that it cannot
    // open it, re-read it, or notice it being deleted — so the status it reports
    // must stay distinguishable from the copies it really did check.
    const offsite = withOffsite(1).destinations.find((d) => d.key === 'offsite')
    expect(offsite.status).toBe('recorded')
    expect(offsite.status).not.toBe('protected')
  })

  it('uses the place the owner named', () => {
    const offsite = withOffsite(1, 'My Google Drive').destinations.find((d) => d.key === 'offsite')
    expect(offsite.label).toBe('My Google Drive')
  })

  it('goes stale after a month, not after a few days', () => {
    // Carrying a file out of the building is an errand, not a daily habit.
    expect(withOffsite(OFFSITE_STALE_DAYS - 1).destinations[2].status).toBe('recorded')
    expect(withOffsite(OFFSITE_STALE_DAYS).destinations[2].status).toBe('recorded-stale')
  })

  it('mentions an ageing off-site copy without raising the alarm', () => {
    const result = withOffsite(OFFSITE_STALE_DAYS + 10)
    expect(result.tone).toBe('ok')
    expect(result.detail).toMatch(/last copy outside the shop/i)
  })

  it('does not count a stale off-site copy as a place currently holding one', () => {
    expect(withOffsite(OFFSITE_STALE_DAYS + 10).score.held).toBe(2)
  })

  it('is reported as not set up when nothing has ever been recorded', () => {
    const offsite = assessProtection(healthy(), NOW).destinations.find((d) => d.key === 'offsite')
    expect(offsite.status).toBe('not-set-up')
  })

  it('does not rescue a shop whose drive is out of date', () => {
    // An off-site copy from last week is no answer to a drive nobody has plugged
    // in for nine days; the recent trading is still in one place only.
    const state = healthy()
    state.external.lastVerifiedAt = daysAgo(9)
    state.offsite = { recorded: true, recordedAt: daysAgo(2), recordedWhere: 'Drive' }

    expect(assessProtection(state, NOW).tone).toBe('critical')
  })
})

describe('missing state', () => {
  it('says nothing rather than guessing', () => {
    const result = assessProtection(null, NOW)
    expect(result.level).toBe('unknown')
    expect(result.action).toBeNull()
  })
})

// The rule the sign-in warning applies. Kept here, beside the model it reads, so
// that a change to the thresholds cannot silently change who gets interrupted.
const worthInterrupting = (assessed) =>
  assessed.tone === 'critical' ||
  (assessed.tone === 'warn' && (assessed.externalAgeDays ?? 0) >= ATTENTION_DAYS) ||
  assessed.level === 'none'

describe('when a sign-in is worth interrupting', () => {
  const atDriveAge = (days) => {
    const state = healthy()
    state.external.lastVerifiedAt = daysAgo(days)
    return assessProtection(state, NOW)
  }

  it('leaves a protected shop alone', () => {
    expect(worthInterrupting(assessProtection(healthy(), NOW))).toBe(false)
  })

  it('stays out of the way for the first two days', () => {
    // A shop that backed up yesterday does not need a dialog this morning. Showing
    // one anyway is how people learn to dismiss it without reading.
    expect(worthInterrupting(atDriveAge(0))).toBe(false)
    expect(worthInterrupting(atDriveAge(1))).toBe(false)
    expect(worthInterrupting(atDriveAge(ATTENTION_DAYS - 1))).toBe(false)
  })

  it('interrupts from day three', () => {
    expect(worthInterrupting(atDriveAge(ATTENTION_DAYS))).toBe(true)
    expect(worthInterrupting(atDriveAge(5))).toBe(true)
  })

  it('interrupts hard once a week has passed', () => {
    const result = atDriveAge(CRITICAL_DAYS + 2)
    expect(worthInterrupting(result)).toBe(true)
    expect(result.tone).toBe('critical')
  })

  it('interrupts when nothing has ever been backed up', () => {
    const result = assessProtection({ local: {}, external: { configured: false } }, NOW)
    expect(worthInterrupting(result)).toBe(true)
  })

  it('does not interrupt a shop that simply has no drive yet', () => {
    // They are told on the dashboard, every time they look at it. A modal every
    // morning for a choice they have not made yet is nagging, not protection.
    const state = healthy()
    state.external = { configured: false }
    expect(worthInterrupting(assessProtection(state, NOW))).toBe(false)
  })

  it('does not interrupt over a missing off-site copy alone', () => {
    // Two current checked copies is a good place to be; the off-site copy is an
    // invitation on the dashboard, never a dialog in somebody's way.
    const result = assessProtection(healthy(), NOW)
    expect(result.action.kind).toBe('offsite')
    expect(worthInterrupting(result)).toBe(false)
  })

  it('always leaves something to act on when it does interrupt', () => {
    // A dialog that interrupts without offering a way forward is just an alarm.
    for (const days of [ATTENTION_DAYS, 5, CRITICAL_DAYS, 30]) {
      const result = atDriveAge(days)
      expect(worthInterrupting(result)).toBe(true)
      expect(result.action).toBeTruthy()
      expect(result.action.label).toBeTruthy()
    }
  })
})
