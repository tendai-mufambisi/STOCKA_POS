import { FiLock, FiAlertTriangle } from 'react-icons/fi'
import { useSaleStore } from '../store/useSaleStore'
import './ShiftForceClosedModal.css'

export default function ShiftForceClosedModal({ onLogout }) {
  const { saleInProgress } = useSaleStore()

  return (
    <div className="sfc-overlay">
      <div className="sfc-card">
        <div className="sfc-icon-wrap">
          <FiLock size={36} />
        </div>
        <h2 className="sfc-title">Shift Closed by Manager</h2>
        <p className="sfc-msg">
          The manager has ended the business day and closed your shift.
        </p>

        {saleInProgress ? (
          <div className="sfc-sale-warning">
            <FiAlertTriangle size={16} />
            <span>You have an active sale — please complete it, then log out.</span>
          </div>
        ) : (
          <p className="sfc-sub">Please log out now.</p>
        )}

        <button
          className="sfc-btn"
          onClick={onLogout}
          disabled={saleInProgress}
        >
          <FiLock size={15} />
          {saleInProgress ? 'Finish sale first…' : 'Log Out'}
        </button>
      </div>
    </div>
  )
}
