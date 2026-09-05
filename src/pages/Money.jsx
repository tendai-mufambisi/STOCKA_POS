import { useState, useEffect } from 'react'
import {
  addCashMovement, getCashMovements, deleteCashMovement,
  getCashPosition, getMovementTypes,
} from '../database/db'
import ConfirmModal from '../components/ConfirmModal'
import { localDateStr, formatDbDate } from '../utils/salesDay'
import { useAuthStore } from '../store/useAuthStore'
import { useShiftStore } from '../store/useShiftStore'
import { FiPlus, FiX, FiTrash2 } from 'react-icons/fi'
import './Money.css'

const money = (n) => `$${(Number(n) || 0).toFixed(2)}`

const PAYMENT_METHODS = ['Cash', 'EcoCash', 'Transfer', 'Swipe', 'USD']

function monthStart() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

const EMPTY_FORM = {
  type: 'owner_draw',
  direction: 'out',
  amount: '',
  date: localDateStr(),
  counterparty: '',
  note: '',
  payment_method: 'Cash',
}

function Money() {
  const { user } = useAuthStore()
  const { currentShift } = useShiftStore()

  const [from, setFrom] = useState(monthStart())
  const [to, setTo] = useState(localDateStr())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [position, setPosition] = useState(null)
  const [movements, setMovements] = useState([])
  const [types, setTypes] = useState([])

  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [formData, setFormData] = useState(EMPTY_FORM)

  const loadData = async () => {
    setLoading(true)
    setError('')
    try {
      const [pos, moves] = await Promise.all([
        getCashPosition({ from, to }),
        getCashMovements({ from, to }),
      ])
      setPosition(pos)
      setMovements(moves)
    } catch (err) {
      setError(err.message || 'Failed to load cash position')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadData() }, [])

  // The taxonomy comes from the main process rather than being duplicated here,
  // so the labels and directions the form offers are the ones it validates
  // against.
  useEffect(() => {
    getMovementTypes().then(setTypes).catch(() => setTypes([]))
  }, [])

  const selectedType = types.find(t => t.id === formData.type)

  const handleSubmit = async (e) => {
    e.preventDefault()
    const amount = parseFloat(formData.amount)
    if (!Number.isFinite(amount) || amount <= 0) {
      setError('Enter an amount greater than zero.')
      return
    }
    setSaving(true)
    setError('')
    try {
      await addCashMovement({
        ...formData,
        amount,
        recorded_by: user?.username || 'unknown',
        shift_id: currentShift?.id || null,
      })
      setFormData(EMPTY_FORM)
      setShowForm(false)
      await loadData()
    } catch (err) {
      setError(err.message || 'Failed to record movement')
    } finally {
      setSaving(false)
    }
  }

  const handleConfirmDelete = async () => {
    const { id } = confirmDelete
    setConfirmDelete(null)
    try {
      await deleteCashMovement(id, user?.username || 'unknown')
      await loadData()
    } catch (err) {
      setError(err.message || 'Failed to delete movement')
    }
  }

  const mv = position?.movement
  // Pockets worth showing: anything holding money, anything that moved this
  // period, and the drawer always — an owner expects cash in hand even at zero.
  const pockets = (position?.by_tender || []).filter(t =>
    t.drawer || t.balance !== 0 || t.sales || t.expenses || t.money_in || t.money_out
  )
  const inTypes    = types.filter(t => t.direction === 'in')
  const outTypes   = types.filter(t => t.direction === 'out')
  const otherTypes = types.filter(t => !t.direction)

  if (loading) return <div className="money-page"><div className="loading">Loading...</div></div>

  return (
    <div className="money-page">
      {error && <div className="error-banner">{error}</div>}

      <div className="money-top">
        <div className="cash-hero">
          <div className="cash-hero-label">Total money</div>
          <div className={`cash-hero-value ${position?.total_money < 0 ? 'negative' : ''}`}>
            {position ? money(position.total_money) : '—'}
          </div>
          <div className="cash-hero-sub">as at {formatDbDate(to)}</div>

          {/* Every pocket, including empty ones, so the parts always add up to
              the figure above and no money the business holds is left out. */}
          <div className="pockets">
            <div className="pockets-title">WHERE IT IS HELD</div>
            {pockets.map(t => (
              <div key={t.id} className="pocket-row">
                <span>
                  {t.label}
                  {t.drawer && <span className="pocket-counted"> · counted</span>}
                </span>
                <strong>{money(t.balance)}</strong>
              </div>
            ))}
          </div>
        </div>

        <div className="cash-statement">
          <div className="cash-statement-title">Where that came from</div>
          <div className="cash-statement-period">{formatDbDate(from)} — {formatDbDate(to)}</div>

          {position && (
            <>
              <StatementRow label="Opening balance" hint="Everything before this period"
                amount={position.opening_balance} muted />
              <StatementRow label="Sales"           sign="+" amount={mv.sales} />
              <StatementRow label="Expenses"        sign="−" amount={mv.expenses} />
              <StatementRow label="Money brought in" sign="+" amount={mv.money_in}
                hint="Capital added, money drawn from the bank" />
              <StatementRow label="Money taken out"  sign="−" amount={mv.money_out}
                hint="Owner drawings, stock buying, suppliers, banking" />
              <StatementRow label="Total money" amount={position.total_money} strong />
            </>
          )}
        </div>
      </div>

      {/* The single most common bookkeeping mistake this page exists to stop. */}
      <div className="money-notice">
        <strong>These movements do not change your profit.</strong> Money you take
        out is profit you already made, and cash spent on stock becomes a cost
        only when that stock sells. Recording either as an expense would make the
        business look less profitable than it really is. Only the Expenses page
        reduces profit.
      </div>

      <div className="toolbar">
        <button className="btn btn-primary" onClick={() => {
          setShowForm(!showForm)
          if (showForm) setFormData(EMPTY_FORM)
        }}>
          {showForm ? <><FiX size={14} /> Cancel</> : <><FiPlus size={14} /> Record Movement</>}
        </button>
        <div className="range-filters">
          <label>From <input type="date" value={from} onChange={e => setFrom(e.target.value)} /></label>
          <label>To <input type="date" value={to} onChange={e => setTo(e.target.value)} /></label>
          <button className="btn btn-secondary" onClick={loadData}>Apply</button>
        </div>
      </div>

      {showForm && (
        <form className="form-card" onSubmit={handleSubmit}>
          <div className="form-row">
            <div className="form-group">
              <label>What happened? *</label>
              <select value={formData.type}
                onChange={e => setFormData(f => ({ ...f, type: e.target.value }))}>
                <optgroup label="Money coming in">
                  {inTypes.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                </optgroup>
                <optgroup label="Money going out">
                  {outTypes.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                </optgroup>
                {otherTypes.length > 0 && (
                  <optgroup label="Other">
                    {otherTypes.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                  </optgroup>
                )}
              </select>
              {selectedType?.hint && <div className="field-hint">{selectedType.hint}</div>}
            </div>

            <div className="form-group">
              <label>Amount *</label>
              <input type="number" step="0.01" min="0" autoFocus
                value={formData.amount} placeholder="0.00"
                onChange={e => setFormData(f => ({ ...f, amount: e.target.value }))} />
            </div>
          </div>

          <div className="form-row">
            {/* A correction is the one movement whose direction cannot be
                inferred, so it is the only time this is asked. */}
            {selectedType && !selectedType.direction && (
              <div className="form-group">
                <label>Direction *</label>
                <select value={formData.direction}
                  onChange={e => setFormData(f => ({ ...f, direction: e.target.value }))}>
                  <option value="in">More cash than recorded (add)</option>
                  <option value="out">Less cash than recorded (remove)</option>
                </select>
              </div>
            )}

            <div className="form-group">
              <label>Paid in</label>
              <select value={formData.payment_method}
                onChange={e => setFormData(f => ({ ...f, payment_method: e.target.value }))}>
                {PAYMENT_METHODS.map(p => <option key={p}>{p}</option>)}
              </select>
              <div className="field-hint">
                Which pocket the money moves from. It counts either way — this
                only decides whether it comes off your cash, EcoCash or bank.
              </div>
            </div>

            <div className="form-group">
              <label>Date</label>
              <input type="date" value={formData.date}
                onChange={e => setFormData(f => ({ ...f, date: e.target.value }))} />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Who or where</label>
              <input type="text" value={formData.counterparty} placeholder="e.g. Mai Rudo Wholesalers"
                onChange={e => setFormData(f => ({ ...f, counterparty: e.target.value }))} />
            </div>
            <div className="form-group">
              <label>Note</label>
              <input type="text" value={formData.note} placeholder="What was it for?"
                onChange={e => setFormData(f => ({ ...f, note: e.target.value }))} />
            </div>
          </div>

          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Saving...' : 'Record Movement'}
          </button>
        </form>
      )}

      {position?.by_type?.length > 0 && (
        <div className="by-type-grid">
          {position.by_type.map(t => (
            <div key={t.type} className="by-type-card">
              <div className="by-type-label">{t.label}</div>
              <div className={`by-type-value ${t.direction}`}>
                {t.direction === 'in' ? '+' : '−'}{money(t.total)}
              </div>
              <div className="by-type-count">{t.count} {t.count === 1 ? 'entry' : 'entries'}</div>
            </div>
          ))}
        </div>
      )}

      <table className="money-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Reason</th>
            <th>Who / where</th>
            <th>Note</th>
            <th>Method</th>
            <th>Amount</th>
            <th>Recorded by</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {movements.length === 0 ? (
            <tr><td colSpan={8} className="empty-state">No money movements recorded in this period</td></tr>
          ) : movements.map(m => (
            <tr key={m.id}>
              <td>{formatDbDate(m.date)}</td>
              <td>{m.label}</td>
              <td>{m.counterparty || '—'}</td>
              <td>{m.note || '—'}</td>
              <td>{m.payment_method || 'Cash'}</td>
              <td className={`amount ${m.direction}`}>
                {m.direction === 'in' ? '+' : '−'}{money(m.amount)}
              </td>
              <td>{m.recorded_by}</td>
              <td>
                <button className="btn-icon" title="Delete"
                  onClick={() => setConfirmDelete({ id: m.id, label: m.label, amount: m.amount })}>
                  <FiTrash2 size={14} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {confirmDelete && (
        <ConfirmModal
          message="Delete this movement?"
          detail={`${confirmDelete.label} of ${money(confirmDelete.amount)} will be removed from your money position.`}
          confirmLabel="Delete"
          danger
          onConfirm={handleConfirmDelete}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  )
}

/**
 * One line of the cash statement. `sign` drives both the leading symbol and the
 * colour, so money leaving reads as money leaving at a glance.
 */
function StatementRow({ label, amount, sign, muted, strong, hint }) {
  const cls = strong ? 'strong' : sign === '−' ? 'out' : sign === '+' ? 'in' : ''
  return (
    <div className={`statement-row ${strong ? 'total' : ''}`}>
      <div>
        <div className={`statement-label ${muted ? 'muted' : ''}`}>
          {sign ? `${sign} ` : ''}{label}
        </div>
        {hint && <div className="statement-hint">{hint}</div>}
      </div>
      <div className={`statement-amount ${cls}`}>{money(amount)}</div>
    </div>
  )
}

export default Money
