import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import ThumbnailStrip from './components/ThumbnailStrip.jsx'
import CanvasPreview from './components/CanvasPreview.jsx'
import ControlsPanel from './components/ControlsPanel.jsx'
import EditActionsBar from './components/EditActionsBar.jsx'
import Icon from './components/Icon.jsx'
import { useProject, visibleImages } from './store/ProjectContext.jsx'
import { useSaveProject } from './hooks/useSaveProject.js'
import { shouldIgnoreShortcut, isMod } from './engine/keyboard.js'
import { useMediaQuery, MOBILE_QUERY } from './hooks/useMediaQuery.js'
import { useSessionRecovery } from './hooks/useSessionRecovery.js'
import { loadPresets } from './hooks/useProjectStore.js'
import logo from './assets/logo-wordmark.webp'

// Loaded on first use to keep the initial download small.
const CatalogView = lazy(() => import('./components/CatalogView.jsx'))
const ShortcutsHelp = lazy(() => import('./components/ShortcutsHelp.jsx'))
const AboutDialog = lazy(() => import('./components/AboutDialog.jsx'))
import { kofiUrl } from './config.js'
import WhatsNew from './components/WhatsNew.jsx'

const VIEW_MODES = [
  { mode: 'filmstrip', label: 'Filmstrip', icon: 'filmstrip' },
  { mode: 'loupe', label: 'Loupe', icon: 'loupe' },
  { mode: 'catalog', label: 'Projects', icon: 'grid' },
]

// Mobile: the filmstrip is hidden by default so the photo gets the room (like Lightroom
// Mobile); a toolbar button shows it, and swiping the photo changes photos. Remembered.
const STRIP_KEY = 'lumagrader.mobileStrip'
function readStripPref() {
  try { return window.localStorage.getItem(STRIP_KEY) === '1' } catch { return false }
}

