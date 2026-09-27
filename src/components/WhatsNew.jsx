import { useEffect, useRef, useState } from 'react'
import { CHANGELOG, POPUP_FROM, compareVersions } from '../changelog'
import { APP_VERSION, ReleaseNotes } from './ReleaseNotes.jsx'

const SEEN_KEY = 'lumagrader.seenVersion'
const MAX_ENTRIES = 5

function readSeen() {
  try { return window.localStorage.getItem(SEEN_KEY) } catch { return null }
}
function markSeen() {
  try { window.localStorage.setItem(SEEN_KEY, APP_VERSION) } catch { /* private mode */ }
}

/** Release notes this browser hasn't seen yet — only versions from POPUP_FROM up to the app's. */
function unseenEntries() {
  const seen = readSeen()
  if (seen && compareVersions(seen, APP_VERSION) >= 0) return null
  const list = CHANGELOG.filter((e) =>
    compareVersions(e.version, POPUP_FROM) >= 0 &&
    compareVersions(e.version, APP_VERSION) <= 0 &&
    (!seen || compareVersions(e.version, seen) > 0))
  // First visit: just the current release, not a backlog.
  const shown = seen ? list.slice(0, MAX_ENTRIES) : list.slice(0, 1)
  return shown.length ? shown : null
}

/** Shows once after the app was updated. Dismissed = remembered. */
export default function WhatsNew() {
  const [entries, setEntries] = useState(unseenEntries)
  const closeRef = useRef(null)
  const close = () => { markSeen(); setEntries(null) }

  useEffect(() => {
    if (!entries) return
    closeRef.current?.focus()
    const onKey = (e) => { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [entries])

  if (!entries) return null
  return (
    <div className="modal-overlay" onClick={close}>
      <div className="modal-panel whats-new" role="dialog" aria-modal="true" aria-labelledby="whatsnew-title" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 id="whatsnew-title">What&apos;s new in LumaGrader v{APP_VERSION}</h3>
          <button type="button" className="modal-close" onClick={close} aria-label="Close">×</button>
        </div>
        <div className="modal-body">
          <ReleaseNotes entries={entries} />
        </div>
        <div className="modal-footer">
          <button ref={closeRef} type="button" className="action primary" onClick={close}>Got it</button>
        </div>
      </div>
    </div>
  )
}
