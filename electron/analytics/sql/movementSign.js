// Normalises stock_movements.quantity into a signed delta.
//
// The table does not use one sign convention. Different write paths chose
// differently and the column has no direction of its own:
//
//   SOLD                  written POSITIVE, but stock went DOWN
//   RECEIVED              written POSITIVE, stock went UP
//   DIRECT_PURCHASE       written POSITIVE, stock went UP
//   EXPIRED_DISCARD       written NEGATIVE, stock went DOWN
//   VOIDED                written POSITIVE, stock went back UP
//   ADJUSTMENT            genuinely signed — the sign IS the meaning
//   RECEIVING_CORRECTION  genuinely signed — qtyDelta from correctStockReceiving
//
// So `SUM(quantity)` across movement types is meaningless, and any historical
// stock reconstruction that does it produces a number that looks plausible and
// is wrong.
//
// The normaliser is deliberately sign-AGNOSTIC for the types whose direction is
// known: it applies -ABS/+ABS rather than trusting the stored sign. A row
// written under either convention then rolls back identically, which matters
// because these rows span years and several code changes.
//
// For genuinely-signed types the stored value is used verbatim — there is no
// external fact to check it against, and ABS() would destroy the meaning.
//
// An unrecognised movement_type contributes 0 rather than being guessed at, and
// is reported as a data-quality warning naming the type. Silently guessing the
// direction of a movement nobody has seen before is how a stock figure drifts.

/** Types whose direction is known, regardless of how the sign was stored. */
const DECREASES = ['SOLD', 'EXPIRED_DISCARD']
const INCREASES = ['RECEIVED', 'DIRECT_PURCHASE', 'VOIDED']

/** Types where the stored sign carries the meaning and must be preserved. */
const SIGNED = ['ADJUSTMENT', 'RECEIVING_CORRECTION']

const KNOWN_TYPES = [...DECREASES, ...INCREASES, ...SIGNED]

const quoted = (list) => list.map((t) => `'${t}'`).join(', ')

/**
 * SQL expression giving the signed effect of a movement row on stock on hand.
 * Every caller must use this rather than referencing `quantity` directly.
 */
function normalizedDeltaExpr(alias = 'sm') {
  return (
    `CASE ` +
    `WHEN ${alias}.movement_type IN (${quoted(DECREASES)}) THEN -ABS(${alias}.quantity) ` +
    `WHEN ${alias}.movement_type IN (${quoted(INCREASES)}) THEN ABS(${alias}.quantity) ` +
    `WHEN ${alias}.movement_type IN (${quoted(SIGNED)}) THEN ${alias}.quantity ` +
    `ELSE 0 END`
  )
}

/** Matches rows this module does not know how to interpret. */
function unknownTypeSql(alias = 'sm') {
  return `${alias}.movement_type NOT IN (${quoted(KNOWN_TYPES)})`
}

/** JS equivalent of normalizedDeltaExpr, for rows already in memory. */
function normalizedDelta(movement) {
  const type = movement?.movement_type
  const qty = Number(movement?.quantity) || 0
  if (DECREASES.includes(type)) return -Math.abs(qty)
  if (INCREASES.includes(type)) return Math.abs(qty)
  if (SIGNED.includes(type)) return qty
  return 0
}

/** Distinct movement types present in the data that this module cannot interpret. */
function findUnknownTypes(db) {
  return db
    .prepare(
      `SELECT DISTINCT movement_type, COUNT(*) AS n
         FROM stock_movements
        WHERE movement_type NOT IN (${quoted(KNOWN_TYPES)})
        GROUP BY movement_type`
    )
    .all()
}

module.exports = {
  DECREASES,
  INCREASES,
  SIGNED,
  KNOWN_TYPES,
  normalizedDeltaExpr,
  unknownTypeSql,
  normalizedDelta,
  findUnknownTypes,
}
