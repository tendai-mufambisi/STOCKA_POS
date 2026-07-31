import { useState, useEffect, useCallback } from 'react'
import {
  addEndOfDay, getEndOfDayRecords,
  getAllShifts, getShiftSummary, closeAllOpenShifts, getShop,
} from '../database/db'
import { useAuthStore } from '../store/useAuthStore'
import { useShiftStore } from '../store/useShiftStore'
import { useLanOnline } from '../hooks/useLanOnline'
import { useReceiptPrinter } from '../hooks/useReceiptPrinter'
import { parseDbDate, localDateStr } from '../utils/salesDay'
import { isUnverified, shiftStatusShort, shiftStatusHint } from '../utils/shiftStatus'
import './EndOfDay.css'
import {
  FiCheckCircle, FiAlertCircle, FiAlertTriangle, FiClock,
  FiDollarSign, FiShoppingCart, FiUsers, FiTrendingDown,
  FiSun, FiChevronDown, FiChevronUp, FiWifiOff, FiPrinter,
} from 'react-icons/fi'

// ─── helpers ──────────────────────────────────────────────────────────────────
const fmt = {
  money:    (n)         => `$${(n || 0).toFixed(2)}`,
  time:     (d)         => d ? parseDbDate(d).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' }) : '—',
  date:     (d)         => d ? parseDbDate(d).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' }) : '—',
  initials: (name)      => (name || '?').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2),
  dur: (start, end) => {
    const mins = Math.round((parseDbDate(end || new Date()) - parseDbDate(start)) / 60000)
    if (mins < 0) return '—'
    const h = Math.floor(mins / 60), m = mins % 60
    return h === 0 ? `${m}m` : `${h}h ${m}m`
  },
}

