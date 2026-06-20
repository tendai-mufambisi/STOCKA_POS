import { FiX, FiPrinter } from 'react-icons/fi'
import './ReceiptModal.css'

function ReceiptModal({ sale, onClose, onReprint }) {
  if (!sale) return null

  const fmt = {
    money: (n) => `$${(n || 0).toFixed(2)}`,
    datetime: (d) => d
      ? new Date(d).toLocaleString('en-ZA', {
          day: '2-digit', month: 'short', year: 'numeric',
          hour: '2-digit', minute: '2-digit'
        })
      : '—',
  }

  const items = sale.items || []
  const subtotal = items.reduce((s, i) => s + (i.subtotal || 0), 0)

  return (
    <div className="rcpt-overlay" onClick={e => { e.stopPropagation(); onClose() }}>
      <div className="rcpt-modal" onClick={e => e.stopPropagation()}>

        <div className="rcpt-header">
          <div>
            <div className="rcpt-title">Sale Receipt</div>
            {sale.receipt_number && (
              <div className="rcpt-subtitle">#{sale.receipt_number}</div>
            )}
          </div>
          <div className="rcpt-header-actions">
            {onReprint && (
              <button className="rcpt-icon-btn" onClick={onReprint} title="Reprint">
                <FiPrinter size={16} />
              </button>
            )}
            <button className="rcpt-icon-btn" onClick={onClose}>
              <FiX size={16} />
            </button>
          </div>
        </div>

        <div className="rcpt-body">

          {/* Meta row */}
          <div className="rcpt-meta">
            <div className="rcpt-meta-row">
              <span>Date</span>
              <span>{fmt.datetime(sale.created_at)}</span>
            </div>
            <div className="rcpt-meta-row">
              <span>Cashier</span>
              <span>{sale.cashier || '—'}</span>
            </div>
            {sale.payment_method && (
              <div className="rcpt-meta-row">
                <span>Payment</span>
                <span>{sale.payment_method}</span>
              </div>
            )}
          </div>

          <div className="rcpt-divider" />

          {/* Items */}
          <div className="rcpt-items">
            <div className="rcpt-items-head">
              <span>Item</span>
              <span>Qty</span>
              <span>Price</span>
              <span>Subtotal</span>
            </div>
            {items.length === 0 ? (
              <div className="rcpt-no-items">No items</div>
            ) : (
              items.map((item, i) => (
                <div key={i} className="rcpt-item-row">
                  <span className="rcpt-item-name">{item.product_name}</span>
                  <span>{item.quantity}</span>
                  <span>{fmt.money(item.selling_price)}</span>
                  <span>{fmt.money(item.subtotal)}</span>
                </div>
              ))
            )}
          </div>

          <div className="rcpt-divider" />

          {/* Totals */}
          <div className="rcpt-totals">
            {items.length > 0 && Math.abs(subtotal - sale.total) > 0.005 && (
              <div className="rcpt-total-row">
                <span>Subtotal</span>
                <span>{fmt.money(subtotal)}</span>
              </div>
            )}
            <div className="rcpt-total-row total">
              <span>Total</span>
              <span>{fmt.money(sale.total)}</span>
            </div>
            {sale.cash_tendered > 0 && (
              <div className="rcpt-total-row">
                <span>Cash Tendered</span>
                <span>{fmt.money(sale.cash_tendered)}</span>
              </div>
            )}
            {sale.change_given > 0 && (
              <div className="rcpt-total-row change">
                <span>Change</span>
                <span>{fmt.money(sale.change_given)}</span>
              </div>
            )}
          </div>

          {sale.note && (
            <>
              <div className="rcpt-divider" />
              <div className="rcpt-note">Note: {sale.note}</div>
            </>
          )}

        </div>

        <div className="rcpt-footer">
          <button className="rcpt-close-btn" onClick={onClose}>Close</button>
        </div>

      </div>
    </div>
  )
}

export default ReceiptModal