export default function App() {
  const isMobile = useMediaQuery(MOBILE_QUERY)
  const [stripOpen, setStripOpen] = useState(readStripPref)
  const toggleStrip = useCallback(() => {
    setStripOpen((open) => {
      try { window.localStorage.setItem(STRIP_KEY, open ? '0' : '1') } catch { /* private mode */ }
      return !open
    })
  }, [])
  const { state, dispatch, undo, redo } = useProject()
  useSessionRecovery()

  // Saved presets load once at startup, whichever panel or tab is open.
  useEffect(() => {
    loadPresets()
      .then((presets) => dispatch({ type: 'LOAD_CUSTOM_PRESETS', presets }))
      .catch((err) => console.warn('Loading presets failed', err))
  }, [dispatch])
  const activePhoto = state.images.find((im) => im.id === state.activeId)
  const editingPhoto = !!activePhoto && state.viewMode !== 'catalog'
  const { saveProject, saveToDevice, saving, hasImages } = useSaveProject()
  const [showShortcuts, setShowShortcuts] = useState(false)
  const [showAbout, setShowAbout] = useState(false)
  const closeAbout = useCallback(() => setShowAbout(false), [])
  const closeShortcuts = useCallback(() => setShowShortcuts(false), [])

  // Global shortcuts. Canvas-specific keys live in CanvasPreview; export/remove in EditActionsBar.
  useEffect(() => {
    function onKeyDown(e) {
      if (shouldIgnoreShortcut(e)) return
      const key = e.key.toLowerCase()

      if (isMod(e) && key === 'z' && state.activeId) {
        e.preventDefault()
        if (e.shiftKey) redo(state.activeId)
        else undo(state.activeId)
        return
      }
      if (isMod(e) && key === 'y' && state.activeId) {
        e.preventDefault()
        redo(state.activeId)
        return
      }
      if (isMod(e) && key === 's') {
        e.preventDefault()
        saveProject()
        return
      }
      if (isMod(e) || e.altKey) return

      if (e.key === '?') {
        e.preventDefault()
        setShowShortcuts((v) => !v)
        return
      }
      const shown = visibleImages(state)
      if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && shown.length) {
        e.preventDefault()
        const idx = shown.findIndex((im) => im.id === state.activeId)
        const next = e.key === 'ArrowRight' ? Math.min(shown.length - 1, idx + 1) : Math.max(0, idx - 1)
        if (shown[next]) dispatch({ type: 'SET_ACTIVE', id: shown[next].id })
        return
      }
      if (/^[0-5]$/.test(e.key) && state.activeId) {
        e.preventDefault()
        dispatch({ type: 'SET_RATING', id: state.activeId, rating: Number(e.key) })
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  useEffect(() => {
    function onBeforeUnload(e) {
      if (!state.isDirty) return
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [state.isDirty])

  return (
    <div className="app">
      <header className={'app-header' + (editingPhoto ? ' is-editing' : '')}>
        <div className="header-left">
          <img src={logo} alt="LumaGrader by Rax" className="app-logo" width="508" height="120" />
          {state.currentProjectName && (
            <button type="button" className="project-name" onClick={() => saveProject({ rename: true })} title="Rename project">
              {state.currentProjectName}
              {state.isDirty && <span className="unsaved-dot" aria-label="unsaved changes" />}
            </button>
          )}
        </div>
        <nav className="view-toggle" aria-label="View">
          {VIEW_MODES.map(({ mode, label, icon }) => (
            <button
              key={mode}
              type="button"
              className={'tbtn' + (state.viewMode === mode ? ' active' : '')}
              aria-pressed={state.viewMode === mode}
              onClick={() => dispatch({ type: 'SET_VIEW_MODE', mode })}
              title={label}
            >
              <Icon name={icon} size={15} />
              <span className="btn-label">{label}</span>
            </button>
          ))}
        </nav>
        {editingPhoto && (
          // Mobile only: filmstrip + undo/redo live in the header so the photo gets the
          // whole area below it (the preview toolbar row is hidden on phones).
          <div className="header-quick show-mobile" role="toolbar" aria-label="Photo history">
            {state.viewMode !== 'loupe' && (
              <button type="button" className={'tbtn icon-only' + (stripOpen ? ' active' : '')} onClick={toggleStrip} aria-pressed={stripOpen} aria-label={stripOpen ? 'Hide filmstrip' : 'Show filmstrip'} title={stripOpen ? 'Hide filmstrip' : 'Show filmstrip (or swipe the photo)'}>
                <Icon name="filmstrip" size={16} />
              </button>
            )}
            <button type="button" className="tbtn icon-only" onClick={() => undo(activePhoto.id)} disabled={!activePhoto.history.past.length} aria-label="Undo" title="Undo">
              <Icon name="undo" size={16} />
            </button>
            <button type="button" className="tbtn icon-only" onClick={() => redo(activePhoto.id)} disabled={!activePhoto.history.future.length} aria-label="Redo" title="Redo">
              <Icon name="redo" size={16} />
            </button>
          </div>
        )}
        <div className="header-right">
          {state.viewMode !== 'catalog' && <EditActionsBar onAbout={() => setShowAbout(true)} onSaveToDevice={hasImages ? saveToDevice : null} />}
          <button
            type="button"
            className={'tbtn' + (state.isDirty ? ' has-changes' : '')}
            onClick={() => saveProject()}
            disabled={saving || !hasImages}
            title="Save project (Ctrl/⌘+S)"
          >
            <Icon name="save" size={15} />
            <span className="btn-label">{saving ? 'Saving…' : state.isDirty || !state.currentProjectId ? 'Save Project' : 'Saved'}</span>
            {state.isDirty && !saving && <span className="unsaved-dot" aria-label="unsaved changes" />}
          </button>
          <button
            type="button"
            className="tbtn icon-only hide-mobile"
            onClick={saveToDevice}
            disabled={saving || !hasImages}
            aria-label="Save project to device"
            title="Save project to device (.lumagrader file)"
          >
            <Icon name="toDevice" size={16} />
          </button>
          <button type="button" className="tbtn icon-only hide-mobile" onClick={() => setShowShortcuts(true)} aria-label="Keyboard shortcuts (?)" title="Keyboard shortcuts (?)">
            <Icon name="keyboard" size={16} />
          </button>
          {kofiUrl() && (
            <a className="tbtn support-link hide-mobile" href={kofiUrl()} target="_blank" rel="noopener noreferrer" title="Support LumaGrader on Ko-fi">
              <Icon name="coffee" size={15} />
              <span className="btn-label">Support</span>
            </a>
          )}
          <button type="button" className="tbtn icon-only about-btn" onClick={() => setShowAbout(true)} aria-label="About LumaGrader" title="About LumaGrader · what's new">
            <Icon name="info" size={16} />
          </button>
        </div>
      </header>
      <main className={'app-main view-' + state.viewMode}>
        {state.viewMode === 'catalog' ? (
          <Suspense fallback={<div className="empty"><span className="spinner" /></div>}>
            <CatalogView />
          </Suspense>
        ) : (
          <>
            {state.viewMode !== 'loupe' && (!isMobile || stripOpen) && <ThumbnailStrip />}
            <CanvasPreview />
            {state.viewMode !== 'loupe' && <ControlsPanel />}
          </>
        )}
      </main>
      {showShortcuts && (
        <Suspense fallback={null}>
          <ShortcutsHelp onClose={closeShortcuts} />
        </Suspense>
      )}
      {showAbout && (
        <Suspense fallback={null}>
          <AboutDialog onClose={closeAbout} />
        </Suspense>
      )}
      <WhatsNew />
    </div>
  )
}
