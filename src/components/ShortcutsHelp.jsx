import { useEffect, useRef } from 'react'
import { SHORTCUTS } from '../engine/keyboard'

export default function ShortcutsHelp({ onClose }) {
  const closeRef = useRef(null)

  useEffect(() => {
    closeRef.current?.focus()
    function onKey(e) {
      if (e.key === 'Escape' || e.key === '?') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const groups = [...new Set(SHORTCUTS.map((s) => s.group))]

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel shortcuts-panel" role="dialog" aria-modal="true" aria-labelledby="shortcuts-title" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 id="shortcuts-title">Keyboard shortcuts</h3>
          <button ref={closeRef} type="button" className="modal-close" onClick={onClose} aria-label="Close shortcuts">×</button>
        </div>
        <div className="modal-body shortcuts-body">
          {groups.map((group) => (
            <section key={group}>
              <h4 className="modal-subhead">{group}</h4>
              <dl className="shortcut-list">
                {SHORTCUTS.filter((s) => s.group === group).map((s) => (
                  <div className="shortcut-row" key={s.label}>
                    <dt>{s.label}</dt>
                    <dd>
                      {s.keys.map((k) => (
                        <kbd key={k}>{k}</kbd>
                      ))}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}
