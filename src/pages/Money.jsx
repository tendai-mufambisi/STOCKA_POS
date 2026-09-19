import { useState, useEffect } from 'react'
import {
  addCashMovement, getCashMovements, deleteCashMovement,
  getCashPosition, getMovementTypes,
} from '../database/db'
import ConfirmModal from '../components/ConfirmModal'
import Modal from '../components/Modal'
import Field from '../components/Field'
import { toast } from '../store/useToastStore'
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
  const [amountError, setAmountError] = useState(null)
  const [attempt, setAttempt] = useState(0)

  // A dialog over the page. It used to open above the movements list and push it down.
  const openForm = () => { setFormData({ ...EMPTY_FORM, date: localDateStr() }); setAmountError(null); setShowForm(true) }
  const closeForm = () => { if (!saving) setShowForm(false) }

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
    // Anything other than a list would take the whole page down at types.find below.
    getMovementTypes().then(t => setTypes(Array.isArray(t) ? t : [])).catch(() => setTypes([]))
  }, [])

  const selectedType = types.find(t => t.id === formData.type)

  const handleSubmit = async (e) => {
    e.preventDefault()
    const amount = parseFloat(formData.amount)
    if (!Number.isFinite(amount) || amount <= 0) {
      setAmountError('Enter an amount greater than zero')
      setAttempt(n => n + 1)
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
      const label = selectedType?.label || 'Money movement'
      setFormData(EMPTY_FORM)
      setShowForm(false)
      await loadData()
      toast.success(`${label} recorded`, {
        detail: `$${amount.toFixed(2)} · ${formData.payment_method}${formData.counterparty ? ' · ' + formData.counterparty : ''}`,
      })
    } catch (err) {
      toast.error('Could not record that: ' + (err.message || 'unknown error'))
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
        <button className="btn btn-primary" onClick={openForm}>
          <FiPlus size={14} /> Record Movement
        </button>
        <div className="range-filters">
          <label>From <input type="date" value={from} onChange={e => setFrom(e.target.value)} /></label>
          <label>To <input type="date" value={to} onChange={e => setTo(e.target.value)} /></label>
          <button className="btn btn-secondary" onClick={loadData}>Apply</button>
        </div>
      </div>

      <Modal
        open={showForm}
        size="medium"
        title="Record a Money Movement"
        subtitle="Cash going in or out that is not a sale — change added to the float, money banked, a loan repaid."
        onClose={closeForm}
        footer={
          <>
            <button type="button" className="smodal-btn-away" onClick={closeForm} disabled={saving}>Cancel</button>
            <button type="submit" form="money-form" className="smodal-btn-primary" disabled={saving}>
              {saving ? 'Saving...' : 'Record Movement'}
            </button>
          </>
        }
      >
        <form id="money-form" className="fl-stack" onSubmit={handleSubmit} noValidate>
          <Field
            as="select" label="What happened?" required
            value={formData.type}
            onChange={e => setFormData(f => ({ ...f, type: e.target.value }))}
            hint={selectedType?.hint}
          >
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
          </Field>

          <div className="fl-row">
            <Field
              label="Amount" required prefix="$" type="number" step="0.01" min="0" inputMode="decimal" autoFocus
              value={formData.amount}
              onChange={e => { setFormData(f => ({ ...f, amount: e.target.value })); if (amountError) setAmountError(null) }}
              error={amountError} shakeKey={attempt}
            />
            <Field
              label="Date" type="date"
              value={formData.date}
              onChange={e => setFormData(f => ({ ...f, date: e.target.value }))}
            />
          </div>

          {/* A correction is the one movement whose direction cannot be
              inferred, so it is the only time this is asked. */}
          {selectedType && !selectedType.direction && (
            <Field
              as="select" label="Which way?" required
              value={formData.direction}
              onChange={e => setFormData(f => ({ ...f, direction: e.target.value }))}
            >
              <option value="in">More cash than recorded (add)</option>
              <option value="out">Less cash than recorded (remove)</option>
            </Field>
          )}

          <Field
            as="select" label="Paid in"
            value={formData.payment_method}
            onChange={e => setFormData(f => ({ ...f, payment_method: e.target.value }))}
            hint="Which pocket it moves through — your cash, EcoCash or the bank."
          >
            {PAYMENT_METHODS.map(pm => <option key={pm}>{pm}</option>)}
          </Field>

          <div className="fl-row">
            <Field
              label="Who or where"
              value={formData.counterparty}
              onChange={e => setFormData(f => ({ ...f, counterparty: e.target.value }))}
              placeholder="e.g. Mai Rudo Wholesalers"
            />
            <Field
              label="Note"
              value={formData.note}
              onChange={e => setFormData(f => ({ ...f, note: e.target.value }))}
              placeholder="What was it for?"
            />
          </div>
        </form>
      </Modal>

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
