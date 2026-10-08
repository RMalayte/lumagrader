import { useCallback, useEffect, useRef, useState } from 'react'
import Icon from './Icon.jsx'
import { kofiUrl, SUPPORT_EVENT } from '../config'
import logo from '../assets/logo-wordmark.webp'

// "Support LumaGrader" card, shown centred after a successful export (at most once a week —
// see takeSupportNudge). It waits until the browser's own "Save as…" dialog is closed: while
// that dialog is open the page has no focus, so the card appears once focus comes back.
const SETTLE_MS = 700 // time for a "Save as…" dialog to open (the page loses focus) …
const AFTER_FOCUS_MS = 400 // … and a moment after it closes before the card appears
const GIVE_UP_MS = 2 * 60 * 1000 // never pop up long after the export

export default function SupportPrompt() {
  const [open, setOpen] = useState(null) // { count } while shown
  const primaryRef = useRef(null)
  const close = useCallback(() => setOpen(null), [])

  useEffect(() => {
    let timers = []
    let cleanupFocus = null
    function show(detail) {
      setOpen({ count: detail?.count || 1 })
    }
    function onRequest(e) {
      const detail = e.detail
      const startedAt = Date.now()
      timers.push(setTimeout(() => {
        if (document.hasFocus() && document.visibilityState === 'visible') return show(detail)
        // A save dialog (or another window) has focus: wait until the user is back.
        const onBack = () => {
          if (!document.hasFocus() || document.visibilityState !== 'visible') return
          cleanup()
          if (Date.now() - startedAt < GIVE_UP_MS) timers.push(setTimeout(() => show(detail), AFTER_FOCUS_MS))
        }
        const cleanup = () => {
          window.removeEventListener('focus', onBack)
          document.removeEventListener('visibilitychange', onBack)
          cleanupFocus = null
        }
        window.addEventListener('focus', onBack)
        document.addEventListener('visibilitychange', onBack)
        cleanupFocus = cleanup
      }, SETTLE_MS))
    }
    window.addEventListener(SUPPORT_EVENT, onRequest)
    return () => {
      window.removeEventListener(SUPPORT_EVENT, onRequest)
      timers.forEach(clearTimeout)
      cleanupFocus?.()
    }
  }, [])

  useEffect(() => {
    if (!open) return
    primaryRef.current?.focus()
    const onKey = (e) => e.key === 'Escape' && close()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, close])

  if (!open || !kofiUrl()) return null
  const what = open.count > 1 ? `Your ${open.count} photos are exported` : 'Your photo is exported'

  return (
    <div className="modal-overlay support-overlay" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal-panel support-card" role="dialog" aria-modal="true" aria-labelledby="support-title">
        <button type="button" className="support-close" onClick={close} aria-label="Close">
          <Icon name="close" size={16} />
        </button>
        <img src={logo} alt="LumaGrader" className="support-logo" width="666" height="120" />
        <div className="support-done"><Icon name="check" size={15} /> {what}</div>
        <h3 id="support-title" className="support-title">Enjoying LumaGrader?</h3>
        <p className="support-text">
          LumaGrader is free, with no ads and no account, and your photos never leave your device.
          If it helped you today, a coffee helps keep it that way.
        </p>
        <div className="support-actions">
          <a
            ref={primaryRef}
            className="action primary support-primary"
            href={kofiUrl()}
            target="_blank"
            rel="noopener noreferrer"
            onClick={close}
          >
            ☕ Support on Ko-fi
          </a>
          <button type="button" className="action secondary" onClick={close}>Maybe later</button>
        </div>
      </div>
    </div>
  )
}
