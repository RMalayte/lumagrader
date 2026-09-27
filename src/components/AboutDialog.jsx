import { useEffect, useRef } from 'react'
import { CHANGELOG } from '../changelog'
import { APP_VERSION, BUILD_DATE, ReleaseNotes } from './ReleaseNotes.jsx'
import logo from '../assets/logo-wordmark.webp'
import { kofiUrl } from '../config'
import Icon from './Icon.jsx'

const REPO = 'https://github.com/RMalayte/lumagrader'

export default function AboutDialog({ onClose }) {
  const closeRef = useRef(null)
  useEffect(() => {
    closeRef.current?.focus()
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel about-panel" role="dialog" aria-modal="true" aria-labelledby="about-title" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 id="about-title">About LumaGrader</h3>
          <button ref={closeRef} type="button" className="modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="modal-body">
          <div className="about-hero">
            <img src={logo} alt="LumaGrader by Rax" className="about-logo" width="508" height="120" />
            <div className="about-version">Version {APP_VERSION} · built {BUILD_DATE}</div>
            <p>Browser-based RAW &amp; photo editor. Your photos never leave your device —
              everything runs in this browser; no account, no upload, no tracking.</p>
            {kofiUrl() && (
              <div className="about-support">
                <a className="action primary support-btn" href={kofiUrl()} target="_blank" rel="noopener noreferrer">
                  <Icon name="coffee" size={16} /> Support LumaGrader on Ko-fi
                </a>
                <p className="about-small">LumaGrader is free. Tips keep it free and help pay for new features.</p>
              </div>
            )}
            <div className="about-links">
              <a href={`${REPO}/blob/main/docs/USER_GUIDE.md`} target="_blank" rel="noopener noreferrer">User guide</a>
              <a href={REPO} target="_blank" rel="noopener noreferrer">Source code (GitHub)</a>
              <a href={`${REPO}/issues`} target="_blank" rel="noopener noreferrer">Report a problem</a>
            </div>
          </div>

          <h4 className="modal-subhead">What&apos;s new</h4>
          <ReleaseNotes entries={CHANGELOG} />

          <h4 className="modal-subhead">License &amp; credits</h4>
          <p className="about-small">
            © 2026 LumaGrader — released under the MIT License. RAW decoding by LibRaw (LGPL-2.1 / CDDL-1.0) via
            libraw-wasm; also uses React, exifr, JSZip, piexifjs and extract-raw-preview (MIT).
          </p>
        </div>
      </div>
    </div>
  )
}
