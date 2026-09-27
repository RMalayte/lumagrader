import { useState } from 'react'
import { useProject } from '../store/ProjectContext'
import { usePanelControls } from '../hooks/usePanelControls'
import Icon from './Icon.jsx'

// Sidebar section. Three ways to control open state:
//  - `id`: shared, auto-closing sidebar accordion (opening one closes the rest)
//  - `open` + `onToggle`: fully controlled by the parent
//  - neither: local state
// Pass `panelId` to get the edited dot plus per-panel reset and on/off (bypass) buttons.
export default function Accordion({ title, id, panelId, defaultOpen = false, open: controlledOpen, onToggle, children }) {
  const { state, dispatch } = useProject()
  const [internalOpen, setInternalOpen] = useState(defaultOpen)
  const { edited, bypassed, reset, toggleBypass } = usePanelControls(panelId, title)

  const open = id ? state.openAccordionId === id : controlledOpen !== undefined ? controlledOpen : internalOpen

  function toggle() {
    if (id) dispatch({ type: 'SET_OPEN_ACCORDION', id: open ? null : id })
    else if (controlledOpen !== undefined) onToggle?.(!open)
    else setInternalOpen((v) => !v)
  }

  const bodyId = `acc-body-${id || panelId || title.replace(/\W+/g, '-').toLowerCase()}`

  return (
    <div className={'accordion' + (bypassed ? ' is-bypassed' : '')}>
      <div className="accordion-header">
        <button type="button" className="accordion-summary" onClick={toggle} aria-expanded={open} aria-controls={bodyId}>
          <span className="accordion-title">
            {title}
            {edited && <span className={'edited-dot' + (bypassed ? ' off' : '')} title={bypassed ? 'Edited (hidden)' : 'Edited'} />}
          </span>
          <Icon name="chevronDown" size={14} className={'accordion-chevron' + (open ? ' open' : '')} />
        </button>
        {edited && (
          <div className="accordion-actions">
            <button
              type="button"
              className={'icon-btn' + (bypassed ? ' is-off' : '')}
              onClick={toggleBypass}
              aria-pressed={bypassed}
              aria-label={bypassed ? `Show ${title} adjustments` : `Hide ${title} adjustments`}
              title={bypassed ? `Show ${title} adjustments` : `Hide ${title} adjustments (compare)`}
            >
              <Icon name={bypassed ? 'eyeOff' : 'eye'} size={14} />
            </button>
            <button type="button" className="icon-btn" onClick={reset} aria-label={`Reset ${title}`} title={`Reset ${title}`}>
              <Icon name="reset" size={14} />
            </button>
          </div>
        )}
      </div>
      {open && (
        <div className="accordion-body" id={bodyId}>
          {children}
        </div>
      )}
    </div>
  )
}
