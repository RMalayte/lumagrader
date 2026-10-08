import { useEffect, useRef, useState } from 'react'
import Icon from './Icon.jsx'

/** Closes a dropdown on outside press or Escape. */
export function useDismiss(open, setOpen, ref) {
  useEffect(() => {
    if (!open) return
    function onPointerDown(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    function onKeyDown(e) {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open, setOpen, ref])
}

/**
 * The header's "⋯" menu: secondary commands live here so the top bar keeps only what is used
 * all the time. `items` entries:
 *   { label, icon, onClick, kbd?, danger?, checked?, hidden? }  — a command
 *   { href, label, icon }                                       — an external link
 *   { sep: true }  ·  { heading: 'Text' }
 *   { row: [{ label, onClick, current }] }                      — a small segmented choice
 */
export default function MoreMenu({ items, label = 'More', className = '' }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useDismiss(open, setOpen, ref)
  const shown = items.filter((it) => it && !it.hidden)

  const run = (fn) => () => {
    setOpen(false)
    fn?.()
  }

  return (
    <div className={'menu-anchor ' + className} ref={ref}>
      <button
        type="button"
        className={'tbtn icon-only' + (open ? ' active' : '')}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={label}
      >
        <Icon name="more" size={18} strokeWidth={3} />
      </button>
      {open && (
        <div className="dropdown-menu more-menu" role="menu">
          {shown.map((it, i) => {
            if (it.sep) return <div key={'s' + i} className="menu-sep" role="separator" />
            if (it.heading) return <div key={'h' + i} className="menu-label">{it.heading}</div>
            if (it.row) {
              return (
                <div key={'r' + i} className="menu-row" role="group" aria-label={it.ariaLabel}>
                  {it.row.map((opt) => (
                    <button
                      key={opt.label}
                      type="button"
                      role="menuitemradio"
                      aria-checked={!!opt.current}
                      className={opt.current ? 'is-current' : ''}
                      title={opt.title || opt.label}
                      onClick={() => opt.onClick()} // keeps the menu open: try sizes side by side
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              )
            }
            if (it.href) {
              return (
                <a key={it.label} role="menuitem" className="menu-link" href={it.href} target="_blank" rel="noopener noreferrer" onClick={() => setOpen(false)}>
                  {it.icon && <Icon name={it.icon} size={14} />} {it.label}
                </a>
              )
            }
            return (
              <button
                key={it.label}
                type="button"
                role={it.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
                aria-checked={it.checked === undefined ? undefined : it.checked}
                className={(it.danger ? 'danger-item' : '') + (it.current ? ' is-current' : '')}
                onClick={run(it.onClick)}
                disabled={it.disabled}
                title={it.title}
              >
                {it.icon && <Icon name={it.icon} size={14} />} {it.label}
                {it.kbd && <kbd>{it.kbd}</kbd>}
                {it.checked && <Icon name="check" size={14} className="menu-check" />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
