// Single registration point. Each module calls defineMetric at load, so simply
// requiring them registers the whole catalogue.
//
// Order does not matter: dependencies are resolved by id at evaluation time,
// and registry.assertValid() catches any that do not exist.
require('./sales')
require('./cogs')
require('./profit')
require('./expenses')
require('./cash')
require('./staff')
require('./inventory')

// comparison.js and trend.js register no metrics — they are functions applied
// TO metrics, so they are exported for the facade rather than required here.
module.exports = {
  comparison: require('./comparison'),
  trend: require('./trend'),
}
