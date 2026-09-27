import { useEffect, useRef, useState } from 'react'
import { CHANGELOG, compareVersions } from '../changelog'

const SEEN_KEY = 'lumagrader.seenVersion'
export const APP_VERSION = __APP_VERSION__
export const BUILD_DATE = __BUILD_DATE__

function readSeen() {
  try { return window.localStorage.getItem(SEEN_KEY) } catch { return null }
}
function markSeen() {
  try { window.localStorage.setItem(SEEN_KEY, APP_VERSION) } catch { /* private mode */ }
}

export function ReleaseNotes({ entries }) {
  return entries.map((e) => (
    <section key={e.version} className="release">
      <h4 className="release-head">
        <span className="release-version">v{e.version}</span> {e.title}
        <span className="release-date">{e.date}</span>
      </h4>
      <ul>
        {e.items.map((it) => <li key={it}>{it}</li>)}
      </ul>
    </section>
  ))
}

/**
 * Shows once after the app was updated: the notes of every version newer than the one this
 * browser last saw (first visit: just the current version). Dismissed = remembered.
 */
export default function WhatsNew() {
  const [entries, setEntries] = useState(() => {
    const seen = readSeen()
    if (seen && compareVersions(seen, APP_VERSION) >= 0) return null
    const newer = CHANGELOG.filter((e) => compareVersions(e.version, APP_VERSION) <= 0 && (!seen || compareVersions(e.version, seen) > 0))
    const list = seen ? newer.slice(0, 5) : newer.slice(0, 1)
    return list.length ? list : null
  })
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
