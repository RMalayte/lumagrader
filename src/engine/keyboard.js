const NAV_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'])
const NON_TEXT_INPUTS = new Set(['range', 'checkbox', 'radio', 'color', 'button', 'submit', 'file'])

/**
 * True when a global shortcut should NOT fire: the user is typing in a text field, a modal
 * dialog is open, or a slider has focus and the key would move it.
 */
export function shouldIgnoreShortcut(e) {
  if (document.querySelector('.modal-overlay')) return true
  const el = e.target
  if (!el || el === document.body) return false
  if (el.isContentEditable) return true
  const tag = el.tagName
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (tag === 'INPUT') {
    if (NON_TEXT_INPUTS.has(el.type)) return NAV_KEYS.has(e.key)
    return true
  }
  return false
}

export const isMod = (e) => e.ctrlKey || e.metaKey

export const SHORTCUTS = [
  { group: 'Editing', keys: ['Ctrl/⌘', 'Z'], label: 'Undo' },
  { group: 'Editing', keys: ['Ctrl/⌘', 'Shift', 'Z'], label: 'Redo' },
  { group: 'Editing', keys: ['Ctrl/⌘', 'S'], label: 'Save project' },
  { group: 'Editing', keys: ['Ctrl/⌘', 'E'], label: 'Export this photo' },
  { group: 'Editing', keys: ['Del'], label: 'Remove photo (undoable)' },
  { group: 'View', keys: ['\\'], label: 'Before / After' },
  { group: 'View', keys: ['Z'], label: 'Toggle Fit ↔ 1:1' },
  { group: 'View', keys: ['+', '−'], label: 'Zoom in / out' },
  { group: 'View', keys: ['J'], label: 'Show clipping (highlights & shadows)' },
  { group: 'View', keys: ['R'], label: 'Crop' },
  { group: 'View', keys: ['F'], label: 'Fullscreen' },
  { group: 'View', keys: ['I'], label: 'Show / hide photo info' },
  { group: 'Library', keys: ['←', '→'], label: 'Previous / next photo' },
  { group: 'Library', keys: ['1–5'], label: 'Star rating' },
  { group: 'Library', keys: ['0'], label: 'Clear rating' },
  { group: 'Help', keys: ['?'], label: 'Show this list' },
]
