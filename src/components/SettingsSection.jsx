import { FiEdit2 } from 'react-icons/fi'
import './Modal.css'
import './SettingsSection.css'

// A settings card that shows what is saved, and only becomes a form when you ask.
//
// Every settings form used to be permanently editable — a page of live inputs you
// could change by accident, with nothing to tell you what was actually saved. Now a
// section reads like a record, has an Edit button, and puts Save / Cancel in front
// of you only while you are changing it.
//
// Only ONE section may be in edit mode at a time (the parent holds a single key).
// That is not a style choice: shop details, receipt and business rules all save the
// same underlying shop record, so two half-edited sections would mean saving one
// quietly saved the other's unfinished changes too.

export function SettingsSection({
  icon,
  title,
  desc,
  sectionKey,
  editing,
  onEdit,
  onCancel,
  onSubmit,
  saving = false,
  canEdit = true,
  editLabel = 'Edit',
  saveLabel = 'Save changes',
  children,
}) {
  const isEditing = editing === sectionKey
  const someoneElse = Boolean(editing) && !isEditing

  const body = typeof children === 'function' ? children(isEditing) : children

  return (
    <div className={`s-card ss-card${isEditing ? ' is-editing' : ''}`}>
      <div className="s-card-head">
        <div>
          <h2 className="s-card-title">{icon} {title}</h2>
          {desc && <p className="s-card-desc">{desc}</p>}
        </div>
        {canEdit && !isEditing && (
          <button
            type="button"
            className="ss-edit-btn"
            onClick={() => onEdit(sectionKey)}
            disabled={someoneElse}
            title={someoneElse ? 'Finish the section you are editing first' : undefined}
          >
            <FiEdit2 size={13} /> {editLabel}
          </button>
        )}
        {isEditing && <span className="ss-editing-tag">Editing</span>}
      </div>

      {isEditing ? (
        <form onSubmit={onSubmit} noValidate>
          <div className="ss-body">{body}</div>
          <div className="ss-actions">
            <button type="button" className="smodal-btn" onClick={onCancel} disabled={saving}>Cancel</button>
            <button type="submit" className="smodal-btn smodal-btn-primary" disabled={saving}>
              {saving ? 'Saving...' : saveLabel}
            </button>
          </div>
        </form>
      ) : (
        <div className="ss-body ss-view">{body}</div>
      )}
    </div>
  )
}

// One saved value, read-only. Formats blanks as "Not set" rather than an empty gap.
export function InfoRow({ label, value, placeholder = 'Not set', hint }) {
  const empty = value === null || value === undefined || value === ''
  return (
    <div className="ss-row">
      <span className="ss-row-label">{label}</span>
      <span className={`ss-row-value${empty ? ' is-empty' : ''}`}>
        {empty ? placeholder : value}
        {hint && <span className="ss-row-hint">{hint}</span>}
      </span>
    </div>
  )
}
