import { useState, useEffect, useCallback } from 'react'
import { LuFileText, LuDownload, LuSheet, LuLock, LuTriangleAlert, LuHistory, LuRefreshCw } from 'react-icons/lu'
import * as XLSX from 'xlsx'
import {
  listReports, runReport, getReportHtml, getReportPdfUrl,
  saveReportSnapshot, listReportSnapshots, getReportSnapshot, isMainRequired,
} from '../database/db'
import { useAuthStore } from '../store/useAuthStore'
import './BusinessReports.css'

// Business reports.
//
// This page contains ZERO business logic, and that is the point of the whole
// architecture. It picks a period, asks the engine for a document, and shows
// the HTML the engine produced. Every figure comes from the metric engine, so
// this page cannot disagree with the dashboard or with the PDF.
//
// The preview is an <iframe srcDoc> of the engine's own HTML rather than a
// React re-implementation of the sections. That means what you see here is
// byte-identical to what prints — there is no second renderer to drift.

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

export default function BusinessReports() {
  const { user } = useAuthStore()
  const now = new Date()

  const [templates, setTemplates] = useState([])
  const [reportId, setReportId] = useState('monthly-business-review')
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)

  const [doc, setDoc] = useState(null)
  const [html, setHtml] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [message, setMessage] = useState(null)
  const [snapshots, setSnapshots] = useState([])
  const [showHistory, setShowHistory] = useState(false)

  const period = { type: 'month', year: Number(year), month: Number(month) }

  useEffect(() => {
    listReports().then(setTemplates).catch(() => setTemplates([]))
    refreshSnapshots()
  }, [])

  const refreshSnapshots = () =>
    listReportSnapshots({ limit: 30 }).then(setSnapshots).catch(() => setSnapshots([]))

  const describeError = (err) =>
    isMainRequired(err)
      ? 'Reports are produced on the Main Computer, which this till cannot reach right now.'
      : err.message

  const generate = useCallback(async () => {
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const [d, h] = await Promise.all([
        runReport(reportId, period),
        getReportHtml(reportId, period),
      ])
      setDoc(d)
      setHtml(h)
    } catch (err) {
      setError(describeError(err))
      setDoc(null)
      setHtml('')
    } finally {
      setBusy(false)
    }
  }, [reportId, year, month])

  const downloadPdf = async () => {
    setBusy(true)
    try {
      const { url, title } = await getReportPdfUrl(reportId, period, null, { document: doc })
      const a = document.createElement('a')
      a.href = url
      a.download = `${title} — ${doc?.period?.label || ''}.pdf`.replace(/[\\/:*?"<>|]/g, '-')
      a.click()
      // Revoked on a delay so the download has actually started.
      setTimeout(() => URL.revokeObjectURL(url), 30000)
    } catch (err) {
      setError(describeError(err))
    } finally {
      setBusy(false)
    }
  }

  // The engine hands back a workbook SPEC — sheets of raw values. SheetJS lives
  // here in the renderer, so the main process never loads a spreadsheet parser
  // next to the database.
  const downloadExcel = async () => {
    setBusy(true)
    try {
      const spec = await window.stocka.analytics.reportWorkbook(reportId, period, null, { document: doc })
      const wb = XLSX.utils.book_new()
      for (const sheet of spec.sheets) {
        const ws = XLSX.utils.aoa_to_sheet(sheet.rows)
        if (sheet.colWidths) ws['!cols'] = sheet.colWidths.map((w) => ({ wch: w }))
        XLSX.utils.book_append_sheet(wb, ws, sheet.name)
      }
      XLSX.writeFile(wb, spec.filename)
      setMessage(`Exported ${spec.sheets.length} sheets.`)
    } catch (err) {
      setError(describeError(err))
    } finally {
      setBusy(false)
    }
  }

  // Freezing is what makes a reprint trustworthy: the stored document reprints
  // exactly, so a void entered next week cannot rewrite this month's figures.
  const freeze = async () => {
    if (!doc) return
    setBusy(true)
    try {
      const saved = await saveReportSnapshot(doc, user?.username || 'System')
      await refreshSnapshots()
      setMessage(`Saved. This report will now reprint exactly as it is, even if data changes later (#${saved.id}).`)
    } catch (err) {
      setError(describeError(err))
    } finally {
      setBusy(false)
    }
  }

  const openSnapshot = async (id) => {
    setBusy(true)
    try {
      const row = await getReportSnapshot(id)
      setDoc(row.document)
      setHtml(await getReportHtml(null, null, null, { document: row.document }))
      setShowHistory(false)
      setMessage(`Showing the saved copy from ${new Date(row.created_at).toLocaleString('en-ZA')}.`)
    } catch (err) {
      setError(describeError(err))
    } finally {
      setBusy(false)
    }
  }

  const confidence = doc?.quality?.confidence
  const years = Array.from({ length: 6 }, (_, i) => now.getFullYear() - i)

  return (
    <div className="business-reports">
      <div className="page-header">
        <h1>Business Reports</h1>
        <p>Answers about how the business performed, not just tables of data</p>
      </div>

      <div className="br-controls">
        <label className="br-field">
          <span>Report</span>
          <select value={reportId} onChange={(e) => setReportId(e.target.value)}>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>{t.title}</option>
            ))}
          </select>
        </label>

        <label className="br-field">
          <span>Month</span>
          <select value={month} onChange={(e) => setMonth(Number(e.target.value))}>
            {MONTHS.map((m, i) => (
              <option key={m} value={i + 1}>{m}</option>
            ))}
          </select>
        </label>

        <label className="br-field">
          <span>Year</span>
          <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {years.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </label>

        <button className="btn-primary" onClick={generate} disabled={busy}>
          {busy ? 'Working…' : 'Generate report'}
        </button>

        <button className="btn-ghost" onClick={() => { setShowHistory(!showHistory); refreshSnapshots() }}>
          <LuHistory /> Saved reports
        </button>
      </div>

      {error && (
        <div className="br-alert error">
          <LuTriangleAlert /> <span>{error}</span>
          <button className="br-retry" onClick={generate}><LuRefreshCw /> Retry</button>
        </div>
      )}
      {message && <div className="br-alert ok">{message}</div>}

      {showHistory && (
        <div className="br-history">
          <h3>Saved reports</h3>
          {snapshots.length === 0 ? (
            <p className="br-empty">Nothing saved yet. Generate a report and choose “Freeze this report”.</p>
          ) : (
            <table>
              <thead>
                <tr><th>Report</th><th>Period</th><th>Confidence</th><th>Saved</th><th>By</th><th /></tr>
              </thead>
              <tbody>
                {snapshots.map((s) => (
                  <tr key={s.id}>
                    <td>{s.report_id}</td>
                    <td>{s.period_start} → {s.period_end}</td>
                    <td className={`br-conf ${s.quality_confidence}`}>{s.quality_confidence || '—'}</td>
                    <td>{new Date(s.created_at).toLocaleString('en-ZA')}</td>
                    <td>{s.created_by}</td>
                    <td><button className="btn-ghost sm" onClick={() => openSnapshot(s.id)}>Open</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {doc && (
        <div className="br-actions">
          <div className={`br-confidence ${confidence}`}>
            <strong>{doc.period?.label}</strong>
            <span>
              {confidence === 'high'
                ? 'Figures verified'
                : confidence === 'medium'
                  ? 'Usable, with caveats'
                  : 'Missing information — see the report'}
            </span>
          </div>
          <div className="br-buttons">
            <button className="btn-secondary" onClick={downloadPdf} disabled={busy}>
              <LuDownload /> PDF
            </button>
            <button className="btn-secondary" onClick={downloadExcel} disabled={busy}>
              <LuSheet /> Excel
            </button>
            <button className="btn-secondary" onClick={freeze} disabled={busy}>
              <LuLock /> Freeze this report
            </button>
          </div>
        </div>
      )}

      {html ? (
        // srcDoc, sandboxed with no allow-scripts: the report is static, so
        // nothing in it needs to run — and nothing in it can.
        <iframe className="br-preview" title="Report preview" sandbox="" srcDoc={html} />
      ) : (
        !busy && !error && (
          <div className="br-placeholder">
            <LuFileText />
            <h2>Choose a period and generate</h2>
            <p>
              The report shows what happened, why, and what to do next — and states plainly how far
              its own figures can be trusted.
            </p>
          </div>
        )
      )}
    </div>
  )
}