function varianceStatus(v) {
  if (v === null || v === undefined) return 'neutral'
  if (Math.abs(v) < 0.01) return 'balanced'
  return v > 0 ? 'overage' : 'shortage'
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function EndOfDay() {
  const { user } = useAuthStore()
  const { clearShift } = useShiftStore()

  // End of Day is a shop-wide operation: every figure below is computed from THIS
  // machine's database. On a satellite that can't reach Main, that database is
  // missing the other tills' sales, so the totals are already wrong before they
  // are saved — and replaying the write later can't fix numbers baked into the
  // payload. Closing a cashier's own drawer stays allowed offline (they counted
  // the cash themselves); closing the whole day does not.
  const { reachable, online, queued } = useLanOnline()
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState('')
  const [todaysRecord, setTodaysRecord] = useState(null)
  const [allRecords, setAllRecords] = useState([])
  const [shifts, setShifts]         = useState([])   // [{...shift, summary:{}}]
  const [cashInputs, setCashInputs]         = useState({})  // {shiftId: string}
  const [transferInputs, setTransferInputs] = useState({})  // {shiftId: string}
  const [notes, setNotes]                   = useState('')
  const [closing, setClosing]       = useState(false)
  // Shifts Main refused to close because the till holding that drawer is offline
  // or still has unsent sales: [{ shiftId, cashier, tillCode, error }].
  const [blockedTills, setBlockedTills]           = useState([])
  const [forceUnreachableTills, setForceUnreachableTills] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [shopInfo, setShopInfo]     = useState(null)
  const [printingDate, setPrintingDate] = useState(null)  // date string currently spooling

  // Same printer, same routing as receipts — a shop that can print a receipt can
  // print its day summary with no extra configuration.
  const { printEodReport, printError } = useReceiptPrinter()

  const today = localDateStr()

  // ── Load ────────────────────────────────────────────────────────────────────
  // `keepInputs` re-reads the shifts without discarding what the admin has already
  // typed. Needed after a partly-blocked Close Day: some drawers really did close,
  // so the rows are stale, but the counts still on screen for the blocked tills are
  // the admin's own work and must survive the refresh.
  const loadData = useCallback(async (keepInputs = false) => {
    try {
      setLoading(true)
      const [records, allRawShifts, shop] = await Promise.all([
        getEndOfDayRecords(),
        getAllShifts(),
        getShop().catch(() => null),
      ])
      setShopInfo(shop)

      setAllRecords(records)
      const record = records.find(r => r.date === today) || null
      setTodaysRecord(record)

      // Today's shifts, plus ANY shift still open regardless of start date —
      // an overnight shift must never be invisible to End of Day.
      const rawShifts = allRawShifts.filter(s =>
        s.status === 'open' ||
        (s.started_at && localDateStr(parseDbDate(s.started_at)) === today)
      )

      // Load shift summaries in parallel
      const withSummaries = await Promise.all(
        rawShifts.map(async s => {
          const summary = await getShiftSummary(s.id)
          return {
            ...s,
            cashier_name: s.cashier_display_name || s.cashier_username || 'Unknown',
            summary,
          }
        })
      )

      setShifts(withSummaries)

      // Pre-fill inputs for already-closed shifts
      const cashIn = {}
      const transferIn = {}
      for (const s of withSummaries) {
        if (s.status === 'closed' && s.closing_cash != null) {
          cashIn[s.id] = s.closing_cash.toFixed(2)
        }
        // Only shifts that were actually reconciled for transfers get a value back —
        // null means nobody counted them, which must not display as a counted 0.00.
        if (s.status === 'closed' && s.closing_transfer != null) {
          transferIn[s.id] = s.closing_transfer.toFixed(2)
        }
      }
      setCashInputs(prev => keepInputs ? { ...cashIn, ...prev } : cashIn)
      setTransferInputs(prev => keepInputs ? { ...transferIn, ...prev } : transferIn)
    } catch {
      setError('Failed to load end of day data')
    } finally {
      setLoading(false)
    }
  }, [today])

  useEffect(() => { loadData() }, [loadData])

  // ── Derived values ──────────────────────────────────────────────────────────
  const openShifts   = shifts.filter(s => s.status === 'open')
  const closedShifts = shifts.filter(s => s.status === 'closed')

  const totalSales            = shifts.reduce((sum, s) => sum + (s.summary?.total_sales       || 0), 0)
  const totalExpenses         = shifts.reduce((sum, s) => sum + (s.summary?.total_expenses    || 0), 0)
  const totalExpected         = shifts.reduce((sum, s) => sum + (s.summary?.expected_cash     || 0), 0)
  const totalExpectedTransfer = shifts.reduce((sum, s) => sum + (s.summary?.expected_transfer || 0), 0)

  const totalReceived = shifts.reduce((sum, s) => {
    const v = parseFloat(cashInputs[s.id])
    return sum + (isNaN(v) ? 0 : v)
  }, 0)
  const totalVariance = totalReceived - totalExpected
  const dayVarStatus  = varianceStatus(totalVariance)

  const totalTransferReceived = shifts.reduce((sum, s) => {
    const v = parseFloat(transferInputs[s.id])
    return sum + (isNaN(v) ? 0 : v)
  }, 0)
  const totalTransferVariance = totalTransferReceived - totalExpectedTransfer

  // Transfer columns are dead weight for a cash-only shop, so History only grows
  // them once some day has actually taken transfer money.
  const anyTransferRecords = allRecords.some(r => (r.expected_transfer || 0) > 0 || (r.actual_transfer || 0) > 0)

  const allOpenInputted = openShifts.every(s => {
    const c = parseFloat(cashInputs[s.id])
    const hasCash = cashInputs[s.id] !== '' && !isNaN(c)
    const et = s.summary?.expected_transfer || 0
    if (et > 0) {
      const t = parseFloat(transferInputs[s.id])
      return hasCash && transferInputs[s.id] !== '' && !isNaN(t)
    }
    return hasCash
  })
  const canClose = openShifts.length === 0 || allOpenInputted

  // Two distinct reasons a satellite can't be trusted with the day's totals: it
  // can't reach Main at all, or it can reach Main but still has its own writes
  // queued — those exist in neither database, so they're missing from both sides.
  const offlineReason = !online
    ? "End of Day needs the Main Computer. This till is offline, so the totals below are missing every sale made on the other tills. Close the day from the Main Computer, or wait for this one to reconnect."
    : `End of Day needs the Main Computer. ${queued} write${queued === 1 ? '' : 's'} from this till ${queued === 1 ? 'has' : 'have'} not reached it yet — closing now would record totals that leave ${queued === 1 ? 'it' : 'them'} out. This clears itself in a moment.`

  // ── Printable report ────────────────────────────────────────────────────────
  // One shape serves three jobs: what the printer renders, what gets frozen into
  // the record at close, and what a reprint replays months later. It is built from
  // the figures on screen, so the paper says exactly what was signed off.
  // `unverifiedNow` holds the cashiers whose drawers are being force-closed over an
  // unreachable till in this very run — their shift rows still say 'open', so the
  // stored status can't be read for them yet.
  const cashierLine = (s, unverifiedNow = new Set()) => {
    const sm      = s.summary || {}
    const isOpen  = s.status === 'open'
    const expCash = sm.expected_cash     || 0
    const expTran = sm.expected_transfer || 0

    const cash = isOpen ? (parseFloat(cashInputs[s.id]) || 0) : (s.closing_cash || 0)

    // null all the way through when nobody counted the transfers — printing 0.00
    // would claim a count that never happened.
    const rawT    = transferInputs[s.id]
    const parsedT = parseFloat(rawT)
    const transfer = isOpen
      ? (rawT === '' || rawT === undefined || isNaN(parsedT) ? null : parsedT)
      : (s.closing_transfer ?? null)

    return {
      name:               s.cashier_name,
      started_at:         s.started_at,
      closed_at:          isOpen ? null : s.closed_at,
      sales:              sm.total_sales || 0,
      expected_cash:      expCash,
      collected_cash:     cash,
      cash_variance:      cash - expCash,
      expected_transfer:  expTran,
      collected_transfer: transfer,
      transfer_variance:  transfer == null ? null : transfer - expTran,
      // The paper has to be as honest as the screen: a drawer nobody counted, or
      // one closed over a till Main couldn't see, must not print as a clean line.
      verified: !(isUnverified(s.reconciliation_status) || unverifiedNow.has(s.cashier_username)),
      status_note: unverifiedNow.has(s.cashier_username)
        ? shiftStatusHint('unverified')
        : shiftStatusHint(s.reconciliation_status),
    }
  }

  const buildReportPayload = (status, diff, unverifiedNow = new Set()) => ({
    date:           today,
    status,
    closed_by:      user?.username || 'System',
    total_sales:    totalSales,
    total_expenses: totalExpenses,
    sales_count:    shifts.reduce((n, s) => n + (s.summary?.sales_count  || 0), 0),
    cash_sales:     shifts.reduce((n, s) => n + (s.summary?.cash_sales     || 0), 0),
    transfer_sales: shifts.reduce((n, s) => n + (s.summary?.transfer_sales || 0), 0),
    opening_floats: shifts.reduce((n, s) => n + (s.opening_cash            || 0), 0),
    cash_expenses:  shifts.reduce((n, s) => n + (s.summary?.cash_expenses  || 0), 0),
    expected_cash:      totalExpected,
    actual_cash:        totalReceived,
    difference:         diff,
    expected_transfer:  totalExpectedTransfer,
    actual_transfer:    totalTransferReceived,
    transfer_difference: totalTransferVariance,
    notes,
    cashiers: shifts.map(s => cashierLine(s, unverifiedNow)),
  })

  // A saved record prints from its frozen snapshot; the stored columns still win on
  // the totals, since those are the row of record. Records saved before snapshots
  // existed simply print without the per-cashier section.
  const reportFromRecord = (record) => {
    let snap = null
    try { snap = record.report_snapshot ? JSON.parse(record.report_snapshot) : null } catch (_) { snap = null }
    return {
      ...(snap || {}),
      date:                record.date,
      status:              record.status,
      closed_by:           record.cashier,
      closed_at:           record.created_at,
      total_sales:         record.total_sales,
      total_expenses:      record.total_expenses,
      expected_cash:       record.expected_cash,
      actual_cash:         record.actual_cash,
      difference:          record.difference,
      expected_transfer:   record.expected_transfer,
      actual_transfer:     record.actual_transfer,
      transfer_difference: record.transfer_difference,
      notes:               record.notes,
      printed_by:          user?.username || 'System',
    }
  }

  const hasPrinter = !!(shopInfo?.printer_name || shopInfo?.printer_port)

  const handlePrintRecord = async (record) => {
    if (!hasPrinter) {
      setError('No printer configured. Go to Settings → Printer Settings to set one up.')
      return
    }
    setError('')
    setPrintingDate(record.date)
    try {
      await printEodReport(reportFromRecord(record), shopInfo || {}, {
        printerName: shopInfo?.printer_name || '',
        portPath:    shopInfo?.printer_port || '',
        // Any day but today is being pulled back out of the file — say so on the paper.
        isReprint:   record.date !== today,
      })
    } finally {
      setPrintingDate(null)
    }
  }

  // ── Close Day handler ───────────────────────────────────────────────────────
  const handleCloseDay = async () => {
    if (!reachable) {
      setError(offlineReason)
      return
    }
    if (!canClose) {
      setError('Enter cash received for every open shift before closing the day.')
      return
    }
    setClosing(true)
    setError('')
    // Shifts that were closed anyway despite their till being unreachable — noted
    // on the saved day record below.
    let blockedForced = []
    try {
      // 1. Force-close all still-open shifts with the admin-entered cash —
      // including the admin's own shift. Excluding it deadlocked Close Day:
      // the shift stayed open, so the page bounced back here on every attempt.
      if (openShifts.length > 0) {
        // The transfer count travels with the cash count now — previously it was
        // collected, validated, and then dropped on the floor here.
        const closingData = openShifts.map(s => {
          const t = parseFloat(transferInputs[s.id])
          return {
            shiftId:     s.id,
            closingCash: parseFloat(cashInputs[s.id]) || 0,
            // null, not 0 — "no transfers to reconcile" must stay distinct from
            // "counted the transfers and they came to zero".
            closingTransfer: transferInputs[s.id] === '' || transferInputs[s.id] === undefined || isNaN(t)
              ? null
              : t,
          }
        })
        const results = await closeAllOpenShifts(closingData, 'Closed by End of Day', {
          force: forceUnreachableTills,
          closedBy: user?.username || null,
        })

        // A drawer whose till is unreachable is refused, not failed: its sales may
        // still be sitting on that machine, so the variance would be fiction. Stop
        // here and let the admin reconnect the till or override deliberately —
        // saving the day's record on top of figures we know are incomplete is the
        // one thing that can't be undone.
        const blocked = (results || []).filter(r => r.code === 'TILL_UNREACHABLE')
        if (blocked.length > 0) {
          setBlockedTills(blocked)
          setError('')
          setClosing(false)
          // Drawers ahead of the blocked one in the list did close. Leaving them
          // on screen as "still open" invites the admin to count them twice.
          await loadData(true)
          return
        }
        setBlockedTills([])
        // With force on, the guard doesn't throw — it marks the shift unverified.
        blockedForced = (results || [])
          .filter(r => r.unverified)
          .map(r => ({ cashier: r.cashier, tillCode: r.result?.till_code || null }))

        const failed = (results || []).filter(r => r.success === false)
        if (failed.length > 0) {
          setError(`Could not close ${failed.length} shift${failed.length === 1 ? '' : 's'}: ` +
            failed.map(f => `${f.cashier || f.shiftId} (${f.error})`).join('; '))
          setClosing(false)
          return
        }

        // If our own shift was among them, the shift store is now stale.
        if (openShifts.some(s => s.cashier_username === user?.username)) clearShift()
      }

      // 2. Save EOD record
      const diff        = totalReceived - totalExpected
      const cashOk      = Math.abs(diff) < 0.01
      const transferOk  = totalExpectedTransfer === 0 || Math.abs(totalTransferVariance) < 0.01
      const status      = (cashOk && transferOk) ? 'Balanced' : diff > 0 ? 'Overage' : 'Shortage'
      // A day closed over unreachable tills must say so on its own record — the
      // saved figures can still move when those tills sync, and six months later
      // the note is the only thing left explaining why.
      const savedNotes = blockedForced.length > 0
        ? [notes, `⚠️ Closed while ${blockedForced.length} till${blockedForced.length === 1 ? ' was' : 's were'} unreachable ` +
            `(${blockedForced.map(b => `${b.cashier}${b.tillCode ? ` / ${b.tillCode}` : ''}`).join(', ')}). ` +
            `Those shifts are recorded as unverified and these totals may be incomplete.`].filter(Boolean).join('\n')
        : notes
      await addEndOfDay({
        date:           today,
        cashier:        user?.username || 'System',
        total_sales:    totalSales,
        total_expenses: totalExpenses,
        expected_cash:  totalExpected,
        actual_cash:    totalReceived,
        difference:     diff,
        // Stored beside the cash figures, never merged into `difference` — otherwise
        // a $50 cash overage and a $50 transfer shortfall cancel to a clean zero.
        expected_transfer:   totalExpectedTransfer,
        actual_transfer:     totalTransferReceived,
        transfer_difference: totalTransferVariance,
        status,
        notes: savedNotes,
        // Frozen here, while the shifts still say what they said tonight.
        report_snapshot: buildReportPayload(status, diff, new Set(blockedForced.map(b => b.cashier))),
      })

      setNotes('')
      setBlockedTills([])
      setForceUnreachableTills(false)
      try { await window.stocka.lan?.broadcastDayClosed(today, user?.username || 'Admin') } catch (_) {}
      await loadData()
    } catch (err) {
      setError('Failed to close day: ' + err.message)
    } finally {
      setClosing(false)
    }
  }

  // ── Loading state ───────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="eod-page">
        <div className="eod-loading"><div className="eod-spinner" /> Loading…</div>
      </div>
    )
  }

  return (
    <div className="eod-page">

      {/* ── Error banner ── */}
      {(error || printError) && (
        <div className="eod-error-banner">
          <FiAlertCircle size={14} />
          <span>{error || printError}</span>
          <button onClick={() => setError('')}>×</button>
        </div>
      )}

      {/* ── Stats strip ── */}
      <div className="eod-stats-strip">
        <div className="eod-stat">
          <FiShoppingCart size={15} className="eod-stat-icon" />
          <div>
            <div className="eod-stat-label">Total Sales</div>
            <div className="eod-stat-value">{fmt.money(totalSales)}</div>
          </div>
        </div>
        <div className="eod-stat">
          <FiTrendingDown size={15} className="eod-stat-icon neg" />
          <div>
            <div className="eod-stat-label">Expenses</div>
            <div className="eod-stat-value">{fmt.money(totalExpenses)}</div>
          </div>
        </div>
        <div className="eod-stat highlight">
          <FiDollarSign size={15} className="eod-stat-icon" />
          <div>
            <div className="eod-stat-label">Expected Cash</div>
            <div className="eod-stat-value">{fmt.money(totalExpected)}</div>
          </div>
        </div>
        {totalExpectedTransfer > 0 && (
          <div className="eod-stat" style={{ borderColor: '#bfdbfe' }}>
            <FiDollarSign size={15} className="eod-stat-icon" style={{ color: '#1d4ed8' }} />
            <div>
              <div className="eod-stat-label" style={{ color: '#1d4ed8' }}>Expected Transfer</div>
              <div className="eod-stat-value" style={{ color: '#1d4ed8' }}>{fmt.money(totalExpectedTransfer)}</div>
            </div>
          </div>
        )}
        <div className="eod-stat">
          <FiUsers size={15} className="eod-stat-icon" />
          <div>
            <div className="eod-stat-label">Shifts Today</div>
            <div className="eod-stat-value">{shifts.length}</div>
            {openShifts.length > 0 && (
              <div className="eod-stat-sub eod-open-tag">{openShifts.length} still open</div>
            )}
          </div>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════
          ACTIVE STATE — day not yet closed, OR new shifts opened after close
         ══════════════════════════════════════════════════════ */}
      {(!todaysRecord || openShifts.length > 0) ? (
        <div className="eod-active">

          {/* Banner when day was previously closed but a new session opened */}
          {todaysRecord && openShifts.length > 0 && (
            <div className="eod-warn-banner" style={{ background: '#eff6ff', borderColor: '#3b82f6', color: '#1e40af' }}>
              <FiAlertTriangle size={14} />
              <strong>Day was already closed.</strong>
              &nbsp;A new cashier session has been opened since. Close the day again to update the record.
            </div>
          )}

          {shifts.length === 0 ? (
            <div className="eod-no-shifts">
              <FiSun size={44} />
              <h3>No shifts today</h3>
              <p>No cashier shifts were opened today — nothing to reconcile.</p>
            </div>
          ) : (
            <>
              {/* Open-shift warning */}
              {openShifts.length > 0 && (
                <div className="eod-warn-banner">
                  <FiAlertTriangle size={14} />
                  <strong>{openShifts.length} shift{openShifts.length > 1 ? 's' : ''} still open.</strong>
                  &nbsp;Enter the cash collected and Close Day — they will be auto-closed.
                </div>
              )}

              {/* Section title */}
              <div className="eod-section-hd">
                <div>
                  <h2>Cashier Cash Reconciliation</h2>
                  <p>For each cashier, verify the expected cash and enter the amount you collected from them.</p>
                </div>
              </div>

              {/* ── Cashier rows ── */}
              <div className="eod-cashier-list">
                {shifts.map(shift => (
                  <CashierRow
                    key={shift.id}
                    shift={shift}
                    cashVal={cashInputs[shift.id] || ''}
                    onCashChange={val => setCashInputs(prev => ({ ...prev, [shift.id]: val }))}
                    transferVal={transferInputs[shift.id] || ''}
                    onTransferChange={val => setTransferInputs(prev => ({ ...prev, [shift.id]: val }))}
                  />
                ))}
              </div>

              {/* ── Totals bar ── */}
              <div className={`eod-totals-bar ${dayVarStatus}`}>
                <div className="eod-tb-item">
                  <span className="eod-tb-label">Expected Cash</span>
                  <span className="eod-tb-val">{fmt.money(totalExpected)}</span>
                </div>
                <div className="eod-tb-divider" />
                <div className="eod-tb-item">
                  <span className="eod-tb-label">Cash Received</span>
                  <span className="eod-tb-val">{fmt.money(totalReceived)}</span>
                </div>
                <div className="eod-tb-divider" />
                <div className={`eod-tb-item variance ${dayVarStatus}`}>
                  <span className="eod-tb-label">
                    {dayVarStatus === 'balanced' ? 'Cash OK' : dayVarStatus === 'overage' ? 'Cash Over' : 'Cash Short'}
                  </span>
                  <span className="eod-tb-val">
                    {totalVariance >= 0 ? '+' : ''}{fmt.money(totalVariance)}
                  </span>
                </div>
                {totalExpectedTransfer > 0 && (
                  <>
                    <div className="eod-tb-divider" />
                    <div className="eod-tb-item">
                      <span className="eod-tb-label" style={{ color: '#1d4ed8' }}>Expected Transfer</span>
                      <span className="eod-tb-val" style={{ color: '#1d4ed8' }}>{fmt.money(totalExpectedTransfer)}</span>
                    </div>
                    <div className="eod-tb-divider" />
                    <div className="eod-tb-item">
                      <span className="eod-tb-label" style={{ color: '#1d4ed8' }}>Transfer Received</span>
                      <span className="eod-tb-val" style={{ color: '#1d4ed8' }}>{fmt.money(totalTransferReceived)}</span>
                    </div>
                    <div className="eod-tb-divider" />
                    <div className={`eod-tb-item variance ${varianceStatus(totalTransferVariance)}`}>
                      <span className="eod-tb-label">
                        {varianceStatus(totalTransferVariance) === 'balanced' ? 'Transfer OK'
                          : varianceStatus(totalTransferVariance) === 'overage' ? 'Transfer Over'
                          : 'Transfer Short'}
                      </span>
                      <span className="eod-tb-val">
                        {totalTransferVariance >= 0 ? '+' : ''}{fmt.money(totalTransferVariance)}
                      </span>
                    </div>
                  </>
                )}
              </div>

              {/* ── Close Day section ── */}
              <div className="eod-close-card">
                {!reachable && (
                  <div className="eod-offline-block">
                    <FiWifiOff size={16} className="eod-offline-icon" />
                    <div>
                      <div className="eod-offline-title">Can't close the day from this till right now</div>
                      <div className="eod-offline-text">{offlineReason}</div>
                    </div>
                  </div>
                )}
                {blockedTills.length > 0 && (
                  <div className="eod-blocked-block">
                    <FiAlertTriangle size={16} className="eod-blocked-icon" />
                    <div>
                      <div className="eod-blocked-title">
                        {blockedTills.length === 1 ? 'A till is not connected' : `${blockedTills.length} tills are not connected`}
                      </div>
                      <div className="eod-blocked-text">
                        The day was not closed. These drawers sit on machines the Main Computer
                        can't currently account for, so their sales may be missing from the totals
                        above and the variance would be wrong:
                      </div>
                      <ul className="eod-blocked-list">
                        {blockedTills.map(b => (
                          <li key={b.shiftId}>
                            <strong>{b.cashier}</strong>{b.tillCode ? ` — till ${b.tillCode}` : ''}
                            <div>{b.error}</div>
                          </li>
                        ))}
                      </ul>
                      <label className="eod-blocked-ack">
                        <input
                          type="checkbox"
                          checked={forceUnreachableTills}
                          onChange={e => setForceUnreachableTills(e.target.checked)}
                        />
                        <span>
                          Close the day anyway. These shifts will be recorded as
                          <strong> unverified</strong>, and must be rechecked once those tills sync.
                        </span>
                      </label>
                    </div>
                  </div>
                )}

                <div className="eod-close-notes-row">
                  <label>Day Notes <span>(optional)</span></label>
                  <textarea
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                    placeholder="Any notes about the day — shortages, incidents, special events…"
                    rows={2}
                  />
                </div>
                <div className="eod-close-actions">
                  {!canClose && reachable && (
                    <span className="eod-close-hint">
                      <FiAlertCircle size={13} /> Enter cash for all open shifts first
                    </span>
                  )}
                  <button
                    className="eod-close-btn"
                    onClick={handleCloseDay}
                    disabled={closing || !canClose || !reachable || (blockedTills.length > 0 && !forceUnreachableTills)}
                  >
                    {closing
                      ? <><div className="eod-btn-spinner" /> Closing Day…</>
                      : blockedTills.length > 0 && forceUnreachableTills
                        ? <><FiAlertTriangle size={15} /> Close Day Unverified</>
                        : <><FiCheckCircle size={15} /> Close Day & Save</>
                    }
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

      ) : (
        /* ══════════════════════════════════════════════════════
           CLOSED STATE — day already closed
           ══════════════════════════════════════════════════════ */
        <div className="eod-closed-view">

          {/* Hero */}
          <div className={`eod-closed-hero ${todaysRecord.status?.toLowerCase()}`}>
            <div className="eod-closed-hero-left">
              <FiCheckCircle size={28} className="eod-closed-hero-icon" />
              <div>
                <div className="eod-closed-hero-title">Day Closed</div>
                <div className="eod-closed-hero-date">{fmt.date(todaysRecord.date)}</div>
              </div>
            </div>
            <div className="eod-closed-hero-right">
              <button
                className="eod-print-btn"
                onClick={() => handlePrintRecord(todaysRecord)}
                disabled={printingDate === todaysRecord.date}
                title={hasPrinter ? 'Print the day summary' : 'No printer configured'}
              >
                {printingDate === todaysRecord.date
                  ? <><div className="eod-btn-spinner dark" /> Printing…</>
                  : <><FiPrinter size={14} /> Print Summary</>
                }
              </button>
              <div className={`eod-day-badge ${todaysRecord.status?.toLowerCase()}`}>
                {todaysRecord.status}
              </div>
            </div>
          </div>

          {/* Day totals */}
          <div className="eod-closed-totals">
            <div className="eod-ct-row">
              <span>Total Sales</span>
              <span className="pos">{fmt.money(todaysRecord.total_sales)}</span>
            </div>
            <div className="eod-ct-row">
              <span>Expenses</span>
              <span className="neg">−{fmt.money(todaysRecord.total_expenses)}</span>
            </div>
            <div className="eod-ct-row sep">
              <span>Total Expected Cash</span>
              <strong>{fmt.money(todaysRecord.expected_cash)}</strong>
            </div>
            <div className="eod-ct-row">
              <span>Total Cash Collected</span>
              <span>{fmt.money(todaysRecord.actual_cash)}</span>
            </div>
            <div className={`eod-ct-row final ${varianceStatus(todaysRecord.difference)}`}>
              <span>
                {varianceStatus(todaysRecord.difference) === 'balanced' ? 'Cash Balanced' :
                 varianceStatus(todaysRecord.difference) === 'overage'  ? 'Cash Overage' : 'Cash Shortage'}
              </span>
              <span>{fmt.money(todaysRecord.difference)}</span>
            </div>

            {/* Transfers reconcile as their own figure — a day can balance on cash and
                still be short on EcoCash/transfer, which is exactly the case that used
                to save as "Shortage" with difference 0.00 and no way to see why. */}
            {(todaysRecord.expected_transfer || 0) > 0 && (
              <>
                <div className="eod-ct-row sep">
                  <span>Total Expected Transfer</span>
                  <strong style={{ color: '#1d4ed8' }}>{fmt.money(todaysRecord.expected_transfer)}</strong>
                </div>
                <div className="eod-ct-row">
                  <span>Total Transfer Received</span>
                  <span>{fmt.money(todaysRecord.actual_transfer)}</span>
                </div>
                <div className={`eod-ct-row final ${varianceStatus(todaysRecord.transfer_difference)}`}>
                  <span>
                    {varianceStatus(todaysRecord.transfer_difference) === 'balanced' ? 'Transfer Balanced' :
                     varianceStatus(todaysRecord.transfer_difference) === 'overage'  ? 'Transfer Overage' : 'Transfer Shortage'}
                  </span>
                  <span>{fmt.money(todaysRecord.transfer_difference)}</span>
                </div>
              </>
            )}
          </div>

          {todaysRecord.notes && (
            <div className="eod-closed-notes">{todaysRecord.notes}</div>
          )}

          {/* Per-cashier breakdown */}
          {shifts.length > 0 && (
            <div className="eod-breakdown">
              <h3>Per-Cashier Breakdown</h3>
              {shifts.map(shift => (
                <BreakdownRow key={shift.id} shift={shift} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── History ── */}
      {allRecords.length > 0 && (
        <div className="eod-history">
          <button className="eod-history-toggle" onClick={() => setHistoryOpen(h => !h)}>
            <span>History ({allRecords.length} records)</span>
            {historyOpen ? <FiChevronUp size={16} /> : <FiChevronDown size={16} />}
          </button>

          {historyOpen && (
            <div className="eod-history-table">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Sales</th>
                    <th>Expenses</th>
                    <th>Expected</th>
                    <th>Collected</th>
                    <th>Cash Var</th>
                    {anyTransferRecords && <>
                      <th>Transfer Exp</th>
                      <th>Transfer Recv</th>
                      <th>Transfer Var</th>
                    </>}
                    <th>Status</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {allRecords.map(r => {
                    const hasTransfers = (r.expected_transfer || 0) > 0 || (r.actual_transfer || 0) > 0
                    return (
                      <tr key={r.id}>
                        <td>{fmt.date(r.date)}</td>
                        <td>{fmt.money(r.total_sales)}</td>
                        <td>{fmt.money(r.total_expenses)}</td>
                        <td>{fmt.money(r.expected_cash)}</td>
                        <td>{fmt.money(r.actual_cash)}</td>
                        <td className={r.difference >= 0 ? 'pos' : 'neg'}>{fmt.money(r.difference)}</td>
                        {/* Without these a transfer shortfall showed as a 'Shortage' badge sitting
                            next to a cash variance of 0.00, with nothing on the row to explain it. */}
                        {anyTransferRecords && <>
                          <td>{hasTransfers ? fmt.money(r.expected_transfer) : '—'}</td>
                          <td>{hasTransfers ? fmt.money(r.actual_transfer)   : '—'}</td>
                          <td className={hasTransfers ? ((r.transfer_difference || 0) >= 0 ? 'pos' : 'neg') : ''}>
                            {hasTransfers ? fmt.money(r.transfer_difference) : '—'}
                          </td>
                        </>}
                        <td>
                          <span
                            className={`eod-hist-badge ${r.status?.toLowerCase()}`}
                            title={hasTransfers
                              ? `Cash ${fmt.money(r.difference)} · Transfer ${fmt.money(r.transfer_difference)}`
                              : `Cash ${fmt.money(r.difference)}`}
                          >
                            {r.status}
                          </span>
                        </td>
                        <td>
                          <button
                            className="eod-print-icon-btn"
                            onClick={() => handlePrintRecord(r)}
                            disabled={printingDate === r.date}
                            title={hasPrinter ? `Print ${fmt.date(r.date)} summary` : 'No printer configured'}
                          >
                            {printingDate === r.date
                              ? <div className="eod-btn-spinner dark" />
                              : <FiPrinter size={14} />
                            }
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── CashierRow ────────────────────────────────────────────────────────────────
function CashierRow({ shift, cashVal, onCashChange, transferVal, onTransferChange }) {
  const s               = shift.summary || {}
  const isOpen          = shift.status === 'open'
  const expectedCash     = s.expected_cash || 0
  const expectedTransfer = s.expected_transfer || 0

  const parsedCash     = parseFloat(cashVal)
  const parsedTransfer = parseFloat(transferVal)

  const cashVariance     = cashVal !== '' ? (isNaN(parsedCash) ? null : parsedCash - expectedCash) : null
  const cashVarSt        = varianceStatus(cashVariance)

  const transferVariance = expectedTransfer > 0 && transferVal !== ''
    ? (isNaN(parsedTransfer) ? null : parsedTransfer - expectedTransfer)
    : null
  const transferVarSt    = varianceStatus(transferVariance)

  const allEntered      = cashVal !== '' && (expectedTransfer === 0 || transferVal !== '')
  const overallBalanced = allEntered
    && cashVarSt === 'balanced'
    && (expectedTransfer === 0 || transferVarSt === 'balanced')

  return (
    <div className={`eod-cr ${isOpen ? 'eod-cr-open' : 'eod-cr-closed'}`}>

      {/* Header row */}
      <div className="eod-cr-head">
        <div className="eod-cr-avatar">{fmt.initials(shift.cashier_name)}</div>
        <div className="eod-cr-identity">
          <div className="eod-cr-name">{shift.cashier_name}</div>
          <div className="eod-cr-time">
            {fmt.time(shift.started_at)}
            {' → '}
            {isOpen
              ? <span className="eod-cr-still-open">Still open</span>
              : fmt.time(shift.closed_at)
            }
            {' · '}{fmt.dur(shift.started_at, shift.closed_at)}
          </div>
        </div>
        {isOpen
          ? <span className="eod-cr-badge open"><FiClock size={10} /> Open</span>
          : isUnverified(shift.reconciliation_status)
            ? <span className={`eod-cr-badge ${shift.reconciliation_status}`} title={shiftStatusHint(shift.reconciliation_status)}>
                <FiAlertTriangle size={10} /> {shiftStatusShort(shift.reconciliation_status)}
              </span>
            : <span className={`eod-cr-badge ${shift.reconciliation_status || 'closed'}`}>
                <FiCheckCircle size={10} /> Closed
              </span>
        }
      </div>

      {/* Metrics grid */}
      <div className="eod-cr-metrics">
        <div className="eod-cr-m">
          <span className="eod-cr-ml">Cash Sales</span>
          <span className="eod-cr-mv pos">{fmt.money(s.cash_sales)}</span>
        </div>
        {(s.transfer_sales || 0) > 0 && (
          <div className="eod-cr-m">
            <span className="eod-cr-ml" style={{ color: '#1d4ed8' }}>Transfer Sales</span>
            <span className="eod-cr-mv" style={{ color: '#1d4ed8' }}>{fmt.money(s.transfer_sales)}</span>
          </div>
        )}
        {(s.total_expenses || 0) > 0 && (
          <div className="eod-cr-m">
            <span className="eod-cr-ml">Expenses</span>
            <span className="eod-cr-mv neg">−{fmt.money(s.total_expenses)}</span>
          </div>
        )}
        <div className="eod-cr-m expected">
          <span className="eod-cr-ml">Expected Cash</span>
          <span className="eod-cr-mv">{fmt.money(s.expected_cash)}</span>
        </div>
        {expectedTransfer > 0 && (
          <div className="eod-cr-m">
            <span className="eod-cr-ml" style={{ color: '#1d4ed8' }}>Expected Transfer</span>
            <span className="eod-cr-mv" style={{ color: '#1d4ed8' }}>{fmt.money(expectedTransfer)}</span>
          </div>
        )}
      </div>

      {/* Input (open) or closed summary */}
      {isOpen ? (
        <div className="eod-cr-input-area">
          <label>Cash collected from cashier</label>
          <div className="eod-cr-input-row">
            <div className="eod-cr-input-wrap">
              <span className="eod-cr-prefix">$</span>
              <input
                type="number" step="any" min="0"
                value={cashVal}
                onChange={e => onCashChange(e.target.value)}
                placeholder="0.00"
                className="eod-cr-input"
                autoComplete="off"
              />
            </div>
          </div>
          {cashVariance !== null && expectedTransfer > 0 && (
            <div className={`eod-cr-var ${cashVarSt}`} style={{ marginTop: 6 }}>
              {cashVarSt === 'balanced' && <><FiCheckCircle size={12} /> Cash balanced</>}
              {cashVarSt === 'overage'  && <><FiAlertCircle size={12} /> +{fmt.money(cashVariance)} cash over</>}
              {cashVarSt === 'shortage' && <><FiAlertCircle size={12} /> {fmt.money(cashVariance)} cash short</>}
            </div>
          )}

          {expectedTransfer > 0 && (
            <>
              <label style={{ marginTop: 10, display: 'block' }}>Transfer received from cashier</label>
              <div className="eod-cr-input-row">
                <div className="eod-cr-input-wrap">
                  <span className="eod-cr-prefix">$</span>
                  <input
                    type="number" step="any" min="0"
                    value={transferVal}
                    onChange={e => onTransferChange(e.target.value)}
                    placeholder="0.00"
                    className="eod-cr-input"
                    autoComplete="off"
                  />
                </div>
              </div>
              {transferVariance !== null && (
                <div className={`eod-cr-var ${transferVarSt}`} style={{ marginTop: 6 }}>
                  {transferVarSt === 'balanced' && <><FiCheckCircle size={12} /> Transfer balanced</>}
                  {transferVarSt === 'overage'  && <><FiAlertCircle size={12} /> +{fmt.money(transferVariance)} transfer over</>}
                  {transferVarSt === 'shortage' && <><FiAlertCircle size={12} /> {fmt.money(transferVariance)} transfer short</>}
                </div>
              )}
            </>
          )}

          {allEntered && (
            <div className={`eod-cr-var ${overallBalanced ? 'balanced' : cashVariance > 0 || (transferVariance || 0) > 0 ? 'overage' : 'shortage'}`} style={{ marginTop: 8 }}>
              {overallBalanced
                ? <><FiCheckCircle size={12} /> Balanced</>
                : <><FiAlertCircle size={12} /> {expectedTransfer > 0 ? 'Discrepancy found' : cashVarSt === 'overage' ? `+${fmt.money(cashVariance)} over` : `${fmt.money(cashVariance)} short`}</>
              }
            </div>
          )}
        </div>
      ) : (
        <div className="eod-cr-settled">
          <div className="eod-cr-settled-row">
            <span>Cash submitted</span>
            <span className="eod-cr-settled-amt">{fmt.money(shift.closing_cash)}</span>
          </div>
          <div className={`eod-cr-settled-row var ${shift.reconciliation_status || ''}`}>
            <span>Variance</span>
            <span className={(shift.variance || 0) >= 0 ? 'pos' : 'neg'}>
              {(shift.variance || 0) > 0 ? '+' : ''}
              {fmt.money(shift.variance || 0)}
              {' '}
              <span className="eod-cr-settled-label" title={shiftStatusHint(shift.reconciliation_status)}>
                ({shiftStatusShort(shift.reconciliation_status)})
              </span>
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── BreakdownRow (read-only, post-close) ─────────────────────────────────────
function BreakdownRow({ shift }) {
  const s        = shift.summary || {}
  const varSt    = shift.reconciliation_status || 'balanced'
  const variance = shift.variance || 0
  // A drawer nobody counted, or one closed over an unreachable till, has a
  // variance of zero only because there was nothing to compare it against.
  // Every other badge in the app stopped calling that "Balanced" — this one,
  // on the signed-off day summary, is the last place it still did.
  const unverified = isUnverified(shift.reconciliation_status)

  return (
    <div className={`eod-br-row ${varSt}`}>
      <div className="eod-br-left">
        <div className="eod-br-avatar">{fmt.initials(shift.cashier_name)}</div>
        <div>
          <div className="eod-br-name">{shift.cashier_name}</div>
          <div className="eod-br-time">
            {fmt.time(shift.started_at)} → {fmt.time(shift.closed_at)}
            {' · '}{fmt.dur(shift.started_at, shift.closed_at)}
          </div>
        </div>
      </div>

      <div className="eod-br-metrics">
        <span><em>Cash Sales</em> {fmt.money(s.cash_sales)}</span>
        {(s.transfer_sales || 0) > 0 && (
          <span style={{ color: '#1d4ed8' }}><em>Transfer</em> {fmt.money(s.transfer_sales)}</span>
        )}
        <span><em>Exp. Cash</em> {fmt.money(s.expected_cash)}</span>
        <span><em>Collected</em> {fmt.money(shift.closing_cash)}</span>
      </div>

      <div className={`eod-br-status ${varSt}`} title={shiftStatusHint(shift.reconciliation_status)}>
        {unverified
          ? <><FiAlertTriangle size={13} /> {shiftStatusShort(shift.reconciliation_status)}</>
          : Math.abs(variance) < 0.01
            ? <><FiCheckCircle size={13} /> Balanced</>
            : variance > 0
              ? <><FiAlertCircle size={13} /> +{fmt.money(variance)}</>
              : <><FiAlertCircle size={13} /> {fmt.money(variance)}</>
        }
      </div>
    </div>
  )
}
