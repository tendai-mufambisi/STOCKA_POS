import './AreaLayout.css'

// A section of the app with its own inner menu, the way Settings works.
//
// The main sidebar used to list twenty-two pages at once. The ones used every
// day now sit there on their own; everything else lives inside an area (Stock,
// Money & Reports) and is reached through this inner menu, so the main sidebar
// stays short enough to read at a glance.
export default function AreaLayout({ area, items, activePage, onNavigate, children }) {
  const Icon = area.icon
  return (
    <div className="area-layout">
      <nav className="area-nav" aria-label={area.label}>
        <div className="area-nav-head">
          <span className="area-nav-icon"><Icon size={18} /></span>
          <div>
            <h2 className="area-nav-title">{area.label}</h2>
            {area.desc && <p className="area-nav-desc">{area.desc}</p>}
          </div>
        </div>

        {area.groups.map(group => {
          const visible = group.items.filter(item => items.includes(item.id))
          if (visible.length === 0) return null
          return (
            <div key={group.label} className="area-nav-group">
              <span className="area-nav-label">{group.label}</span>
              {visible.map(item => {
                const ItemIcon = item.icon
                const on = activePage === item.id
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={`area-nav-item${on ? ' active' : ''}`}
                    aria-current={on ? 'page' : undefined}
                    onClick={() => onNavigate(item.id)}
                  >
                    <ItemIcon size={17} />
                    <span className="area-nav-words">
                      <span className="area-nav-name">{item.label}</span>
                      {item.hint && <span className="area-nav-hint">{item.hint}</span>}
                    </span>
                  </button>
                )
              })}
            </div>
          )
        })}
      </nav>

      <section className="area-content">{children}</section>
    </div>
  )
}
