import CashierSessions from './CashierSessions'
import ShiftDashboard from './ShiftDashboard'
import './CashiersShifts.css'

// Cashier Sessions and Shift Management were two sidebar entries showing the same
// thing from two sides: who is on the till right now, and every shift that has
// run. They are one place now, with a tab for each. The tabs are still the two
// original pages (and the two role privileges), so a Manager who may see one
// but not the other only gets that one.
export default function CashiersShifts({ activePage, onNavigate, canLive, canHistory }) {
  const tab = activePage === 'shifts' || !canLive ? 'shifts' : 'cashier-sessions'
  const tabs = [
    canLive && { id: 'cashier-sessions', label: 'On the till now', hint: 'Who is selling, live' },
    canHistory && { id: 'shifts', label: 'All shifts', hint: 'Open and closed, cash counts, closing' },
  ].filter(Boolean)

  return (
    <div className="cs-page">
      {tabs.length > 1 && (
        <div className="cs-tabs" role="tablist" aria-label="Cashiers and shifts">
          {tabs.map(t => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              className={`cs-tab${tab === t.id ? ' active' : ''}`}
              onClick={() => onNavigate(t.id)}
            >
              <span className="cs-tab-label">{t.label}</span>
              <span className="cs-tab-hint">{t.hint}</span>
            </button>
          ))}
        </div>
      )}
      <div className="cs-body">
        {tab === 'shifts' ? <ShiftDashboard /> : <CashierSessions />}
      </div>
    </div>
  )
}
