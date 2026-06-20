import { FiLogOut, FiCheckCircle, FiX } from 'react-icons/fi'
import './SignOutModal.css'

export default function SignOutModal({ hasShift, onCloseShift, onSignOutOnly, onStay }) {
  return (
    <div className="so-overlay">
      <div className="so-card">
        <div className="so-icon-wrap">
          <FiLogOut size={30} />
        </div>

        <h2 className="so-title">Sign Out</h2>

        {hasShift ? (
          <>
            <p className="so-subtitle">
              You have an active shift. What would you like to do?
            </p>

            <div className="so-options">
              <button className="so-option so-option--primary" onClick={onCloseShift}>
                <span className="so-option-icon"><FiCheckCircle size={22} /></span>
                <span className="so-option-body">
                  <span className="so-option-title">Close Shift &amp; Sign Out</span>
                  <span className="so-option-desc">Count your cash, submit your closing float, then log out</span>
                </span>
              </button>

              <button className="so-option so-option--secondary" onClick={onSignOutOnly}>
                <span className="so-option-icon"><FiLogOut size={22} /></span>
                <span className="so-option-body">
                  <span className="so-option-title">Sign Out Only</span>
                  <span className="so-option-desc">Leave your shift open — another admin can close it later</span>
                </span>
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="so-subtitle">Are you sure you want to sign out?</p>
            <div className="so-options">
              <button className="so-option so-option--primary" onClick={onSignOutOnly}>
                <span className="so-option-icon"><FiLogOut size={22} /></span>
                <span className="so-option-body">
                  <span className="so-option-title">Yes, Sign Out</span>
                  <span className="so-option-desc">You will be returned to the login screen</span>
                </span>
              </button>
            </div>
          </>
        )}

        <button className="so-stay" onClick={onStay}>
          <FiX size={14} />
          Stay logged in
        </button>
      </div>
    </div>
  )
}
