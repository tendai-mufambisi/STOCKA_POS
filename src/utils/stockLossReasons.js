/**
 * Reasons a unit of stock left the shelves without being sold.
 *
 * Stored in stock_movements.reason_code on STOCK_LOSS rows. The codes are
 * mirrored in electron/database/domains/stock.js, which validates them on the
 * way in — keep the two lists in step.
 *
 * EXPIRED is deliberately NOT recordable here. Expired stock is written off from
 * Expiry Tracking via discardExpiredBatch(), the only path that also clears the
 * batch from the tracker. A second write path for the same event would let the
 * same units be written off twice. The losses list still SHOWS expiry
 * write-offs — see EXPIRED_LABEL — so one screen answers "what did we lose?";
 * it just doesn't create them.
 */
export const STOCK_LOSS_REASONS = [
  { code: 'BROKEN',        label: 'Broken',       hint: 'Dropped, knocked over, shattered' },
  { code: 'DAMAGED',       label: 'Damaged',      hint: 'Dented, torn or crushed packaging' },
  { code: 'SPILLED',       label: 'Spilled',      hint: 'Contents lost, container intact' },
  { code: 'SPOILED',       label: 'Spoiled',      hint: 'Went off before its expiry date' },
  { code: 'LOST',          label: 'Lost',         hint: 'Cannot be found, no explanation' },
  { code: 'THEFT',         label: 'Theft',        hint: 'Known or suspected to be stolen' },
  { code: 'INTERNAL_USE',  label: 'Internal Use', hint: 'Used by the shop, not sold' },
  { code: 'OTHER',         label: 'Other',        hint: 'Anything else — describe it below' },
]

export const STOCK_LOSS_REASON_CODES = STOCK_LOSS_REASONS.map((r) => r.code)

/** Expiry write-offs are shown in the losses list but recorded elsewhere. */
export const EXPIRED_LABEL = 'Expired'

export const stockLossReasonLabel = (code) =>
  code === 'EXPIRED'
    ? EXPIRED_LABEL
    : STOCK_LOSS_REASONS.find((r) => r.code === code)?.label || code || 'Other'
