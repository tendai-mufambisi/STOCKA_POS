import { FiDelete } from 'react-icons/fi'
import './NumericKeypad.css'

// On-screen keypad for touch tills — edits a string amount ("12.50") via onChange.
// Keeps the same string format the payment inputs already use, so physical
// keyboard entry and keypad taps can be mixed freely.
function NumericKeypad({ value, onChange, disabled = false }) {
  const press = (key) => {
    if (disabled) return
    const v = String(value ?? '')

    if (key === 'back') { onChange(v.slice(0, -1)); return }
    if (key === 'clear') { onChange(''); return }
    if (key === '.') {
      if (v.includes('.')) return
      onChange(v === '' ? '0.' : v + '.')
      return
    }
    // digit — cap at 2 decimals and a sane whole-number length
    const [, dec] = v.split('.')
    if (dec !== undefined && dec.length >= 2) return
    if (dec === undefined && v.replace('.', '').length >= 7) return
    onChange(v + key)
  }

  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'back']

  return (
    <div className="numpad">
      {keys.map(k => (
        <button
          key={k}
          type="button"
          className={`numpad-key${k === 'back' ? ' numpad-key--back' : ''}`}
          // preventDefault keeps focus in the amount input so the caret/selection is preserved
          onMouseDown={e => e.preventDefault()}
          onClick={() => press(k)}
          disabled={disabled}
          aria-label={k === 'back' ? 'Delete last digit' : k}
        >
          {k === 'back' ? <FiDelete size={20} /> : k}
        </button>
      ))}
    </div>
  )
}

export default NumericKeypad
