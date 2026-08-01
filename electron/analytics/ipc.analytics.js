const analytics = require('./index')

// ONE channel table, consumed by three places that must never disagree:
//
//   electron/database/ipc.js  → ipcMain.handle for each
//   electron/lan/lanServer.js → DISPATCH, so satellites can reach them
//   electron/lan/lanClient.js → FORCE_REMOTE_READ_CHANNELS, so satellites don't
//                               answer them from an incomplete local mirror
//
// Adding a channel in one place and forgetting the others is the standing bug in
// this codebase's plumbing — and the DISPATCH omission only ever fails on a
// satellite, which is the machine least likely to be under a developer's nose.
// Deriving all three from this object removes the opportunity.

const CHANNELS = {
  'domain:analytics:metrics': (ids, period, scope, opts) =>
    analytics.computeMetrics(ids, period, scope, opts),

  'domain:analytics:compare': (ids, period, scope, opts) =>
    analytics.compareMetrics(ids, period, scope, opts),

  'domain:analytics:quality': (period, scope, opts) => analytics.quality(period, scope, opts),

  'domain:analytics:explain': (metricId, period, scope, opts) =>
    analytics.explain(metricId, period, scope, opts),

  'domain:analytics:trend': (metricId, period, scope, opts) =>
    analytics.trend(metricId, period, scope, opts),

  'domain:analytics:listMetrics': () => analytics.listMetrics(),
}

const CHANNEL_IDS = Object.keys(CHANNELS)

module.exports = { CHANNELS, CHANNEL_IDS }
