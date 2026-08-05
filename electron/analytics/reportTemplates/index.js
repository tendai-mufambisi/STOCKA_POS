// Report templates.
//
// A template names metrics and arranges sections. It contains no calculations —
// that is the whole point of the layering, and the reason a new report is an
// afternoon's work rather than a fortnight's.

const templates = new Map()

function register(t) {
  if (templates.has(t.id)) throw new Error(`Duplicate report template '${t.id}'`)
  templates.set(t.id, t)
}

register(require('./monthlyBusinessReview'))

function getTemplate(id) {
  const t = templates.get(id)
  if (!t) throw new Error(`No report template '${id}'. Available: ${[...templates.keys()].join(', ')}`)
  return t
}

const listTemplates = () =>
  [...templates.values()].map((t) => ({
    id: t.id,
    title: t.title,
    granularities: t.granularities,
  }))

module.exports = { getTemplate, listTemplates }
